// 斗地主规则引擎测试（rules.gen.js 由 gen-rules.py 从 chat/js/miniapps/ddz-rules.js 生成）
// 运行：deno test supabase/functions/ddz/rules_test.ts
import * as R from "./rules.gen.js";

// rules.gen.js 是纯 JS，类型靠推断会很别扭，这里统一当 any 用
// deno-lint-ignore no-explicit-any
const { apply, beats, botAction, canPass, cardLabel, classify, deal, DDZ_RULES_VERSION, hints, newGame, publicView, rankOf, shuffleDeck, sortHand, suitOf } = R as any;

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

// 用点数写牌：'3'..'10','J','Q','K','A','2','s'(小王),'B'(大王)；同点数自动依次取不同花色
const RANKS: Record<string, number> = { "3": 0, "4": 1, "5": 2, "6": 3, "7": 4, "8": 5, "9": 6, "10": 7, J: 8, Q: 9, K: 10, A: 11, "2": 12 };
function cs(str: string): number[] {
  const used: Record<string, number> = {};
  const out: number[] = [];
  for (const t of str.trim().split(/\s+/)) {
    if (t === "s") { out.push(52); continue; }
    if (t === "B") { out.push(53); continue; }
    const i = used[t] || 0;
    used[t] = i + 1;
    out.push(RANKS[t] * 4 + i);
  }
  return out;
}
function T(str: string) { const r = classify(cs(str)) as S; return r && `${r.type}:${r.rank}:${r.len}`; }

Deno.test("card helpers", () => {
  eq(DDZ_RULES_VERSION, 1);
  eq(rankOf(0), 0); eq(rankOf(51), 12); eq(rankOf(52), 13); eq(rankOf(53), 14);
  eq(suitOf(5), 1);
  eq([0, 4, 20, 44, 48, 52, 53].map(cardLabel), ["3", "4", "8", "A", "2", "小王", "大王"]);
  eq(cardLabel(28), "10");
  eq(sortHand([0, 53, 4, 5, 52]), [53, 52, 5, 4, 0]);
});

Deno.test("classify: basic types", () => {
  eq(T("3"), "single:0:1");
  eq(T("B"), "single:14:1");
  eq(T("5 5"), "pair:2:1");
  eq(T("2 2"), "pair:12:1");
  eq(T("7 7 7"), "trio:4:1");
  eq(T("3 3 3 2"), "trio1:0:1");
  eq(T("9 9 9 s"), "trio1:6:1");
  eq(T("3 3 3 4 4"), "trio2:0:1");
  eq(T("4 4 4 4"), "bomb:1:1");
  eq(T("2 2 2 2"), "bomb:12:1");
  eq(T("s B"), "rocket:14:1");
});

Deno.test("classify: straights and pair chains", () => {
  eq(T("3 4 5 6 7"), "straight:4:5");
  eq(T("10 J Q K A"), "straight:11:5");
  eq(T("3 4 5 6 7 8 9 10 J Q K A"), "straight:11:12");
  eq(T("3 4 5 6"), null);
  eq(T("J Q K A 2"), null);
  eq(T("10 J Q K A 2"), null);
  eq(T("3 4 5 6 s"), null);
  eq(T("3 3 4 4 5 5"), "pairs:2:3");
  eq(T("Q Q K K A A"), "pairs:11:3");
  eq(T("3 3 4 4"), null);
  eq(T("K K A A 2 2"), null);
  eq(T("3 3 4 4 6 6"), null);
});

Deno.test("classify: planes", () => {
  eq(T("3 3 3 4 4 4"), "plane:1:2");
  eq(T("3 3 3 4 4 4 5 5 5"), "plane:2:3");
  eq(T("K K K A A A"), "plane:11:2");
  eq(T("A A A 2 2 2"), null);
  eq(T("3 3 3 4 4 4 5 6"), "plane1:1:2");
  eq(T("3 3 3 4 4 4 5 5 6 6"), "plane2:1:2");
  eq(T("3 3 3 4 4 4 s B"), null); // 翅膀不能是火箭
  eq(T("3 3 3 4 4 4 5 5"), "plane1:1:2"); // 翅膀是同点数的两张，也算两张单牌
  eq(T("3 3 3 5 5 5 6 7"), null); // 不连续
  eq(T("3 3 3 4 4 4 5 5 5 6 7 8"), "plane1:2:3");
  eq(T("3 3 3 4 4 4 5 5 5 6 6 6 7 8 9 10"), "plane1:3:4");
});

Deno.test("classify: ambiguous planes pick highest main rank, then longest", () => {
  // 333444555666：4 连飞机 rank 3 len 4，优先于「444555666 带 333」（rank 同为 3，len 更短）
  eq(T("3 3 3 4 4 4 5 5 5 6 6 6"), "plane:3:4");
  // 666777888 + 333：四个三条不连续，只能是 3 连飞机带三张翅膀，主牌最大 888 (rank 5)
  eq(T("6 6 6 7 7 7 8 8 8 3 3 3"), "plane1:5:3");
  // 33334444：plane1(rank 1,len 2) 与 four22(rank 1,len 1) → len 更长的 plane1
  eq(T("3 3 3 3 4 4 4 4"), "plane1:1:2");
  // 3 3 3 4 4 4 4 5：翅膀带了拆出来的 4
  eq(T("3 3 3 4 4 4 4 5"), "plane1:1:2");
});

Deno.test("classify: four with kickers", () => {
  eq(T("4 4 4 4 5 6"), "four2:1:1");
  eq(T("4 4 4 4 5 5"), "four2:1:1");
  eq(T("4 4 4 4 s B"), null);
  eq(T("4 4 4 4 5 5 6 6"), "four22:1:1");
  eq(T("4 4 4 4 5 6 7 8"), null);
  eq(T("4 4 4 4 5 5 5 5"), "plane1:2:2"); // 与 33334444 同理，长度更长的解释优先
  eq(T("4 4 4 4 5"), null);
});

