// 斗地主牌桌逻辑测试：假数据库、假时钟、固定随机数；真的跑规则引擎和机器人
// 运行：deno test supabase/functions/ddz/game_test.ts
import * as R from "./rules.gen.js";
import { BID_MS, botName, handle, MAX_AUTO_STEPS, PLAY_MS, TICK_GRACE_MS, type Commit, type Deps, type GameRow, type StateDoc, type Store } from "./game.ts";

// deno-lint-ignore no-explicit-any
const { botAction, classify, hints } = R as any;

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

const GROUP = 7;
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c"; // 群成员，旁观
const X = "00000000-0000-0000-0000-0000000000ff"; // 不在群里
const D = "00000000-0000-0000-0000-00000000000d"; // 群成员

type Fake = {
  store: Store;
  games: Map<number, GameRow>;
  states: Map<number, StateDoc>;
  hands: Map<string, { seat: number; user_id: string; round: number; cards: number[] }>; // key game:seat
  scores: Map<string, { delta: number; games: number; wins: number }>;
  lines: { group: number; actor: string; body: string }[];
  commits: Commit[];
  failCommits: number; // 接下来这么多次 commit 报告版本冲突
  clock: { t: number };
  unfriended: boolean; // 私聊桌：好友关系已经结束
};

function fake(seats0: (string | null)[], bots0: boolean[], status: GameRow["status"] = "waiting", dm = false): Fake {
  const seats = seats0.length === 3 ? [...seats0, null] : seats0;
  const bots = bots0.length === 3 ? [...bots0, false] : bots0;
  const f: Fake = {
    games: new Map(), states: new Map(), hands: new Map(), scores: new Map(), lines: [], commits: [], failCommits: 0, unfriended: false, clock: { t: Date.parse("2030-01-01T00:00:00Z") },
    store: null as unknown as Store,
  };
  const [lo, hi] = A < B ? [A, B] : [B, A];
  f.games.set(1, { id: 1, group_id: dm ? null : GROUP, dm_lo: dm ? lo : null, dm_hi: dm ? hi : null, created_by: A, message_id: 5, status, seats, bots, auto: [false, false, false, false], round: 0, pub: {}, deadline: null, version: 3 });
  f.store = {
    getGame: (id) => Promise.resolve(f.games.has(id) ? structuredClone(f.games.get(id)!) : null),
    getState: (id) => Promise.resolve(f.states.has(id) ? structuredClone(f.states.get(id)!) : null),
    canAccess: (r, u) => Promise.resolve(r.group_id != null ? r.group_id === GROUP && [A, B, C, D].includes(u) : (f.unfriended ? false : u === r.dm_lo || u === r.dm_hi)),
    names: (ids) => Promise.resolve(Object.fromEntries(ids.map((i) => [i, i === A ? "阿杰" : i === B ? "小明" : "好友"]))),
    groupName: () => Promise.resolve("牌友"),
    commit: (c) => {
      if (f.failCommits > 0) { f.failCommits--; return Promise.resolve(false); }
      const g = f.games.get(c.game)!;
      if (g.version !== c.version) return Promise.resolve(false);
      f.games.set(c.game, { ...g, status: c.patch.status as GameRow["status"], pub: c.patch.pub, auto: c.patch.auto, round: c.patch.round, deadline: c.patch.deadline, version: g.version + 1, ...(c.patch.seats ? { seats: c.patch.seats, bots: c.patch.bots! } : {}) });
      f.states.set(c.game, structuredClone(c.state));
      for (const h of c.hands) f.hands.set(c.game + ":" + h.seat, structuredClone(h));
      for (const s of c.scores) {
        const o = f.scores.get(s.user_id) ?? { delta: 0, games: 0, wins: 0 };
        f.scores.set(s.user_id, { delta: o.delta + s.delta, games: o.games + 1, wins: o.wins + (s.win ? 1 : 0) });
      }
      if (c.line) f.lines.push({ group: g.group_id!, actor: c.actor!, body: c.line });
      f.commits.push(c);
      return Promise.resolve(true);
    },
  };
  return f;
}

