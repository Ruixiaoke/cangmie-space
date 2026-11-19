// 飞行棋：群聊和私聊里的 2 到 4 人棋局（Supabase Edge Function，Deno）
//
// 前端带着用户自己的 JWT 调用：POST { game, action: "start" | "roll" | "move" | "tick" | "auto_off" | "rematch", plane?, version? }
// 服务器是唯一的裁判（见 game.ts）：骰子在这里掷；大厅操作（开桌 / 入座 / 离座 / 加减机器人）是 SQL 函数（fxq_open 等）。
// 平台注入：SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY；推送用 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT（和 send-push 共用，没有就不推送）。
// 规则引擎：chat/js/miniapps/fxq-rules.js 是唯一真相来源，supabase/functions/fxq/gen-rules.py 把它复制成 rules.gen.js（CI 检查没过期）。
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { corsHeaders, pushToUser, reply } from "../_shared/push.ts";
import { cryptoRng, handle, type Commit, type GameRow, type Store } from "./game.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return reply(req, 405, { error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !adminKey) return reply(req, 500, { error: "not_configured" });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(req, 400, { error: "invalid_body" });
  }

  const admin = createClient(url, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !auth?.user) return reply(req, 401, { error: "not_authenticated" });

  const store: Store = {
    async getGame(id: number) {
      const { data, error } = await admin.from("fxq_games").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error("db_error");
      return (data as GameRow | null) ?? null;
    },
    async canAccess(row: GameRow, user: string) {
      if (row.group_id != null) {
        const { data, error } = await admin.from("group_members").select("user_id").eq("group_id", row.group_id).eq("user_id", user).maybeSingle();
        if (error) throw new Error("db_error");
        return !!data;
      }
      // 私聊桌：必须是这对好友之一，且好友关系还在
      if (!row.dm_lo || !row.dm_hi || (user !== row.dm_lo && user !== row.dm_hi)) return false;
      const { data, error } = await admin.from("friendships").select("id").eq("status", "accepted")
        .or(`and(requester_id.eq.${row.dm_lo},addressee_id.eq.${row.dm_hi}),and(requester_id.eq.${row.dm_hi},addressee_id.eq.${row.dm_lo})`).limit(1);
      if (error) throw new Error("db_error");
      return !!data && data.length > 0;
    },
    async names(ids: string[]) {
      const out: Record<string, string> = {};
      if (!ids.length) return out;
      const { data } = await admin.from("profiles").select("id,nickname").in("id", ids);
      for (const r of (data ?? []) as { id: string; nickname: string }[]) out[r.id] = r.nickname;
      return out;
    },
    async groupName(group: number) {
      const { data } = await admin.from("groups").select("name").eq("id", group).maybeSingle();
      return (data?.name as string | undefined) ?? "群聊";
    },
    async commit(c: Commit) {
      const { data, error } = await admin.rpc("fxq_commit", {
        p_game: c.game,
        p_version: c.version,
        p_patch: c.patch,
        p_scores: c.scores,
        p_line: c.line,
        p_actor: c.actor,
      });
      if (error) throw new Error("commit_failed");
      return data === true;
    },
  };

  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  try {
    const r = await handle({
      store,
      now: () => Date.now(),
      rng: cryptoRng,
      push: vapidPublic && vapidPrivate && vapidSubject
        ? (user, payload) => pushToUser(admin, user, payload, { subject: vapidSubject, publicKey: vapidPublic, privateKey: vapidPrivate })
        : undefined,
    }, auth.user.id, body);
    return reply(req, r.status, r.body);
  } catch (e) {
    console.error("fxq failed", e instanceof Error ? e.message : String(e));
    return reply(req, 500, { error: "server_error" });
  }
});
