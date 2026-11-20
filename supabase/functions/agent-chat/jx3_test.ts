// jx3.ts（剑三公开数据工具）的测试：假的 fetch，不连网
import { beijingDate, fmtCopper, fmtYuan, jx3CacheClear, jx3Info, sectId, stripHtml } from "./jx3.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const j = (s: string) => JSON.parse(s);
const ok = (detail: unknown) => new Response(JSON.stringify({ status: 200, detail }), { headers: { "Content-Type": "application/json" } });
function fake(handler: (u: URL) => Response | Promise<Response>) {
  const urls: URL[] = [];
  const fn = ((input: string, init?: RequestInit) => {
    const u = new URL(input);
    urls.push(u);
    const ua = new Headers(init?.headers).get("User-Agent") ?? "";
    if (ua !== "cangmie-chat-agent") throw new Error("generic UA expected, got " + ua);
    return Promise.resolve(handler(u));
  }) as unknown as typeof fetch;
  return { fn, urls };
}

Deno.test("calendar: day is clamped, fields mapped, cached for 10 minutes", async () => {
  jx3CacheClear();
  const f = fake(() => ok({ date: "2026-11-19", week: "四", war: "大战！英雄大阳津", battle: "西风古道", orecar: "跨服·渝州", lucky: ["饿饿"], weekly: { raid: ["敖龙岛"], conn: ["侠客岛·雾岛寻丹"] } }));
  const o = j(await jx3Info(f.fn, { kind: "calendar", day: 99 }, 1000));
  if (f.urls[0].origin + f.urls[0].pathname !== "https://www.jx3api.com/active/calendar" || f.urls[0].searchParams.get("num") !== "6") throw new Error(String(f.urls[0]));
  if (o.war !== "大战！英雄大阳津" || o.week !== "星期四" || o.lucky_pets[0] !== "饿饿" || o.weekly.raid[0] !== "敖龙岛" || !o.source.includes("第三方")) throw new Error(JSON.stringify(o));
  await jx3Info(f.fn, { kind: "calendar", day: 6 }, 1000 + 9 * 60_000);
  if (f.urls.length !== 1) throw new Error("should hit cache");
  await jx3Info(f.fn, { kind: "calendar", day: 6 }, 1000 + 11 * 60_000);
  if ((f.urls.length as number) !== 2) throw new Error("cache should expire");
});

Deno.test("server: requires a name, merges status and open/close times, bad name -> bad_argument", async () => {
  jx3CacheClear();
  const f = fake((u) => {
    const s = u.searchParams.get("server");
    if (s === "不存在") return new Response(JSON.stringify({ status: 400, detail: "服务器名称不正确" }));
    return u.searchParams.get("type") === "2"
      ? ok({ zone: "电信区", server: s, status: "维护" })
      : ok([{ server: s, zone: "电信区", status: 0, lasttime: 1794453101, shuttime: 1795041442 }]);
  });
  if (j(await jx3Info(f.fn, { kind: "server" })).error !== "server_required" || f.urls.length) throw new Error("no name must not fetch");
  const o = j(await jx3Info(f.fn, { kind: "server", server: " 梦江南 " }));
  if (o.server !== "梦江南" || o.status !== "维护" || o.zone !== "电信区" || !/^\d+月\d+日 \d\d:\d\d$/.test(o.last_open) || !o.last_close) throw new Error(JSON.stringify(o));
  const bad = j(await jx3Info(f.fn, { kind: "server", server: "不存在" }));
  if (bad.error !== "bad_argument" || bad.message !== "服务器名称不正确") throw new Error(JSON.stringify(bad));
});