function deps(f: Fake, seed = 1, push?: Deps["push"]): Deps {
  return { store: f.store, now: () => f.clock.t, rng: () => mulberry32(seed), push };
}
// deno-lint-ignore no-explicit-any
async function call(f: Fake, uid: string, body: any, seed = 1, push?: Deps["push"]) {
  return await handle(deps(f, seed, push), uid, { game: 1, ...body });
}
function row(f: Fake) { return f.games.get(1)!; }
function st(f: Fake) { return f.states.get(1)!; }

// 让 uid 坐的座位按机器人的主意操作一步（模拟一个会玩的真人）
async function humanStep(f: Fake, uid: string) {
  const seat = row(f).seats.indexOf(uid);
  const a = botAction(st(f).g, seat);
  const r = await call(f, uid, a.kind === "bid" ? { action: "bid", value: a.value } : a.kind === "play" ? { action: "play", cards: a.cards } : { action: "pass" });
  assert(r.status === 200, "human step failed: " + JSON.stringify(r.body));
}

Deno.test("start: one human + two bots, deals secretly and waits for the human", async () => {
  const f = fake([A, null, null], [false, true, true]);
  const pushes: string[] = [];
  const r = await call(f, A, { action: "start" }, 5, (u) => { pushes.push(u); return Promise.resolve(); });
  eq(r.status, 200);
  const g = row(f);
  assert(g.status === "bidding" || g.status === "playing");
  eq(g.round, 1);
  eq(g.version, 4);
  // 现在一定轮到真人，截止时间 = 现在 + 20 秒
  const s = st(f).g;
  eq(s.turn, 0);
  eq(g.deadline, new Date(f.clock.t + BID_MS).toISOString());
  // 旁观者能看到的 pub 没有任何手牌，只有张数
  const pub = g.pub;
  assert(!("hands" in pub) && pub.myHand === null && pub.bottom === null, "pub must hide hands and bottom while bidding");
  eq(pub.handCounts, [17, 17, 17]);
  // 真人自己的手牌行：只有他的座位，17 张，和完整状态一致
  eq([...f.hands.keys()], ["1:0"]);
  eq(f.hands.get("1:0")!.cards, s.hands[0]);
  eq(f.hands.get("1:0")!.cards.length, 17);
  eq((r.body as { hand: number[] }).hand, s.hands[0]);
  eq(pushes, []); // 没有别的真人
});

Deno.test("start: validation (not full, not seated, not a member, bad phase) and push to other humans only", async () => {
  let f = fake([A, B, null], [false, false, true]);
  eq((await call(f, C, { action: "start" })).body, { error: "not_seated" });
  eq((await call(f, X, { action: "start" })).status, 403);
  eq((await call(f, X, { action: "start" })).body, { error: "not_group_member" });
  eq((await call(f, A, { action: "bid", value: 1 })).body, { error: "bad_phase" }); // 还没开始
  const pushes: [string, string][] = [];
  const r = await call(f, A, { action: "start" }, 3, (u, p) => { pushes.push([u, p.title + "|" + p.body]); return Promise.resolve(); });
  eq(r.status, 200);
  eq(pushes, [[B, "牌友|斗地主开局了，来看看"]]); // 只推给另一个真人，不推给开局的人，也不推给旁观者
  eq((await call(f, A, { action: "start" })).body, { error: "bad_phase" }); // 已经开了
  eq((await call(f, A, { action: "nope" })).status, 400);
  eq((await handle(deps(f), A, { game: "1", action: "start" })).status, 400);
  eq((await call(f, A, { action: "start" })).status, 400);
  eq((await handle(deps(f), A, { game: 99, action: "start" })).status, 404);
});

