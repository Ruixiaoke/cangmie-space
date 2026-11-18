// 聊天小程序的 Web Push 发送函数（Supabase Edge Function，Deno）
//
// 前端在发消息 / 发好友请求 / 通过好友请求之后，带着用户自己的 JWT 调用本函数；
// 函数核对"调用者确实刚刚做了这件事"，再用 VAPID 给对方所有已订阅的设备推送。
// 平台注入：SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY；需要手动设置的 secret：
// VAPID_PUBLIC_KEY、VAPID_PRIVATE_KEY、VAPID_SUBJECT。
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { corsHeaders, cut, pushToUser, reply, type Payload } from "../_shared/push.ts";

const FRESH_MS = 2 * 60 * 1000;

type PushEvent = { type: "message" | "friend_request" | "friend_accepted" | "sling_turn" | "pool_turn"; id: number };

// 特效表情 "[雪球]" 或定向的 "[雪球]#123"：去掉结尾的 #数字，不让原始 id 出现在通知里
function stripStickerId(s: string): string {
  return s.replace(/^(\[[^\[\]]{1,6}\])#\d+$/, "$1");
}

// 井字棋邀请 "[井字棋]#123" 推送成一句话，不暴露对局 id
function pushText(s: string): string {
  if (/^\[井字棋\]#\d+$/.test(s)) return "邀请你下一局井字棋";
  if (/^\[弹弓大战\]#\d+$/.test(s)) return "邀请你玩弹弓大战";
  if (/^\[斗地主\]#\d+$/.test(s)) return "开了一桌斗地主，来玩";
  if (/^\[[89]球台球\]#\d+$/.test(s)) return "邀请你打一局" + s.slice(1, 5);
  return stripStickerId(s);
}

function isFresh(ts: string | null | undefined): boolean {
  const t = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(t) && Date.now() - t < FRESH_MS && t - Date.now() < 60 * 1000;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return reply(req, 405, { error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!url || !adminKey) {
    return reply(req, 500, { error: "not_configured" });
  }

  // 解析请求
  let ev: PushEvent;
  try {
    const b = await req.json();
    if (!b || !["message", "friend_request", "friend_accepted", "sling_turn", "pool_turn"].includes(b.type) || !Number.isSafeInteger(b.id) || b.id <= 0) {
      return reply(req, 400, { error: "invalid_body" });
    }
    ev = { type: b.type, id: b.id };
  } catch {
    return reply(req, 400, { error: "invalid_body" });
  }

  const admin = createClient(url, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 调用者身份来自 JWT
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !auth?.user) return reply(req, 401, { error: "not_authenticated" });
  if (!vapidPublic || !vapidPrivate || !vapidSubject) {
    return reply(req, 200, { skipped: true, reason: "push_not_configured" });
  }
  const me = auth.user.id;

  // 核对事件，得出收件人、推送内容和去重用的 ref_id
  let recipient: string;
  let payload: Payload;
  let refId: number;
  let groupRecipients: string[] | null = null; // 群消息：推给群里除发送者以外的所有成员

  if (ev.type === "message") {
    const { data: m } = await admin.from("messages").select("id,sender_id,receiver_id,group_id,author,body,created_at,reply_to").eq("id", ev.id).maybeSingle();
    if (!m || m.sender_id !== me) return reply(req, 403, { error: "forbidden" });
    if (!isFresh(m.created_at)) return reply(req, 400, { error: "too_old" });
    if (m.author === "system") return reply(req, 200, { skipped: true }); // 系统提示行不推送
    const { data: p } = await admin.from("profiles").select("nickname").eq("id", me).maybeSingle();
    refId = m.id;
    // 引用回复：推送正文前加上 回复「被引用的内容」
    let prefix = "";
    if (typeof m.reply_to === "number") {
      const { data: q } = await admin.from("messages").select("body").eq("id", m.reply_to).maybeSingle();
      if (q && typeof q.body === "string") prefix = "回复「" + cut(stripStickerId(q.body).replace(/^\[([^\[\]]{1,6})\]$/, "$1").replace(/\s+/g, " "), 20) + "」"; // 特效表情 "[水枪]" 显示成 水枪
    }
    if (typeof m.group_id === "number") {
      // 群消息：调用者必须还在群里；标题是群名，正文是 昵称：预览
      const { data: g } = await admin.from("groups").select("name").eq("id", m.group_id).maybeSingle();
      const { data: ms } = await admin.from("group_members").select("user_id").eq("group_id", m.group_id);
      const ids = ((ms ?? []) as { user_id: string }[]).map((r) => r.user_id);
      if (!g || !ids.includes(me)) return reply(req, 403, { error: "forbidden" });
      groupRecipients = ids.filter((id) => id !== me);
      recipient = me; // 不会用到
      payload = { title: g.name ?? "群聊", body: cut((p?.nickname ?? "好友") + "：" + prefix + pushText(m.body), 80), tag: "grp-" + m.group_id, group: m.group_id };
    } else {
      recipient = m.receiver_id;
      payload = { title: p?.nickname ?? "新消息", body: cut(prefix + pushText(m.body), 80), tag: "msg-" + me, peer: me };
    }
  } else if (ev.type === "sling_turn") {
    // 弹弓大战：出手后通知对方轮到 Ta 了；出手记录必须是调用者刚刚打的
    const { data: sh } = await admin.from("sling_shots").select("id,game_id,shooter,knocked,created_at").eq("id", ev.id).maybeSingle();
    if (!sh || sh.shooter !== me) return reply(req, 403, { error: "forbidden" });
    if (!isFresh(sh.created_at)) return reply(req, 400, { error: "too_old" });
    const { data: g } = await admin.from("sling_games").select("player_a,player_b,score_a,score_b").eq("id", sh.game_id).maybeSingle();
    if (!g) return reply(req, 403, { error: "forbidden" });
    const { data: p } = await admin.from("profiles").select("nickname").eq("id", me).maybeSingle();
    recipient = g.player_a === me ? g.player_b : g.player_a;
    const mine = recipient === g.player_a ? g.score_a : g.score_b;
    const theirs = recipient === g.player_a ? g.score_b : g.score_a;
    refId = sh.id;
    payload = {
      title: p?.nickname ?? "弹弓大战",
      body: sh.knocked ? "打中你了！比分 " + mine + ":" + theirs : "轮到你了（弹弓大战）",
      tag: "sling-" + me,
      peer: me,
    };
  } else if (ev.type === "pool_turn") {
    // 9球/8球台球：出杆后，轮到对方时通知（继续出杆的那一杆不通知）；出杆记录必须是调用者刚刚打的
    const { data: sh } = await admin.from("pool_shots").select("id,game_id,shooter,foul,keep,won,lost,created_at").eq("id", ev.id).maybeSingle();
    if (!sh || sh.shooter !== me) return reply(req, 403, { error: "forbidden" });
    if (!isFresh(sh.created_at)) return reply(req, 400, { error: "too_old" });
    if (sh.keep) return reply(req, 200, { skipped: true });
    const { data: g } = await admin.from("pool_games").select("player_a,player_b,score_a,score_b,mode").eq("id", sh.game_id).maybeSingle();
    if (!g) return reply(req, 403, { error: "forbidden" });
    const { data: p } = await admin.from("profiles").select("nickname").eq("id", me).maybeSingle();
    recipient = g.player_a === me ? g.player_b : g.player_a;
    const mine = recipient === g.player_a ? g.score_a : g.score_b;
    const theirs = recipient === g.player_a ? g.score_b : g.score_a;
    refId = sh.id;
    const eight = g.mode === "eight";
    const name = eight ? "8球台球" : "9球台球";
    const score = "（" + mine + ":" + theirs + "）";
    payload = {
      title: p?.nickname ?? name,
      body: eight
        ? (sh.won ? "Ta 打进了8号球，这一盘你输了" + score
          : sh.lost ? (sh.foul ? "Ta 打8号球时犯规了，这一盘你赢了" : "Ta 提前打进了8号球，这一盘你赢了") + score
          : sh.foul ? "Ta 犯规了，你有自由球（" + name + "）" : "轮到你了（" + name + "）")
        : (sh.won ? "Ta 打进了9号球，这一盘你输了" + score : sh.foul ? "Ta 犯规了，你有自由球（9球台球）" : "轮到你了（9球台球）"),
      tag: "pool-" + me,
      peer: me,
    };
  } else {
    const { data: f } = await admin.from("friendships").select("id,requester_id,addressee_id,status,updated_at").eq("id", ev.id).maybeSingle();
    if (!f) return reply(req, 403, { error: "forbidden" });
    const wantStatus = ev.type === "friend_request" ? "pending" : "accepted";
    const caller = ev.type === "friend_request" ? f.requester_id : f.addressee_id;
    if (caller !== me || f.status !== wantStatus) return reply(req, 403, { error: "forbidden" });
    if (!isFresh(f.updated_at)) return reply(req, 400, { error: "too_old" });
    const { data: p } = await admin.from("profiles").select("nickname").eq("id", me).maybeSingle();
    const name = p?.nickname ?? "好友";
    // 被拒绝后可以重新发起，同一行 id 会复用，所以把更新时间（秒）拼进去重键
    refId = f.id * 10_000_000_000 + Math.floor(Date.parse(f.updated_at) / 1000);
    if (ev.type === "friend_request") {
      recipient = f.addressee_id;
      payload = { title: "新的好友请求", body: name + " 想加你为好友", tag: "req-" + me, tab: "friends" };
    } else {
      recipient = f.requester_id;
      payload = { title: "好友请求已通过", body: name + " 通过了你的好友请求", tag: "req-" + me, peer: me };
    }
  }

  // 先占位：已经推送过就跳过（并发或重放）
  const { error: logErr } = await admin.from("push_log").insert({ kind: ev.type, ref_id: refId });
  if (logErr) {
    if (logErr.code === "23505") return reply(req, 200, { skipped: true });
    return reply(req, 500, { error: "log_failed" });
  }

  // 跳过正在前台使用的设备的逻辑在 _shared/push.ts 的 pushToUser 里
  if (groupRecipients) {
    const vapid = { subject: vapidSubject, publicKey: vapidPublic, privateKey: vapidPrivate };
    const rs = await Promise.allSettled(groupRecipients.map((to) => pushToUser(admin, to, payload, vapid)));
    let sent = 0, removed = 0;
    for (const r of rs) if (r.status === "fulfilled") { sent += r.value.sent; removed += r.value.removed; }
    return reply(req, 200, { sent, removed });
  }
  try {
    const r = await pushToUser(admin, recipient, payload, { subject: vapidSubject, publicKey: vapidPublic, privateKey: vapidPrivate });
    return reply(req, 200, { sent: r.sent, removed: r.removed });
  } catch {
    return reply(req, 500, { error: "subscriptions_failed" });
  }
});