Deno.test("classify: illegal", () => {
  eq(T("3 4"), null);
  eq(T("3 3 4"), null);
  eq(T("3 3 3 3 3"), null);
  eq(T("3 4 5"), null);
    eq(classify([]), null);
  eq(classify([1, 1]), null);
  eq(classify([54]), null);
  eq(classify([-1]), null);
  eq(classify([1.5]), null);
  eq(classify(null as unknown as number[]), null);
  eq(T("3 3 3 4 5 6"), null);
  eq(T("3 3 3 4 4 5"), null);
  eq(T("3 3 4 4 4 5"), null);
});

Deno.test("beats matrix", () => {
  const b = (x: string, y: string) => beats(cs(x), cs(y));
  assert(b("4", "3")); assert(!b("3", "4")); assert(!b("3", "3"));
  assert(b("2", "A")); assert(b("s", "2")); assert(b("B", "s"));
  assert(b("6 6", "5 5")); assert(!b("5 5", "6 6")); assert(!b("6", "5 5"));
  assert(b("5 5 5 9", "4 4 4 K")); assert(!b("5 5 5 9 9", "4 4 4 K"));
  assert(b("4 5 6 7 8", "3 4 5 6 7")); assert(!b("4 5 6 7 8 9", "3 4 5 6 7"));
  assert(b("4 4 5 5 6 6", "3 3 4 4 5 5")); assert(!b("4 4 5 5 6 6 7 7", "3 3 4 4 5 5"));
  assert(b("4 4 4 5 5 5 8 9", "3 3 3 4 4 4 5 6")); assert(!b("3 3 3 4 4 4 8 8", "3 3 3 4 4 4 5 6"));
  assert(b("4 4 4 4", "3 3 3 3")); assert(!b("3 3 3 3", "4 4 4 4"));
  assert(b("3 3 3 3", "2 2")); assert(b("3 3 3 3", "A")); assert(b("3 3 3 3", "3 3 3 4"));
  assert(!b("2 2", "3 3 3 3"));
  assert(b("s B", "2 2 2 2")); assert(!b("2 2 2 2", "s B")); assert(!b("s B", "s B"));
  assert(b("5 5 5 5 6 6", "3 3 3 3 4 4")); assert(!b("5 5 5 5 6 6", "3 3 3 4 4 4"));
  assert(!b("3 3 3 3 4 4", "5 5 5 5 6 6"));
  assert(!b("3 4", "3"));
  assert(beats(cs("3"), null));
  assert(!beats(cs("3 4"), null));
});

Deno.test("deal and shuffle", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const d = deal(mulberry32(seed));
    eq(d.hands.map((h: number[]) => h.length), [17, 17, 17]);
    eq(d.bottom.length, 3);
    const all = [...d.hands[0], ...d.hands[1], ...d.hands[2], ...d.bottom];
    eq(new Set(all).size, 54);
    assert(all.every((c: number) => c >= 0 && c <= 53));
    eq(d.hands[0], sortHand(d.hands[0]));
  }
  eq(shuffleDeck(mulberry32(5)), shuffleDeck(mulberry32(5)));
  assert(JSON.stringify(shuffleDeck(mulberry32(5))) !== JSON.stringify(shuffleDeck(mulberry32(6))));
});

// ---------- 状态机 ----------
// deno-lint-ignore no-explicit-any
type S = any;
function ok(r: S): S { assert(r.ok, "expected ok, got " + r.error); return r.state; }
function bad(r: S, code: string) { assert(!r.ok && r.error === code, `expected ${code} got ${JSON.stringify(r)}`); }

function total(s: S) {
  // 手牌 + 已出的牌 = 54（底牌已并入地主手牌，叫牌阶段底牌单独算）
  const n = s.hands.flat().length + s.played.flat().length + (s.phase === "bidding" ? s.bottom.length : 0);
  return n;
}

function playingState(hands: string[], opts: S = {}): S {
  const s = newGame({ rng: mulberry32(1), firstSeat: 0 });
  s.phase = "playing";
  s.hands = hands.map(cs);
  s.landlord = opts.landlord ?? 0;
  s.turn = opts.turn ?? s.landlord;
  s.bid = opts.bid ?? 1;
  s.multiplier = s.bid;
  s.bids = [null, null, null];
  s.bottom = [0, 1, 2];
  if (opts.lastPlay) s.lastPlay = { seat: opts.lastPlay.seat, cards: cs(opts.lastPlay.cards), type: classify(cs(opts.lastPlay.cards)).type };
  if (opts.playCounts) s.playCounts = opts.playCounts;
  if (opts.bombs) s.bombs = opts.bombs;
  return s;
}

Deno.test("bidding: ordering, bid 3 ends immediately, highest wins", () => {
  let s = newGame({ rng: mulberry32(7), firstSeat: 1 });
  eq(s.phase, "bidding"); eq(s.turn, 1); eq(s.bottom.length, 3);
  bad(apply(s, 0, { kind: "bid", value: 1 }), "not_your_turn");
  bad(apply(s, 1, { kind: "bid", value: 4 }), "bad_bid");
  bad(apply(s, 1, { kind: "play", cards: [0] }), "bad_phase");
  s = ok(apply(s, 1, { kind: "bid", value: 1 }));
  bad(apply(s, 2, { kind: "bid", value: 1 }), "bad_bid");
  s = ok(apply(s, 2, { kind: "bid", value: 2 }));
  s = ok(apply(s, 0, { kind: "bid", value: 0 }));
  eq(s.phase, "playing"); eq(s.landlord, 2); eq(s.bid, 2); eq(s.turn, 2);
  eq(s.hands[2].length, 20); eq(s.hands[0].length, 17);
  assert(s.bottom.every((c: number) => s.hands[2].includes(c)));
  eq(s.lastPlay, null);

  let t = newGame({ rng: mulberry32(8), firstSeat: 0 });
  t = ok(apply(t, 0, { kind: "bid", value: 1 }));
  t = ok(apply(t, 1, { kind: "bid", value: 3 }));
  eq(t.phase, "playing"); eq(t.landlord, 1); eq(t.bid, 3); eq(t.turn, 1); eq(t.hands[1].length, 20);
});

