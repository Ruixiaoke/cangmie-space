// Edge Function 之间共享的代码：CORS、JSON 响应、Web Push 发送
// send-push（消息 / 好友请求 / 小游戏回合）和 agent-chat（榴莲的回复）都用这里的实现，行为保持一致。
// 注意：目录名以下划线开头，Supabase 不会把它当成一个可调用的函数部署，只会在被 import 时一起打包。
import webpush from "npm:web-push@3.6.7";

export const ALLOWED_ORIGINS = ["https://rickzhou0527.github.io"];
const LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export type Payload = { title: string; body: string; tag: string; peer?: string; tab?: string };

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const ok = ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN_RE.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export function reply(req: Request, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

export function cut(s: string, n: number): string {
  const chars = Array.from(s);
  return chars.length > n ? chars.slice(0, n).join("") + "…" : s;
}

// 只往浏览器官方的推送服务发请求（Apple、Google/FCM、Mozilla、Microsoft），
// 防止有人登记一个任意网址，让本函数替他向别的服务器发请求
const PUSH_HOST_RE = /^(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*notify\.windows\.com)$/i;
export function isPushService(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

export type Vapid = { subject: string; publicKey: string; privateKey: string };

// 推送给一个用户的所有设备，跳过正在前台使用的设备（active_until 还没到期）：
// Safari 无法在页面里拦截推送，只能在服务器这边不发；收件人的其他设备不受影响，页面自己会通过 Realtime 收到消息
// deno-lint-ignore no-explicit-any
export async function pushToUser(admin: any, recipient: string, payload: Payload, vapid: Vapid): Promise<{ sent: number; removed: number }> {
  const { data: subs, error: subErr } = await admin.from("push_subscriptions").select("id,endpoint,p256dh,auth")
    .eq("user_id", recipient)
    .or("active_until.is.null,active_until.lte." + new Date().toISOString());
  if (subErr) throw new Error("subscriptions_failed");
  if (!subs || subs.length === 0) return { sent: 0, removed: 0 };

  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const text = JSON.stringify(payload);
  let sent = 0;
  const gone: number[] = [];
  const ok: number[] = [];
  // deno-lint-ignore no-explicit-any
  await Promise.all(subs.map(async (s: any) => {
    if (!isPushService(s.endpoint)) {
      gone.push(s.id); // 不是推送服务的地址：不发，顺手删掉
      return;
    }
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        text,
        { TTL: 60 * 60 * 24, urgency: "high" },
      );
      sent++;
      ok.push(s.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(s.id);
      else console.error("push failed", code ?? String(e));
    }
  }));

  if (gone.length) await admin.from("push_subscriptions").delete().in("id", gone);
  if (ok.length) await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).in("id", ok);
  return { sent, removed: gone.length };
}
