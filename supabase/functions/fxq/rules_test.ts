// 飞行棋规则引擎测试（rules.gen.js 由 gen-rules.py 从 chat/js/miniapps/fxq-rules.js 生成）
// 运行：deno test supabase/functions/fxq/rules_test.ts
import * as R from "./rules.gen.js";

// deno-lint-ignore no-explicit-any
const { apply, botAction, botPick, canMove, danger, homeCount, legalMoves, newGame, nodeOf, progress, ranking, simulate, FXQ_RULES_VERSION } = R as any;

function assert(c: unknown, msg = "assertion failed") { if (!c) throw new Error(msg); }
function eq(a: unknown, b: unknown, msg = "") {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg} expected ${y} got ${x}`);
}
// 按顺序给出点数的假随机数
function dice(...vs: number[]) {
  let i = 0;
  return () => { const v = vs[i++]; if (v === undefined) throw new Error("out of dice"); return (v - 1) / 6 + 0.01; };
}
// deno-lint-ignore no-explicit-any
type S = any;
function game(seats: boolean[] = [true, true, false, false], first = 0): S { return newGame({ seats, first }); }
function put(st: S, seat: number, planes: number[]): S { st.planes[seat] = planes; return st; }
function roll(st: S, seat: number, v: number): S { const r = apply(st, seat, { kind: "roll" }, dice(v)); assert(r.ok, "roll " + JSON.stringify(r)); return r; }

Deno.test("newGame: seats are colours, empty seats have no planes, first mover", () => {
  eq(FXQ_RULES_VERSION, 1);
  const st = game([true, false, true, true], 2);
  eq(st.order, [0, 2, 3]); eq(st.n, 3); eq(st.turn, 2);
  eq(st.planes[1], null); eq(st.planes[0], [-1, -1, -1, -1]);
  eq(game([false, true, false, true], 0).turn, 1, "first falls back to first seated");
  eq([0, 1, 2, 3].map((s) => nodeOf(s, 0)), [0, 13, 26, 39], "start squares");
  eq(nodeOf(1, 45), 6 + 13 * 0, "yellow last loop square is the middle of side 0");
});

Deno.test("take-off needs a 6; any other roll with everything in the hangar passes", () => {
  eq(canMove(-1, 5), false); eq(canMove(-1, 6), true);
  const st = game();
  const r = roll(st, 0, 3);
  eq(r.events.map((e: S) => e.k), ["roll", "pass"]);
  eq(r.events[1].why, "none");
  eq(r.state.turn, 1);
  eq(r.state.planes[0], [-1, -1, -1, -1]);
});

Deno.test("rolling a 6 takes off (auto move, one distinct move) and grants another roll", () => {
  const st = game();
  const r = roll(st, 0, 6);
  eq(r.events.map((e: S) => e.k), ["roll", "move"]);
  eq(r.events[1].takeoff, true);
  eq(r.state.planes[0], [0, -1, -1, -1]);
  eq(r.state.turn, 0, "same player rolls again");
  eq(r.state.sixes, 1);
  eq(r.state.roll, null);
  // 再掷 3：只有一架在场，自动走，然后换人
  const r2 = apply(r.state, 0, { kind: "roll" }, dice(3));
  eq(r2.state.planes[0], [3, -1, -1, -1]);
  eq(r2.state.turn, 1); eq(r2.state.sixes, 0);
});

Deno.test("three 6s in a row forfeit the turn without moving", () => {
  let st = game();
  put(st, 0, [10, 20, -1, -1]);
  let r = apply(st, 0, { kind: "roll" }, dice(6)); // 两架在场 + 机库：不止一种走法，要选
  assert(r.ok); eq(r.state.roll, 6); eq(r.state.sixes, 1);
  r = apply(r.state, 0, { kind: "move", plane: 0 }, dice(1)); // 10 + 6 = 16 飞到 28
  eq(r.state.turn, 0); eq(r.state.sixes, 1);
  r = apply(r.state, 0, { kind: "roll" }, dice(6));
  eq(r.state.sixes, 2); eq(r.state.roll, 6);
  r = apply(r.state, 0, { kind: "move", plane: 1 }, dice(1));
  eq(r.state.turn, 0); eq(r.state.sixes, 2);
  const before = JSON.stringify(r.state.planes);
  r = apply(r.state, 0, { kind: "roll" }, dice(6));
  eq(r.events.map((e: S) => e.k), ["roll", "pass"]);
  eq(r.events[1].why, "sixes");
  eq(JSON.stringify(r.state.planes), before, "no plane moved");
  eq(r.state.turn, 1); eq(r.state.sixes, 0);
  st = r.state;
});

Deno.test("two different legal moves need a pick; wrong order / bad plane are rejected", () => {
  const st = put(game(), 0, [5, 9, -1, -1]);
  const r = roll(st, 0, 2);
  eq(r.state.roll, 2); eq(r.state.turn, 0);
  eq(r.events.map((e: S) => e.k), ["roll"]);
  assert(!apply(r.state, 1, { kind: "move", plane: 0 }, dice()).ok, "not my turn");
  eq(apply(r.state, 1, { kind: "roll" }, dice(1)).error, "not_your_turn");
  eq(apply(r.state, 0, { kind: "roll" }, dice(1)).error, "pick_a_plane");
  eq(apply(r.state, 0, { kind: "move", plane: 2 }, dice()).error, "bad_plane", "hangar plane needs a 6");
  eq(apply(r.state, 0, { kind: "move", plane: 7 }, dice()).error, "bad_plane");
  eq(apply(game(), 0, { kind: "move", plane: 0 }, dice()).error, "roll_first");
  const m = apply(r.state, 0, { kind: "move", plane: 1 }, dice());
  assert(m.ok); eq(m.state.planes[0], [5, 11, -1, -1]); eq(m.state.turn, 1);
});

Deno.test("stacked own planes count as one move (auto)", () => {
  const st = put(game(), 0, [7, 7, -1, -1]);
  eq(legalMoves(st, 0, 2).length, 1);
  const r = roll(st, 0, 2);
  eq(r.state.planes[0], [9, 7, -1, -1], "the first plane of the stack moved");
  eq(legalMoves(put(game(), 0, [-1, -1, -1, 3]), 0, 6).length, 2, "take-off + the one on the board");
});

Deno.test("colour jump: landing on an own-colour square jumps 4 once", () => {
  const sim = simulate(put(game(), 0, [5, -1, -1, -1]), 0, 0, 3); // 5 + 3 = 8
  eq(sim.path, [6, 7, 8]); eq(sim.jump, 12); eq(sim.fly, null); eq(sim.to, 12);
  const s2 = simulate(put(game(), 0, [6, -1, -1, -1]), 0, 0, 2); // 8 -> 12 only once (not 16)
  eq(s2.to, 12); eq(s2.jump, 12);
  const s3 = simulate(put(game(), 0, [6, -1, -1, -1]), 0, 0, 1); // 7 is not own colour
  eq(s3.jump, null); eq(s3.to, 7);
  const s4 = simulate(put(game(), 0, [40, -1, -1, -1]), 0, 0, 4); // 44: next jump would leave the loop
  eq(s4.to, 44); eq(s4.jump, null);
  const s5 = simulate(put(game(), 0, [36, -1, -1, -1]), 0, 0, 4); // 40 -> 44
  eq(s5.to, 44); eq(s5.jump, 44);
  // 别的颜色的格子不跳：黄（座位 1）r = 4 是环格 17，颜色 17 % 4 = 1 = 黄，所以也是 r % 4 == 0
  const s6 = simulate(put(game(), 1, [0, -1, -1, -1]), 1, 0, 4);
  eq(s6.jump, 8);
});

Deno.test("flying shortcut: r16 flies to r28; r12 jumps to 16 then flies; take-off does not trigger", () => {
  const a = simulate(put(game(), 0, [10, -1, -1, -1]), 0, 0, 6);
  eq(a.to, 28); eq(a.fly, 28); eq(a.jump, null);
  const b = simulate(put(game(), 0, [9, -1, -1, -1]), 0, 0, 3);
  eq(b.jump, 16); eq(b.fly, 28); eq(b.to, 28);
  const c = simulate(put(game(), 0, [26, -1, -1, -1]), 0, 0, 2); // 过了飞格，普通跳
  eq(c.to, 32); eq(c.fly, null); eq(c.jump, 32);
  const d = simulate(put(game(), 2, [-1, -1, -1, -1]), 2, 0, 6);
  eq(d.takeoff, true); eq(d.to, 0); eq(d.jump, null); eq(d.fly, null);
  // 用 apply 走一遍，事件里有 fly
  const r = apply(put(game(), 0, [10, 52, 52, 52]), 0, { kind: "roll" }, dice(6));
  eq(r.events[1].fly, 28); eq(r.state.planes[0][0], 28);
});

Deno.test("capture: an opponent on the final square goes home; several planes all go", () => {
  // 红 r = 20 的环格 20（自己的颜色，落上去会再跳）；黄 r = 7 的环格 13 + 7 = 20
  const st = put(put(game(), 0, [17, -1, -1, -1]), 1, [7, 7, 30, -1]);
  const r = roll(st, 0, 3); // 17 + 3 = 20，是红色格，先跳到 24，终点不在黄的飞机上
  eq(r.events[1].jump, 24);
  eq(r.state.planes[1], [7, 7, 30, -1], "jumped away, nobody captured");
  // 红 r = 18（环格 18）；黄 r = 5（环格 13 + 5 = 18）两架叠着
  const st3 = put(put(game(), 0, [15, -1, -1, -1]), 1, [5, 5, 40, -1]);
  const r3 = roll(st3, 0, 3);
  eq(r3.events[1].to, 18); eq(r3.events[1].cap, [[1, 0], [1, 1]]);
  eq(r3.state.planes[1], [-1, -1, 40, -1]);
  eq(r3.state.planes[0], [18, -1, -1, -1]);
  // 在停机坪里没人能撞：红 r = 47 不对应环格
  eq(simulate(put(put(game(), 0, [44, -1, -1, -1]), 1, [20, -1, -1, -1]), 0, 0, 3).cap, []);
  // 自己的飞机叠在一起不算撞
  eq(simulate(put(game(), 0, [15, 18, -1, -1]), 0, 0, 3).cap, []);
});

Deno.test("capture on take-off square and after a fly landing", () => {
  // 黄的飞机停在红的起飞格（环格 0）：黄 r = 39 -> 13 + 39 = 52 -> 0
  const st = put(put(game(), 0, [-1, -1, -1, -1]), 1, [39, -1, -1, -1]);
  const r = roll(st, 0, 6);
  eq(r.events[1].cap, [[1, 0]]);
  eq(r.state.planes[1], [-1, -1, -1, -1]);
  // 飞到 r = 28（环格 28）撞上蓝的 r = 2（26 + 2）
  const st2 = put(put(game([true, false, true, false], 0), 0, [10, 52, 52, 52]), 2, [2, -1, -1, -1]);
  const r2 = roll(st2, 0, 6);
  eq(r2.events[1].fly, 28); eq(r2.events[1].cap, [[2, 0]]);
});

Deno.test("home stretch: exact landing on the centre, overshoot bounces back", () => {
  const exact = simulate(put(game(), 0, [49, -1, -1, -1]), 0, 0, 3);
  eq(exact.to, 52); eq(exact.home, true); eq(exact.path, [50, 51, 52]);
  const bounce = simulate(put(game(), 0, [51, -1, -1, -1]), 0, 0, 3);
  eq(bounce.path, [52, 51, 50]); eq(bounce.to, 50); eq(bounce.home, false);
  const far = simulate(put(game(), 0, [52 - 1, -1, -1, -1]), 0, 0, 6);
  eq(far.to, 47);
  // 进停机坪：r = 45 + 2 = 47，不跳不飞不撞
  const into = simulate(put(put(game(), 0, [44, -1, -1, -1]), 1, [0, -1, -1, -1]), 0, 0, 3);
  eq(into.to, 47); eq(into.jump, null); eq(into.cap, []);
  eq(canMove(52, 3), false, "planes at the centre never move");
  // 只剩到家的飞机和机库：掷不到 6 就过
  const st = put(game(), 0, [52, 52, -1, -1]);
  eq(roll(st, 0, 4).events[1].why, "none");
});

Deno.test("win: the first player with 4 planes home ends the game; ranking by progress", () => {
  const st = put(put(game([true, true, true, false], 0), 0, [52, 52, 52, 49]), 1, [52, 52, 10, 10]);
  put(st, 2, [52, 30, 30, -1]);
  const r = roll(st, 0, 3);
  eq(r.state.phase, "over"); eq(r.state.winner, 0);
  eq(r.state.rank, [0, 1, 2]);
  eq(homeCount(r.state, 0), 4);
  eq(progress(r.state, 2), 53 + 31 + 31 + 0);
  assert(!apply(r.state, 1, { kind: "roll" }, dice(1)).ok, "no moves after the game is over");
  eq(apply(r.state, 0, { kind: "roll" }, dice(1)).error, "game_over");
  // 6 到家的最后一架：赢了就不再掷
  const st6 = put(put(game(), 0, [52, 52, 52, 46]), 1, [-1, -1, -1, -1]);
  const r6 = roll(st6, 0, 6);
  eq(r6.state.phase, "over"); eq(r6.state.turn, 0);
  // 排名只按到家数和进度（赢家固定第一）
  eq(ranking(put(put(game(), 0, [52, 52, 52, 52]), 1, [52, -1, -1, -1])), [0, 1]);
});

Deno.test("danger counts opponents up to 6 squares behind (and hangar planes on their start square)", () => {
  const st = put(put(game(), 0, [20, -1, -1, -1]), 1, [10, -1, -1, -1]); // 黄 r = 10 -> 环格 23；红 r = 20 -> 环格 20，追不上（在前面）
  eq(danger(st, 0, 20), 0);
  const st2 = put(put(game(), 0, [30, -1, -1, -1]), 1, [10, -1, -1, -1]); // 红环格 30，黄环格 23，差 7
  eq(danger(st2, 0, 30), 0);
  const st3 = put(put(game(), 0, [27, -1, -1, -1]), 1, [10, -1, -1, -1]); // 差 4
  eq(danger(st3, 0, 27), 1);
  // 黄的机库里有飞机时，红站在黄的起飞格（环格 13，红 r = 13）上有危险
  eq(danger(put(put(game(), 0, [13, -1, -1, -1]), 1, [-1, -1, -1, -1]), 0, 13), 1);
  eq(danger(game(), 0, 46), 0, "stretch is safe");
});

Deno.test("bot: capture > take-off > fly/jump > most endangered > furthest", () => {
  // 能撞：红 r = 15 走 3 到 18 撞黄；另一架红 r = 30 走 3 不撞
  const a = put(put(game(), 0, [30, 15, -1, -1]), 1, [5, -1, -1, -1]);
  a.roll = 3;
  eq(botPick(a, 0, 3), 1);
  eq(botAction(a, 0), { kind: "move", plane: 1 });
  eq(botAction(game(), 0), { kind: "roll" });
  // 起飞比普通前进好
  const b2 = put(game(), 0, [11, -1, -1, -1]); // 11 + 6 = 17，只是普通前进；起飞更好
  eq(botPick(b2, 0, 6), 1);
  // 起飞比飞更优先
  const c = put(game(), 0, [10, 30, -1, -1]);
  eq(botPick(c, 0, 6), 2, "take-off first");
  // 飞 / 跳：掷 2，r = 10 -> 12 -> 跳 16 -> 飞 28（跳 + 飞）；r = 30 -> 32 -> 跳 36
  const d = put(game(), 0, [10, 30, -1, -1]);
  eq(botPick(d, 0, 2), 0, "jump+fly beats a plain jump");
  // 最危险的先走：红两架都不跳；一架被追（黄在后面 3 格）
  const e = put(put(game(), 0, [21, 41, -1, -1]), 1, [8, -1, -1, -1]); // 黄 r = 8 -> 环格 21？ 13 + 8 = 21。
  // 让黄在红 r = 41(环格 41) 后面 3 格：黄环格 38 = 13 + 25
  put(e, 1, [25, -1, -1, -1]);
  eq(danger(e, 0, 41), 1);
  eq(botPick(e, 0, 1), 1, "move the endangered plane");
  // 没别的区别：走得最远的
  const f = put(game(), 0, [5, 6, 7, -1]);
  eq(botPick(f, 0, 1), 2);
  // 到家比起飞更优先
  const g2 = put(game(), 0, [-1, 46, -1, -1]); // 46 + 6 = 52 到家
  eq(botPick(g2, 0, 6), 1);
});

Deno.test("bot-only simulation always finishes with a winner and never gets stuck", () => {
  for (let seed = 1; seed <= 20; seed++) {
    let a = seed * 2654435761 >>> 0;
    const rng = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const seats = [true, seed % 2 === 0, seed % 3 !== 0, true];
    let st = newGame({ seats, first: 0 });
    let steps = 0;
    while (st.phase === "playing" && steps++ < 20000) {
      const r = apply(st, st.turn, botAction(st, st.turn), rng);
      assert(r.ok, "bot action rejected: " + JSON.stringify(r));
      st = r.state;
    }
    assert(st.phase === "over" && st.winner !== null, "game did not finish for seed " + seed);
    assert(homeCount(st, st.winner) === 4);
    eq(st.rank[0], st.winner);
  }
});