Deno.test("bidding: all pass redeals, capped at 3 redeals", () => {
  const rng = mulberry32(11);
  let s = newGame({ rng, firstSeat: 0 });
  const first = s.hands.map((h: number[]) => h.join());
  for (let i = 0; i < 3; i++) s = ok(apply(s, s.turn, { kind: "bid", value: 0 }, rng));
  eq(s.phase, "bidding"); eq(s.redeals, 1); eq(s.turn, 1); eq(s.bidTurnCount, 0);
  eq(s.bids, [null, null, null]);
  assert(s.hands.map((h: number[]) => h.join()).join("|") !== first.join("|"));
  eq(s.hands.map((h: number[]) => h.length), [17, 17, 17]);
  eq(s.log[s.log.length - 1].kind, "redeal");
  for (let i = 0; i < 3; i++) s = ok(apply(s, s.turn, { kind: "bid", value: 0 }, rng));
  eq(s.redeals, 2); eq(s.turn, 2);
  for (let i = 0; i < 3; i++) s = ok(apply(s, s.turn, { kind: "bid", value: 0 }, rng));
  eq(s.redeals, 3); eq(s.turn, 0);
  // 第 4 轮由 seat 0 先叫，全不叫 → seat 0 当地主，叫分 1
  for (let i = 0; i < 3; i++) s = ok(apply(s, s.turn, { kind: "bid", value: 0 }, rng));
  eq(s.phase, "playing"); eq(s.landlord, 0); eq(s.bid, 1); eq(s.turn, 0); eq(s.hands[0].length, 20);
  eq(s.redeals, 3);
  // 没有 rng 时重发会报错
  let u = newGame({ rng: mulberry32(2), firstSeat: 0 });
  u = ok(apply(u, 0, { kind: "bid", value: 0 })); u = ok(apply(u, 1, { kind: "bid", value: 0 }));
  bad(apply(u, 2, { kind: "bid", value: 0 }), "no_rng");
});

Deno.test("play: validation errors and pass rules", () => {
  const s = playingState(["3 3 4 5 6 7 8 9", "4 4 K", "5 5 A"], { landlord: 0 });
  bad(apply(s, 1, { kind: "play", cards: cs("4") }), "not_your_turn");
  bad(apply(s, 0, { kind: "bid", value: 1 }), "bad_phase");
  bad(apply(s, 0, { kind: "play", cards: cs("K") }), "not_in_hand");
  bad(apply(s, 0, { kind: "play", cards: cs("3 4") }), "illegal_combo");
  bad(apply(s, 0, { kind: "play", cards: [] }), "illegal_combo");
  bad(apply(s, 0, { kind: "play", cards: [cs("3")[0], cs("3")[0]] }), "illegal_combo");
  bad(apply(s, 0, { kind: "pass" }), "cannot_pass");
  assert(!canPass(s, 0));
  let t = ok(apply(s, 0, { kind: "play", cards: cs("3") }));
  eq(t.turn, 1);
  assert(canPass(t, 1)); assert(!canPass(t, 2));
  bad(apply(t, 1, { kind: "play", cards: cs("4 4") }), "too_small");
  bad(apply(t, 1, { kind: "play", cards: cs("4 K") }), "illegal_combo");
});

Deno.test("play: too_small, two passes return the lead, immutability", () => {
  const s = playingState(["3 5 9 9", "4 6 K", "7 A A"], { landlord: 0 });
  const snap = JSON.stringify(s);
  let t = ok(apply(s, 0, { kind: "play", cards: cs("5") }));
  eq(JSON.stringify(s), snap, "input mutated");
  t = ok(apply(t, 1, { kind: "pass" }));
  t = ok(apply(t, 2, { kind: "pass" }));
  eq(t.turn, 0); eq(t.lastPlay, null);
  bad(apply(t, 0, { kind: "pass" }), "cannot_pass");
  t = ok(apply(t, 0, { kind: "play", cards: cs("9 9") }));
  eq(t.lastPlay.type, "pair");
  t = ok(apply(t, 1, { kind: "pass" }));
  t = ok(apply(t, 2, { kind: "play", cards: cs("A A") }));
  eq(t.turn, 0);
  t = ok(apply(t, 0, { kind: "pass" }));
  t = ok(apply(t, 1, { kind: "pass" }));
  eq(t.turn, 2); eq(t.lastPlay, null);
  eq(t.log.filter((e: S) => e.kind === "pass").length, 5);
});