Deno.test("news: html stripped and clipped, only https links, limit clamped", async () => {
  jx3CacheClear();
  const html = '<p><span style="color:#B22222">【更新说明】</span></p><p>1、新外观&nbsp;上架</p>' + "<p>长内容</p>".repeat(300);
  const f = fake(() => ok([
    { title: "11月19日更新公告", date: "2026/11/19", type: "官方公告", url: "https://jx3.xoyo.com/announce/gg.html?id=1", desc: { content: html } },
    { title: "第二条", date: "2026/11/18", type: "官方公告", url: "javascript:alert(1)", desc: { content: "<p>x</p>" } },
  ]));
  const o = j(await jx3Info(f.fn, { kind: "news", limit: 50 }));
  if (f.urls[0].searchParams.get("limit") !== "5") throw new Error("limit clamp");
  const first = o.items[0];
  if (!first.excerpt.startsWith("【更新说明】\n1、新外观 上架") || first.excerpt.includes("<") || Array.from(first.excerpt).length > 401) throw new Error(first.excerpt.slice(0, 60));
  if (o.items[1].url !== undefined || o.items[1].excerpt !== undefined) throw new Error("second item: no unsafe url, no excerpt");
});

Deno.test("celebs, saohua, bad kind, network failure", async () => {
  jx3CacheClear();
  const f = fake((u) => u.pathname === "/saohua/random" ? ok({ text: "世界骚了一整宿，起床还是单身狗。" })
    : ok([{ time: "10:10", map: "烂柯山", site: "凌天寺", stage: "凌天塔·再战凌天" }]));
  const c = j(await jx3Info(f.fn, { kind: "celebs", name: "不存在的" }));
  if (c.name !== "楚天社" || c.next[0] !== "10:10 烂柯山·凌天寺：凌天塔·再战凌天") throw new Error(JSON.stringify(c));
  const s1 = j(await jx3Info(f.fn, { kind: "saohua" }));
  await jx3Info(f.fn, { kind: "saohua" });
  if (s1.text !== "世界骚了一整宿，起床还是单身狗。" || f.urls.filter((u) => u.pathname === "/saohua/random").length !== 2) throw new Error("saohua not cached");
  if (j(await jx3Info(f.fn, { kind: "wanbaolou" })).error !== "bad_kind") throw new Error("bad kind");
  const down = (() => Promise.reject(new Error("net"))) as unknown as typeof fetch;
  if (j(await jx3Info(down, { kind: "calendar", day: 1 })).error !== "jx3_unavailable") throw new Error("network");
  const html500 = (() => Promise.resolve(new Response("<html>", { status: 502 }))) as unknown as typeof fetch;
  if (j(await jx3Info(html500, { kind: "calendar", day: 2 })).error !== "jx3_unavailable") throw new Error("502");
});

Deno.test("stripHtml entities and whitespace", () => {
  if (stripHtml("<p>a&amp;b</p><br/><p>  c&lt;d </p>") !== "a&b\nc<d") throw new Error(stripHtml("<p>a&amp;b</p><br/><p>  c&lt;d </p>"));
});

// 假的 jx3_calendar 表：select().eq("date").maybeSingle() 和 upsert()
function fakeDb(rows: Record<string, unknown>) {
  const upserts: Record<string, unknown>[] = [];
  return {
    upserts,
    from(table: string) {
      if (table !== "jx3_calendar") throw new Error("unexpected table " + table);
      let date = "";
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b,
        eq: (c: string, v: string) => { if (c === "date") date = v; return b; },
        maybeSingle: () => Promise.resolve({ data: rows[date] ? { data: rows[date] } : null, error: null }),
        upsert: (r: Record<string, unknown>) => { upserts.push(r); return Promise.resolve({ error: null }); },
      };
      return b;
    },
  };
}

Deno.test("beijingDate: UTC+8 and day offset", () => {
  const t = Date.parse("2026-11-19T17:30:00Z"); // 北京 11-20 01:30
  if (beijingDate(t, 0) !== "2026-11-20" || beijingDate(t, 6) !== "2026-11-26") throw new Error(beijingDate(t, 0));
});