Deno.test("full game against two bots: human acts, bots reply instantly, ends with scores and a system line", async () => {
  const f = fake([A, null, null], [false, true, true]);
  eq((await call(f, A, { action: "start" }, 11)).status, 200);
  let steps = 0;
  while (row(f).status !== "over" && steps++ < 200) {
    const g = row(f);
    // 每次提交之后：轮到的一定是真人（机器人在服务器里连着走完）
    eq(st(f).g.turn, 0, "after every commit it is the human's turn");
    assert(g.deadline !== null);
    await humanStep(f, A);
  }
  eq(row(f).status, "over");
  eq(row(f).deadline, null);
  const g = st(f).g;
  assert(g.winner === "landlord" || g.winner === "farmers");
  eq(g.scores.reduce((a: number, b: number) => a + b, 0), 0);
  // 积分：只有真人有，累加
  eq([...f.scores.keys()], [A]);
  const sc = f.scores.get(A)!;
  eq(sc.delta, g.scores[0]);
  eq(sc.games, 1);
  eq(sc.wins, (g.winner === "landlord") === (g.landlord === 0) ? 1 : 0);
  // 系统提示行
  eq(f.lines.length, 1);
  assert(f.lines[0].actor === A && f.lines[0].group === GROUP);
  assert(f.lines[0].body.startsWith("斗地主：") && f.lines[0].body.includes("赢了，" + g.multiplier + " 倍"), f.lines[0].body);
  if (g.winner === "landlord") assert(f.lines[0].body.includes(g.landlord === 0 ? "地主 阿杰" : "地主 " + botName([false, true, true], g.landlord)));
  else assert(f.lines[0].body.includes("农民"));
  // 结束后公开的牌：没有手牌泄露之前，pub 里 over 才带 finalHands
  assert(Array.isArray(row(f).pub.finalHands));
  // 结束后不能再出牌
  eq((await call(f, A, { action: "pass" })).body, { error: "bad_phase" });
});

Deno.test("illegal plays are rejected and change nothing", async () => {
  const f = fake([A, null, null], [false, true, true]);
  await call(f, A, { action: "start" }, 4);
  // 叫分：不合法的值
  eq((await call(f, A, { action: "bid", value: 5 })).body, { error: "bad_bid" });
  eq((await call(f, A, { action: "bid", value: 1.5 })).body, { error: "bad_bid" });
  // 出牌阶段之前不能出牌 / 过
  eq((await call(f, A, { action: "pass" })).body, { error: "bad_phase" });
  // 推进到出牌阶段
  let n = 0;
  while (row(f).status === "bidding" && n++ < 10) await humanStep(f, A);
  eq(row(f).status, "playing");
  const v = row(f).version;
  const hand: number[] = st(f).g.hands[0];
  const other = st(f).g.hands[1][0];
  eq((await call(f, A, { action: "play", cards: [other] })).body, { error: "not_in_hand" });
  eq((await call(f, A, { action: "play", cards: [hand[0], hand[0]] })).body, { error: "illegal_combo" });
  eq((await call(f, A, { action: "play", cards: [] })).body, { error: "illegal_combo" });
  eq((await call(f, A, { action: "play", cards: [999] })).body, { error: "not_in_hand" });
  eq((await call(f, A, { action: "play", cards: ["x"] })).body, { error: "illegal_combo" }); // 不是整数：入口就挡住
  // 领出的人不能不出
  if (st(f).g.lastPlay === null) eq((await call(f, A, { action: "pass" })).body, { error: "cannot_pass" });
  // 两张不成牌型
  const a2 = hand.find((c: number, i: number) => i > 0 && classify([hand[0], c]) === null);
  if (a2 !== undefined && st(f).g.lastPlay === null) eq((await call(f, A, { action: "play", cards: [hand[0], a2] })).body, { error: "illegal_combo" });
  eq(row(f).version, v);
  assert(f.commits.every((c) => c.state.g.hands[0].length > 0));
});

Deno.test("a play that does not beat the last one is rejected (too_small), a bigger one is accepted", async () => {
  const f = fake([A, B, null], [false, false, true], "playing");
  // 手工搭一个局面：A 是地主，B 刚出了一张 8，轮到 A；A 手里有 5 和 10
  const base = R.newGame({ rng: mulberry32(1), firstSeat: 0 });
  const c5 = 2 * 4, c8 = 5 * 4, c10 = 7 * 4, k = 10 * 4;
  const g = { ...base, phase: "playing", landlord: 0, bid: 1, turn: 0, lastPlay: { seat: 1, cards: [c8], type: "single" }, passCount: 0 };
  g.hands = [[c5, c10, k], base.hands[1].filter((c: number) => c !== c8).concat([c8]), base.hands[2]];
  f.states.set(1, { g, misses: [0, 0, 0], first: 0 });
  f.games.get(1)!.deadline = new Date(f.clock.t + 30_000).toISOString();
  const v = row(f).version;
  eq((await call(f, A, { action: "play", cards: [c5] })).body, { error: "too_small" });
  eq(row(f).version, v);
  eq((await call(f, A, { action: "play", cards: [c10] })).status, 200);
  eq(row(f).version, v + 1);
  assert(!st(f).g.hands[0].includes(c10));
  // 出牌的人手里只剩的牌不在公开视图里
  assert(!("hands" in row(f).pub));
});