Deno.test("scoring: landlord wins, spring, anti-spring, bombs", () => {
  // 地主打完最后一手；农民没出过牌 → 春天
  let s = playingState(["3", "4 5", "6 7"], { landlord: 0, bid: 2 });
  s = ok(apply(s, 0, { kind: "play", cards: cs("3") }));
  eq(s.phase, "over"); eq(s.winner, "landlord"); eq(s.spring, true);
  eq(s.multiplier, 4); eq(s.scores, [8, -4, -4]);
  bad(apply(s, 1, { kind: "pass" }), "bad_phase");

  // 农民出过牌 → 不是春天
  s = playingState(["3", "4 5", "6 7"], { landlord: 0, bid: 2, playCounts: [2, 1, 0] });
  s = ok(apply(s, 0, { kind: "play", cards: cs("3") }));
  eq(s.spring, false); eq(s.multiplier, 2); eq(s.scores, [4, -2, -2]);

  // 农民赢、地主只出过一手 → 反春
  s = playingState(["3 4", "K", "6 7"], { landlord: 0, bid: 1, turn: 1, playCounts: [1, 0, 0] });
  s = ok(apply(s, 1, { kind: "play", cards: cs("K") }));
  eq(s.winner, "farmers"); eq(s.spring, true); eq(s.multiplier, 2); eq(s.scores, [-4, 2, 2]);

  // 地主出过两手 → 不是反春
  s = playingState(["3 4", "K", "6 7"], { landlord: 0, bid: 1, turn: 1, playCounts: [2, 0, 0] });
  s = ok(apply(s, 1, { kind: "play", cards: cs("K") }));
  eq(s.spring, false); eq(s.scores, [-2, 1, 1]);

  // 炸弹翻倍（2 个炸弹 ×4），再叠春天 ×2
  s = playingState(["3 4 4 4 4", "5 5 5 5 9", "9"], { landlord: 0, bid: 3 });
  s = ok(apply(s, 0, { kind: "play", cards: cs("4 4 4 4") }));
  eq(s.bombs, 1); eq(s.multiplier, 6);
  s = ok(apply(s, 1, { kind: "play", cards: cs("5 5 5 5") }));
  eq(s.bombs, 2); eq(s.multiplier, 12); eq(s.lastPlay.type, "bomb");
  s = ok(apply(s, 2, { kind: "pass" }));
  s = ok(apply(s, 0, { kind: "pass" }));
  eq(s.turn, 1);
  // 火箭也算一次
  let r = playingState(["3 s B", "4 4", "5 5"], { landlord: 0, bid: 1 });
  r = ok(apply(r, 0, { kind: "play", cards: cs("s B") }));
  eq(r.bombs, 1); eq(r.multiplier, 2); eq(r.lastPlay.type, "rocket");
  r = ok(apply(r, 1, { kind: "pass" })); r = ok(apply(r, 2, { kind: "pass" }));
  r = ok(apply(r, 0, { kind: "play", cards: cs("3") }));
  eq(r.winner, "landlord"); eq(r.spring, true); eq(r.multiplier, 4); eq(r.scores, [8, -4, -4]);
});

Deno.test("publicView never leaks other hands", () => {
  let s = newGame({ rng: mulberry32(3), firstSeat: 0 });
  const v = publicView(s, 1);
  eq(v.hands, undefined);
  eq(v.handCounts, [17, 17, 17]);
  eq(v.myHand, s.hands[1]);
  eq(v.bottom, null);
  eq(publicView(s, null).myHand, null);
  const text = JSON.stringify(publicView(s, null));
  for (const h of s.hands) assert(!text.includes(JSON.stringify(h)));
  v.myHand.push(99);
  assert(!s.hands[1].includes(99));
  s = ok(apply(s, 0, { kind: "bid", value: 3 }));
  const w = publicView(s, 2);
  eq(w.bottom, s.bottom); eq(w.handCounts, [20, 17, 17]);
  eq(JSON.stringify(w).includes(JSON.stringify(s.hands[0])), false);
  eq(JSON.stringify(w).includes(JSON.stringify(s.hands[1])), false);
  eq(w.myHand, s.hands[2]);
});

// ---------- 机器人 ----------
Deno.test("full games: 2000 seeded bot games terminate with sane results", () => {
  let landlordWins = 0, springs = 0, bombGames = 0, redealGames = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const rng = mulberry32(seed * 7919);
    let s: S = newGame({ rng, firstSeat: seed % 3 });
    let n = 0;
    while (s.phase !== "over") {
      assert(++n <= 300, `seed ${seed} did not terminate`);
      const seat = s.turn;
      const a = botAction(s, seat);
      const r = apply(s, seat, a, rng);
      assert(r.ok, `seed ${seed} step ${n}: ${JSON.stringify(a)} -> ${r.error}`);
      s = r.state;
      if (s.phase === "playing") eq(total(s), 54, `seed ${seed} conservation`);
    }
    eq(total(s), 54);
    eq(s.scores.reduce((x: number, y: number) => x + y, 0), 0);
    assert(s.winner === "landlord" || s.winner === "farmers");
    const empty = s.hands.filter((h: number[]) => !h.length).length;
    eq(empty, 1);
    if (s.winner === "landlord") landlordWins++;
    if (s.spring) springs++;
    if (s.bombs) bombGames++;
    if (s.redeals) redealGames++;
  }
  console.log(`landlord wins ${landlordWins}/2000, spring ${springs}, bomb games ${bombGames}, redeal games ${redealGames}`);
  assert(landlordWins >= 700 && landlordWins <= 1400, `landlord win rate out of band: ${landlordWins}/2000`);
});

Deno.test("botAction is deterministic and does not mutate state", () => {
  const rng = mulberry32(99);
  let s: S = newGame({ rng, firstSeat: 0 });
  for (let i = 0; i < 30 && s.phase !== "over"; i++) {
    const snap = JSON.stringify(s);
    const a = botAction(s, s.turn), b = botAction(s, s.turn);
    eq(a, b); eq(JSON.stringify(s), snap);
    s = ok(apply(s, s.turn, a, rng));
  }
});

Deno.test("bot bidding: strong hand bids high, weak hand passes", () => {
  const s = newGame({ rng: mulberry32(1), firstSeat: 0 });
  s.hands[0] = cs("s B 2 2 A A A A K K Q J 10 9 8 7 6");
  s.hands[1] = cs("3 3 4 5 6 7 8 9 10 J Q K 4 5 6 7 8");
  eq(botAction(s, 0), { kind: "bid", value: 3 });
  eq(botAction(s, 1), { kind: "bid", value: 0 });
  s.bid = 2;
  const a = botAction(s, 0);
  eq(a, { kind: "bid", value: 3 });
  s.hands[0] = cs("s 2 A A K K Q Q J J 10 9 8 7 6 5 4");
  s.bid = 3;
  eq(botAction(s, 0), { kind: "bid", value: 0 });
});

