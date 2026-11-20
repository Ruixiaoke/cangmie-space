// 剑三（剑网三）公开游戏数据：jx3_info 工具。数据来自第三方 JX3API（https://www.jx3api.com，非官方），只用不要 token 的免费接口。
//
// 只读；请求里只带服务器名、活动名这类参数，不带任何用户信息。结果在函数实例里缓存几分钟，免得一问一请求。
// JX3API 服务器在大陆，从海外访问常要 5 到 10 秒甚至超时：单次 10 秒，网络失败重试一次。
// 日常（calendar）由 GitHub Actions（.github/workflows/jx3-calendar.yml）每天早上预先抓进 public.jx3_calendar，这里先读库；
// 库里没有那一天时才现查，查到的写回库里。
// 接口挂了 / 改了格式时返回 { error }，助手会说查不到，聊天本身不受影响。
// 物价和万宝楼（auction / wbl_role / wbl_look）走另外两个免费的第三方 / 官方未公开接口：
//   JX3BOX（node.jx3box.com 搜物品，next2.jx3box.com 交易行价格）、万宝楼 trade-api.seasunwbl.com（在售角色 / 外观 / 金币）。
// 金价（gold）：万宝楼在售金币（goods_type=1），每份标价 ¥10 之类、卖若干金，attrs.gold_price 是「1 元能买多少金」。
//   JX3BOX 的金价走势接口（spider2.jx3box.com/api/spider/gold/trend）2026 年 5 月以后就不更新了，别用。
//   都不要登录，请求里只带物品名 / 服务器名 / 门派这类参数；接口随时可能改，所以出错一律返回 { error }。
// 以后买了 token 想接奇遇、第三方平台金价：在这里加 kind，并把 token 放进 Edge Function 的 secret（不要写进代码）。

export const JX3_BASE = "https://www.jx3api.com";
export const JX3_KINDS = ["calendar", "server", "news", "celebs", "saohua", "auction", "wbl_role", "wbl_look", "gold"] as const;
export const JX3_CELEBS = ["楚天社", "云从社", "披风会", "穹野卫"];
const TIMEOUT_MS = 10_000;
const TRIES = 2;
const TTL_MS: Record<string, number> = { calendar: 10 * 60_000, server: 60_000, news: 10 * 60_000, celebs: 2 * 60_000, saohua: 0, auction: 5 * 60_000, wbl_role: 3 * 60_000, wbl_look: 3 * 60_000, gold: 3 * 60_000 };
const GATEWAY_TTL_MS = 60 * 60_000;
const WBL_SIZE = 8;
const LOOK_PAGE_SIZE = 10; // 万宝楼 size 超过 10 左右就报「每页数量格式不正确」
const LOOK_PAGES = 3;
const HOT_NAMES = 5; // 不带外观名又指定了服务器：取全服最热门的几个名字，再逐个查它在本服最便宜的价
// 万宝楼外观类型 id（goods_filter_config?goods_type=3 的 appearance_type，筛选参数 filter[appearance_type]）
export const LOOK_TYPES = ["外观礼盒", "上衣", "发型", "披风", "头饰", "背挂", "腰挂", "面挂", "肩饰", "眼饰", "手饰", "佩囊", "小头像", "宠物", "挂宠", "坐骑", "马具", "其他"];
const NEWS_EXCERPT = 400;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Gate = { server_id: string; server_name: string; zone_id: string; zone_name: string };
const cache = new Map<string, { at: number; text: string }>();
let gateCache: { at: number; list: Gate[] } | null = null;
export function jx3CacheClear() { cache.clear(); gateCache = null; }

class Jx3Error extends Error {
  constructor(public code: string, public msg?: string) { super(code); }
}