Deno.test("tick: rejected before the deadline, auto-plays after it", async () => {
  const f = fake([A, null, null], [false, true, true]);
  await call(f, A, { action: "start" }, 2);
  const dl = Date.parse(row(f).deadline!);
  const v = row(f).version;
  const log = st(f).g.log.length;
  // 之前（连同宽限期内）：拒绝，什么都不变
  f.clock.t = dl - 1;
  eq((await call(f, C, { action: "tick" })).body, { error: "too_early" });
  f.clock.t = dl + TICK_GRACE_MS - 1;
  eq((await call(f, C, { action: "tick" })).status, 409);
  eq(row(f).version, v);
  // 之后：旁观的群成员也可以 tick，服务器替 A 自动叫分 / 出牌，然后机器人继续，再轮到 A
  f.clock.t = dl + TICK_GRACE_MS;
  const r = await call(f, C, { action: "tick" });
  eq(r.status, 200);
  assert(row(f).version === v + 1 && st(f).g.log.length > log);
  eq(st(f).g.log[log].seat, 0, "the first auto move is for the timed-out seat");
  eq(st(f).misses, [1, 0, 0]);
  eq(row(f).auto, [false, false, false, false]);
  // 新的截止时间从现在算起（叫分 20 秒，出牌 30 秒）
  const want = st(f).g.phase === "bidding" ? BID_MS : PLAY_MS;
  eq(row(f).deadline, new Date(f.clock.t + want).toISOString());
  // 真人自己操作后连续超时计数清零
  await humanStep(f, A);
  eq(st(f).misses, [0, 0, 0]);
});

Deno.test("two timeouts in a row put the seat on auto-play; any action by the human clears it", async () => {
  const f = fake([A, B, null], [false, false, true]);
  await call(f, A, { action: "start" }, 21);
  const g0 = () => st(f).g;
  let guard = 0;
  while (!row(f).auto[0] && guard++ < 300 && row(f).status !== "over") {
    const seat = g0().turn;
    if (seat === 0) {
      f.clock.t = Date.parse(row(f).deadline!) + TICK_GRACE_MS + 1;
      eq((await call(f, B, { action: "tick" })).status, 200);
    } else {
      await humanStep(f, B); // B 正常操作
    }
  }
  assert(row(f).auto[0], "seat 0 should be on auto after two timeouts");
  eq(st(f).misses[0] >= 2, true);
  eq(row(f).auto[1], false);
  // 托管的座位轮到时服务器立刻替他出，不会停在他身上等超时：之后每一次提交，轮到的都不是座位 0
  guard = 0;
  while (row(f).status !== "over" && guard++ < 300) {
    assert(g0().turn !== 0, "the auto seat must never be left waiting on its own turn");
    if (!row(f).auto[0]) break;
    await humanStep(f, B);
  }
  if (row(f).status !== "over") {
    // 让托管的人回来：自己的任何操作（auto_off）解除托管
    eq((await call(f, A, { action: "auto_off" })).status, 200);
    eq(row(f).auto[0], false);
    eq(st(f).misses[0], 0);
  }
});