Deno.test("bot: farmer does not top teammate's play", () => {
  // seat0 地主，seat1/2 农民；seat 1 出了 5，轮到 seat 2，seat 2 有 K 可以压
  const s = playingState(["3 3 4 4 6 7 8 9 9 10 10", "5 5 8", "K K 7 8 9"], {
    landlord: 0, turn: 2, lastPlay: { seat: 1, cards: "5" },
  });
  eq(botAction(s, 2), { kind: "pass" });
  // 但如果能一手出完，就出
  const t = playingState(["3 3 4 4 6 7 8 9 9 10 10", "5 5 8", "K"], {
    landlord: 0, turn: 2, lastPlay: { seat: 1, cards: "5" },
  });
  eq(botAction(t, 2), { kind: "play", cards: cs("K") });
  // 对比：同样的牌，如果是地主出的 5，农民会压
  const u = playingState(["3 3 4 4 6 7 8 9 9 10 10 J", "5 5 8", "K K 7 8 9"], {
    landlord: 0, turn: 1, lastPlay: { seat: 0, cards: "5" },
  });
  const a = botAction(u, 1);
  eq(a.kind, "play");
  assert(beats(a.cards, cs("5")));
});

Deno.test("bot: bombs when the landlord has 1 card and would otherwise win", () => {
  // 农民 seat1 手里只有炸弹和小牌；地主 seat0 出 A 后只剩 1 张。单牌压不住，必须炸。
  const s = playingState(["K", "3 4 6 6 6 6", "5 8 9 10"], {
    landlord: 0, turn: 1, lastPlay: { seat: 0, cards: "A" },
  });
  const a = botAction(s, 1);
  eq(a, { kind: "play", cards: sortHand(cs("6 6 6 6")) });
  // 地主还有很多牌时不浪费炸弹
  const t = playingState(["K K K Q Q Q 7 8 9 10 J", "3 4 6 6 6 6 5 5 5 7 7", "5 8 9 10 J J Q"], {
    landlord: 0, turn: 1, lastPlay: { seat: 0, cards: "A" },
  });
  eq(botAction(t, 1), { kind: "pass" });
});

Deno.test("bot: leads sensibly", () => {
  // 对手剩 1 张时不领单张
  let s = playingState(["3 5 7 9 9 K K", "A", "4 4 6 6 8"], { landlord: 0, turn: 2 });
  let a = botAction(s, 2);
  eq(a.kind, "play");
  assert(a.cards.length >= 2, "should not lead a single into a 1-card landlord");
  // 能一手出完就出
  s = playingState(["3 5 7", "4 4 4 4 8 8", "A A"], { landlord: 0, turn: 1 });
  a = botAction(s, 1);
  eq(a.cards.length, 6);
  // 领牌优先多张的小牌组合，而不是拆大牌
  s = playingState(["3 4 5 6 7 8 K K A 2 s", "9", "10"], { landlord: 0, turn: 0 });
  a = botAction(s, 0);
  eq(a.kind, "play");
  assert(a.cards.length >= 5);
  assert(!a.cards.some((c: number) => rankOf(c) >= 12));
});

// ---------- 提示 ----------
Deno.test("hints: legal and ordered", () => {
  const hand = cs("3 4 5 6 7 8 8 8 9 9 J J Q K A A 2 2 s B");
  const prev = cs("7");
  const hs = hints(hand, prev);
  assert(hs.length > 0);
  for (const h of hs) assert(beats(h, prev), "hint must beat prev");
  eq(hs[0].length, 1);
  const lead = hints(hand, null);
  assert(lead.length > 5 && lead.length < 200);
  for (const h of lead) assert(classify(h) !== null);
  for (const h of lead) for (const c of h) assert(hand.includes(c));
  // 对手出火箭，什么都压不了
  eq(hints(hand, cs("s B")), []);
  // 只有炸弹能压顺子
  const h2 = hints(cs("3 3 3 3 5 9"), cs("3 4 5 6 7"));
  eq(h2.length, 1); eq(classify(h2[0])!.type, "bomb");
  // 提示里不会出现拆炸弹的单张，除非别无选择
  const h3 = hints(cs("5 5 5 5 9"), cs("4"));
  eq(h3[0], cs("9"));
});

Deno.test("hints: cheap-to-strong ordering for pairs", () => {
  const hs = hints(cs("4 4 5 5 5 9 9 K K"), cs("3 3"));
  eq(hs.map((h: number[]) => rankOf(h[0])), [1, 6, 2, 10]); // 44, 99, 拆三条的 55, KK
});

Deno.test("hints perf: 20-card hands", () => {
  const rng = mulberry32(2024);
  let worst = 0;
  const prevs = [null, cs("3"), cs("3 3"), cs("3 3 3 4"), cs("3 4 5 6 7"), cs("3 3 4 4 5 5"), cs("3 3 3 4 4 4"), cs("3 3 3 4 4 4 5 6"), cs("3 3 3 3 4 5")];
  for (let i = 0; i < 200; i++) {
    const d = deal(rng);
    const hand = sortHand(d.hands[i % 3].concat(d.bottom));
    for (const p of prevs) {
      const t0 = performance.now();
      const hs = hints(hand, p);
      const dt = performance.now() - t0;
      if (dt > worst) worst = dt;
      for (const h of hs) assert(classify(h) !== null && beats(h, p));
    }
  }
  console.log(`hints worst case ${worst.toFixed(2)} ms`);
  assert(worst < 100, "hints too slow: " + worst);
});

