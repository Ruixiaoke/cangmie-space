// 麻将牌桌逻辑测试：假数据库、假时钟、固定随机数；真的跑规则引擎和机器人
// 运行：deno test supabase/functions/mahjong/game_test.ts
import * as R from "./rules.gen.js";
import { botName, CLAIM_MS, handle, MISS_LIMIT, TICK_GRACE_MS, TURN_MS, type Commit, type Deps, type GameRow, type StateDoc, type Store } from "./game.ts";

// deno-lint-ignore no-explicit-any
const { botAction, newGame, pending, publicView } = R as any;

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

const GROUP = 7;
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c"; // 群成员，旁观
const X = "00000000-0000-0000-0000-0000000000ff"; // 不在群里

type HandRec = { seat: number; user_id: string; round: number; step: number; cards: number[]; drawn: number | null; opts: unknown; ag: number[] };
type Fake = {
  store: Store;
  games: Map<number, GameRow>;
  states: Map<number, StateDoc>;
  hands: Map<string, HandRec>; // key game:seat
  scores: Map<string, { delta: number; games: number; wins: number }>;
  lines: { group: number; actor: string; body: string }[];
  commits: Commit[];
  failCommits: number; // 接下来这么多次 commit 报告版本冲突
  clock: { t: number };
  unfriended: boolean; // 私聊桌：好友关系已经结束
};

