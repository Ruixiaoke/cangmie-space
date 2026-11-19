// 飞行棋牌桌逻辑测试：假数据库、假时钟、固定随机数；真的跑规则引擎和机器人
// 运行：deno test supabase/functions/fxq/game_test.ts
import * as R from "./rules.gen.js";
import { botName, handle, LOG_KEEP, MISS_LIMIT, REPLAY_MS, TICK_GRACE_MS, TURN_MS, type Commit, type Deps, type GameRow, type Store } from "./game.ts";

// deno-lint-ignore no-explicit-any
const { botAction, newGame, homeCount } = R as any;

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
// 按顺序给出点数的假随机数
function dice(...vs: number[]) {
  let i = 0;
  return () => { const v = vs[i++]; if (v === undefined) throw new Error("out of dice"); return (v - 1) / 6 + 0.01; };
}

const GROUP = 7;
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c"; // 群成员，旁观
const X = "00000000-0000-0000-0000-0000000000ff"; // 不在群里

type Fake = {
  store: Store;
  games: Map<number, GameRow>;
  scores: Map<string, { games: number; wins: number }>;
  lines: { group: number; actor: string; body: string }[];
  commits: Commit[];
  failCommits: number;
  clock: { t: number };
  unfriended: boolean;
};

function fake(seats: (string | null)[], bots: boolean[], status: GameRow["status"] = "waiting", dm = false): Fake {
  const f: Fake = { games: new Map(), scores: new Map(), lines: [], commits: [], failCommits: 0, unfriended: false, clock: { t: Date.parse("2030-01-01T00:00:00Z") }, store: null as unknown as Store };
  const [lo, hi] = A < B ? [A, B] : [B, A];
  f.games.set(1, { id: 1, group_id: dm ? null : GROUP, dm_lo: dm ? lo : null, dm_hi: dm ? hi : null, created_by: A, message_id: 5, status, seats, bots, auto: [false, false, false, false], round: 0, pub: {}, deadline: null, version: 3 });
  f.store = {
    getGame: (id) => Promise.resolve(f.games.has(id) ? structuredClone(f.games.get(id)!) : null),
    canAccess: (r, u) => Promise.resolve(r.group_id != null ? r.group_id === GROUP && [A, B, C].includes(u) : (f.unfriended ? false : u === r.dm_lo || u === r.dm_hi)),
    names: (ids) => Promise.resolve(Object.fromEntries(ids.map((i) => [i, i === A ? "阿杰" : i === B ? "小明" : "好友"]))),
    groupName: () => Promise.resolve("飞友"),
    commit: (c) => {
      if (f.failCommits > 0) { f.failCommits--; return Promise.resolve(false); }
      const g = f.games.get(c.game)!;
      if (g.version !== c.version) return Promise.resolve(false);
      f.games.set(c.game, { ...g, status: c.patch.status as GameRow["status"], pub: c.patch.pub, auto: c.patch.auto, round: c.patch.round, deadline: c.patch.deadline, version: g.version + 1 });
      for (const s of c.scores) {
        const o = f.scores.get(s.user_id) ?? { games: 0, wins: 0 };
        f.scores.set(s.user_id, { games: o.games + 1, wins: o.wins + (s.win ? 1 : 0) });
      }
      if (c.line) f.lines.push({ group: g.group_id!, actor: c.actor!, body: c.line });
      f.commits.push(c);
      return Promise.resolve(true);
    },
  };
  return f;
}

function deps(f: Fake, rng: () => () => number, push?: Deps["push"]): Deps {
  return { store: f.store, now: () => f.clock.t, rng, push };
}
// deno-lint-ignore no-explicit-any
async function call(f: Fake, uid: string, body: any, rng: () => () => number = () => mulberry32(1), push?: Deps["push"]) {
  return await handle(deps(f, rng, push), uid, { game: 1, ...body });
}
function row(f: Fake) { return f.games.get(1)!; }
// 直接把牌桌放进「对局中」：planes[seat] 是 4 个 r；轮到 turn
function setPlaying(f: Fake, planes: Record<number, number[]>, turn: number, extra: Record<string, unknown> = {}) {
  const g = row(f);
  const active = [0, 1, 2, 3].map((i) => !!g.seats[i] || !!g.bots[i]);
  const st = newGame({ seats: active, first: turn });
  for (const [s, p] of Object.entries(planes)) st.planes[Number(s)] = p;
  Object.assign(st, extra);
  g.status = "playing"; g.round = 1; g.pub = { ...st, v: 1, round: 1, misses: [0, 0, 0, 0], log: [] };
  g.deadline = new Date(f.clock.t + TURN_MS).toISOString();
}

