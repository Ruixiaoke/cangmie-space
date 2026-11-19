// 麻将规则引擎测试（rules.gen.js 由 gen-rules.py 从 chat/js/miniapps/mahjong-rules.js 生成）
// 运行：deno test supabase/functions/mahjong/rules_test.ts
import * as R from "./rules.gen.js";

// rules.gen.js 是纯 JS，类型靠推断会很别扭，这里统一当 any 用
// deno-lint-ignore no-explicit-any
const { apply, botAction, canHu, chiOptions, newGame, pending, pickDiscard, privateView, publicView, scoreHand, shuffleWall, tileName, timeoutAction, toCounts, turnOptions } = R as any;

function assert(c: unknown, msg = "assertion failed") { if (!c) throw new Error(msg); }
function eq(a: unknown, b: unknown, msg = "") {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg} expected ${y} got ${x}`);
}
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 牌的简写：123m 万、123s 条、123p 筒、1234567z 东南西北中发白
function T(str: string): number[] {
  const out: number[] = [];
  let digits: number[] = [];
  for (const ch of str.replace(/\s+/g, "")) {
    if (/[0-9]/.test(ch)) { digits.push(Number(ch)); continue; }
    const base = ch === "m" ? 0 : ch === "s" ? 9 : ch === "p" ? 18 : 27;
    for (const d of digits) out.push(base + d - 1);
    digits = [];
  }
  return out;
}
const meld = (kind: string, tile: number, from = 0) => ({ kind, tile, tiles: kind === "chi" ? [tile, tile + 1, tile + 2] : kind === "peng" ? [tile, tile, tile] : [tile, tile, tile, tile], from });

// 手工搭一个状态：hands 是四家的牌（轮到的人包含刚摸的那张 drawn），其余用默认
// deno-lint-ignore no-explicit-any
function mk(o: { hands: string[]; melds?: any[][]; turn?: number; drawn?: number | null; phase?: string; wall?: number[]; dealer?: number; gangFlag?: boolean; haidi?: boolean }): any {
  const g = newGame({ rng: mulberry32(1), dealer: o.dealer ?? 0 });
  g.hands = o.hands.map((s) => T(s).sort((a, b) => a - b));
  g.melds = o.melds ?? [[], [], [], []];
  g.discards = [[], [], [], []];
  g.turn = o.turn ?? 0;
  g.phase = o.phase ?? "discard";
  g.drawn = o.drawn === undefined ? null : o.drawn;
  g.wall = o.wall ?? T("1m2m3m4m5m6m7m8m9m1s2s3s4s5s6s7s8s9s1p2p3p4p5p6p7p8p9p");
  g.gangFlag = !!o.gangFlag;
  g.haidi = !!o.haidi;
  g.lastDiscard = null; g.claim = null; g.recent = []; g.step = 0; g.result = null;
  return g;
}
// deno-lint-ignore no-explicit-any
function act(g: any, seat: number, a: any): any {
  const r = apply(g, seat, a);
  assert(r.ok, "apply failed: " + JSON.stringify(a) + " " + r.error);
  return r.state;
}

// ---- 牌墙 ----
Deno.test("wall: 136 tiles, 4 of each, no flowers; shuffle only depends on the injected rng", () => {
  const w = shuffleWall(mulberry32(3));
  eq(w.length, 136);
  const c = toCounts(w);
  assert(c.length === 34 && c.every((n: number) => n === 4));
  eq(shuffleWall(mulberry32(3)), w);
  assert(JSON.stringify(shuffleWall(mulberry32(4))) !== JSON.stringify(w));
  eq(tileName(0), "一万"); eq(tileName(17), "九条"); eq(tileName(18), "一筒"); eq(tileName(27), "东"); eq(tileName(33), "白");
});

Deno.test("deal: 13 each, dealer 14, wall 83, turn = dealer, public view hides all hands", () => {
  const g = newGame({ rng: mulberry32(9), dealer: 2 });
  eq(g.hands.map((h: number[]) => h.length), [13, 13, 14, 13]);
  eq(g.wall.length, 136 - 53);
  eq(g.turn, 2); eq(g.phase, "discard");
  assert(g.drawn !== null && g.hands[2].includes(g.drawn));
  const pub = publicView(g);
  eq(pub.handCounts, [13, 13, 14, 13]);
  const s = JSON.stringify(pub);
  assert(!("hands" in pub) && !("wall" in pub) && pub.result === null);
  // 公开状态里不能出现任何手牌：把一家的手牌序列化后不应该整段出现
  assert(!s.includes(JSON.stringify(g.hands[0])));
  eq(privateView(g, 2).drawn, g.drawn);
  eq(privateView(g, 0).drawn, null);
  eq(privateView(g, 1).cards, g.hands[1]);
});

// ---- 胡牌判断 ----
Deno.test("canHu: standard shapes, seven pairs, melds already shown, non-wins", () => {
  assert(canHu(T("123m456m789m123p55s"), 0));
  assert(canHu(T("11223344556677m"), 0)); // 七对（同时也是 123 123 456 456 77）
  assert(canHu(T("11m22p33s11z22z33z44z"), 0)); // 七对（跨花色）
  assert(canHu(T("11112222333344m"), 0)); // 四张相同算两对：11 11 22 22 33 33 44
  assert(canHu(T("456m789m55s"), 2)); // 已经亮出两组，手里 8 张
  assert(canHu(T("55s"), 4)); // 亮出四组，单吊将
  assert(!canHu(T("12345m"), 0));
  assert(!canHu(T("123m456m789m123p56s"), 0));
  assert(!canHu(T("123m456m789m123p5s"), 0)); // 张数不对
  assert(!canHu(T("11223344556678m"), 0));
  assert(!canHu(T("11m22p33s44s"), 2)); // 亮了组之后不能算七对（也凑不成面子）
  assert(canHu(T("1122m3344p5566s77z"), 0)); // 七对
  assert(!isSeven(T("11112222333344m"), 1)); // 亮了组就不能七对
});
function isSeven(tiles: number[], nMelds: number): boolean { return R.isSevenPairs(tiles, nMelds); }

Deno.test("canHu: tricky decompositions (nine gates, overlapping runs, honours never form runs)", () => {
  // 九莲宝灯：1112345678999 听 1..9 全部
  for (let t = 0; t < 9; t++) assert(canHu(T("1112345678999m").concat([t]), 0), "nine gates + " + t);
  assert(!canHu(T("1112345678999m").concat([9]), 0));
  assert(canHu(T("11122233344455m"), 0)); // 111 222 333 444 55
  assert(canHu(T("11123456789999m"), 0)); // 11 123 456 789 999
  assert(canHu(T("22334455667788m"), 0)); // 七对，也是 234 234 567 567 88
  assert(canHu(T("3334455667778m").concat(T("8m")), 0)); // 33 345 456 677 788 之类的拆法
  assert(!canHu(T("3334455667778m"), 0)); // 13 张
  assert(!canHu(T("123m456m789m").concat(T("1234z")).concat(T("1z")).slice(0, 14), 0)); // 字牌不能组成顺子
  assert(!canHu(T("89m1m").concat(T("23456789p11s")), 0)); // 89m1m 不是顺子（不能跨 9 到 1）
  assert(!canHu(T("12m3p").concat(T("456p789p11s1s")).slice(0, 14), 0)); // 不能跨花色
  assert(canHu(T("123m123m123m123m55s"), 0)); // 同一组顺子可以重复四次
  assert(canHu(T("111m111p111s11z234m"), 0));
});

// 对拍：另一个写法的参考实现（拆最大的那张牌）对随机手牌和「差一张」的手牌
function refWin(tiles: number[]): boolean {
  const c = toCounts(tiles);
  if (tiles.length === 14 && c.every((n: number) => n % 2 === 0)) return true;
  const melds = (cc: number[]): boolean => {
    let i = 33;
    while (i >= 0 && cc[i] === 0) i--;
    if (i < 0) return true;
    if (cc[i] >= 3) { cc[i] -= 3; const ok = melds(cc); cc[i] += 3; if (ok) return true; }
    if (i < 27 && i % 9 >= 2 && cc[i - 1] > 0 && cc[i - 2] > 0) { cc[i]--; cc[i - 1]--; cc[i - 2]--; const ok = melds(cc); cc[i]++; cc[i - 1]++; cc[i - 2]++; if (ok) return true; }
    return false;
  };
  for (let p = 0; p < 34; p++) if (c[p] >= 2) { c[p] -= 2; const ok = melds(c); c[p] += 2; if (ok) return true; }
  return false;
}
Deno.test("canHu: matches an independent reference on 20000 random and near-winning hands", () => {
  const rng = mulberry32(42);
  let wins = 0;
  for (let n = 0; n < 20000; n++) {
    // 随机拼一个胡牌牌型（不超过每种 4 张），再随机换掉一张
    const c = new Array(34).fill(0);
    const put = (t: number, k: number) => { if (c[t] + k > 4) return false; c[t] += k; return true; };
    let ok = true;
    const suit = n % 3 === 0 ? 0 : Math.floor(rng() * 4); // 三分之一的手牌集中在一种花色，拆法更复杂
    const pick = () => { const s = n % 3 === 0 ? 0 : Math.floor(rng() * 4); void suit; return s === 3 ? 27 + Math.floor(rng() * 7) : s * 9 + Math.floor(rng() * 9); };
    for (let m = 0; m < 4 && ok; m++) {
      const t = pick();
      if (t < 27 && rng() < 0.6 && t % 9 <= 6) ok = put(t, 1) && put(t + 1, 1) && put(t + 2, 1);
      else ok = put(t, 3);
    }
    if (ok) ok = put(pick(), 2);
    if (!ok) continue;
    const tiles: number[] = [];
    for (let t = 0; t < 34; t++) for (let k = 0; k < c[t]; k++) tiles.push(t);
    assert(canHu(tiles, 0), "constructed hand must win: " + JSON.stringify(tiles));
    wins++;
    const mod = tiles.slice();
    mod[Math.floor(rng() * 14)] = Math.floor(rng() * 34);
    if (toCounts(mod).some((x: number) => x > 4)) continue;
    eq(canHu(mod, 0), refWin(mod), "mismatch on " + JSON.stringify(mod.sort((a, b) => a - b)));
  }
  assert(wins > 5000);
});

// ---- 番 ----
Deno.test("fan: 平胡 门清 自摸 / 点炮 and every bonus", () => {
  // 平胡 + 门清 = 2
  let s = scoreHand(T("123m456m789m123p55s"), [], { zimo: true });
  eq(s.fan, 2); eq(s.shape, "平胡");
  eq(s.items.map((i: { name: string }) => i.name), ["底番", "门清"]);
  // 吃过的平胡：只有底番
  s = scoreHand(T("456m789m123p55s"), [meld("chi", 0)], {});
  eq(s.fan, 1);
  // 碰碰胡：已经碰了两组，门不清：1 + 1 = 2
  s = scoreHand(T("111m222p33s"), [meld("peng", 4), meld("peng", 27)], {});
  eq(s.fan, 2); eq(s.shape, "碰碰胡");
  // 碰碰胡含暗杠仍然门清：1 + 1 + 1 = 3
  s = scoreHand(T("111m222p33s"), [meld("angang", 4), meld("angang", 27)], {});
  eq(s.fan, 3);
  // 手里有顺子就不是碰碰胡
  eq(scoreHand(T("123m222p33s444s"), [meld("peng", 4)], {}).shape, "平胡");
  // 碰碰胡 + 门清：全是刻子的手牌 111m 222m 333p 44s 的 4 组 + 将
  s = scoreHand(T("111m222m333p555s44z"), [], { zimo: true });
  eq(s.fan, 3); eq(s.shape, "碰碰胡"); // 底 + 碰碰 + 门清
  // 七对 = 1 + 2 + 1（门清）
  s = scoreHand(T("11m22m33p44p55s66s77z"), [], {});
  eq(s.fan, 4); eq(s.shape, "七对");
  // 清一色 = 1 + 2 + 1（门清）；吃碰过的清一色 = 1 + 2
  s = scoreHand(T("123m456m789m123m55m"), [], {});
  eq(s.fan, 4);
  s = scoreHand(T("456m789m123m55m"), [meld("chi", 0)], {});
  eq(s.fan, 3);
  // 混一色（有字牌）= 1 + 1 + 1（门清）
  s = scoreHand(T("123m456m789m11z222z").slice(0, 14).concat([]), [], {});
  eq(s.items.map((i: { name: string }) => i.name), ["底番", "混一色", "门清"]);
  eq(s.fan, 3);
  // 全字牌既不是混一色也不是清一色
  s = scoreHand(T("111z222z333z444z55z"), [], {});
  eq(s.items.map((i: { name: string }) => i.name), ["底番", "碰碰胡", "门清"]);
  // 杠上开花 / 抢杠胡 / 海底捞月
  eq(scoreHand(T("123m456m789m123p55s"), [], { zimo: true, gangFlag: true }).fan, 3);
  eq(scoreHand(T("123m456m789m123p55s"), [], { zimo: false, gangFlag: true }).fan, 2); // 点炮没有杠上开花
  eq(scoreHand(T("123m456m789m123p55s"), [], { qiang: true }).fan, 3);
  eq(scoreHand(T("123m456m789m123p55s"), [], { zimo: true, haidi: true }).fan, 3);
  eq(scoreHand(T("123m456m789m123p55s"), [], { zimo: false, haidi: true }).fan, 2); // 点炮没有海底捞月
  // 全部叠加：清一色碰碰胡（亮出两组杠） + 杠上开花 + 海底：1 + 1 + 2 + 1（门清，暗杠）+ 1 + 1
  s = scoreHand(T("111m222m33m").concat([]), [meld("angang", 5), meld("angang", 6)], { zimo: true, gangFlag: true, haidi: true });
  eq(s.fan, 1 + 1 + 2 + 1 + 1 + 1);
  assert(scoreHand(T("123m456m789m123p56s"), [], {}) === null);
});

Deno.test("chiOptions: only suited tiles, all combinations, never across suits or 9->1", () => {
  eq(chiOptions(T("1234m"), 2), [[0, 1], [1, 3]]); // 吃三万：一二、二四（四五要有五万）
  eq(chiOptions(T("2346m"), 4), [[2, 3], [3, 5]]);
  eq(chiOptions(T("12m"), 2), [[0, 1]]);
  eq(chiOptions(T("78m1p"), 8), [[6, 7]]);
  eq(chiOptions(T("12m"), 18), []);
  eq(chiOptions(T("1z2z"), 28), []);
  eq(chiOptions(T("9m1s"), 9), []);
});

// ---- 流程 ----
Deno.test("discard: no claimers means the next seat draws from the wall tail", () => {
  const g0 = mk({ hands: ["1m 5m 9m 1s 5s 9s 1p 5p 9p 1z 3z 5z 7z 9s", "2m 4m 6m 8m 2s 4s 6s 8s 2p 4p 6p 8p 2z", "1m 5m 9m 1s 5s 9s 1p 5p 9p 1z 3z 5z 7z", "2m 4m 6m 8m 2s 4s 6s 8s 2p 4p 6p 8p 4z"], turn: 0, drawn: T("9s")[0] });
  const g = act(g0, 0, { kind: "discard", tile: T("9s")[0] });
  eq(g.phase, "discard"); eq(g.turn, 1);
  eq(g.hands[1].length, 14);
  eq(g.drawn, g0.wall[g0.wall.length - 1]);
  eq(g.wall.length, g0.wall.length - 1);
  eq(g.discards[0], T("9s"));
  eq(g.lastDiscard, { seat: 0, tile: T("9s")[0], n: 0 });
  // 不是你的回合 / 没有这张牌
  eq(apply(g, 0, { kind: "discard", tile: 0 }).error, "not_your_turn");
  eq(apply(g, 1, { kind: "discard", tile: T("9z")[0] }).error, "not_in_hand");
  eq(apply(g0, 0, { kind: "discard", tile: T("2z")[0] }).error, "not_in_hand");
});

Deno.test("claim priority: 胡 beats 碰, 碰 beats 吃; the claim waits for a higher priority player who has not answered yet", () => {
  // 座位 0 打 5m。座位 1（下家）能吃，座位 2 能碰，座位 3 能胡
  const hands = [
    "1m 9m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z 5m",
    "3m 4m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z",
    "5m 5m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z",
    "2m 3m 4m 6m 7m 8m 3p 4p 5p 9s 9s 5m 5m", // 听 5m：234m 678m 345p 555m 99s
  ];
  const g0 = mk({ hands, turn: 0, drawn: T("5m")[0] });
  assert(canHu(g0.hands[3].concat(T("5m")), 0));
  let g = act(g0, 0, { kind: "discard", tile: T("5m")[0] });
  eq(g.phase, "claim");
  eq(Object.keys(g.claim.opts).sort(), ["1", "2", "3"]);
  eq(g.claim.opts[1].chi, [[T("3m")[0], T("4m")[0]]]);
  assert(g.claim.opts[2].peng && !g.claim.opts[2].hu);
  assert(g.claim.opts[3].hu);
  // 先说话的是座位 1 吃：还有更高优先级没表态，继续等
  g = act(g, 1, { kind: "chi", with: [T("3m")[0], T("4m")[0]] });
  eq(g.phase, "claim"); eq(pending(g), [2, 3]);
  // 座位 2 碰：座位 3 还能胡，继续等
  g = act(g, 2, { kind: "peng" });
  eq(g.phase, "claim"); eq(pending(g), [3]);
  // 座位 3 胡：直接结算，点炮的是座位 0
  const w = act(g, 3, { kind: "hu" });
  eq(w.phase, "over"); eq(w.result.type, "ron"); eq(w.result.winner, 3); eq(w.result.from, 0);
  // 座位 3 放弃：座位 2 的碰生效（碰优先于吃）
  const p = act(g, 3, { kind: "pass" });
  eq(p.phase, "discard"); eq(p.turn, 2);
  eq(p.melds[2].map((m: { kind: string }) => m.kind), ["peng"]);
  eq(p.hands[2].length, 11); // 13 张碰走 2 张
  eq(p.discards[0], []); // 牌从牌河里拿走了
  eq(p.drawn, null);
});

Deno.test("claim: only the nearest winner after the discarder wins (no multiple winners), wherever they answer first", () => {
  const win13 = "2m 3m 4m 6m 7m 8m 3p 4p 5p 9s 9s 5m 5m";
  const base = ["1m 9m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z 5m", win13, "1m 9m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z", win13];
  const g0 = mk({ hands: base, turn: 0, drawn: T("5m")[0] });
  let g = act(g0, 0, { kind: "discard", tile: T("5m")[0] });
  eq(pending(g), [1, 3]);
  // 远的先说胡：近的还没表态，要等
  g = act(g, 3, { kind: "hu" });
  eq(g.phase, "claim");
  const w = act(g, 1, { kind: "hu" });
  eq(w.result.winner, 1);
  const w2 = act(g, 1, { kind: "pass" });
  eq(w2.result.winner, 3);
  // 近的先说胡：直接结算
  const g2 = act(g0, 0, { kind: "discard", tile: T("5m")[0] });
  eq(act(g2, 1, { kind: "hu" }).result.winner, 1);
  // 以打牌人为起点：打牌的是座位 2 时，座位 3 比座位 1 近
  const h2 = ["1m 9m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z", win13, "1m 9m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z 5m", win13];
  let g3 = act(mk({ hands: h2, turn: 2, drawn: T("5m")[0] }), 2, { kind: "discard", tile: T("5m")[0] });
  g3 = act(g3, 1, { kind: "hu" });
  eq(g3.phase, "claim"); // 座位 3 更近，要等他
  eq(act(g3, 3, { kind: "hu" }).result.winner, 3);
  eq(act(g3, 3, { kind: "pass" }).result.winner, 1);
});

Deno.test("claim: everybody passes -> next seat draws; wrong claims are rejected", () => {
  const g0 = mk({ hands: ["1m 9m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z 5m", "3m 4m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z", "5m 5m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z", "1m 9m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z"], turn: 0, drawn: T("5m")[0] });
  let g = act(g0, 0, { kind: "discard", tile: T("5m")[0] });
  eq(pending(g), [1, 2]);
  eq(apply(g, 3, { kind: "pass" }).error, "cannot_claim"); // 没有选项的人不能表态
  eq(apply(g, 1, { kind: "peng" }).error, "cannot_claim");
  eq(apply(g, 2, { kind: "chi", with: [T("3m")[0], T("4m")[0]] }).error, "cannot_claim"); // 只有下家能吃
  eq(apply(g, 1, { kind: "chi", with: [T("1s")[0], T("2s")[0]] }).error, "cannot_claim");
  eq(apply(g, 1, { kind: "hu" }).error, "cannot_hu");
  eq(apply(g, 0, { kind: "pass" }).error, "cannot_claim"); // 打牌的人自己
  g = act(g, 1, { kind: "pass" });
  eq(g.phase, "claim");
  g = act(g, 2, { kind: "pass" });
  eq(g.phase, "discard"); eq(g.turn, 1); eq(g.hands[1].length, 14);
  eq(apply(g, 2, { kind: "pass" }).error, "not_your_turn");
});

Deno.test("claim: 吃 takes a tile from the discarder's pool, then must discard (no draw); 明杠 draws a replacement from the wall head", () => {
  const wall = T("1m2m3m4m5m6m7m8m9m1s2s3s");
  const g0 = mk({ hands: ["1m 9m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z 5m", "3m 4m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z", "1m 9m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z", "1m 9m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z"], turn: 0, drawn: T("5m")[0], wall });
  let g = act(g0, 0, { kind: "discard", tile: T("5m")[0] });
  g = act(g, 1, { kind: "chi", with: [T("3m")[0], T("4m")[0]] });
  eq(g.phase, "discard"); eq(g.turn, 1); eq(g.drawn, null);
  eq(g.melds[1], [{ kind: "chi", tile: T("5m")[0], tiles: T("345m"), from: 0 }]);
  eq(g.hands[1].length, 11);
  eq(g.discards[0], []);
  eq(g.wall.length, wall.length); // 吃不摸牌
  eq(turnOptions(g, 1), { hu: false, angang: [], bugang: [] }); // 刚吃完不能杠 / 胡
  g = act(g, 1, { kind: "discard", tile: T("1p")[0] });
  eq(g.turn, 2);
  // 明杠
  const g1 = mk({ hands: ["1m 9m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z 5m", "1m 9m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z", "5m 5m 5m 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z", "1m 9m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z"], turn: 0, drawn: T("5m")[0], wall });
  let k = act(g1, 0, { kind: "discard", tile: T("5m")[0] });
  eq(pending(k), [2]);
  k = act(k, 2, { kind: "gang" });
  eq(k.phase, "discard"); eq(k.turn, 2);
  eq(k.melds[2][0].kind, "gang"); eq(k.melds[2][0].tiles.length, 4);
  eq(k.drawn, wall[0]); // 补牌从牌墙头部拿
  eq(k.wall.length, wall.length - 1);
  assert(k.gangFlag);
  eq(k.hands[2].length, 14 - 3);
});

Deno.test("杠: 暗杠 and 补杠 draw a replacement; 杠上开花 scores +1; no gang when the wall is empty", () => {
  const wall = T("5s9m1m2m3m");
  const g0 = mk({ hands: ["1m 1m 1m 1m 5m 6m 7m 2s 3s 4s 8p 8p 5s 9z", "1z", "2z", "3z"], turn: 0, drawn: T("5s")[0], wall: wall.slice() });
  eq(turnOptions(g0, 0).angang, T("1m"));
  let g = act(g0, 0, { kind: "angang", tile: T("1m")[0] });
  eq(g.melds[0][0].kind, "angang");
  eq(g.hands[0].length, 14 - 4 + 1); // 摸的牌还在手里，杠走 4 张，再补一张
  eq(g.drawn, wall[0]); eq(g.gangFlag, true); eq(g.turn, 0);
  eq(g.recent[g.recent.length - 1], { seat: 0, kind: "angang", tile: null }); // 暗杠是哪张牌不公开
  eq(publicView(g).melds[0], [{ kind: "angang", tile: null, tiles: [], from: 0 }]);
  eq(privateView(g, 0).ag, T("1m"));
  // 杠上开花：补到的是胡牌的那张
  const h = mk({ hands: ["5m 6m 7m 2s 3s 4s 8p 8p 4m 4m 4m", "1z", "2z", "3z"], melds: [[meld("angang", 0)], [], [], []], turn: 0, drawn: T("4m")[0], gangFlag: true });
  eq(turnOptions(h, 0).hu, true);
  const z = act(h, 0, { kind: "hu" });
  eq(z.result.type, "zimo");
  eq(z.result.items.map((i: { name: string }) => i.name), ["底番", "门清", "杠上开花"]);
  // 补杠：别人没法抢就补牌
  const b = mk({ hands: ["5m 6m 7m 2s 3s 4s 8p 8p 5s 9s", "1z 1z 2z 3z", "2z 2z 3z 4z", "3z 3z 4z 5z"], melds: [[meld("peng", 0)], [], [], []], turn: 0, drawn: T("5s")[0], wall: wall.slice() });
  eq(turnOptions(b, 0).bugang, []); // 手里没有碰过的那张
  const b2 = mk({ hands: ["1m 5m 6m 7m 2s 3s 4s 8p 8p 9s", "1z 1z 2z 3z", "2z 2z 3z 4z", "3z 3z 4z 5z"], melds: [[meld("peng", 0)], [], [], []], turn: 0, drawn: T("9s")[0], wall: wall.slice() });
  eq(turnOptions(b2, 0).bugang, T("1m"));
  const b3 = act(b2, 0, { kind: "bugang", tile: T("1m")[0] });
  eq(b3.melds[0][0].kind, "bugang"); eq(b3.melds[0][0].tiles.length, 4);
  eq(b3.drawn, wall[0]); eq(b3.turn, 0);
  // 牌墙空了：不能杠
  const e = mk({ hands: ["1m 1m 1m 1m 5m 6m 7m 2s 3s 4s 8p 8p 5s 9z", "1z", "2z", "3z"], turn: 0, drawn: T("5s")[0], wall: [] });
  eq(turnOptions(e, 0).angang, []);
  eq(apply(e, 0, { kind: "angang", tile: 0 }).error, "cannot_gang");
});

Deno.test("抢杠胡: a 补杠 can be robbed; the robbed player pays 3x; priority / nearest rule applies too", () => {
  const wait = "2m 3m 4m 6m 7m 8m 3p 4p 5p 9s 9s 1m 1m"; // 听 1m：胡 1m 后 = 234m 678m 345p 99s 111m
  const g0 = mk({ hands: ["1m 5m 6m 7m 2s 3s 4s 8p 8p 9s", wait, "1z 1z 2z 3z 4z 5z 6z 7z 1s 9s 1p 9p 1m 5z", wait], melds: [[meld("peng", 0)], [], [], []], turn: 0, drawn: T("9s")[0] });
  let g = act(g0, 0, { kind: "bugang", tile: T("1m")[0] });
  eq(g.phase, "claim"); eq(g.claim.kind, "qianggang"); eq(pending(g), [1, 3]); // 只有能胡的人有选项，没有吃碰
  assert(!g.claim.opts[1].peng && !g.claim.opts[1].chi.length);
  eq(publicView(g).claim, { kind: "qianggang", tile: 0, from: 0 });
  const w = act(act(g, 3, { kind: "hu" }), 1, { kind: "hu" }); // 座位 1 离补杠的座位 0 最近
  eq(w.result.type, "qianggang"); eq(w.result.winner, 1); eq(w.result.from, 0);
  eq(w.result.scores, [-3 * w.result.fan, 3 * w.result.fan, 0, 0]);
  assert(w.result.items.some((i: { name: string }) => i.name === "抢杠胡"));
  eq(w.hands[0].length, 10); // 补杠没成：那张牌还给他
  // 都不抢：杠成了，补一张牌
  const p = act(act(g, 1, { kind: "pass" }), 3, { kind: "pass" });
  eq(p.phase, "discard"); eq(p.turn, 0); eq(p.melds[0][0].kind, "bugang");
});

Deno.test("自摸 scoring: winner +3x, others -x; 点炮: the discarder pays 3x; sums to zero", () => {
  const g0 = mk({ hands: ["1m 2m 3m 4m 5m 6m 7m 8m 9m 1p 2p 3p 5s 5s", "1z", "2z", "3z"], turn: 0, drawn: T("5s")[0], dealer: 0 });
  const z = act(g0, 0, { kind: "hu" });
  eq(z.result.fan, 2); // 底 + 门清
  eq(z.result.scores, [6, -2, -2, -2]);
  eq(z.result.scores.reduce((a: number, b: number) => a + b, 0), 0);
  // 点炮
  const win13 = "2m 3m 4m 6m 7m 8m 3p 4p 5p 9s 9s 5m 5m";
  const g1 = mk({ hands: ["1m 9m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z 5m", win13, "1m", "1m"], turn: 0, drawn: T("5m")[0] });
  const w = act(act(g1, 0, { kind: "discard", tile: T("5m")[0] }), 1, { kind: "hu" });
  eq(w.result.fan, 2);
  eq(w.result.scores, [-6, 6, 0, 0]);
  eq(w.result.hands[1].length, 14);
  // 没有胡牌时不能胡
  eq(apply(mk({ hands: ["1m 2m 4m 5m 6m 7m 8m 9m 1p 2p 3p 5s 5s 9z", "1z", "2z", "3z"], turn: 0, drawn: 0 }), 0, { kind: "hu" }).error, "cannot_hu");
  // 结束后不能再动
  eq(apply(z, 0, { kind: "discard", tile: 0 }).error, "bad_phase");
});

Deno.test("海底捞月: taking the last wall tile and winning by 自摸 scores +1; a discard after the last tile ends in 流局", () => {
  // 座位 0 打 9z 之类让下家摸最后一张
  const h = mk({ hands: ["1z 2z 3z 4z 5z 6z 7z 1m 9m 1s 9s 1p 9p 3z", "1m 2m 3m 4m 5m 6m 7m 8m 9m 1p 2p 3p 5s", "1z 1z", "2z 2z"], turn: 0, drawn: T("3z")[0], wall: T("5s") });
  const g = act(h, 0, { kind: "discard", tile: T("3z")[0] });
  eq(g.turn, 1); eq(g.haidi, true); eq(g.wall.length, 0);
  assert(turnOptions(g, 1).hu);
  const w = act(g, 1, { kind: "hu" });
  assert(w.result.items.some((i: { name: string }) => i.name === "海底捞月"));
  eq(w.result.fan, 3);
  // 海底牌打出去没人要：流局
  const last = mk({ hands: ["1z 2z 3z 4z 5z 6z 7z 1m 9m 1s 9s 1p 9p", "1m 3m 5m 7m 9m 2s 4s 6s 8s 1p 3p 5p 7p 4z", "1z 1z", "2z 2z"], turn: 1, drawn: T("4z")[0], wall: [] });
  const d = act(last, 1, { kind: "discard", tile: T("4z")[0] });
  eq(d.phase, "over"); eq(d.result.type, "draw"); eq(d.result.scores, [0, 0, 0, 0]);
  eq(d.nextDealer, 0); // 流局庄家不变
});

Deno.test("流局 when the wall runs out after a 杠 draw; dealer rotation: dealer win/draw stays, others pass the deal", () => {
  const e = mk({ hands: ["1m 1m 1m 1m 5m 6m 7m 2s 3s 4s 8p 8p 5s 9z", "1z", "2z", "3z"], turn: 0, drawn: T("5s")[0], wall: T("5s") });
  const d = act(e, 0, { kind: "angang", tile: 0 });
  eq(d.drawn, T("5s")[0]); eq(d.wall.length, 0); // 补走了最后一张
  const d2 = act(d, 0, { kind: "discard", tile: T("5s")[0] });
  eq(d2.phase, "over"); eq(d2.result.type, "draw");
  // 庄家胡：留任；闲家胡：下家做庄，圈数加一
  const mkWin = (winner: number, dealer: number) => {
    const hands = ["1z", "2z", "3z", "4z"];
    hands[winner] = "1m 2m 3m 4m 5m 6m 7m 8m 9m 1p 2p 3p 5s 5s";
    return act(mk({ hands, turn: winner, drawn: T("5s")[0], dealer }), winner, { kind: "hu" });
  };
  let r = mkWin(2, 2);
  eq([r.nextDealer, r.nextQuan], [2, 0]);
  r = mkWin(0, 2);
  eq([r.nextDealer, r.nextQuan], [3, 1]);
  r = mkWin(1, 3);
  eq([r.nextDealer, r.nextQuan], [0, 1]);
  eq(d2.nextDealer, 0);
});

Deno.test("timeouts and bots: auto discard prefers the drawn tile; claim timeout is pass; bots always hu, never chi, only peng when safe", () => {
  const g0 = mk({ hands: ["1m 2m 3m 4m 5m 6m 7m 8m 9m 1p 3z 7z 9s 5s", "1z", "2z", "3z"], turn: 0, drawn: T("5s")[0] });
  eq(timeoutAction(g0, 0), { kind: "discard", tile: T("5s")[0] });
  const g1 = mk({ hands: ["1m 2m 3m 4m 5m 6m 7m 8m 9m 1p 3p 7z 9s 5s", "1z", "2z", "3z"], turn: 0, drawn: null });
  const t = timeoutAction(g1, 0);
  eq(t.kind, "discard"); assert(g1.hands[0].includes(t.tile));
  // 孤立的字牌先打
  assert(pickDiscard(T("2m3m4m5m6m7m2s3s4s5s5p6p7z8p")) === T("7z")[0]);
  assert(pickDiscard(T("2m3m4m5m6m7m2s3s4s5s5p6p9s8p")) === T("9s")[0]);
  // 机器人：能胡就胡
  const w = mk({ hands: ["1m 2m 3m 4m 5m 6m 7m 8m 9m 1p 2p 3p 5s 5s", "1z", "2z", "3z"], turn: 0, drawn: T("5s")[0] });
  eq(botAction(w, 0), { kind: "hu" });
  // 机器人：不吃；字牌碰；孤对碰；有搭子的对子不碰
  const mkClaim = (hand1: string, tile: string) => {
    const g = mk({ hands: ["1m 9m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z " + tile, hand1, "1z", "2z"], turn: 0, drawn: T(tile)[0] });
    return act(g, 0, { kind: "discard", tile: T(tile)[0] });
  };
  let c = mkClaim("3m 4m 8s 8s 1p 9p 1z 2z 3z 4z 6z 7z 9z".replace("9z", "5z"), "5m");
  eq(pending(c), [1]);
  eq(botAction(c, 1), { kind: "pass" }); // 只有吃：机器人不吃
  c = mkClaim("5z 5z 1s 9s 1p 9p 1z 2z 3z 4z 6z 7z 9m", "5z");
  eq(botAction(c, 1), { kind: "peng" }); // 字牌对子：碰
  c = mkClaim("5m 5m 4m 9s 1p 9p 1z 2z 3z 4z 6z 7z 9m", "5m");
  eq(botAction(c, 1), { kind: "pass" }); // 4m 5m 5m 连着：碰了会拆搭子
  c = mkClaim("5m 5m 9s 9s 1p 9p 1z 2z 3z 4z 6z 7z 9m", "5m");
  eq(botAction(c, 1), { kind: "peng" });
  c = mkClaim("5z 5z 5z 9s 1p 9p 1z 2z 3z 4z 6z 7z 9m", "5z");
  eq(botAction(c, 1), { kind: "gang" });
});

// ---- 整局随机对局 ----
Deno.test("full games: bots only, 300 seeds, every game ends, tiles are conserved, scores sum to zero, rematch rotation is consistent", () => {
  let draws = 0, wins = 0, zimo = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const rng = mulberry32(seed);
    let g = newGame({ rng, dealer: seed % 4 });
    let steps = 0;
    while (g.phase !== "over") {
      assert(steps++ < 1000, "game does not end, seed " + seed);
      const total = g.wall.length + g.hands.reduce((a: number, h: number[]) => a + h.length, 0) + g.discards.reduce((a: number, d: number[]) => a + d.length, 0)
        + g.melds.reduce((a: number, ms: { tiles: number[] }[]) => a + ms.reduce((b, m) => b + m.tiles.length, 0), 0)
        // 补杠 / 抢杠窗口里那张牌暂时不在手里也不在牌河里
        + (g.claim && g.claim.kind === "qianggang" ? 1 : 0);
      eq(total, 136, "tile conservation seed " + seed);
      const seat = pending(g)[0];
      const a = botAction(g, seat);
      const r = apply(g, seat, a);
      assert(r.ok, "bot action rejected " + JSON.stringify(a) + " " + r.error + " seed " + seed);
      g = r.state;
    }
    const res = g.result;
    eq(res.scores.reduce((a: number, b: number) => a + b, 0), 0, "scores sum seed " + seed);
    if (res.type === "draw") { draws++; eq(g.wall.length, 0); eq(g.nextDealer, g.dealer); }
    else {
      wins++;
      if (res.type === "zimo") zimo++;
      assert(res.fan >= 1);
      assert(canHu(res.hands[res.winner], g.melds[res.winner].length), "winner hand must be a win");
      eq(g.nextDealer, res.winner === g.dealer ? g.dealer : (g.dealer + 1) % 4);
      if (res.type === "zimo") eq(res.scores[res.winner], 3 * res.fan); else eq(res.scores[res.from], -3 * res.fan);
    }
  }
  assert(wins > 20 && draws > 0 && zimo > 0, `wins ${wins} draws ${draws} zimo ${zimo}`);
});