Deno.test("auto_off and acting both clear 托管 (direct state)", async () => {
  const f = fake([A, B, null], [false, false, true]);
  await call(f, A, { action: "start" }, 31);
  // 手动把 A 设成托管（模拟两次超时之后）
  const g = row(f);
  g.auto = [true, false, false, false];
  const s = st(f);
  s.misses = [2, 0, 0];
  eq((await call(f, C, { action: "auto_off" })).body, { error: "not_seated" }); // 旁观者不能替别人取消
  eq((await call(f, A, { action: "auto_off" })).status, 200);
  eq(row(f).auto, [false, false, false, false]);
  eq(st(f).misses, [0, 0, 0]);
  // 已经解除后，再出牌 / 叫分照常（一次真实操作也会清零）
  g.auto = [true, false, false, false];
  if (st(f).g.turn === 0 || true) {
    // 找到轮到 A 的时刻再操作
    let guard = 0;
    while (st(f).g.turn !== 0 && guard++ < 20) await humanStep(f, B);
    if (row(f).status !== "over") { await humanStep(f, A); eq(row(f).auto[0], false); }
  }
});

Deno.test("spectators and non-members cannot act; members can only act on their own turn", async () => {
  const f = fake([A, B, null], [false, false, true]);
  await call(f, A, { action: "start" }, 9);
  const turnUser = row(f).seats[st(f).g.turn] as string;
  const other = turnUser === A ? B : A;
  eq((await call(f, C, { action: "bid", value: 1 })).status, 403);
  eq((await call(f, C, { action: "bid", value: 1 })).body, { error: "not_seated" });
  eq((await call(f, C, { action: "play", cards: [0] })).body, { error: "not_seated" });
  eq((await call(f, C, { action: "pass" })).body, { error: "not_seated" });
  eq((await call(f, C, { action: "start" })).body, { error: "bad_phase" });
  eq((await call(f, X, { action: "bid", value: 1 })).body, { error: "not_group_member" });
  eq((await call(f, other, { action: "bid", value: 1 })).body, { error: "not_your_turn" });
  eq(row(f).version, 4);
});

Deno.test("hands stay secret: hand rows only for human seats, pub never carries hands", async () => {
  const f = fake([A, B, null], [false, false, true]);
  await call(f, A, { action: "start" }, 12);
  let guard = 0;
  while (row(f).status !== "over" && guard++ < 400) {
    const s = st(f).g;
    for (const c of f.commits) {
      const p = c.patch.pub;
      if (c.patch.status !== "over") {
        assert(!("hands" in p) && p.myHand === null && p.finalHands === null, "no hands in pub while the game runs");
        assert(JSON.stringify(p).length < 6000);
      }
      for (const h of c.hands) assert(c.state.g.hands[h.seat].join() === h.cards.join(), "hand row = that seat's hand");
      for (const h of c.hands) assert(h.seat === 0 || h.seat === 1, "no hand row for the bot seat");
    }
    await humanStep(f, row(f).seats[s.turn] as string);
  }
  eq(row(f).status, "over");
  // 两个真人都有积分、总和（加上机器人那份）为零
  eq([...f.scores.keys()].sort(), [A, B]);
});

Deno.test("version conflict: one retry succeeds, a second conflict gives 409", async () => {
  const f = fake([A, null, null], [false, true, true]);
  f.failCommits = 1;
  eq((await call(f, A, { action: "start" }, 6)).status, 200); // 第一次冲突，重读重试后成功
  eq(row(f).status === "bidding" || row(f).status === "playing", true);
  const g = fake([A, null, null], [false, true, true]);
  g.failCommits = 2;
  const r = await call(g, A, { action: "start" }, 6);
  eq(r.status, 409);
  eq(r.body, { error: "conflict" });
  eq(g.games.get(1)!.status, "waiting");
  // 客户端带了过期的 version：直接 409，不做任何事
  const h = fake([A, null, null], [false, true, true]);
  eq((await call(h, A, { action: "start", version: 2 })).body, { error: "conflict" });
  eq((await call(h, A, { action: "start", version: 3 })).status, 200);
});

Deno.test("table_exists (another table was opened) is reported on rematch", async () => {
  const f = fake([A, null, null], [false, true, true]);
  await call(f, A, { action: "start" }, 14);
  let guard = 0;
  while (row(f).status !== "over" && guard++ < 300) await humanStep(f, A);
  const base = f.store.commit;
  f.store.commit = () => Promise.reject(new Error("table_exists"));
  eq((await call(f, A, { action: "rematch" })).body, { error: "table_exists" });
  f.store.commit = base;
});