// ======================= 四人斗地主（两副牌） =======================
// 用点数写两副牌：同点数前 4 张取第一副的 4 种花色，后面取第二副；'s' / 'B' 第一张在第一副，第二张在第二副
function c4(str: string): number[] {
  const used: Record<string, number> = {};
  const out: number[] = [];
  for (const t of str.trim().split(/\s+/)) {
    const i = used[t] || 0;
    used[t] = i + 1;
    if (t === "s") { out.push(52 + 54 * i); continue; }
    if (t === "B") { out.push(53 + 54 * i); continue; }
    out.push(RANKS[t] * 4 + (i % 4) + (i >= 4 ? 54 : 0));
  }
  return out;
}
function T4(str: string) { const r = classify(c4(str), 4) as S; return r && `${r.type}:${r.rank}:${r.len}`; }

Deno.test("4p: card codes use base = c % 54", () => {
  eq(rankOf(54), 0); eq(rankOf(54 + 51), 12); eq(rankOf(54 + 52), 13); eq(rankOf(107), 14);
  eq(suitOf(54 + 5), 1);
  eq([54, 106, 107].map(cardLabel), ["3", "小王", "大王"]);
  eq(sortHand([107, 53, 54, 0]), [107, 53, 54, 0]);
});

Deno.test("4p: newGame deals 25 each plus 8 bottom cards from 108 distinct cards", () => {
  const s = newGame({ rng: mulberry32(5), firstSeat: 2, players: 4 });
  eq(s.players, 4); eq(s.hands.length, 4); eq(s.bottom.length, 8); eq(s.turn, 2); eq(s.bids, [null, null, null, null]);
  for (const h of s.hands) eq(h.length, 25);
  const all = s.hands.flat().concat(s.bottom);
  eq(new Set(all).size, 108);
  eq(Math.min(...all), 0); eq(Math.max(...all), 107);
  eq(newGame({ rng: mulberry32(5) }).players, 3);
  eq(newGame({ rng: mulberry32(5), players: 7 }).players, 3);
});

Deno.test("4p: classify types", () => {
  eq(T4("3"), "single:0:1");
  eq(T4("5 5"), "pair:2:1");
  eq(T4("s s"), "pair:13:1");
  eq(T4("B B"), "pair:14:1");
  eq(T4("s B"), null); // 大小王各一张什么都不是
  eq(T4("7 7 7"), "trio:4:1");
  eq(T4("3 3 3 4 4"), "trio2:0:1");
  eq(T4("3 3 3 s s"), "trio2:0:1"); // 一对小王当对子带
  eq(T4("3 3 3 s B"), null);
  eq(T4("3 3 3 2"), null); // 没有三带一
  eq(T4("3 3 3 4 4 4 5 6"), null); // 没有飞机带单
  eq(T4("4 4 4 4 5 6"), null); // 没有四带二
  eq(T4("4 4 4 4 5 5 6 6"), null); // 没有四带两对
  eq(T4("3 4 5 6 7"), "straight:4:5");
  eq(T4("3 3 4 4 5 5"), "pairs:2:3");
  eq(T4("3 3 3 4 4 4"), "plane:1:2");
  eq(T4("3 3 3 4 4 4 5 5 6 6"), "plane2:1:2");
  eq(T4("3 3 3 4 4 4 5 5 s s"), "plane2:1:2");
  eq(T4("3 3 3 4 4 4 5 6 7 8"), null);
});

Deno.test("4p: bombs are 4 to 8 cards, king bomb is four jokers", () => {
  eq(T4("4 4 4 4"), "bomb:1:4");
  eq(T4("4 4 4 4 4"), "bomb:1:5");
  eq(T4("4 4 4 4 4 4"), "bomb:1:6");
  eq(T4("4 4 4 4 4 4 4"), "bomb:1:7");
  eq(T4("4 4 4 4 4 4 4 4"), "bomb:1:8");
  eq(T4("2 2 2 2 2 2 2 2"), "bomb:12:8");
  eq(T4("s s B B"), "rocket:14:4");
  eq(T4("s s B"), null);
  eq(T4("s s"), "pair:13:1");
  eq(classify(c4("4 4 4 4 4 4 4 4 4"), 4), null);
  // 三人局的写法不变：同样的四张是炸弹 len 1，两张王是火箭
  eq(T("4 4 4 4"), "bomb:1:1"); eq(T("s B"), "rocket:14:1"); eq(T("3 3 3 2"), "trio1:0:1");
  // 三人局拒绝第二副牌的编码
  eq(classify([54, 55]), null);
});

Deno.test("4p: beats matrix incl. bomb sizes and king bomb", () => {
  const b = (x: string, y: string) => beats(c4(x), c4(y), 4);
  assert(b("5 5 5 5", "3 4 5 6 7")); // 炸弹压顺子
  assert(b("5 5 5 5", "A A A")); // 炸弹压三条
  assert(b("3 3 3 3 3", "2 2 2 2")); // 5 炸压 4 炸，不论点数
  assert(!b("2 2 2 2", "3 3 3 3 3"));
  assert(b("4 4 4 4", "3 3 3 3")); // 同张数比点数
  assert(!b("3 3 3 3", "4 4 4 4"));
  assert(!b("4 4 4 4", "4 4 4 4")); // 相等不能压
  assert(b("3 3 3 3 3 3 3 3", "A A A A A A A")); // 8 炸压 7 炸
  assert(b("3 3 3 3 3 3", "A A A A A")); // 6 压 5
  assert(b("s s B B", "2 2 2 2 2 2 2 2")); // 天王炸压 8 炸
  assert(!b("2 2 2 2 2 2 2 2", "s s B B"));
  assert(!b("s s B B", "s s B B"));
  assert(b("s s B B", "3"));
  assert(b("B B", "s s")); // 对大王压对小王
  assert(!b("s s", "B B"));
  assert(b("s s", "2 2")); // 对小王压对 2
  assert(!b("3 3 3 4 4", "3 3 3 4 4"));
  assert(b("4 4 4 5 5", "3 3 3 9 9"));
  assert(!b("4 4 4 4", "4 4 4 4 4")); // 4 炸不压 5 炸
  assert(!b("3 3 3", "3 3")); // 牌型不同
  assert(!b("3 3 3 3", "s s B B"));
  assert(!b("3 3 3 4 4 4", "3 3 3 4 4 4"));
  assert(b("4 4 4 5 5 5", "3 3 3 4 4 4"));
});