Deno.test("start: needs at least 2 seated (humans + bots); fills nothing automatically", async () => {
  let f = fake([A, null, null, null], [false, false, false, false]);
  eq((await call(f, A, { action: "start" })).body, { error: "not_full" });
  f = fake([A, null, null, null], [false, false, true, false]);
  const r = await call(f, A, { action: "start" }, () => dice(2), undefined);
  eq(r.status, 200);
  const g = row(f);
  eq(g.status, "playing"); eq(g.round, 1); eq(g.version, 4);
  eq(g.pub.order, [0, 2], "colours stay on their seats, no compaction");
  eq(g.pub.planes[1], null);
  eq(row(f).seats, [A, null, null, null]);
  eq(g.pub.turn, 0, "the seated human is first or the bot already played its turn");
  assert(g.pub.first === 0 || g.pub.first === 2);
});

Deno.test("start: first mover is random among seated; a bot first mover plays until a human is up", async () => {
  // 先手 = 在坐了人的座位里随机选（第一个随机数 0.99 -> 最后一个座位）
  const f = fake([A, null, B, null], [false, false, false, false]);
  const r1 = await call(f, A, { action: "start" }, () => () => 0.99);
  eq(r1.status, 200);
  eq(row(f).pub.first, 2);
  eq(row(f).pub.turn, 2);
  const f2 = fake([A, null, null, null], [false, true, false, false]);
  const r = await call(f2, A, { action: "start" }, () => mulberry32(2));
  eq(r.status, 200);
  const pub = row(f2).pub;
  // 无论谁先手，请求结束时一定轮到真人（座位 0），或者对局结束
  eq(pub.turn, 0);
  eq(row(f2).deadline, new Date(f2.clock.t + TURN_MS + REPLAY_MS * pub.log.length).toISOString(), "the bot's events get replay time on top");
  assert(pub.log.every((e: { seat: number }) => e.seat === 1), "only the bot acted");
});

Deno.test("start: validation (not seated, not a member, bad phase, bad body) and push to other humans only", async () => {
  const f = fake([A, B, null, null], [false, false, false, false]);
  eq((await call(f, C, { action: "start" })).body, { error: "not_seated" });
  eq((await call(f, X, { action: "start" })).status, 403);
  eq((await call(f, A, { action: "roll" })).body, { error: "bad_phase" });
  eq((await call(f, A, { action: "nope" })).status, 400);
  eq((await call(f, A, { action: "move" })).body, { error: "bad_plane" });
  eq((await handle(deps(f, () => mulberry32(1)), A, { game: -1, action: "start" })).status, 400);
  eq((await handle(deps(f, () => mulberry32(1)), A, null)).status, 400);
  eq((await call(f, A, { action: "start", version: 1 })).body, { error: "conflict" });
  const pushes: { u: string; body: string }[] = [];
  const r = await call(f, A, { action: "start" }, () => dice(1), (u, p) => { pushes.push({ u, body: p.body }); return Promise.resolve(); });
  eq(r.status, 200);
  eq(pushes.length, 1); eq(pushes[0].u, B);
  eq(pushes[0].body, row(f).pub.turn === 1 ? "飞行棋开局了，轮到你先掷骰子" : "飞行棋开局了，来看看");
  eq((await call(f, A, { action: "start" })).body, { error: "bad_phase" });
});

