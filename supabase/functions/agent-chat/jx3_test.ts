// jx3.ts（剑三公开数据工具）的测试：假的 fetch，不连网
import { jx3CacheClear, jx3Info, stripHtml } from "./jx3.ts";

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