Deno.test("4p: hints are legal, ordered by bomb size, and respect the king bomb", () => {
  const hand = c4("3 3 3 3 3 4 4 5 6 7 8 9 9 9 9 J K A 2 s s B B");
  const lead = hints(hand, null, 4);
  assert(lead.length > 5);
  for (const h of lead) { assert(classify(h, 4) !== null); const t = classify(h, 4).type; assert(t !== "trio1" && t !== "plane1" && t !== "four2" && t !== "four22"); }
  // 压 4 张的 8 炸：同张数更大的 9 炸、5 张的 3 炸、天王炸，按这个顺序
  const h1 = hints(hand, c4("8 8 8 8"), 4);
  eq(h1.map((h: number[]) => h.length), [4, 5, 4]);
  eq(classify(h1[2], 4).type, "rocket");
  // 天王炸压不了
  eq(hints(hand, c4("s s B B"), 4), []);
  // 一对小王能压对 2，天王炸排在最后
  const h2 = hints(hand, c4("2 2"), 4);
  assert(h2.length > 0 && h2.every((h: number[]) => beats(h, c4("2 2"), 4)));
  eq(classify(h2[h2.length - 1], 4).type, "rocket");
  // 4 人局的三带一不会被提示
  const h3 = hints(c4("3 3 3 4 5"), c4("2"), 4);
  eq(h3, []);
  const h4 = hints(c4("3 3 3 4 4"), c4("A A A 5 5"), 4);
  eq(h4, []);
  const h5 = hints(c4("K K K 4 4"), c4("Q Q Q 5 5"), 4);
  eq(h5.length, 1);
});

Deno.test("4p: bidding and passing use four seats", () => {
  let s = newGame({ rng: mulberry32(11), firstSeat: 3, players: 4 });
  s = ok(apply(s, 3, { kind: "bid", value: 1 }));
  eq(s.turn, 0);
  s = ok(apply(s, 0, { kind: "bid", value: 0 }));
  s = ok(apply(s, 1, { kind: "bid", value: 2 }));
  eq(s.phase, "bidding");
  s = ok(apply(s, 2, { kind: "bid", value: 0 }));
  eq(s.phase, "playing"); eq(s.landlord, 1); eq(s.bid, 2); eq(s.hands[1].length, 33); eq(s.turn, 1);
  eq(s.hands.reduce((n: number, h: number[]) => n + h.length, 0), 108);
  // 出牌后需要 3 个人不要才轮回出牌人
  const lead = s.hands[1].slice().sort((a: number, b: number) => rankOf(a) - rankOf(b))[0];
  s = ok(apply(s, 1, { kind: "play", cards: [lead] }));
  eq(s.turn, 2);
  s = ok(apply(s, 2, { kind: "pass" }));
  s = ok(apply(s, 3, { kind: "pass" }));
  eq(s.turn, 0); assert(s.lastPlay);
  s = ok(apply(s, 0, { kind: "pass" }));
  eq(s.turn, 1); eq(s.lastPlay, null);
  // 3 家都不叫：重发，叫牌起点后移一位
  let t = newGame({ rng: mulberry32(12), firstSeat: 0, players: 4 });
  const rng = mulberry32(99);
  for (let i = 0; i < 4; i++) t = ok(apply(t, t.turn, { kind: "bid", value: 0 }, rng));
  eq(t.redeals, 1); eq(t.bidStart, 1); eq(t.turn, 1); eq(t.hands.map((h: number[]) => h.length), [25, 25, 25, 25]);
  // 三次重发后第 4 次全不叫：叫牌起点坐地主，1 分
  for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) t = ok(apply(t, t.turn, { kind: "bid", value: 0 }, rng));
  eq(t.phase, "playing"); eq(t.bid, 1);
});

Deno.test("4p: scoring sums to zero, landlord 3x, spring and bombs", () => {
  const mk = (hands: string[], o: S = {}) => {
    const s = playingState(hands.slice(0, 3), o);
    s.players = 4; s.hands = hands.map(c4); s.bids = [null, null, null, null]; s.played = [[], [], [], []]; s.playCounts = o.playCounts ?? [0, 0, 0, 0];
    s.bottom = [];
    return s;
  };
  // 地主一手出完，农民没出过牌：春天，bid 2 × 2 = 4 倍：地主 +12，每个农民 -4
  let s = mk(["9 9", "3", "4", "5"], { landlord: 0, bid: 2 });
  s = ok(apply(s, 0, { kind: "play", cards: c4("9 9") }));
  eq(s.phase, "over"); eq(s.winner, "landlord"); eq(s.spring, true); eq(s.multiplier, 4);
  eq(s.scores, [12, -4, -4, -4]);
  // 农民赢，地主只出过一手：反春；有一个炸弹和一个天王炸：2^2；bid 3
  s = mk(["3 4", "9", "4", "A A A A"], { landlord: 0, turn: 3, bid: 3, bombs: 2, playCounts: [1, 0, 0, 0] });
  s = ok(apply(s, 3, { kind: "play", cards: c4("A A A A") })); // 已有 2 个炸弹，这手再炸一个并出完
  eq(s.winner, "farmers"); eq(s.spring, true);
  eq(s.bombs, 3); eq(s.multiplier, 3 * 8 * 2);
  eq(s.scores, [-3 * 48, 48, 48, 48]);
  eq(s.scores.reduce((a: number, b: number) => a + b, 0), 0);
  // 普通局：地主输，非春天
  s = mk(["3 4", "9 9", "4", "5"], { landlord: 0, turn: 2, bid: 1, playCounts: [3, 1, 1, 1] });
  s = ok(apply(s, 2, { kind: "play", cards: c4("4") }));
  eq(s.winner, "farmers"); eq(s.spring, false); eq(s.scores, [-3, 1, 1, 1]);
});