Deno.test("roll: the server rolls the die; a value from the client is ignored; not your turn is rejected", async () => {
  const f = fake([A, B, null, null], [false, false, false, false], "playing");
  setPlaying(f, { 0: [5, 9, -1, -1], 1: [-1, -1, -1, -1] }, 0);
  eq((await call(f, B, { action: "roll" })).body, { error: "not_your_turn" });
  eq((await call(f, C, { action: "roll" })).body, { error: "not_seated" });
  const r = await call(f, A, { action: "roll", value: 6, v: 6 }, () => dice(2));
  eq(r.status, 200);
  const pub = row(f).pub;
  eq(pub.roll, 2, "die came from the server rng, not the client");
  eq(pub.turn, 0);
  eq(pub.log.map((e: { k: string }) => e.k), ["roll"]);
  eq(row(f).deadline, new Date(f.clock.t + TURN_MS).toISOString());
  // 还要选一架
  eq((await call(f, A, { action: "roll" })).body, { error: "pick_a_plane" });
  eq((await call(f, A, { action: "move", plane: 2 })).body, { error: "bad_plane" });
  eq((await call(f, B, { action: "move", plane: 0 })).body, { error: "not_your_turn" });
  const m = await call(f, A, { action: "move", plane: 1 });
  eq(m.status, 200);
  eq(row(f).pub.planes[0], [5, 11, -1, -1]);
  eq(row(f).pub.turn, 1);
  eq(row(f).pub.roll, null);
});

Deno.test("only one legal move is played automatically; no legal move passes", async () => {
  const f = fake([A, B, null, null], [false, false, false, false], "playing");
  setPlaying(f, { 0: [5, -1, -1, -1], 1: [-1, -1, -1, -1] }, 0);
  await call(f, A, { action: "roll" }, () => dice(3));
  eq(row(f).pub.planes[0], [8 + 4, -1, -1, -1], "5 + 3 = 8 is own colour: jumps to 12");
  eq(row(f).pub.turn, 1);
  eq(row(f).pub.log.map((e: { k: string }) => e.k), ["roll", "move"]);
  await call(f, B, { action: "roll" }, () => dice(2));
  eq(row(f).pub.log.map((e: { k: string }) => e.k).slice(-2), ["roll", "pass"]);
  eq(row(f).pub.turn, 0);
});

Deno.test("bots and auto seats act immediately until a human is up", async () => {
  const f = fake([A, null, null, null], [false, true, true, false], "playing");
  setPlaying(f, { 0: [5, -1, -1, -1], 1: [-1, -1, -1, -1], 2: [-1, -1, -1, -1] }, 0);
  const pushes: string[] = [];
  await call(f, A, { action: "roll" }, () => mulberry32(3), (u, p) => { pushes.push(u + ":" + p.body); return Promise.resolve(); });
  eq(row(f).pub.turn, 0, "back to the only human");
  const seats = new Set(row(f).pub.log.map((e: { seat: number }) => e.seat));
  assert(seats.has(0) && seats.has(1) && seats.has(2), "all three seats acted in order");
  eq(pushes, [], "the actor is never pushed");
});

Deno.test("turn push goes to the next human only (not bots, not the actor, not auto)", async () => {
  const f = fake([A, B, C, null], [false, false, false, false], "playing");
  setPlaying(f, { 0: [5, -1, -1, -1], 1: [-1, -1, -1, -1], 2: [-1, -1, -1, -1] }, 0);
  const pushes: string[] = [];
  const push: Deps["push"] = (u, p) => { pushes.push(u + ":" + p.body + ":" + (p.group ?? "")); return Promise.resolve(); };
  await call(f, A, { action: "roll" }, () => dice(2), push);
  eq(pushes, [B + ":轮到你了（飞行棋）:7"]);
  // 6：同一个人再掷，不推
  pushes.length = 0;
  setPlaying(f, { 0: [5, -1, -1, -1], 1: [-1, -1, -1, -1], 2: [-1, -1, -1, -1] }, 0);
  await call(f, A, { action: "roll" }, () => dice(6), push);
  eq(pushes, []);
  // B 托管：不推
  pushes.length = 0;
  setPlaying(f, { 0: [5, -1, -1, -1], 1: [-1, -1, -1, -1], 2: [-1, -1, -1, -1] }, 0);
  row(f).auto = [false, true, false, false];
  await call(f, A, { action: "roll" }, () => dice(2, 3), push);
  eq(pushes, [C + ":轮到你了（飞行棋）:7"], "auto seat B passes by itself, the push goes to C only");
});