Deno.test("calendar reads the prefetched row first, falls back to live and saves it", async () => {
  jx3CacheClear();
  const now = Date.parse("2026-11-19T02:00:00Z"); // 北京 11-19 10:00
  const f = fake(() => ok({ date: "2026-11-20", war: "大战！英雄南山马场" }));
  const db = fakeDb({ "2026-11-19": { date: "2026-11-19", war: "大战！英雄大阳津" } });
  const today = j(await jx3Info(f.fn, { kind: "calendar" }, now, db));
  if (today.war !== "大战！英雄大阳津" || f.urls.length) throw new Error("should come from the table without fetching");
  const tomorrow = j(await jx3Info(f.fn, { kind: "calendar", day: 1 }, now, db));
  if (tomorrow.war !== "大战！英雄南山马场" || f.urls.length !== 1 || f.urls[0].searchParams.get("num") !== "1") throw new Error("live fallback");
  if (db.upserts.length !== 1 || db.upserts[0].date !== "2026-11-20") throw new Error("should save the live result: " + JSON.stringify(db.upserts));
});

Deno.test("network errors retry once; business errors don't", async () => {
  jx3CacheClear();
  let n = 0;
  const flaky = (() => { n++; return n === 1 ? Promise.reject(new Error("timeout")) : Promise.resolve(ok({ text: "第二次成功" })); }) as unknown as typeof fetch;
  if (j(await jx3Info(flaky, { kind: "saohua" })).text !== "第二次成功" || n !== 2) throw new Error("retry");
  let m = 0;
  const bad = (() => { m++; return Promise.resolve(new Response(JSON.stringify({ status: 400, detail: "服务器名称不正确" }))); }) as unknown as typeof fetch;
  await jx3Info(bad, { kind: "server", server: "x" });
  if (m !== 2) throw new Error("server does 2 parallel calls, no retries: " + m);
});

// ---- 物价 / 万宝楼 ----
const raw = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const wbl = (data: unknown) => raw({ code: 1, msg: "SUCCESS", data });
const GATES = { list: [{ zone_id: "z05", zone_name: "电信区", servers: [{ server_id: "gate0502", server_name: "梦江南" }, { server_id: "gate0514", server_name: "乾坤一掷" }] }] };
const role = (price: number, sect = "七秀", shape = "萝莉") => ({
  attrs: { role_sect: sect, role_shape: shape, role_camp: "浩气盟", role_equipment_point: 8931, role_hair_count: 3, role_garment_count: 2, role_cloak_count: 1 },
  server_name: "梦江南", single_unit_price: price, consignment_id: "1434938704250339328", seller_role_name: "惊***", info: "电信区-梦江南-惊***",
});

Deno.test("money formatting: 铜 -> 金银铜, 分 -> ¥", () => {
  if (fmtCopper(5487200) !== "548金72银") throw new Error(fmtCopper(5487200));
  if (fmtCopper(10000) !== "1金" || fmtCopper(150) !== "1银50铜" || fmtCopper(7) !== "7铜" || fmtCopper(0) !== "0铜" || fmtCopper(10001) !== "1金1铜") throw new Error("copper");
  if (fmtYuan(109900) !== "¥1099" || fmtYuan(1050) !== "¥10.5" || fmtYuan(1) !== "¥0.01") throw new Error(fmtYuan(1050));
  if (sectId("七秀")?.id !== 14 || sectId("纯阳")?.id !== 12 || sectId("万花")?.id !== 15 || sectId("药宗")?.id !== 18 || sectId("abc") !== null) throw new Error("sect");
});