Deno.test("rematch: same seats, new deal, first bidder rotates, hands and auto reset", async () => {
  const f = fake([A, null, null], [false, true, true]);
  eq((await call(f, A, { action: "rematch" })).body, { error: "bad_phase" }); // 没结束
  await call(f, A, { action: "start" }, 15);
  const first0 = st(f).first;
  let guard = 0;
  while (row(f).status !== "over" && guard++ < 300) await humanStep(f, A);
  eq(row(f).status, "over");
  eq((await call(f, C, { action: "rematch" })).body, { error: "not_seated" });
  eq((await call(f, A, { action: "rematch" }, 16)).status, 200);
  const g = row(f);
  eq(g.round, 2);
  eq(st(f).first, (first0 + 1) % 3);
  assert(g.status === "bidding" || g.status === "playing");
  eq(st(f).g.hands[0].length >= 17, true);
  eq(f.hands.get("1:0")!.round, 2);
  eq(st(f).misses, [0, 0, 0]);
  eq(f.scores.get(A)!.games, 1); // 新局没结束，积分不重复
});

Deno.test("the loop of bots is bounded and a fully automatic table finishes in one commit", async () => {
  // 一个真人坐着，但已经托管：三家都是机器 -> 一次 start 之后（真人是 auto）整局直接打完
  const f = fake([A, null, null], [false, true, true]);
  f.games.get(1)!.auto = [false, false, false, false];
  eq((await call(f, A, { action: "start" }, 17)).status, 200);
  // 让 A 变成托管，再 tick：整局自己打完
  f.games.get(1)!.auto = [true, false, false, false];
  f.clock.t = Date.parse(row(f).deadline!) + TICK_GRACE_MS + 1;
  const r = await call(f, C, { action: "tick" });
  eq(r.status, 200);
  eq(row(f).status, "over");
  assert(st(f).g.log.length < MAX_AUTO_STEPS);
  eq(f.lines.length, 1);
});

Deno.test("bot names are numbered by seat order", () => {
  eq([0, 1, 2].map((i) => botName([false, true, true], i)), ["机器人0", "机器人1", "机器人2"]);
  eq([0, 1, 2].map((i) => botName([true, false, true], i)), ["机器人1", "机器人1", "机器人2"]);
});

Deno.test("hints helper sanity (engine reachable from tests)", () => {
  assert(Array.isArray(hints([0, 1, 2, 3], null)));
});

// ======================= 4 个座位、自动补机器人、私聊桌 =======================
const seatsOf = (f: Fake) => ({ seats: row(f).seats, bots: row(f).bots });

Deno.test("start with 1 human and no bots auto-fills 2 bots (3 players)", async () => {
  const f = fake([A, null, null, null], [false, false, false, false]);
  const r = await call(f, A, { action: "start" }, 5);
  eq(r.status, 200);
  eq(seatsOf(f), { seats: [A, null, null, null], bots: [false, true, true, false] });
  eq(st(f).g.players, 3);
  eq(st(f).g.hands.length, 3);
  eq((r.body.game as { pub: { handCounts: number[] } }).pub.handCounts.length, 3);
  eq((r.body.game as { bots: boolean[] }).bots, [false, true, true, false]);
  eq(r.body.seat, 0);
});

Deno.test("start with 2 humans and 1 bot is a 3-player game; 2 humans and 2 bots is 4-player", async () => {
  let f = fake([A, B, null, null], [false, false, true, false]);
  eq((await call(f, A, { action: "start" }, 6)).status, 200);
  eq(st(f).g.players, 3);
  eq([...f.hands.keys()].sort(), ["1:0", "1:1"]);
  // 2 个真人，没有机器人：补 1 个，3 人局
  f = fake([A, B, null, null], [false, false, false, false]);
  eq((await call(f, B, { action: "start" }, 6)).status, 200);
  eq(seatsOf(f), { seats: [A, B, null, null], bots: [false, false, true, false] });
  eq(st(f).g.players, 3);
  // 2 个真人 + 2 个机器人：4 人局，108 张牌，25 张一人
  f = fake([A, B, null, null], [false, false, true, true]);
  const r = await call(f, A, { action: "start" }, 7);
  eq(r.status, 200);
  eq(st(f).g.players, 4);
  eq(st(f).g.hands.map((h: number[]) => h.length).reduce((a: number, b: number) => a + b, 0) + st(f).g.bottom.length, 108);
  eq(st(f).g.hands.length, 4);
  eq((r.body.game as { pub: { handCounts: number[] } }).pub.handCounts.length, 4);
  eq(f.hands.get("1:0")!.cards.length >= 25, true);
});