Deno.test("tick: too early is rejected; after the deadline the server rolls / picks for the slow human", async () => {
  const f = fake([A, B, null, null], [false, false, false, false], "playing");
  setPlaying(f, { 0: [5, 9, -1, -1], 1: [-1, -1, -1, -1] }, 0);
  eq((await call(f, B, { action: "tick" })).body, { error: "too_early" });
  f.clock.t += TURN_MS + TICK_GRACE_MS - 1;
  eq((await call(f, B, { action: "tick" })).body, { error: "too_early" });
  f.clock.t += 2;
  const r = await call(f, B, { action: "tick" }, () => dice(2)); // 谁都能催：B 催 A 的回合，替 A 掷骰子
  eq(r.status, 200);
  eq(row(f).pub.roll, 2);
  eq(row(f).pub.misses[0], 1);
  eq(row(f).auto[0], false);
  // 选飞机也超时：机器人替他选
  f.clock.t += TURN_MS + TICK_GRACE_MS + 1;
  await call(f, A, { action: "tick" });
  eq(row(f).pub.roll, null);
  eq(row(f).pub.misses[0], MISS_LIMIT);
  eq(row(f).auto[0], true, "two timeouts in a row switch him to auto");
  // 轮到 B：B 是真人，A 托管。A 的托管状态在下一回合 A 之前一直有效
  eq(row(f).pub.turn, 1);
  eq(row(f).pub.log.map((e: { k: string }) => e.k), ["roll", "move"]);
});

Deno.test("auto seat keeps playing on its own; auto_off hands control back", async () => {
  const f = fake([A, B, null, null], [false, false, false, false], "playing");
  setPlaying(f, { 0: [5, -1, -1, -1], 1: [5, -1, -1, -1] }, 1);
  row(f).auto = [true, false, false, false];
  // B 掷 2（只有一架：自动走），然后轮到托管的 A：服务器马上替 A 行动，直到又轮到 B
  await call(f, B, { action: "roll" }, () => dice(2, 2));
  eq(row(f).pub.turn, 1);
  assert(row(f).pub.log.some((e: { seat: number }) => e.seat === 0), "auto A acted");
  const g = row(f);
  g.auto = [true, false, false, false];
  const r = await call(f, A, { action: "auto_off" });
  eq(r.status, 200);
  eq(row(f).auto[0], false);
  eq(row(f).pub.misses[0], 0);
});

Deno.test("finishing: the winner is recorded, humans get a game, bots get nothing, group line only in groups", async () => {
  const f = fake([A, B, null, null], [false, true, false, false], "playing");
  setPlaying(f, { 0: [52, 52, 52, 49], 1: [10, 10, 52, -1] }, 0);
  const r = await call(f, A, { action: "roll" }, () => dice(3));
  eq(r.status, 200);
  const g = row(f);
  eq(g.status, "over"); eq(g.pub.winner, 0); eq(g.pub.rank, [0, 1]); eq(g.deadline, null);
  eq(f.scores.get(A), { games: 1, wins: 1 });
  eq(f.scores.has(B), false, "bot seat has no score row");
  eq(f.lines, [{ group: GROUP, actor: A, body: "飞行棋：阿杰（红）赢了" }]);
  eq((await call(f, A, { action: "roll" })).body, { error: "bad_phase" });
  // 机器人赢了：玩家输一局，文案是 机器人N
  const f2 = fake([A, null, null, null], [false, true, false, false], "playing");
  setPlaying(f2, { 0: [-1, -1, -1, -1], 1: [52, 52, 52, 50] }, 0);
  await call(f2, A, { action: "roll" }, () => dice(3, 2));
  eq(row(f2).status, "over");
  eq(f2.scores.get(A), { games: 1, wins: 0 });
  eq(f2.lines[0].body, "飞行棋：" + botName([false, true, false, false], 1) + "（黄）赢了");
  // 私聊：不写系统行
  const f3 = fake([A, B, null, null], [false, false, false, false], "playing", true);
  setPlaying(f3, { 0: [52, 52, 52, 49], 1: [10, 10, 52, -1] }, 0);
  await call(f3, A, { action: "roll" }, () => dice(3));
  eq(row(f3).status, "over");
  eq(f3.lines, []);
  eq(f3.scores.get(A), { games: 1, wins: 1 }); eq(f3.scores.get(B), { games: 1, wins: 0 });
});