Deno.test("auction: exact match, unbound variant preferred, POST json, cached", async () => {
  jx3CacheClear();
  let post: Row | null = null;
  let method = "";
  const fn = ((input: string, init?: RequestInit) => {
    const u = new URL(input);
    if (u.hostname === "node.jx3box.com") {
      if (decodeURIComponent(u.pathname) !== "/item_merged/name/五行石（六级）" || u.searchParams.get("client") !== "std") throw new Error(String(u));
      return Promise.resolve(raw({ list: [{ id: "5_24447", Name: "五行石（六级）", BindType: 3 }, { id: "5_24428", Name: "五行石（六级）" }, { id: "5_24423", Name: "五行石（一级）" }] }));
    }
    method = init?.method ?? "";
    if (new Headers(init?.headers).get("Content-Type") !== "application/json") throw new Error("json body expected");
    post = JSON.parse(String(init?.body));
    return Promise.resolve(raw([{ item_id: "5_24428", server: "梦江南", price: 5487200, sample: 3146, timestamp: 1795132747 }]));
  }) as unknown as typeof fetch;
  const o = j(await jx3Info(fn, { kind: "auction", item: "五行石（六级）", server: "梦江南服" }));
  if (method !== "POST" || post!.server !== "梦江南" || post!.item_ids[0] !== "5_24428" || post!.aggregate_type !== "hourly") throw new Error(JSON.stringify(post));
  if (o.item !== "五行石（六级）" || o.price !== "548金72银" || o.samples !== 3146 || !/^\d+月\d+日 \d\d:\d\d$/.test(o.updated) || !o.note.includes("JX3BOX") || !o.source) throw new Error(JSON.stringify(o));
  if (!o.alternatives.includes("五行石（一级）")) throw new Error("alternatives");
  await jx3Info(fn, { kind: "auction", item: "五行石（六级）", server: "梦江南服" });
  method = "";
  if (method !== "") throw new Error("second call should hit cache");
});

Deno.test("auction: ambiguous name picks the shortest containing match and lists others; unknown item; unknown server; errors", async () => {
  jx3CacheClear();
  const mk = (items: Row[], prices: unknown) => fake((u) => u.hostname === "node.jx3box.com" ? raw({ list: items }) : raw(prices)).fn;
  const items = [{ id: "5_1", Name: "隐元秘宝·五行石(陆)" }, { id: "5_2", Name: "五行石(陆)" }, { id: "5_3", Name: "五行石(柒)" }];
  const o = j(await jx3Info(mk(items, [{ item_id: "5_2", server: "梦江南", price: 12345, sample: 5, timestamp: 1795132747 }]), { kind: "auction", item: "五行石", server: "梦江南" }));
  if (o.item !== "五行石(陆)" || o.exact_match !== false || o.price !== "1金23银45铜" || !o.alternatives.includes("五行石(柒)")) throw new Error(JSON.stringify(o));
  const none = j(await jx3Info(mk([], []), { kind: "auction", item: "没有这个", server: "梦江南" }));
  if (none.found !== false) throw new Error(JSON.stringify(none));
  const badServer = j(await jx3Info(mk(items, []), { kind: "auction", item: "五行石", server: "不存在服" }));
  if (badServer.price !== null || !badServer.note.includes("服务器")) throw new Error(JSON.stringify(badServer));
  if (j(await jx3Info(mk(items, []), { kind: "auction", item: "五行石" })).error !== "server_required") throw new Error("server required");
  if (j(await jx3Info(mk(items, []), { kind: "auction", server: "梦江南" })).error !== "item_required") throw new Error("item required");
  const down = (() => Promise.reject(new Error("net"))) as unknown as typeof fetch;
  if (j(await jx3Info(down, { kind: "auction", item: "x", server: "梦江南" })).error !== "jx3_unavailable") throw new Error("down");
  const err = fake(() => raw({ detail: [{ msg: "bad" }] }, 422)).fn;
  if (j(await jx3Info(err, { kind: "auction", item: "x", server: "y" })).error !== "jx3_unavailable") throw new Error("422");
});