Deno.test("start with 3 humans and 1 bot is 4-player; 3 humans alone is 3-player", async () => {
  let f = fake([A, B, C, null], [false, false, false, true]);
  eq((await call(f, A, { action: "start" }, 8)).status, 200);
  eq(st(f).g.players, 4);
  eq([...f.hands.keys()].sort(), ["1:0", "1:1", "1:2"]);
  f = fake([A, B, C, null], [false, false, false, false]);
  eq((await call(f, A, { action: "start" }, 8)).status, 200);
  eq(st(f).g.players, 3);
  eq(seatsOf(f), { seats: [A, B, C, null], bots: [false, false, false, false] });
  // 4 个真人
  f = fake([A, B, C, D], [false, false, false, false]);
  eq((await call(f, D, { action: "start" }, 8)).status, 200);
  eq(st(f).g.players, 4);
  eq([...f.hands.keys()].sort(), ["1:0", "1:1", "1:2", "1:3"]);
});

Deno.test("start compacts seats so the engine sees contiguous seats, hands follow the new seats", async () => {
  // A 在 3 号位，B 在 1 号位，机器人在 2 号位：压紧成 B, 机器人, A
  const f = fake([null, B, null, A], [false, false, true, false]);
  const r = await call(f, A, { action: "start" }, 9);
  eq(r.status, 200);
  eq(seatsOf(f), { seats: [B, null, A, null], bots: [false, true, false, false] });
  eq(r.body.seat, 2);
  eq(f.hands.get("1:0")!.user_id, B);
  eq(f.hands.get("1:2")!.user_id, A);
  eq(st(f).g.players, 3);
  // 这一局的 pub 里别人的牌只有张数
  const pub = JSON.stringify(row(f).pub);
  for (const h of st(f).g.hands) assert(!pub.includes(JSON.stringify(h)));
  eq(row(f).pub.players, 3);
});

Deno.test("start with a bot only table (no human) is rejected; a spectator cannot start", async () => {
  let f = fake([null, null, null, null], [true, true, false, false]);
  eq((await call(f, A, { action: "start" })).body, { error: "not_seated" });
  f = fake([A, null, null, null], [false, false, false, false]);
  eq((await call(f, C, { action: "start" })).body, { error: "not_seated" });
});

Deno.test("4p: full game with bots ends with 108-card conservation, 4 hands and scores summing to zero", async () => {
  const f = fake([A, B, null, null], [false, false, true, true]);
  let r = await call(f, A, { action: "start" }, 10);
  eq(r.status, 200);
  let guard = 0;
  while (row(f).status !== "over" && guard++ < 300) {
    const g = st(f).g;
    const seat = g.turn as number;
    const u = row(f).seats[seat]!;
    assert(u === A || u === B, "a human must be on turn");
    const a = botAction(g, seat);
    const body = a.kind === "bid" ? { action: "bid", value: a.value } : a.kind === "play" ? { action: "play", cards: a.cards } : { action: "pass" };
    r = await call(f, u, body, 11 + guard);
    eq(r.status, 200, JSON.stringify(r.body));
  }
  eq(row(f).status, "over");
  const g = st(f).g;
  eq(g.hands.length, 4);
  eq(g.hands.flat().length + g.played.flat().length, 108);
  eq(g.scores.length, 4);
  eq(g.scores.reduce((a: number, b: number) => a + b, 0), 0);
  eq(g.scores.map((x: number) => Math.abs(x)).sort((a: number, b: number) => a - b)[3] >= 3, true);
  // 系统提示行：群里写一条，只有真人的积分
  eq(f.lines.length, 1);
  assert(f.lines[0].body.startsWith("斗地主：") && f.lines[0].body.includes(g.multiplier + " 倍"));
  if (g.winner === "farmers") assert(f.lines[0].body.includes("农民") && f.lines[0].body.split("、").length >= 2);
  eq([...f.scores.keys()].sort(), [A, B]);
  eq(row(f).pub.finalHands.length, 4);
  // 再来一局：同样的座位和人数，先手轮转
  const before = st(f).first;
  r = await call(f, B, { action: "rematch" }, 99);
  eq(r.status, 200);
  eq(st(f).g.players, 4);
  eq(st(f).first, (before + 1) % 4);
  eq(seatsOf(f), { seats: [A, B, null, null], bots: [false, false, true, true] });
  eq(row(f).round, 2);
});