Deno.test("rematch keeps the seats, bumps the round and rotates the first mover", async () => {
  const f = fake([A, B, null, null], [false, false, false, true], "playing");
  setPlaying(f, { 0: [52, 52, 52, 49], 1: [10, 10, 52, -1], 3: [-1, -1, -1, -1] }, 0);
  await call(f, A, { action: "roll" }, () => dice(3));
  eq(row(f).status, "over");
  eq((await call(f, C, { action: "rematch" })).body, { error: "not_seated" });
  const first0 = row(f).pub.first;
  const r = await call(f, B, { action: "rematch" }, () => dice(1, 1, 1, 1, 1, 1));
  eq(r.status, 200);
  const g = row(f);
  eq(g.status, "playing"); eq(g.round, 2);
  eq(g.seats, [A, B, null, null]); eq(g.bots, [false, false, false, true]);
  eq(g.pub.order, [0, 1, 3]);
  eq(g.pub.first, 1, "next seated colour after " + first0);
  eq(g.pub.planes[0], [-1, -1, -1, -1]);
  eq(g.auto, [false, false, false, false]);
  eq((await call(f, B, { action: "rematch" })).body, { error: "bad_phase" });
});

Deno.test("a version conflict is retried once; two in a row fail", async () => {
  const f = fake([A, B, null, null], [false, false, false, false], "playing");
  setPlaying(f, { 0: [5, 9, -1, -1], 1: [-1, -1, -1, -1] }, 0);
  f.failCommits = 1;
  eq((await call(f, A, { action: "roll" }, () => dice(2))).status, 200);
  f.failCommits = 2;
  eq((await call(f, A, { action: "move", plane: 0 })).body, { error: "conflict" });
});

Deno.test("private table: only the two friends, and only while they are still friends", async () => {
  const f = fake([A, B, null, null], [false, false, false, false], "playing", true);
  setPlaying(f, { 0: [5, 9, -1, -1], 1: [-1, -1, -1, -1] }, 0);
  eq((await call(f, C, { action: "roll" })).body, { error: "not_friends" });
  f.unfriended = true;
  eq((await call(f, A, { action: "roll" })).status, 403);
});

Deno.test("full game with a human following the bot heuristic ends with a winner, scores and a bounded log", async () => {
  for (const seed of [1, 2, 3]) {
    const f = fake([A, null, B, null], [false, true, false, true], "waiting");
    const rng = () => mulberry32(seed * 100);
    eq((await call(f, A, { action: "start" }, rng)).status, 200);
    let n = 0, seed2 = seed * 1000;
    while (row(f).status === "playing" && n++ < 3000) {
      const g = row(f), turn = g.pub.turn as number, uid = g.seats[turn];
      assert(uid, "the request must stop on a human seat");
      const a = botAction(g.pub, turn);
      const body = a.kind === "roll" ? { action: "roll" } : { action: "move", plane: a.plane };
      const r = await call(f, uid!, body, () => mulberry32(++seed2));
      assert(r.status === 200, "step failed " + JSON.stringify(r.body));
      assert(row(f).pub.log.length <= LOG_KEEP);
    }
    eq(row(f).status, "over");
    const w = row(f).pub.winner as number;
    eq(homeCount(row(f).pub, w), 4);
    const total = [...f.scores.values()].reduce((s, x) => s + x.games, 0);
    eq(total, 2, "both humans got a game");
    eq([...f.scores.values()].reduce((s, x) => s + x.wins, 0), w === 0 || w === 2 ? 1 : 0);
  }
});