Deno.test("wbl_role: server mapping, sect/shape filters, cheapest first, no ids or sellers", async () => {
  jx3CacheClear();
  const f = fake((u) => u.pathname.endsWith("/gateways") ? wbl(GATES) : wbl({ list: [role(10000), role(109900)], total_record: 484 }));
  const o = j(await jx3Info(f.fn, { kind: "wbl_role", server: "梦江南", sect: "七秀", shape: "萝莉" }));
  const q = f.urls[1].searchParams;
  if (q.get("goods_type") !== "2" || q.get("server_id") !== "gate0502" || q.get("zone_id") !== "z05" || q.get("sort[price]") !== "1" || q.get("filter[role_sect]") !== "14" || q.get("filter[role_shape]") !== "4" || q.get("size") !== "8") throw new Error(String(f.urls[1]));
  if (o.total_on_sale !== 484 || o.cheapest[0].price !== "¥100" || o.cheapest[1].price !== "¥1099" || o.cheapest[0].gear_score !== 8931 || o.cheapest[0].camp !== "浩气盟" || o.cheapest[0].outfits !== 2 || o.cheapest[0].hairs !== 3 || o.cheapest[0].cloaks !== 1) throw new Error(JSON.stringify(o));
  const text = JSON.stringify(o);
  if (text.includes("1434938704250339328") || text.includes("惊***") || text.includes("consignment")) throw new Error("must not leak ids or sellers");
  await jx3Info(f.fn, { kind: "wbl_role", server: "梦江南", sect: "七秀", shape: "萝莉" });
  if ((f.urls.length as number) !== 2) throw new Error("cached");
  const o2 = j(await jx3Info(f.fn, { kind: "wbl_role", server: "乾坤一掷" }));
  if (f.urls.length !== 3 || f.urls[2].searchParams.get("server_id") !== "gate0514" || f.urls[2].searchParams.has("filter[role_sect]") || o2.error) throw new Error("gateways should be cached, no filters");
});

Deno.test("wbl_role: unknown server, bad sect, missing server, API error", async () => {
  jx3CacheClear();
  const f = fake((u) => u.pathname.endsWith("/gateways") ? wbl(GATES) : wbl({ list: [], total_record: 0 }));
  const u = j(await jx3Info(f.fn, { kind: "wbl_role", server: "不存在" }));
  if (u.error !== "server_unknown" || !u.servers.includes("梦江南")) throw new Error(JSON.stringify(u));
  if (j(await jx3Info(f.fn, { kind: "wbl_role", server: "梦江南", sect: "不是门派" })).error !== "bad_argument") throw new Error("sect");
  if (j(await jx3Info(f.fn, { kind: "wbl_role", sect: "七秀" })).error !== "server_required") throw new Error("server");
  jx3CacheClear();
  const apiErr = fake((u) => u.pathname.endsWith("/gateways") ? wbl(GATES) : raw({ code: -21004, msg: "排序格式不正确", data: {} }));
  if (j(await jx3Info(apiErr.fn, { kind: "wbl_role", server: "梦江南" })).error !== "jx3_unavailable") throw new Error("api error");
  const empty = j(await jx3Info(fake((u) => u.pathname.endsWith("/gateways") ? wbl(GATES) : wbl({ list: [], total_record: 0 })).fn, { kind: "wbl_role", server: "梦江南", sect: "七秀" }));
  if (empty.total_on_sale !== 0 || empty.cheapest.length !== 0) throw new Error("empty");
});