// 网络失败 / 超时 / 5xx 重试一次；业务错误（比如服务器名不对）不重试
async function get(fetchFn: typeof fetch, path: string, params: Record<string, string | number>): Promise<unknown> {
  for (let i = 0; ; i++) {
    try {
      return await getOnce(fetchFn, path, params);
    } catch (e) {
      if (!(e instanceof Jx3Error) || e.code !== "jx3_unavailable" || e.msg || i + 1 >= TRIES) throw e;
    }
  }
}
async function getOnce(fetchFn: typeof fetch, path: string, params: Record<string, string | number>): Promise<unknown> {
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

export const JX3BOX_ITEM_URL = "https://node.jx3box.com/item_merged/name/";
export const JX3BOX_AUCTION_URL = "https://next2.jx3box.com/api/auction/";
export const WBL_BASE = "https://trade-api.seasunwbl.com/api";

// 通用 JSON 请求（JX3BOX / 万宝楼）：10 秒超时，网络失败 / 5xx / 非 JSON 重试一次
async function httpJson(fetchFn: typeof fetch, url: string, post?: unknown): Promise<unknown> {
  for (let i = 0; ; i++) {
    try {
      let res: Response;
      try {
        const headers: Record<string, string> = { "Accept": "application/json", "User-Agent": "cangmie-chat-agent" };
        if (post !== undefined) headers["Content-Type"] = "application/json";
        res = await fetchFn(url, { method: post === undefined ? "GET" : "POST", headers, body: post === undefined ? undefined : JSON.stringify(post), signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        throw new Jx3Error("jx3_unavailable");
      }
      if (!res.ok) { await res.body?.cancel(); throw new Jx3Error("jx3_unavailable"); }
      try { return await res.json(); } catch { throw new Jx3Error("jx3_unavailable"); }
    } catch (e) {
      if (i + 1 >= TRIES || !(e instanceof Jx3Error)) throw e;
    }
  }
}

// 铜 -> 「548金72银」（1金 = 10000铜，1银 = 100铜）
export function fmtCopper(c: number): string {
  const n = Math.max(0, Math.round(c));
  const g = Math.floor(n / 10000), sv = Math.floor((n % 10000) / 100), cu = n % 100;
  return (g ? g + "金" : "") + (sv ? sv + "银" : "") + (cu || (!g && !sv) ? cu + "铜" : "");
}
// 分 -> 「¥1099」/「¥1099.5」
export function fmtYuan(fen: number): string {
  const y = Math.round(fen) / 100;
  return "¥" + (Number.isInteger(y) ? String(y) : y.toFixed(2).replace(/0+$/, ""));
}

// 金 -> 「9020金」/「10.8万金」
export function fmtGold(g: number): string {
  const n = Math.max(0, Math.round(g));
  return n >= 10000 ? (Math.round(n / 1000) / 10) + "万金" : n + "金";
}
// 用户说「金价」「金币」时模型常把它当交易行物品名：这几个名字转去查金价
const GOLD_WORDS = ["金", "金币", "金价", "金子", "游戏币", "金币比例"];

const str = (v: unknown, n: number) => typeof v === "string" ? v.trim().slice(0, n) : "";
const serverArg = (v: unknown) => str(v, 12).replace(/服$/, "");

// 万宝楼门派 id（goods_filter_config 里的）；用户常说简称，按前两个字对
const SECTS: [number, string][] = [[21, "段氏"], [20, "万灵山庄"], [19, "刀宗"], [18, "北天药宗"], [17, "衍天宗"], [1, "凌雪阁"], [2, "蓬莱"], [3, "霸刀山庄"], [4, "长歌门"], [5, "苍云"], [6, "丐帮"], [7, "明教"], [8, "唐门"], [9, "五毒教"], [10, "藏剑山庄"], [11, "天策府"], [12, "纯阳宫"], [13, "少林寺"], [14, "七秀坊"], [15, "万花谷"]];
const SHAPES: [number, string][] = [[1, "成男"], [2, "成女"], [3, "正太"], [4, "萝莉"]];
export function sectId(name: string): { id: number; name: string } | null {
  const n = name.replace(/[ 　]/g, "");
  if (n.length < 2) return null;
  if (n.startsWith("药宗")) return { id: 18, name: "北天药宗" };
  const hit = SECTS.find(([, full]) => full.startsWith(n.slice(0, 2)) || n.startsWith(full.slice(0, 2)));
  return hit ? { id: hit[0], name: hit[1] } : null;
}
export function shapeId(name: string): { id: number; name: string } | null {
  const n = name.replace(/[ 　]/g, "");
  const alias = n === "男" ? "成男" : n === "女" ? "成女" : n === "少年" || n === "男孩" ? "正太" : n === "小女孩" || n === "女孩" || n === "小萝莉" ? "萝莉" : n;
  const hit = SHAPES.find(([, full]) => full === alias);
  return hit ? { id: hit[0], name: hit[1] } : null;
}

// 服务器名 -> 万宝楼的 server_id（来自 /platform/setting/gateways，缓存一小时）
async function gateways(fetchFn: typeof fetch, now: number): Promise<Gate[]> {
  if (gateCache && now - gateCache.at < GATEWAY_TTL_MS) return gateCache.list;
  const b = await httpJson(fetchFn, WBL_BASE + "/platform/setting/gateways") as Row;
  const list: Gate[] = [];
  if (b?.code !== 1) throw new Jx3Error("jx3_unavailable");
  for (const z of Array.isArray(b?.data?.list) ? b.data.list : []) {
    for (const sv of Array.isArray(z.servers) ? z.servers : []) list.push({ server_id: String(sv.server_id), server_name: String(sv.server_name), zone_id: String(z.zone_id), zone_name: String(z.zone_name) });
  }
  if (!list.length) throw new Jx3Error("jx3_unavailable");
  gateCache = { at: now, list };
  return list;
}
async function findGate(fetchFn: typeof fetch, server: string, now: number): Promise<Gate> {
  const list = await gateways(fetchFn, now);
  const g = list.find((x) => x.server_name === server);
  if (!g) throw new Jx3Error("server_unknown", list.map((x) => x.server_name).join("、"));
  return g;
}
async function wblList(fetchFn: typeof fetch, params: Record<string, string | number>): Promise<{ list: Row[]; total: number }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const b = await httpJson(fetchFn, WBL_BASE + "/buyer/goods/list?" + qs.toString()) as Row;
  if (b?.code !== 1 || !Array.isArray(b?.data?.list)) throw new Jx3Error("jx3_unavailable");
  return { list: b.data.list, total: Number(b.data.total_record) || 0 };
}

// 金价：万宝楼某服在售金币，按「1 元买多少金」从高到低（对买家最划算的在前），再取一条最低的看区间
// 2026-11 实测所有服都在 1元 = 739 到 902 金之间，最划算的一页全挂在 902：万宝楼给比例设了上下限，顶格时要提醒这是上限不是自由行情
const goldRatio = (r: Row) => {
  const g = Number(r?.attrs?.gold_price);
  if (Number.isFinite(g) && g > 0) return g;
  const size = Number(r?.single_unit_size), fen = Number(r?.single_unit_price);
  return size > 0 && fen > 0 ? Math.floor(size / (fen / 100)) : NaN;
};
async function gold(fetchFn: typeof fetch, g: Gate): Promise<Row> {
  const base = { goods_type: 1, page: 1, zone_id: g.zone_id, server_id: g.server_id };
  const [best, worst] = await Promise.all([
    wblList(fetchFn, { ...base, size: LOOK_PAGE_SIZE, "sort[gold_price]": 0 }),
    wblList(fetchFn, { ...base, size: 1, "sort[gold_price]": 1 }),
  ]);
  const rows = best.list.filter((r) => Number.isFinite(goldRatio(r)));
  const note = "数据来自官方万宝楼的在售金币（寄售中的报价，不是成交价），可能有延迟，仅供参考；比例是 1 元能买多少金，越高越划算。不提供卖家信息，要买请对方自己去万宝楼看。DD373、UU898 这些第三方平台的价格查不到";
  if (!rows.length) return { server: g.server_name, zone: g.zone_name, on_sale: false, note: "万宝楼这个服现在没有在售的金币。" + note };
  const top = goldRatio(rows[0]);
  const low = worst.list.length ? goldRatio(worst.list[0]) : NaN;
  const capped = rows.length >= LOOK_PAGE_SIZE && rows.every((r) => goldRatio(r) === top);
  const atTop = rows.filter((r) => goldRatio(r) === top).reduce((s, r) => s + Math.max(0, Number(r.single_unit_size) || 0) * Math.max(0, Number(r.remain_unit_count) || 0), 0);
  return {
    server: g.server_name, zone: g.zone_name, on_sale: true,
    best: `1元 = ${top}金`,
    per_10k_gold: "1万金 ≈ " + fmtYuan(Math.round(1_000_000 / top)),
    best_ratio_stock: atTop ? "这个比例前几单合计约 " + fmtGold(atTop) : undefined,
    range: Number.isFinite(low) && low !== top ? `在售比例从 1元 = ${low}金 到 1元 = ${top}金` : undefined,
    top_ratios: rows.map(goldRatio),
    capped: capped || undefined,
    note: (capped ? "最划算的一整页都挂在同一个比例，多半是万宝楼允许的比例上限，实际行情可能比这更划算，报的时候说明这一点。" : "") + note,
  };
}

// 交易行：先在 JX3BOX 按名字搜物品，再查价格。同名物品（比如绑定 / 不绑定）会有好几个 id，一次把前几个候选的价格都查了，取第一个有价格的
async function auction(fetchFn: typeof fetch, item: string, server: string): Promise<Row> {
  const found = await httpJson(fetchFn, JX3BOX_ITEM_URL + encodeURIComponent(item) + "?client=std&per=10") as Row;
  const rows: Row[] = (Array.isArray(found?.list) ? found.list : []).filter((r: Row) => typeof r?.id === "string" && typeof r?.Name === "string");
  if (!rows.length) return { item, server, found: false, note: "JX3BOX 里没搜到这个物品名，让对方给更准确的名字" };
  const exact = rows.filter((r) => r.Name === item);
  // 绑定的（BindType 3）不能上交易行，排后面
  const rank = (r: Row) => (r.BindType === 3 ? 1 : 0);
  const pool = (exact.length ? exact : rows.filter((r) => r.Name.includes(item))).slice();
  if (!pool.length) pool.push(...rows);
  pool.sort((a, b) => rank(a) - rank(b) || (exact.length ? 0 : a.Name.length - b.Name.length));
  const cands = pool.slice(0, 3);
  const prices = await httpJson(fetchFn, JX3BOX_AUCTION_URL, { item_ids: cands.map((r) => r.id), server, aggregate_type: "hourly" });
  const byId = new Map<string, Row>();
  for (const p of Array.isArray(prices) ? prices as Row[] : []) if (p && typeof p.item_id === "string" && Number.isFinite(Number(p.price))) byId.set(p.item_id, p);
  const alternatives = rows.filter((r) => !cands[0] || r.id !== cands[0].id).map((r) => r.Name).filter((n, i, a) => a.indexOf(n) === i && n !== cands[0]?.Name).slice(0, 5);
  const pick = cands.find((r) => byId.has(r.id));
  if (!pick) {
    return { item: cands[0].Name, server, found: true, price: null, note: "交易行没查到这个物品在该服的价格：可能服务器名不对、该物品不在交易行卖（绑定 / 任务物品），或近期没成交", alternatives: alternatives.length ? alternatives : undefined };
  }
  const p = byId.get(pick.id)!;
  return {
    item: pick.Name, server: p.server ?? server,
    price: fmtCopper(Number(p.price)), price_copper: Number(p.price),
    samples: Number.isFinite(Number(p.sample)) ? Number(p.sample) : undefined,
    updated: beijing(Number(p.timestamp)) ?? undefined,
    exact_match: pick.Name === item,
    alternatives: alternatives.length ? alternatives : undefined,
    note: "数据来自 JX3BOX（第三方），可能有延迟，仅供参考；价格已换算成金 / 银 / 铜；samples 是统计用的样本数；alternatives 是搜到的其他物品名，匹配不准时可以问对方是不是其中一个",
  };
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

// 北京时间的日期 + day 天，YYYY-MM-DD
export function beijingDate(now: number, day: number): string {
  return new Date(now + 8 * 3600_000 + day * 86400_000).toISOString().slice(0, 10);
}

// deno-lint-ignore no-explicit-any
type Db = any;
async function calendarDay(fetchFn: typeof fetch, db: Db | undefined, day: number, now: number): Promise<{ d: Row; cached: boolean }> {
  const date = beijingDate(now, day);
  if (db) {
    try {
      const { data } = await db.from("jx3_calendar").select("data").eq("date", date).maybeSingle();
      if (data?.data && typeof data.data === "object") return { d: data.data as Row, cached: true };
    } catch { /* 读库失败就现查 */ }
  }
  const d = await get(fetchFn, "/active/calendar", { num: day }) as Row;
  if (db && d && typeof d.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
    try { await db.from("jx3_calendar").upsert({ date: d.date, data: d, fetched_at: new Date(now).toISOString() }, { onConflict: "date" }); } catch { /* 写不进也不影响回答 */ }
  }
  return { d, cached: false };
}

async function run(fetchFn: typeof fetch, kind: string, args: Row, db: Db | undefined, now: number): Promise<{ key: string; out: Row }> {
  if (kind === "calendar") {
    const day = Number.isInteger(args.day) ? Math.max(0, Math.min(6, args.day as number)) : 0;
    const { d } = await calendarDay(fetchFn, db, day, now);
    return {
      key: "calendar:" + beijingDate(now, day),
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
  if (kind === "auction") {
    const item = str(args.item, 30), server = serverArg(args.server);
    if (!item) throw new Jx3Error("item_required");
    if (GOLD_WORDS.includes(item)) throw new Jx3Error("bad_argument", "金价不是交易行物品，用 kind=gold 带 server 查万宝楼金价");
    if (!server) throw new Jx3Error("server_required");
    return { key: "auction:" + server + ":" + item, out: await auction(fetchFn, item, server) };
  }
  if (kind === "wbl_role") {
    const server = serverArg(args.server);
    if (!server) throw new Jx3Error("server_required");
    const sectIn = str(args.sect, 12), shapeIn = str(args.shape, 8);
    const sect = sectIn ? sectId(sectIn) : null, shape = shapeIn ? shapeId(shapeIn) : null;
    if (sectIn && !sect) throw new Jx3Error("bad_argument", "门派名不认识");
    if (shapeIn && !shape) throw new Jx3Error("bad_argument", "体型只能是 成男 成女 正太 萝莉");
    const g = await findGate(fetchFn, server, now);
    const params: Record<string, string | number> = { goods_type: 2, page: 1, size: WBL_SIZE, zone_id: g.zone_id, server_id: g.server_id, "sort[price]": 1 };
    if (sect) params["filter[role_sect]"] = sect.id;
    if (shape) params["filter[role_shape]"] = shape.id;
    const { list, total } = await wblList(fetchFn, params);
    return {
      key: "wbl_role:" + server + ":" + sectIn + ":" + shapeIn,
      out: {
        server: g.server_name, zone: g.zone_name, sect: sect?.name, shape: shape?.name, total_on_sale: total,
        cheapest: list.slice(0, WBL_SIZE).map((r) => ({
          price: fmtYuan(Number(r.single_unit_price)), sect: r.attrs?.role_sect, shape: r.attrs?.role_shape, camp: r.attrs?.role_camp,
          gear_score: r.attrs?.role_equipment_point, outfits: r.attrs?.role_garment_count, hairs: r.attrs?.role_hair_count, cloaks: r.attrs?.role_cloak_count,
        })),
        note: "数据来自官方万宝楼的公开列表，按价格从低到高，只列最便宜的几个；价格是人民币，可能有延迟，仅供参考。不提供卖家信息和寄售编号，要买请对方自己去万宝楼看",
      },
    };
  }
  if (kind === "wbl_look") {
    // 带外观名：按价格从低到高；不带：按关注数从高到低看热门（可选外观类型）
    const name = str(args.item, 20), server = serverArg(args.server), typeIn = str(args.type, 6);
    const ti = typeIn ? LOOK_TYPES.indexOf(typeIn) : -1;
    if (typeIn && ti < 0) throw new Jx3Error("bad_argument", "外观类型只能是 " + LOOK_TYPES.join(" "));
    const g = server ? await findGate(fetchFn, server, now) : null;
    const hot = !name;
    // 热门 + 指定服务器：热门榜被少数几个服占满，本服的翻几页也筛不出来；先拿全服热门的名字，再按名字查本服价格
    if (hot && g) {
      const params: Record<string, string | number> = { goods_type: 3, page: 1, size: LOOK_PAGE_SIZE, "sort[followed_num]": 0 };
      if (ti >= 0) params["filter[appearance_type]"] = ti + 1;
      const top = (await wblList(fetchFn, params)).list;
      const names = [...new Set(top.map((r) => String(r.info ?? "")).filter(Boolean))].slice(0, HOT_NAMES);
      const local = await Promise.all(names.map((n) => wblList(fetchFn, { goods_type: 3, page: 1, size: LOOK_PAGE_SIZE, keyword: n, "sort[price]": 1 })
        .then((r) => r.list.filter((x) => x.server_name === g.server_name && x.info === n)).catch(() => null)));
      return {
        key: "wbl_look:" + server + "::" + typeIn,
        out: {
          mode: "热门", type: typeIn || undefined, server: g.server_name,
          items: names.map((n, i) => {
            const src = top.find((r) => r.info === n);
            const here = local[i];
            return { name: n, type: src?.attrs?.appearance_type_name, watchers: Math.max(...top.filter((r) => r.info === n).map((r) => Number(r.followed_num) || 0)),
              price_here: here && here.length ? fmtYuan(Number(here[0].single_unit_price)) : null,
              here: here === null ? "查询失败" : here.length ? "本服在售" : "本服最便宜的 10 条里没有" };
          }),
          note: `数据来自官方万宝楼的公开列表。万宝楼不能按服务器筛外观，所以这里先取全服关注人数最多的 ${names.length} 个外观，再分别查它们在 ${g.server_name} 最便宜的在售价；price_here 为空表示本服没查到。watchers 是全服关注人数，只代表热度。价格是人民币，可能有延迟，仅供参考。列出来的都是真实查到的，只报这些，不要补别的外观名或价格。不提供卖家信息，要买请对方自己去万宝楼看`,
        },
      };
    }
    // 外观列表接口不认服务器筛选（试过 server_id / zone_id / filter[...] 都被忽略），要指定服务器就多翻几页，在本地按服务器名筛
    const rows: Row[] = [];
    let total = 0, scanned = 0;
    const pages = g ? LOOK_PAGES : 1;
    for (let page = 1; page <= pages; page++) {
      const params: Record<string, string | number> = { goods_type: 3, page, size: LOOK_PAGE_SIZE };
      if (name) params.keyword = name;
      if (hot) params["sort[followed_num]"] = 0; else params["sort[price]"] = 1;
      if (ti >= 0) params["filter[appearance_type]"] = ti + 1;
      const r = await wblList(fetchFn, params);
      total = r.total; scanned += r.list.length;
      rows.push(...(g ? r.list.filter((x) => x.server_name === g.server_name) : r.list));
      if (rows.length >= WBL_SIZE || r.list.length < LOOK_PAGE_SIZE || scanned >= total) break;
    }
    const order = hot ? "按关注人数从多到少（热门）" : "按价格从低到高";
    return {
      key: "wbl_look:" + server + ":" + name + ":" + typeIn,
      out: {
        keyword: name || undefined, mode: hot ? "热门" : "最便宜", type: typeIn || undefined,
        server: g?.server_name ?? "全部服务器", total_all_servers: total,
        scanned: g ? scanned : undefined,
        items: rows.slice(0, WBL_SIZE).map((r) => ({ name: r.info, type: r.attrs?.appearance_type_name, server: r.server_name, price: fmtYuan(Number(r.single_unit_price)), watchers: hot ? Number(r.followed_num) || 0 : undefined })),
        note: `数据来自官方万宝楼的公开列表，${order}；` + (name ? "名字是模糊匹配；" : "watchers 是关注这件的人数，只代表热度；") + "价格是人民币，可能有延迟，仅供参考。" +
          (g ? `万宝楼接口不能按服务器筛外观，这里是在全服最便宜的 ${scanned} 条里挑出 ${g.server_name} 的，没列到不代表这个服没有；` : "") +
          "列出来的都是真实在售的，只报这些，不要补别的外观名或价格。不提供卖家信息，要买请对方自己去万宝楼看",
      },
    };
  }
  if (kind === "gold") {
    const server = serverArg(args.server);
    if (!server) throw new Jx3Error("server_required");
    const g = await findGate(fetchFn, server, now);
    return { key: "gold:" + server, out: await gold(fetchFn, g) };
  }
  throw new Jx3Error("bad_kind");
}

// 工具入口：返回给模型的 JSON 字符串，永远不抛出
export async function jx3Info(fetchFn: typeof fetch, args: Row, now = Date.now(), db?: Db): Promise<string> {
  const kind = typeof args.kind === "string" ? args.kind : "";
  if (!(JX3_KINDS as readonly string[]).includes(kind)) return JSON.stringify({ error: "bad_kind", allowed: JX3_KINDS });
  // 缓存键要在请求前就能算出来：和 run() 里的规则保持一致
  const pre = kind === "calendar" ? "calendar:" + beijingDate(now, Number.isInteger(args.day) ? Math.max(0, Math.min(6, args.day)) : 0)
    : kind === "server" ? "server:" + (typeof args.server === "string" ? args.server.trim().slice(0, 12) : "")
    : kind === "news" ? "news:" + (Number.isInteger(args.limit) ? Math.max(1, Math.min(5, args.limit)) : 3)
    : kind === "celebs" ? "celebs:" + (typeof args.name === "string" && JX3_CELEBS.includes(args.name) ? args.name : JX3_CELEBS[0])
    : kind === "auction" ? "auction:" + serverArg(args.server) + ":" + str(args.item, 30)
    : kind === "wbl_role" ? "wbl_role:" + serverArg(args.server) + ":" + str(args.sect, 12) + ":" + str(args.shape, 8)
    : kind === "wbl_look" ? "wbl_look:" + serverArg(args.server) + ":" + str(args.item, 20) + ":" + str(args.type, 6)
    : kind === "gold" ? "gold:" + serverArg(args.server)
    : "saohua";
  const hit = cache.get(pre);
  if (hit && now - hit.at < (TTL_MS[kind] ?? 0)) return hit.text;
  try {
    const { key, out } = await run(fetchFn, kind, args, db, now);
    const source = kind === "auction" ? "JX3BOX（第三方）" : kind === "wbl_role" || kind === "wbl_look" || kind === "gold" ? "官方万宝楼公开列表（未公开接口）" : "JX3API（第三方，非官方）";
    const text = JSON.stringify({ kind, source, ...out });
    if (TTL_MS[kind]) {
      if (cache.size > 200) cache.clear();
      cache.set(key, { at: now, text });
    }
    return text;
  } catch (e) {
    if (e instanceof Jx3Error) {
      if (e.code === "server_required") return JSON.stringify({ error: "server_required", hint: "问清楚是哪个服务器，例如 梦江南、乾坤一掷" });
      if (e.code === "item_required") return JSON.stringify({ error: "item_required", hint: "问清楚要查哪个物品 / 外观的名字" });
      if (e.code === "server_unknown") return JSON.stringify({ error: "server_unknown", hint: "没有这个服务器，请对方确认服务器名", servers: e.msg });
      if (e.code === "bad_argument") return JSON.stringify({ error: "bad_argument", message: e.msg ?? "参数不对" });
      return JSON.stringify({ error: e.code, hint: "剑三数据暂时查不到，直说就好，别编" });
    }
    return JSON.stringify({ error: "jx3_unavailable" });
  }
}
