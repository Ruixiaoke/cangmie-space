// 榴莲（Durian）：聊天里的 AI 助手（Supabase Edge Function，Deno）
//
// 流程：前端先用 agent_ask(消息 id) 建任务，再带着用户自己的 JWT 调用本函数 { job: 任务 id }。
// 函数核对调用者就是提问的人、任务还是 pending，把它改成 running，立刻回 202，
// 真正的工作放进 EdgeRuntime.waitUntil（Supabase 的后台任务）里继续跑，客户端可以直接断开。
// 回复作为一条 author = 'durian' 的消息写进聊天，任务改成 done；任何失败都改成 failed 并带一个短代码。
//
// 平台注入：SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY。需要设置的 secret：
//   OPENAI_API_KEY（没有的话任务以 agent_unconfigured 失败，前端显示「榴莲还没接通」）
//   OPENAI_MODEL（可选，默认 gpt-6-luna）
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT（推送，和 send-push 共用；没有就不推送）
//
// 人设：agent/persona.md 是唯一真相来源。Edge Function 只会打包 supabase/functions 里被 import 的文件，
// 所以 agent/gen-persona.py 把它原样生成成 persona.gen.ts（已提交，deno check 和本地运行直接可用；
// CI 会检查它没过期，backend.yml 部署前会重新生成一遍）。
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { corsHeaders, pushToUser, reply } from "../_shared/push.ts";
import { runJob } from "./agent.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return reply(req, 405, { error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !adminKey) return reply(req, 500, { error: "not_configured" });

  let jobId: number;
  try {
    const b = await req.json();
    if (!b || !Number.isSafeInteger(b.job) || b.job <= 0) return reply(req, 400, { error: "invalid_body" });
    jobId = b.job;
  } catch {
    return reply(req, 400, { error: "invalid_body" });
  }

  const admin = createClient(url, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !auth?.user) return reply(req, 401, { error: "not_authenticated" });

  // 认领任务：只有提问的人、只有 pending 的才能开工（原子更新，重复调用只会有一次成功）
  const { data: claimed, error: claimErr } = await admin.from("agent_jobs")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("id", jobId).eq("asker", auth.user.id).eq("status", "pending").select("id");
  if (claimErr) return reply(req, 500, { error: "claim_failed" });
  if (!claimed || claimed.length === 0) return reply(req, 409, { error: "not_pending" });

  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  const work = runJob({
    admin,
    apiKey: Deno.env.get("OPENAI_API_KEY") || undefined,
    model: Deno.env.get("OPENAI_MODEL") || "gpt-6-luna",
    fetchFn: fetch,
    push: async (to, payload) => {
      if (!vapidPublic || !vapidPrivate || !vapidSubject) return;
      await pushToUser(admin, to, payload, { subject: vapidSubject, publicKey: vapidPublic, privateKey: vapidPrivate });
    },
  }, jobId);

  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime) EdgeRuntime.waitUntil(work);
  else await work; // 本地 / 没有后台任务支持时，等做完再回
  return reply(req, 202, { job: jobId, status: "running" });
});