Deno.test("wbl_look: keyword, cheapest first, no seller info; server filter is client-side over a few pages", async () => {
  jx3CacheClear();
  const item = (name: string, server: string, price: number) => ({ info: name, attrs: { appearance_type_name: "其他", item_index: 85264 }, server_name: server, single_unit_price: price, consignment_id: "135640", seller_role_name: "眺***" });
  const f = fake((u) => u.pathname.endsWith("/gateways") ? wbl(GATES) : wbl({ list: [item("头顶表情【何意味】", "唯我独尊", 1000), item("头顶表情【何意味】", "梦江南", 109900)], total_record: 6 }));
  const o = j(await jx3Info(f.fn, { kind: "wbl_look", item: "何意味" }));
  const q = f.urls[0].searchParams;
  if (f.urls.length !== 1 || q.get("goods_type") !== "3" || q.get("keyword") !== "何意味" || q.get("sort[price]") !== "1" || q.get("size") !== "10") throw new Error(String(f.urls[0]));
  if (o.total_all_servers !== 6 || o.items[0].name !== "头顶表情【何意味】" || o.items[0].type !== "其他" || o.items[0].price !== "¥10" || o.items[1].price !== "¥1099" || o.items[0].server !== "唯我独尊" || !o.source.includes("万宝楼")) throw new Error(JSON.stringify(o));
  if (JSON.stringify(o).includes("consignment") || JSON.stringify(o).includes("眺***")) throw new Error("leak");
  const s = j(await jx3Info(f.fn, { kind: "wbl_look", item: "何意味", server: "梦江南" }));
  if (s.items.length !== 1 || s.items[0].server !== "梦江南" || s.items[0].price !== "¥1099" || !s.note.includes("不能按服务器筛") || s.scanned !== 2) throw new Error(JSON.stringify(s));
  if (j(await jx3Info(f.fn, { kind: "wbl_look", item: "x", server: "不存在" })).error !== "server_unknown") throw new Error("server");
  // 本服的货在第 3 页才出现：最多翻 3 页，不会无限翻
  jx3CacheClear();
  let pages = 0;
  const full = fake((u) => { if (u.pathname.endsWith("/gateways")) return wbl(GATES); pages++; return wbl({ list: Array.from({ length: 10 }, () => item("头顶表情【x】", "唯我独尊", 1000)), total_record: 500 }); });
  const none = j(await jx3Info(full.fn, { kind: "wbl_look", item: "头顶表情", server: "梦江南" }));
  if (pages !== 3 || none.items.length !== 0 || none.scanned !== 30) throw new Error(pages + JSON.stringify(none));
});

Deno.test("gold: 万宝楼 gold listings for one server, best ratio first, range, no sellers", async () => {
  jx3CacheClear();
  const coin = (ratio: number, size: number, count: number) => ({ info: size + "金", seller_role_name: "姑***", server_name: "梦江南", consignment_id: "1439932131312476160", single_unit_size: size, single_unit_price: 1000, remain_unit_count: count, attrs: { gold_price: ratio } });
  const f = fake((u) => {
    if (u.pathname.endsWith("/gateways")) return wbl(GATES);
    return u.searchParams.get("sort[gold_price]") === "0"
      ? wbl({ list: [coin(902, 9020, 12), coin(902, 9020, 3), coin(900, 9000, 5)], total_record: 0 })
      : wbl({ list: [coin(739, 7397, 100)], total_record: 0 });
  });
  const o = j(await jx3Info(f.fn, { kind: "gold", server: "梦江南服" }));
  const q = f.urls.find((u) => u.searchParams.get("sort[gold_price]") === "0")!.searchParams;
  if (q.get("goods_type") !== "1" || q.get("server_id") !== "gate0502" || q.get("zone_id") !== "z05") throw new Error(String(q));
  if (o.best !== "1元 = 902金" || o.per_10k_gold !== "1万金 ≈ ¥11.09" || o.range !== "在售比例从 1元 = 739金 到 1元 = 902金" || o.best_ratio_stock !== "这个比例前几单合计约 13.5万金" || o.top_ratios.join() !== "902,902,900" || !o.source.includes("万宝楼")) throw new Error(JSON.stringify(o));
  const text = JSON.stringify(o);
  if (text.includes("姑***") || text.includes("1439932131312476160")) throw new Error("leak");
  const n = f.urls.length;
  await jx3Info(f.fn, { kind: "gold", server: "梦江南" });
  if (f.urls.length !== n) throw new Error("cached");
  if (j(await jx3Info(f.fn, { kind: "gold" })).error !== "server_required") throw new Error("server");
  if (j(await jx3Info(f.fn, { kind: "gold", server: "不存在" })).error !== "server_unknown") throw new Error("unknown");
  jx3CacheClear();
  const none = j(await jx3Info(fake((u) => u.pathname.endsWith("/gateways") ? wbl(GATES) : wbl({ list: [], total_record: 0 })).fn, { kind: "gold", server: "梦江南" }));
  if (none.on_sale !== false || none.best) throw new Error(JSON.stringify(none));
  // 把「金」当交易行物品查：提示改用 gold
  const a = j(await jx3Info(f.fn, { kind: "auction", item: "金", server: "梦江南" }));
  if (a.error !== "bad_argument" || !a.message.includes("kind=gold")) throw new Error(JSON.stringify(a));
});