Deno.test("DM table: 3p with 1 bot, members only, no system line, scores kept, push goes to the peer by id", async () => {
  const f = fake([A, B, null, null], [false, false, false, false], "waiting", true);
  const pushes: { to: string; p: { title: string; peer?: string; group?: number } }[] = [];
  eq((await call(f, C, { action: "start" })).body, { error: "not_friends" }); // 同群但不是这对好友
  eq((await call(f, C, { action: "start" })).status, 403);
  eq((await call(f, X, { action: "bid", value: 1 })).status, 403);
  const r = await call(f, A, { action: "start" }, 21, (u, p) => { pushes.push({ to: u, p }); return Promise.resolve(); });
  eq(r.status, 200);
  eq(st(f).g.players, 3);
  eq(seatsOf(f), { seats: [A, B, null, null], bots: [false, false, true, false] });
  eq(pushes.length, 1);
  eq(pushes[0].to, B);
  eq(pushes[0].p.peer, A);
  eq(pushes[0].p.group, undefined);
  eq(pushes[0].p.title, "阿杰");
  // 打完：没有系统提示行，但积分写了
  let guard = 0;
  while (row(f).status !== "over" && guard++ < 300) {
    const g = st(f).g;
    const seat = g.turn as number;
    const u = row(f).seats[seat]!;
    const a = botAction(g, seat);
    const body = a.kind === "bid" ? { action: "bid", value: a.value } : a.kind === "play" ? { action: "play", cards: a.cards } : { action: "pass" };
    eq((await call(f, u, body, 100 + guard)).status, 200);
  }
  eq(row(f).status, "over");
  eq(f.lines.length, 0);
  eq([...f.scores.keys()].sort(), [A, B]);
  // 好友关系结束后谁也不能再操作
  f.unfriended = true;
  eq((await call(f, A, { action: "rematch" })).status, 403);
  eq((await call(f, B, { action: "rematch" })).body, { error: "not_friends" });
});

Deno.test("DM table: 4p with 2 bots ends cleanly and a non-member cannot tick", async () => {
  const f = fake([A, B, null, null], [false, false, true, true], "waiting", true);
  eq((await call(f, A, { action: "start" }, 30)).status, 200);
  eq(st(f).g.players, 4);
  f.games.get(1)!.auto = [true, true, true, true];
  f.clock.t = Date.parse(row(f).deadline!) + TICK_GRACE_MS + 1;
  eq((await call(f, X, { action: "tick" })).status, 403);
  const r = await call(f, A, { action: "tick" });
  eq(r.status, 200);
  eq(row(f).status, "over");
  eq(st(f).g.hands.flat().length + st(f).g.played.flat().length, 108);
  eq(f.lines.length, 0);
});

Deno.test("existing 3-player live tables (state without players field) keep working", async () => {
  const f = fake([A, B, null], [false, false, true]);
  await call(f, A, { action: "start" }, 40);
  const d = st(f);
  delete d.g.players; // 升级前存下来的状态没有这个字段
  delete (row(f).pub as { players?: number }).players;
  let guard = 0;
  while (row(f).status !== "over" && guard++ < 300) {
    const g = st(f).g;
    const seat = g.turn as number;
    const u = row(f).seats[seat]!;
    const a = botAction(g, seat);
    const body = a.kind === "bid" ? { action: "bid", value: a.value } : a.kind === "play" ? { action: "play", cards: a.cards } : { action: "pass" };
    eq((await call(f, u, body, 200 + guard)).status, 200);
  }
  eq(row(f).status, "over");
  eq(st(f).g.hands.length, 3);
});