function fake(seats: (string | null)[], bots: boolean[], status: GameRow["status"] = "waiting", dm = false): Fake {
  const f: Fake = {
    games: new Map(), states: new Map(), hands: new Map(), scores: new Map(), lines: [], commits: [], failCommits: 0, unfriended: false, clock: { t: Date.parse("2030-01-01T00:00:00Z") },
    store: null as unknown as Store,
  };
  const [lo, hi] = A < B ? [A, B] : [B, A];
  f.games.set(1, { id: 1, group_id: dm ? null : GROUP, dm_lo: dm ? lo : null, dm_hi: dm ? hi : null, created_by: A, message_id: 5, status, seats, bots, auto: [false, false, false, false], round: 0, pub: {}, deadline: null, version: 3 });
  f.store = {
    getGame: (id) => Promise.resolve(f.games.has(id) ? structuredClone(f.games.get(id)!) : null),
    getState: (id) => Promise.resolve(f.states.has(id) ? structuredClone(f.states.get(id)!) : null),
    canAccess: (r, u) => Promise.resolve(r.group_id != null ? r.group_id === GROUP && [A, B, C].includes(u) : (f.unfriended ? false : u === r.dm_lo || u === r.dm_hi)),
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
  const r = await call(f, uid, a.kind === "chi" ? { action: "chi", with: a.with } : a.tile !== undefined ? { action: a.kind, tile: a.tile } : { action: a.kind });
  assert(r.status === 200, "human step failed: " + JSON.stringify(a) + JSON.stringify(r.body));
}
// 把牌桌直接放进一个手工搭的局面
// deno-lint-ignore no-explicit-any
function inject(f: Fake, g: any, deadline: string | null = null) {
  f.states.set(1, { g, misses: [0, 0, 0, 0] });
  f.games.set(1, { ...row(f), status: "playing", pub: publicView(g), deadline });
}
// deno-lint-ignore no-explicit-any
function board(hands: string[], turn: number, drawn: number | null): any {
  const g = newGame({ rng: mulberry32(1), dealer: 0 });
  g.hands = hands.map((s) => T(s).sort((a: number, b: number) => a - b));
  g.melds = [[], [], [], []]; g.discards = [[], [], [], []];
  g.turn = turn; g.phase = "discard"; g.drawn = drawn; g.claim = null; g.lastDiscard = null; g.recent = []; g.gangFlag = false; g.haidi = false;
  g.wall = T("2m4m6m8m2s4s6s8s2p4p6p8p1z2z3z4z5z6z7z1m9m");
  return g;
}
const QUIET = "1m 9m 1s 9s 1p 9p 1z 2z 3z 4z 5z 6z 7z";

Deno.test("start: one human + three bots, seat kept, deals secretly and waits for the human", async () => {
  const f = fake([null, A, null, null], [false, false, false, false]);
  const pushes: string[] = [];
  const r = await call(f, A, { action: "start" }, 5, (u) => { pushes.push(u); return Promise.resolve(); });
  eq(r.status, 200);
  const g = row(f);
  eq(g.status, "playing");
  eq(g.round, 1);
  eq(g.version, 4);
  eq(g.seats, [null, A, null, null]); // 座位保持原位
  eq(g.bots, [true, false, true, true]); // 空座位补机器人
  const s = st(f).g;
  eq(s.turn === 1 && s.phase === "discard" || s.phase === "claim" && s.claim.opts[1] !== undefined, true, "the human must be the one to act");
  eq(g.deadline, new Date(f.clock.t + (s.phase === "claim" ? CLAIM_MS : TURN_MS)).toISOString());
  // 公开状态：只有张数，没有手牌和牌墙
  const pub = g.pub;
  assert(!("hands" in pub) && !("wall" in pub) && pub.result === null);
  eq(pub.handCounts.length, 4);
  assert(pub.wallLeft > 60 && pub.wallLeft <= 83);
  // 真人自己的手牌行：只有他的座位，和完整状态一致
  eq([...f.hands.keys()], ["1:1"]);
  eq(f.hands.get("1:1")!.cards, s.hands[1]);
  eq(f.hands.get("1:1")!.step, s.step);
  const mine = (r.body as { hand: { cards: number[]; step: number } }).hand;
  eq(mine.cards, s.hands[1]);
  // 别人的手牌不能出现在公开状态里
  for (const i of [0, 2, 3]) assert(!JSON.stringify(pub).includes(JSON.stringify(s.hands[i])), "pub leaks hand " + i);
  eq(pushes, []); // 没有别的真人
});

Deno.test("start: validation (not seated, not a member, bad phase) and push to other humans only", async () => {
  const f = fake([A, B, null, null], [false, false, false, false]);
  eq((await call(f, C, { action: "start" })).body, { error: "not_seated" });
  eq((await call(f, X, { action: "start" })).body, { error: "not_group_member" });
  eq((await call(f, A, { action: "discard", tile: 3 })).body, { error: "bad_phase" }); // 还没开始
  eq((await call(f, A, { action: "discard", tile: 99 })).body, { error: "bad_tile" });
  eq((await call(f, A, { action: "chi", with: [1] })).body, { error: "bad_tile" });
  eq((await call(f, A, { action: "flip" })).body, { error: "invalid_body" });
  eq((await call(f, A, { action: "rematch" })).body, { error: "bad_phase" });
  const pushes: [string, string][] = [];
  const r = await call(f, A, { action: "start" }, 3, (u, p) => { pushes.push([u, p.title + "|" + p.body]); return Promise.resolve(); });
  eq(r.status, 200);
  assert(pushes.some(([u, t]) => u === B && t === "牌友|麻将开局了，来看看"));
  assert(!pushes.some(([u]) => u === A || u === C)); // 不推给开局的人，也不推给旁观者
  eq((await call(f, A, { action: "start" })).body, { error: "bad_phase" }); // 已经开了
  // 旁观者不能动
  eq((await call(f, C, { action: "discard", tile: 3 })).body, { error: "not_seated" });
  eq((await call(f, C, { action: "pass" })).body, { error: "not_seated" });
});

Deno.test("human vs bots: play whole games with the server loop; scores sum to zero, only humans get score rows, group gets one system line", async () => {
  for (let seed = 1; seed <= 12; seed++) {
    const f = fake([A, null, null, null], [false, false, false, false]);
    assert((await call(f, A, { action: "start" }, seed)).status === 200);
    for (let n = 0; row(f).status === "playing"; n++) {
      assert(n < 400, "game does not end, seed " + seed);
      await humanStep(f, A);
    }
    const g = st(f).g, res = g.result;
    eq(res.scores.reduce((a: number, b: number) => a + b, 0), 0);
    const sc = f.scores.get(A);
    eq(sc?.delta, res.scores[0]);
    eq(f.scores.size, 1);
    eq(f.lines.length, 1);
    assert(f.lines[0].body.startsWith("麻将：") && f.lines[0].group === GROUP);
    eq(row(f).status, "over");
    eq(row(f).deadline, null);
    eq(row(f).pub.result.scores, res.scores);
    // 结束后才亮牌
    assert(Array.isArray(row(f).pub.result.hands) && row(f).pub.result.hands.length === 4);
  }
});

Deno.test("dm table: no system line, access follows the friendship", async () => {
  const f = fake([A, B, null, null], [false, false, false, false], "waiting", true);
  assert((await call(f, A, { action: "start" })).status === 200);
  f.unfriended = true;
  eq((await call(f, A, { action: "tick" })).body, { error: "not_friends" });
  eq((await call(f, C, { action: "start" })).status, 403);
  f.unfriended = false;
  // 打到结束：私聊没有系统行
  for (let n = 0; row(f).status === "playing"; n++) {
    assert(n < 800);
    const g = st(f).g, pend: number[] = pending(g);
    const uid = pend.map((s) => row(f).seats[s]).find((u) => !!u) as string;
    await humanStep(f, uid);
  }
  eq(f.lines.length, 0);
  eq(f.scores.size, 2);
  const res = st(f).g.result;
  eq([...f.scores.values()].reduce((a, s) => a + s.delta, 0), res.scores[0] + res.scores[1]); // 只记真人的分，机器人的分不记
});

Deno.test("claim window: opens for the human, tick is too early until the deadline, then counts as pass and does not count as a miss", async () => {
  const f = fake([A, B, null, null], [false, false, true, true]);
  // 座位 0（A）刚摸 5m 打出去；座位 1（B）手里有一对 5m，可以碰
  const g0 = board([QUIET + " 5m", "5m 5m 3s 4s 8p 9p 1z 2z 3z 4z 5z 6z 7z", QUIET, QUIET], 0, T("5m")[0]);
  inject(f, g0, new Date(f.clock.t + 10_000).toISOString());
  const pushes: [string, string][] = [];
  const r = await call(f, A, { action: "discard", tile: T("5m")[0] }, 1, (u, p) => { pushes.push([u, p.body]); return Promise.resolve(); });
  eq(r.status, 200);
  eq(st(f).g.phase, "claim");
  eq(row(f).pub.claim, { kind: "discard", tile: T("5m")[0], from: 0 });
  eq(row(f).deadline, new Date(f.clock.t + CLAIM_MS).toISOString());
  eq(pushes, [[B, "有牌可以吃碰杠胡，快来看看"]]);
  // B 的手牌行带着可用的动作；A 的行没有
  eq((f.hands.get("1:1")!.opts as { mode: string; peng: boolean }).mode, "claim");
  eq(f.hands.get("1:0")!.opts, null);
  // 还没到点：tick 被拒绝
  eq((await call(f, C, { action: "tick" })).body, { error: "too_early" });
  f.clock.t += CLAIM_MS + TICK_GRACE_MS - 1;
  eq((await call(f, C, { action: "tick" })).body, { error: "too_early" });
  f.clock.t += 2;
  assert((await call(f, C, { action: "tick" })).status === 200); // 旁观者也能催
  const s = st(f);
  eq(s.g.discards[0], T("5m")); // 没人要：牌留在牌河里
  eq(s.g.phase === "discard" && s.g.turn === 1, true); // 下家 B 摸牌
  eq(s.misses, [0, 0, 0, 0]); // 窗口超时不算
  eq(row(f).auto, [false, false, false, false]);
  eq(row(f).deadline, new Date(f.clock.t + TURN_MS).toISOString());
});

Deno.test("turn timeout: auto discards the drawn tile; two misses in a row switch the seat to 托管 until the player acts again", async () => {
  const f = fake([A, B, null, null], [false, false, true, true]);
  const g0 = board([QUIET + " 5m", "2m 3m 4s 8p 9p 1z 2z 3z 4z 5z 6z 7z 9m", QUIET, QUIET], 0, T("5m")[0]);
  inject(f, g0, new Date(f.clock.t + TURN_MS).toISOString());
  eq((await call(f, B, { action: "tick" })).body, { error: "too_early" });
  f.clock.t += TURN_MS + TICK_GRACE_MS + 1;
  assert((await call(f, B, { action: "tick" })).status === 200);
  eq(st(f).g.discards[0], T("5m")); // 打掉的是刚摸的牌
  eq(st(f).misses[0], 1);
  eq(row(f).auto[0], false);
  // A 的下一次轮到：再超时一次就进入托管
  const g1 = board([QUIET + " 5m", "2m 3m 4s 8p 9p 1z 2z 3z 4z 5z 6z 7z 9m", QUIET, QUIET], 0, T("5m")[0]);
  f.states.set(1, { g: g1, misses: [MISS_LIMIT - 1, 0, 0, 0] });
  f.games.set(1, { ...row(f), pub: publicView(g1), deadline: new Date(f.clock.t + TURN_MS).toISOString() });
  f.clock.t += TURN_MS + TICK_GRACE_MS + 1;
  assert((await call(f, B, { action: "tick" })).status === 200);
  eq(row(f).auto, [true, false, false, false]);
  eq(st(f).misses[0], MISS_LIMIT);
  // 托管中的座位从不让别人等：现在等的是 B
  eq(pending(st(f).g), [1]);
  // 到 B 的回合，A 自己出手解除托管
  const g2 = board([QUIET + " 5m", "2m 3m 4s 8p 9p 1z 2z 3z 4z 5z 6z 7z 9m", QUIET, QUIET], 0, T("5m")[0]);
  f.states.set(1, { g: g2, misses: [MISS_LIMIT, 0, 0, 0] });
  f.games.set(1, { ...row(f), pub: publicView(g2), deadline: new Date(f.clock.t + TURN_MS).toISOString() });
  const r2 = await call(f, A, { action: "discard", tile: T("5m")[0] });
  eq(r2.status, 200);
  eq(row(f).auto[0], false);
  eq(st(f).misses[0], 0);
  // 单独的 auto_off 也行，并且不推迟当前的截止时间
  f.games.set(1, { ...row(f), auto: [true, false, false, false] });
  const dl = row(f).deadline;
  f.clock.t += 1000;
  eq((await call(f, A, { action: "auto_off" })).status, 200);
  eq(row(f).auto[0], false);
  eq(row(f).deadline, dl);
});

Deno.test("actions: wrong player, wrong tile, wrong claim are rejected without changing anything", async () => {
  const f = fake([A, B, null, null], [false, false, true, true]);
  const g0 = board([QUIET + " 5m", "5m 5m 3s 4s 8p 9p 1z 2z 3z 4z 5z 6z 7z", QUIET, QUIET], 0, T("5m")[0]);
  inject(f, g0, new Date(f.clock.t + TURN_MS).toISOString());
  const v = row(f).version;
  eq((await call(f, B, { action: "discard", tile: T("5m")[0] })).body, { error: "not_your_turn" });
  eq((await call(f, A, { action: "discard", tile: T("6m")[0] })).body, { error: "not_in_hand" });
  eq((await call(f, A, { action: "hu" })).body, { error: "cannot_hu" });
  eq((await call(f, A, { action: "peng" })).body, { error: "bad_action" }); // 出牌阶段没有碰
  eq(row(f).version, v);
  assert((await call(f, A, { action: "discard", tile: T("5m")[0] })).status === 200);
  eq((await call(f, A, { action: "discard", tile: T("1m")[0] })).body, { error: "cannot_claim" }); // 窗口里打牌的人不能再动
  eq((await call(f, B, { action: "chi", with: [T("3s")[0], T("4s")[0]] })).body, { error: "cannot_claim" });
  eq((await call(f, B, { action: "hu" })).body, { error: "cannot_hu" });
  const ok = await call(f, B, { action: "peng" }); // 真正的碰
  eq(ok.status, 200);
  eq(st(f).g.melds[1][0].kind, "peng");
  eq(st(f).g.turn, 1);
  eq(row(f).deadline, new Date(f.clock.t + TURN_MS).toISOString());
  // 返回给 B 的手牌里带着最新状态
  eq((ok.body as { hand: { step: number; drawn: unknown } }).hand.step, st(f).g.step);
  eq((ok.body as { hand: { drawn: unknown } }).hand.drawn, null); // 碰完不摸牌
});

Deno.test("a human win by 点炮 pays the discarder; the other human's turn push goes only to people who newly have to act", async () => {
  const f = fake([A, B, null, null], [false, false, true, true]);
  const win13 = "2m 3m 4m 6m 7m 8m 3p 4p 5p 9s 9s 5m 5m";
  const g0 = board([QUIET + " 5m", win13, QUIET, QUIET], 0, T("5m")[0]);
  inject(f, g0, new Date(f.clock.t + TURN_MS).toISOString());
  const pushes: [string, string][] = [];
  await call(f, A, { action: "discard", tile: T("5m")[0] }, 1, (u, p) => { pushes.push([u, p.body]); return Promise.resolve(); });
  eq(pushes, [[B, "有牌可以吃碰杠胡，快来看看"]]);
  pushes.length = 0;
  const r = await call(f, B, { action: "hu" }, 1, (u, p) => { pushes.push([u, p.body]); return Promise.resolve(); });
  eq(r.status, 200);
  eq(row(f).status, "over");
  eq(f.scores.get(B), { delta: 6, games: 1, wins: 1 });
  eq(f.scores.get(A), { delta: -6, games: 1, wins: 0 });
  eq(f.lines[0].body, "麻将：小明 胡了，阿杰 点炮，2 番");
  eq(pushes, [[A, "这局麻将打完了，来看结果"]]);
  // 再来一局：座位不变，庄家 = 闲家胡牌后庄家的下家
  eq(st(f).g.nextDealer, 1);
  const again = await call(f, A, { action: "rematch" }, 9);
  eq(again.status, 200);
  eq(row(f).seats, [A, B, null, null]);
  eq(row(f).round, 1); // 手工搭的这局 round 是 0，再来一局是 1
  eq(st(f).g.dealer, 1);
  eq(st(f).g.quan, 1);
  eq(row(f).status, "playing");
  eq(f.hands.get("1:0")!.round, 1);
  eq((await call(f, A, { action: "rematch" })).body, { error: "bad_phase" });
});

Deno.test("commit conflict: retried once against fresh state; a stale version from the client is a 409", async () => {
  const f = fake([A, null, null, null], [false, false, false, false]);
  f.failCommits = 1;
  const r = await call(f, A, { action: "start" });
  eq(r.status, 200);
  f.failCommits = 2;
  eq((await call(f, A, { action: "auto_off" })).body, { error: "conflict" }); // 一直冲突：放弃
  eq((await call(f, A, { action: "auto_off", version: 1 })).body, { error: "conflict" });
});

Deno.test("bot names count only the bots", () => {
  eq([0, 1, 2, 3].map((i) => botName([true, false, true, true], i)), ["机器人1", "机器人1", "机器人2", "机器人3"]);
});