Deno.test("4p: publicView never leaks other hands", () => {
  let s = newGame({ rng: mulberry32(4), firstSeat: 0, players: 4 });
  const v = publicView(s, 2);
  eq(v.hands, undefined); eq(v.handCounts, [25, 25, 25, 25]); eq(v.myHand, s.hands[2]); eq(v.bottom, null); eq(v.players, 4);
  const text = JSON.stringify(publicView(s, null));
  for (const h of s.hands) assert(!text.includes(JSON.stringify(h)));
  eq(publicView(s, 4).myHand, null);
  s = ok(apply(s, 0, { kind: "bid", value: 3 }));
  const w = publicView(s, 3);
  eq(w.bottom, s.bottom); eq(w.handCounts, [33, 25, 25, 25]); eq(w.myHand, s.hands[3]);
  for (const i of [0, 1, 2]) eq(JSON.stringify(w).includes(JSON.stringify(s.hands[i])), false);
});

Deno.test("4p full games: 1000 seeded bot games terminate, conserve 108 cards, scores sum to 0", () => {
  let landlordWins = 0, springs = 0, bombGames = 0, kingBombs = 0, redealGames = 0, steps = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    const rng = mulberry32(seed * 104729);
    let s: S = newGame({ rng, firstSeat: seed % 4, players: 4 });
    let n = 0;
    while (s.phase !== "over") {
      assert(++n <= 600, `seed ${seed} did not terminate`);
      const seat = s.turn;
      const a = botAction(s, seat);
      const r = apply(s, seat, a, rng);
      assert(r.ok, `seed ${seed} step ${n}: ${JSON.stringify(a)} -> ${r.error}`);
      s = r.state;
      if (s.phase === "playing" && n % 7 === 0) eq(total(s), 108, `seed ${seed} conservation`);
      if (s.lastPlay && s.lastPlay.type === "rocket") kingBombs++;
    }
    steps += n;
    eq(total(s), 108);
    eq(s.scores.reduce((x: number, y: number) => x + y, 0), 0);
    eq(s.hands.filter((h: number[]) => !h.length).length, 1);
    assert(s.winner === "landlord" || s.winner === "farmers");
    if (s.winner === "landlord") landlordWins++;
    if (s.spring) springs++;
    if (s.bombs) bombGames++;
    if (s.redeals) redealGames++;
  }
  console.log(`4p landlord wins ${landlordWins}/1000, spring ${springs}, bomb games ${bombGames}, king bombs seen ${kingBombs}, redeal games ${redealGames}, avg steps ${(steps / 1000).toFixed(0)}`);
  assert(landlordWins >= 250 && landlordWins <= 700, `4p landlord win rate out of band: ${landlordWins}/1000`);
});

Deno.test("4p: bot is deterministic, does not mutate state, farmers do not top teammates", () => {
  const rng = mulberry32(77);
  let s: S = newGame({ rng, firstSeat: 0, players: 4 });
  s = ok(apply(s, 0, { kind: "bid", value: 3 }));
  const snap = JSON.stringify(s);
  const a = botAction(s, s.turn);
  eq(botAction(s, s.turn), a);
  eq(JSON.stringify(s), snap);
  // 地主 seat0，农民 seat1 出 5，seat2 有 K 能压但是队友出的牌，不压
  const t = playingState(["3 3 4 4 6 7 8 9 9 10 10", "5 5 8", "K K 7 8 9", "4 6 7 8 9"], { landlord: 0, turn: 2, lastPlay: { seat: 1, cards: "5" } });
  t.players = 4; t.hands = ["3 3 4 4 6 7 8 9 9 10 10", "5 5 8", "K K 7 8 9", "4 6 7 8 9"].map(c4); t.bids = [null, null, null, null]; t.played = [[], [], [], []]; t.playCounts = [0, 0, 0, 0];
  t.lastPlay = { seat: 1, cards: c4("5"), type: "single" };
  eq(botAction(t, 2), { kind: "pass" });
  // 地主出的 5，农民会压
  t.lastPlay = { seat: 0, cards: c4("5"), type: "single" };
  const b = botAction(t, 2);
  eq(b.kind, "play"); assert(beats(b.cards, c4("5"), 4));
  // 地主只剩 1 张，农民手里只有炸弹能压：炸
  t.hands = [c4("K"), c4("3 4 6 6 6 6"), c4("5 8 9 10"), c4("7 7")];
  t.turn = 1; t.lastPlay = { seat: 0, cards: c4("A"), type: "single" };
  eq(botAction(t, 1), { kind: "play", cards: sortHand(c4("6 6 6 6")) });
});

Deno.test("4p hints perf: 33-card hands", () => {
  const rng = mulberry32(2026);
  let worst = 0;
  const prevs = [null, c4("3"), c4("3 3"), c4("3 3 3"), c4("3 3 3 4 4"), c4("3 4 5 6 7"), c4("3 3 4 4 5 5"), c4("3 3 3 4 4 4"), c4("3 3 3 4 4 4 5 5 6 6"), c4("3 3 3 3"), c4("3 3 3 3 3 3")];
  for (let i = 0; i < 150; i++) {
    const d = deal(rng, 4);
    const hand = sortHand(d.hands[i % 4].concat(d.bottom));
    for (const p of prevs) {
      const t0 = performance.now();
      const hs = hints(hand, p, 4);
      const dt = performance.now() - t0;
      if (dt > worst) worst = dt;
      for (const h of hs) assert(classify(h, 4) !== null && beats(h, p, 4));
    }
  }
  console.log(`4p hints worst case ${worst.toFixed(2)} ms`);
  assert(worst < 300, "4p hints too slow: " + worst);
});