Deno.test("gold: a full page at one ratio is flagged as the 万宝楼 cap", async () => {
  jx3CacheClear();
  const coin = { info: "9020金", single_unit_size: 9020, single_unit_price: 1000, remain_unit_count: 1, attrs: { gold_price: 902 } };
  const f = fake((u) => u.pathname.endsWith("/gateways") ? wbl(GATES) : wbl({ list: Array.from({ length: 10 }, () => coin), total_record: 0 }));
  const o = j(await jx3Info(f.fn, { kind: "gold", server: "梦江南" }));
  if (o.capped !== true || !o.note.includes("上限") || o.range !== undefined) throw new Error(JSON.stringify(o));
});

Deno.test("wbl_look without a name: most-watched first, optional type, server scan over more pages", async () => {
  jx3CacheClear();
  const it = (name: string, server: string, price: number, fans: number) => ({ info: name, attrs: { appearance_type_name: "发型" }, server_name: server, single_unit_price: price, followed_num: fans, seller_role_name: "眺***" });
  const f = fake((u) => u.pathname.endsWith("/gateways") ? wbl(GATES) : wbl({ list: [it("金发·登云峰", "绝代天骄", 131100, 3719), it("红发·赤影", "梦江南", 500000, 45)], total_record: 2 }));
  const o = j(await jx3Info(f.fn, { kind: "wbl_look", type: "发型" }));
  const q = f.urls[0].searchParams;
  if (q.has("keyword") || q.get("sort[followed_num]") !== "0" || q.has("sort[price]") || q.get("filter[appearance_type]") !== "3") throw new Error(String(f.urls[0]));
  if (o.mode !== "热门" || o.items[0].name !== "金发·登云峰" || o.items[0].watchers !== 3719 || o.items[0].price !== "¥1311" || !o.note.includes("不要补别的")) throw new Error(JSON.stringify(o));
  if (JSON.stringify(o).includes("眺***")) throw new Error("leak");
  if (j(await jx3Info(f.fn, { kind: "wbl_look", type: "不是类型" })).error !== "bad_argument") throw new Error("type");
  // 热门 + 服务器：先拿全服热门名字，再逐个按名字查本服价格
  jx3CacheClear();
  const g = fake((u) => {
    if (u.pathname.endsWith("/gateways")) return wbl(GATES);
    const kw = u.searchParams.get("keyword");
    if (!kw) return wbl({ list: [it("金发·登云峰", "绝代天骄", 131100, 3719), it("金发·登云峰", "绝代天骄", 1000, 1716), it("红发·赤影", "绝代天骄", 2000, 45)], total_record: 3 });
    if (kw === "金发·登云峰") return wbl({ list: [it("金发·登云峰", "唯我独尊", 900, 0), it("金发·登云峰", "梦江南", 98800, 0)], total_record: 2 });
    return wbl({ list: [it("红发·赤影之二", "梦江南", 100, 0)], total_record: 1 });
  });
  const s = j(await jx3Info(g.fn, { kind: "wbl_look", server: "梦江南" }));
  const kws = g.urls.map((u) => u.searchParams.get("keyword")).filter(Boolean);
  if (kws.join() !== "金发·登云峰,红发·赤影") throw new Error(kws.join());
  if (s.items.length !== 2 || s.items[0].price_here !== "¥988" || s.items[0].watchers !== 3719 || s.items[1].price_here !== null || s.items[1].here !== "本服最便宜的 10 条里没有") throw new Error(JSON.stringify(s));
});
