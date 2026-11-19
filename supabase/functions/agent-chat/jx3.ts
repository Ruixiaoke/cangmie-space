// 剑三（剑网三）公开游戏数据：jx3_info 工具。数据来自第三方 JX3API（https://www.jx3api.com，非官方），只用不要 token 的免费接口。
//
// 只读；请求里只带服务器名、活动名这类参数，不带任何用户信息。结果在函数实例里缓存几分钟，免得一问一请求。
// 接口挂了 / 改了格式时返回 { error }，助手会说查不到，聊天本身不受影响。
// 以后买了 token 想接金价、物价、奇遇：在这里加 kind，并把 token 放进 Edge Function 的 secret（不要写进代码）。

export const JX3_BASE = "https://www.jx3api.com";
export const JX3_KINDS = ["calendar", "server", "news", "celebs", "saohua"] as const;
export const JX3_CELEBS = ["楚天社", "云从社", "披风会", "穹野卫"];
const TIMEOUT_MS = 6000;
const TTL_MS: Record<string, number> = { calendar: 10 * 60_000, server: 60_000, news: 10 * 60_000, celebs: 2 * 60_000, saohua: 0 };
const NEWS_EXCERPT = 400;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const cache = new Map<string, { at: number; text: string }>();
export function jx3CacheClear() { cache.clear(); }

class Jx3Error extends Error {
  constructor(public code: string, public msg?: string) { super(code); }
}

async function get(fetchFn: typeof fetch, path: string, params: Record<string, string | number>): Promise<unknown> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const url = JX3_BASE + path + (qs.size ? "?" + qs.toString() : "");
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { "Accept": "application/json", "User-Agent": "cangmie-chat-agent" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Jx3Error("jx3_unavailable");
  }
  if (!res.ok) { await res.body?.cancel(); throw new Jx3Error("jx3_unavailable"); }
  let body: Row;
  try { body = await res.json(); } catch { throw new Jx3Error("jx3_unavailable"); }
  // HTTP 永远 200，业务状态在 body.status
  if (body?.status !== 200) throw new Jx3Error(body?.status === 400 ? "bad_argument" : "jx3_unavailable", typeof body?.detail === "string" ? body.detail.slice(0, 40) : undefined);
  return body.detail;
}

// 公告正文是 HTML：去标签、合并空白，只留开头一段
export function stripHtml(html: string): string {
  return String(html ?? "")
    .replace(/<\s*(br|\/p|\/div|\/li)\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t　]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();
}
const clip = (s: string, n: number) => { const a = Array.from(s); return a.length > n ? a.slice(0, n).join("") + "…" : s; };
const beijing = (unix: number) => {
  if (!Number.isFinite(unix) || unix <= 0) return null;
  const d = new Date(unix * 1000 + 8 * 3600_000);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

async function run(fetchFn: typeof fetch, kind: string, args: Row): Promise<{ key: string; out: Row }> {
  if (kind === "calendar") {
    const day = Number.isInteger(args.day) ? Math.max(0, Math.min(6, args.day as number)) : 0;
    const d = await get(fetchFn, "/active/calendar", { num: day }) as Row;
    return {
      key: "calendar:" + day,
      out: {
        date: d.date, week: d.week ? "星期" + d.week : undefined,
        war: d.war, battle: d.battle, school: d.school, rescue: d.rescue, orecar: d.orecar,
        lucky_pets: d.lucky, card: d.card, leader: d.leader, draw: d.draw,
        weekly: d.weekly ? { raid: d.weekly.raid, conn: d.weekly.conn } : undefined,
        legend: "war 大战，battle 战场，orecar 矿车，lucky_pets 福缘宠物，weekly.raid 本周团队副本，weekly.conn 本周秘境；school、rescue、card、leader、draw 按原文说，拿不准含义就别解释",
      },
    };
  }
  if (kind === "server") {
    const server = typeof args.server === "string" ? args.server.trim().slice(0, 12) : "";
    if (!server) throw new Jx3Error("server_required");
    const [now, log] = await Promise.all([
      get(fetchFn, "/server/status/check", { server, type: 2 }) as Promise<Row>,
      (get(fetchFn, "/server/status/check", { server }) as Promise<Row[]>).catch(() => null),
    ]);
    const last = Array.isArray(log) ? log[0] : null;
    return {
      key: "server:" + server,
      out: {
        server: now.server ?? server, zone: now.zone, status: now.status,
        last_open: last ? beijing(Number(last.lasttime)) : undefined,
        last_close: last ? beijing(Number(last.shuttime)) : undefined,
        note: "status 是官方在线状态（维护 / 正常 / 拥挤 / 爆满）；时间是北京时间",
      },
    };
  }
  if (kind === "news") {
    const limit = Number.isInteger(args.limit) ? Math.max(1, Math.min(5, args.limit as number)) : 3;
    const list = await get(fetchFn, "/news/announce", { limit }) as Row[];
    const items = (Array.isArray(list) ? list : []).slice(0, limit);
    return {
      key: "news:" + limit,
      out: {
        items: items.map((n, i) => ({
          title: n.title, date: n.date, type: n.type, url: typeof n.url === "string" && /^https:\/\//.test(n.url) ? n.url : undefined,
          excerpt: i === 0 && n.desc?.content ? clip(stripHtml(n.desc.content), NEWS_EXCERPT) : undefined,
        })),
        note: "只给了第一条公告的开头一段，要细节就把链接发给他们",
      },
    };
  }
  if (kind === "celebs") {
    const name = typeof args.name === "string" && JX3_CELEBS.includes(args.name) ? args.name : JX3_CELEBS[0];
    const list = await get(fetchFn, "/active/celebs", { name }) as Row[];
    return {
      key: "celebs:" + name,
      out: {
        name,
        next: (Array.isArray(list) ? list : []).slice(0, 8).map((e) => `${e.time} ${e.map}·${e.site}：${e.stage}`),
        note: "接下来的公共任务，时间是北京时间",
      },
    };
  }
  if (kind === "saohua") {
    const d = await get(fetchFn, "/saohua/random", {}) as Row;
    return { key: "saohua", out: { text: typeof d?.text === "string" ? clip(d.text, 120) : "" } };
  }
  throw new Jx3Error("bad_kind");
}

// 工具入口：返回给模型的 JSON 字符串，永远不抛出
export async function jx3Info(fetchFn: typeof fetch, args: Row, now = Date.now()): Promise<string> {
  const kind = typeof args.kind === "string" ? args.kind : "";
  if (!(JX3_KINDS as readonly string[]).includes(kind)) return JSON.stringify({ error: "bad_kind", allowed: JX3_KINDS });
  // 缓存键要在请求前就能算出来：和 run() 里的规则保持一致
  const pre = kind === "calendar" ? "calendar:" + (Number.isInteger(args.day) ? Math.max(0, Math.min(6, args.day)) : 0)
    : kind === "server" ? "server:" + (typeof args.server === "string" ? args.server.trim().slice(0, 12) : "")
    : kind === "news" ? "news:" + (Number.isInteger(args.limit) ? Math.max(1, Math.min(5, args.limit)) : 3)
    : kind === "celebs" ? "celebs:" + (typeof args.name === "string" && JX3_CELEBS.includes(args.name) ? args.name : JX3_CELEBS[0])
    : "saohua";
  const hit = cache.get(pre);
  if (hit && now - hit.at < (TTL_MS[kind] ?? 0)) return hit.text;
  try {
    const { key, out } = await run(fetchFn, kind, args);
    const text = JSON.stringify({ kind, source: "JX3API（第三方，非官方）", ...out });
    if (TTL_MS[kind]) {
      if (cache.size > 200) cache.clear();
      cache.set(key, { at: now, text });
    }
    return text;
  } catch (e) {
    if (e instanceof Jx3Error) {
      if (e.code === "server_required") return JSON.stringify({ error: "server_required", hint: "问清楚是哪个服务器，例如 梦江南、乾坤一掷" });
      if (e.code === "bad_argument") return JSON.stringify({ error: "bad_argument", message: e.msg ?? "参数不对" });
      return JSON.stringify({ error: e.code, hint: "剑三数据暂时查不到，直说就好，别编" });
    }
    return JSON.stringify({ error: "jx3_unavailable" });
  }
}
