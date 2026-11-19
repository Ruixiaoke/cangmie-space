// games.ts（榴莲看小游戏）的测试：假数据库按真实的「这一对好友」过滤规则求值，所以能验证不会碰别的对局
import { ddzRecord, gameHint, gameRecord, gameStatus, poolHelper, poolTargets8, slLayoutA, STATUS_MAX_CHARS, tttWinningCells } from "./games.ts";
import { buildUserInput, runJob, systemInstructions, TOOL_SPECS } from "./agent.ts";

const ME = "11111111-1111-1111-1111-111111111111";
const PEER = "22222222-2222-2222-2222-222222222222";
const OTHER = "33333333-3333-3333-3333-333333333333";
const names = { [ME]: "小红", [PEER]: "小明" };

type Row = Record<string, unknown>;
function fakeAdmin(tables: Record<string, Row[]>, rpcImpl?: (fn: string, a: Record<string, unknown>) => unknown) {
  const queries: { table: string; or?: string; eq: [string, unknown][] }[] = [];
  const matchOr = (row: Row, expr: string) =>
    expr.split("),and(").some((part) => part.replace(/^and\(|\)$/g, "").split(",").every((c) => { const [col, , v] = c.split("."); return row[col] === v; }));
  return {
    queries,
    from(table: string) {
      const rec = { table, eq: [] as [string, unknown][], or: undefined as string | undefined };
      queries.push(rec);
      let lim = 1000;
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b, order: () => b,
        or: (e: string) => { rec.or = e; return b; },
        eq: (c: string, v: unknown) => { rec.eq.push([c, v]); return b; },
        limit: (n: number) => { lim = n; return b; },
        // deno-lint-ignore no-explicit-any
        then: (res: any, rej: any) => {
          let rows = [...(tables[table] ?? [])].sort((x, y) => (y.id as number) - (x.id as number));
          if (rec.or) rows = rows.filter((r) => matchOr(r, rec.or!));
          for (const [c, v] of rec.eq) rows = rows.filter((r) => r[c] === v);
          return Promise.resolve({ data: rows.slice(0, lim), error: null }).then(res, rej);
        },
      };
      return b;
    },
    rpc: (fn: string, a: Record<string, unknown>) => Promise.resolve({ data: rpcImpl ? rpcImpl(fn, a) : null, error: null }),
  };
}

const ttt = (id: number, x: string, o: string, board: string, next: string | null, status = "active", winner: string | null = null): Row => ({ id, player_x: x, player_o: o, board, next_player: next, status, winner });
const pool = (o: Row): Row => ({ id: 1, player_a: ME, player_b: PEER, status: "active", winner: null, score_a: 0, score_b: 0, rack_no: 1, seed: 7, next_player: ME, state: null, in_hand: false, last_foul: null, mode: "nine", group_a: null, ...o });
const sling = (o: Row): Row => ({ id: 1, player_a: ME, player_b: PEER, status: "active", winner: null, score_a: 1, score_b: 0, round_no: 2, seed: 42, wind: 0.4, next_player: ME, state: null, ...o });
const j = (s: string) => JSON.parse(s);

Deno.test("ttt precompute: winning and blocking cells, no-move and full board", () => {
  if (tttWinningCells("xx.......", "x").join() !== "3") throw new Error("row win");
  if (tttWinningCells("x...x....", "x").join() !== "9") throw new Error("diag win");
  if (tttWinningCells("xo.xo....", "o").join() !== "8") throw new Error("o col win");
  if (tttWinningCells(".........", "x").length) throw new Error("empty board has no win");
  if (tttWinningCells("xoxxoooxx", "x").length) throw new Error("full board has no move");
});

Deno.test("game_status ttt detail: board rows, legal, must_block, win_now, asker marked", async () => {
  const db = fakeAdmin({ ttt_games: [ttt(5, ME, PEER, "xx.oo....", PEER), ttt(6, PEER, ME, "xoxxoooxx", null, "draw")] });
  // 轮到 o（小明）且 o 自己有 o o 在第二行：先赢
  let o = j(await gameStatus(db, ME, PEER, names, { game: "ttt" }));
  if (o.id !== 5 || o.X !== "小红(提问人)" || o.O !== "小明" || o.board[0] !== "XX." || o.turn !== "小明") throw new Error(JSON.stringify(o));
  if (o.legal.join() !== "3,6,7,8,9" || o.x_wins_at.join() !== "3" || o.o_wins_at.join() !== "6" || o.mover_best.win_now.join() !== "6") throw new Error(JSON.stringify(o));
  // 轮到 x 时，o 要赢，x 必须堵
  const db2 = fakeAdmin({ ttt_games: [ttt(5, ME, PEER, "x.xoo....", ME)] });
  o = j(await gameStatus(db2, ME, PEER, names, { game: "ttt", id: 5 }));
  if (o.mover_best.win_now?.join() !== "2") throw new Error("x wins at 2: " + JSON.stringify(o.mover_best));
  const db3 = fakeAdmin({ ttt_games: [ttt(5, ME, PEER, "xo.xo.o..", ME)] });
  o = j(await gameStatus(db3, ME, PEER, names, { game: "ttt" }));
  if (o.mover_best.must_block?.join() !== "3,8") throw new Error("must block 3 and 8: " + JSON.stringify(o.mover_best));
  const db4 = fakeAdmin({ ttt_games: [ttt(5, ME, PEER, ".o..o....", ME)] });
  o = j(await gameStatus(db4, ME, PEER, names, { game: "ttt" }));
  if (o.mover_best.must_block?.join() !== "8") throw new Error("must block 8: " + JSON.stringify(o.mover_best));
  // 结束的局：没有 legal
  o = j(await gameStatus(fakeAdmin({ ttt_games: [ttt(6, PEER, ME, "xoxxoooxx", null, "draw")] }), ME, PEER, names, { game: "ttt" }));
  if (o.status !== "draw" || o.legal || o.board[2] !== "OXX") throw new Error(JSON.stringify(o));
});

Deno.test("pair scoping: other pair's game id is rejected and queries always carry the pair filter", async () => {
  const db = fakeAdmin({
    ttt_games: [ttt(5, ME, PEER, "........."  , ME), ttt(9, ME, OTHER, "........x", ME), ttt(10, OTHER, PEER, ".........", PEER)],
    sling_games: [sling({ id: 3, player_b: OTHER })], pool_games: [pool({ id: 4, player_b: OTHER })],
  });
  for (const [game, id] of [["ttt", 9], ["ttt", 10], ["sling", 3], ["pool", 4], ["ttt", 999]] as [string, number][]) {
    const o = j(await gameStatus(db, ME, PEER, names, { game, id }));
    if (o.error !== "game_not_found") throw new Error(game + id + " leaked: " + JSON.stringify(o));
  }
  const l = j(await gameStatus(db, ME, PEER, names, {}));
  if (JSON.stringify(l).includes("#9") || JSON.stringify(l).includes("#10") || JSON.stringify(l).includes("#3 ") || JSON.stringify(l).includes("#4 ")) throw new Error("list leaked " + JSON.stringify(l));
  // 反过来问（对方是提问人）也只能看到同一对
  const l2 = j(await gameStatus(db, PEER, ME, names, {}));
  if (l2.games.length !== 1 || !l2.games[0].includes("#5")) throw new Error(JSON.stringify(l2));
  for (const q of db.queries) {
    if (!q.or || !q.or.includes(ME) && !q.or.includes(PEER)) throw new Error("query without pair filter: " + JSON.stringify(q));
    if (q.or.includes(OTHER)) throw new Error("other user in filter");
  }
  if (j(await gameStatus(db, ME, PEER, names, { game: "chess" })).error !== "bad_game") throw new Error("bad game");
  if (j(await gameStatus(db, ME, PEER, names, { game: "ttt", id: -1 })).error !== "bad_id") throw new Error("bad id");
  if (j(await gameStatus(db, ME, PEER, names, { id: 5 })).error !== "game_required_with_id") throw new Error("id w/o game");
});

Deno.test("game_status list: no params, active first then latest finished, max 2 per kind", async () => {
  const db = fakeAdmin({
    ttt_games: [ttt(1, ME, PEER, ".........", null, "x_won", ME), ttt(2, ME, PEER, ".........", null, "draw"), ttt(3, ME, PEER, ".........", null, "draw"), ttt(4, ME, PEER, "x........", PEER)],
    sling_games: [], pool_games: [pool({ id: 8, mode: "eight", score_a: 2, score_b: 1 })],
  });
  const o = j(await gameStatus(db, ME, PEER, names, {}));
  const ttts = o.games.filter((s: string) => s.startsWith("井字棋"));
  if (ttts.length !== 2 || !ttts[0].includes("#4") || !ttts[0].includes("active") || !ttts[1].includes("#3")) throw new Error(JSON.stringify(o));
  if (!o.games.some((s: string) => s.startsWith("8球台球 #8") && s.includes("2:1"))) throw new Error(JSON.stringify(o));
  const none = j(await gameStatus(fakeAdmin({}), ME, PEER, names, {}));
  if (typeof none.games !== "string") throw new Error("empty list message");
});

Deno.test("context hint: active games only, relative to the asker, empty when none", async () => {
  const db = fakeAdmin({
    ttt_games: [ttt(4, ME, PEER, "x........", PEER)],
    sling_games: [sling({ id: 2, status: "a_won" })],
    pool_games: [pool({ id: 8, mode: "eight", player_a: PEER, player_b: ME, score_a: 1, score_b: 2, next_player: ME })],
  });
  const h = await gameHint(db, ME, PEER, names);
  if (h !== "进行中的小游戏：井字棋（轮到小明）、8球台球（2:1，轮到你）") throw new Error(h);
  if (db.queries.length !== 3) throw new Error("one query per table");
  if (await gameHint(fakeAdmin({ ttt_games: [ttt(4, ME, OTHER, "x........", ME)] }), ME, PEER, names) !== "") throw new Error("must be empty");
});

Deno.test("sling detail: scores, wind relative to mover, fortress summary", async () => {
  const lay = slLayoutA(42);
  if (!lay.blocks.length || lay.blocks.length > 12) throw new Error("layout");
  const db = fakeAdmin({ sling_games: [sling({})] });
  const o = j(await gameStatus(db, ME, PEER, names, { game: "sling" }));
  if (o.win_at !== 3 || o.round !== 2 || !o.score.includes("1 : 0") || o.turn !== "小红(提问人)" || !String(o.wind).includes("顺风")) throw new Error(JSON.stringify(o));
  for (const f of [o.fortress_A, o.fortress_B]) {
    if (!/^\d+\/\d+$/.test(f.blocks) || !Array.isArray(f.col_heights) || typeof f.avatar !== "string") throw new Error(JSON.stringify(f));
  }
  if (o.fortress_A.blocks !== o.fortress_B.blocks) throw new Error("mirror fortresses start equal");
  // 有状态：第一个 A 方方块碎了
  const n = lay.blocks.length;
  const b = Array.from({ length: n * 2 }, (_, i) => (i === 0 ? [0, 0, 0, 0, 0, 1] : [lay.blocks[i % n].x, lay.blocks[i % n].y, 0, 100, i === n ? 1 : 0, 0]));
  const o2 = j(await gameStatus(fakeAdmin({ sling_games: [sling({ state: { b, v: [[lay.av.x, lay.av.y, 0], [2000 - lay.av.x, lay.av.y, 0]] } })] }), ME, PEER, names, { game: "sling" }));
  if (o2.fortress_A.blocks !== `${n - 1}/${n}`) throw new Error(JSON.stringify(o2.fortress_A));
  // 头像上面的方块没了就暴露
  const noTop = Array.from({ length: n * 2 }, () => [0, 0, 0, 0, 0, 1]);
  const o3 = j(await gameStatus(fakeAdmin({ sling_games: [sling({ state: { b: noTop, v: [[lay.av.x, lay.av.y, 0], [2000 - lay.av.x, lay.av.y, 0]] } })] }), ME, PEER, names, { game: "sling" }));
  if (!o3.fortress_A.avatar.includes("暴露")) throw new Error(JSON.stringify(o3.fortress_A));
  if (JSON.stringify(o).length > STATUS_MAX_CHARS) throw new Error("size");
});

Deno.test("pool helper geometry: straight shot ~0 degrees, blocked line flagged, bad cut is hard", () => {
  // 右上袋 (344,-4)：目标球在袋口正下方一条竖线附近，白球在它正下方 => 到「左上/右上」之外，用右中袋 (347,300) 做直线
  const straight = poolHelper([[0, 100, 300], [3, 250, 300]], [3]);
  const s = straight[0];
  if (s.ball !== 3 || s.pocket !== "右中" || s.cut_deg > 2 || s.blocked_by) throw new Error(JSON.stringify(s));
  // 中间挡一个球
  const blocked = poolHelper([[0, 100, 300], [3, 250, 300], [5, 175, 300]], [3]);
  if (blocked[0].pocket === "右中" && !blocked[0].blocked_by?.includes(5)) throw new Error("block not flagged: " + JSON.stringify(blocked[0]));
  const onlyBlocked = poolHelper([[0, 100, 300], [3, 250, 300], [5, 175, 300], [6, 250, 200], [7, 250, 400]], [3]);
  if (!onlyBlocked[0]) throw new Error("some result expected");
  // 反方向：白球在目标球和袋口之间的另一侧很偏 => 切角大
  const awkward = poolHelper([[0, 300, 310], [3, 250, 300]], [3]);
  if (awkward[0].cut_deg < 30 && awkward[0].pocket === "右中") throw new Error("cue in front of the ball should not be an easy shot: " + JSON.stringify(awkward[0]));
  if (poolHelper([[3, 250, 300]], [3]).length) throw new Error("no cue ball -> no helper");
});

Deno.test("8-ball legal targets: open table, groups, 8 last, break", () => {
  const balls: [number, number, number][] = [[0, 170, 450], [1, 50, 50], [9, 60, 60], [8, 70, 70], [10, 80, 80]];
  const t = (g: string | null, brk = false) => poolTargets8(balls, g, brk).join();
  if (t(null) !== "1,9,10") throw new Error("open: any but 8: " + t(null));
  if (t("solid") !== "1" || t("stripe") !== "9,10") throw new Error("groups");
  if (t(null, true) !== "1,9,8,10") throw new Error("break: all");
  if (poolTargets8([[0, 1, 1], [8, 2, 2]], "solid", false).join() !== "8") throw new Error("8 after clearing group");
});

Deno.test("pool detail: nine-ball lowest ball + helper; eight-ball groups, counts, targets; size cap; break rack from seed", async () => {
  const balls = [[0, 170, 450], [3, 200, 300], [5, 120, 200], [9, 250, 150]];
  let o = j(await gameStatus(fakeAdmin({ pool_games: [pool({ state: { b: balls } })] }), ME, PEER, names, { game: "pool" }));
  if (o.game !== "pool9" || o.legal_first_contact.join() !== "3" || o.balls.length !== 4 || o.pockets.length !== 6 || !o.helper_rough?.length || !o.helper_note.includes("粗略")) throw new Error(JSON.stringify(o));
  if (o.in_hand !== false || o.break_shot !== false) throw new Error("flags");
  const b8 = [[0, 170, 450], [1, 200, 300], [2, 100, 100], [9, 250, 150], [10, 50, 400], [11, 60, 60], [8, 170, 200]];
  const g8 = pool({ mode: "eight", group_a: "solid", state: { b: b8 }, last_foul: "scratch", in_hand: false, next_player: PEER, score_a: 2, score_b: 1 });
  o = j(await gameStatus(fakeAdmin({ pool_games: [g8] }), ME, PEER, names, { game: "pool" }));
  if (o.game !== "pool8" || o.groups["小红(提问人)"] !== "solid" || o.groups["小明"] !== "stripe" || o.left["小红(提问人)"] !== 2 || o.left["小明"] !== 3) throw new Error(JSON.stringify(o));
  if (o.legal_first_contact.join() !== "9,10,11" || o.turn !== "小明" || o.last_foul !== "scratch") throw new Error(JSON.stringify(o));
  // 白球在手：没有白球，没有 helper
  o = j(await gameStatus(fakeAdmin({ pool_games: [pool({ state: { b: balls.slice(1) }, in_hand: true })] }), ME, PEER, names, { game: "pool" }));
  if (o.in_hand !== true || o.helper_rough) throw new Error("in hand: " + JSON.stringify(o));
  // 开球：state 为空，按种子摆球
  for (const mode of ["nine", "eight"]) {
    o = j(await gameStatus(fakeAdmin({ pool_games: [pool({ mode })] }), ME, PEER, names, { game: "pool" }));
    if (o.break_shot !== true || o.balls.length !== (mode === "eight" ? 16 : 10) || o.balls[0][0] !== 0) throw new Error(mode + JSON.stringify(o));
  }
  // 全 15 球 + helper 的最大输出也不超限
  const full = [[0, 170, 450]]; for (let i = 1; i <= 15; i++) if (i !== 8) full.push([i, 40 + i * 17, 100 + (i % 5) * 60]);
  full.push([8, 170, 250]);
  const txt = await gameStatus(fakeAdmin({ pool_games: [pool({ mode: "eight", state: { b: full } })] }), ME, PEER, names, { game: "pool" });
  if (txt.length > STATUS_MAX_CHARS) throw new Error("size " + txt.length);
  // 超限时先丢建议：用超长昵称撑大
  const big = { [ME]: "甲".repeat(400), [PEER]: "乙".repeat(400) };
  const bigTxt = await gameStatus(fakeAdmin({ pool_games: [pool({ mode: "eight", state: { b: full } })] }), ME, PEER, big, { game: "pool" });
  if (bigTxt.includes("helper_rough") || j(bigTxt).balls.length !== 16) throw new Error("helpers trimmed first");
});

Deno.test("game_leaderboard tool: only the two people, calls the pair-only rpc, rejects bad game", async () => {
  const calls: Record<string, unknown>[] = [];
  const db = fakeAdmin({}, (_fn, a) => { calls.push(a); return [{ a_wins: 4, a_losses: 2, b_wins: 3, b_losses: 5, a_h2h: 2, b_h2h: 1 }]; });
  const o = j(await gameRecord(db, ME, PEER, names, { game: "pool8" }));
  if (calls[0].p_a !== ME || calls[0].p_b !== PEER || calls[0].p_game !== "pool8") throw new Error("rpc args");
  if (o.totals["小红"] !== "4胜2负" || o.totals["小明"] !== "3胜5负" || o.head_to_head !== "小红 2 : 1 小明" || JSON.stringify(o).length > 300) throw new Error(JSON.stringify(o));
  if (j(await gameRecord(db, ME, PEER, names, { game: "chess" })).error !== "bad_game" || calls.length !== 1) throw new Error("bad game must not hit rpc");
});

Deno.test("tools are static and read-only; rules mention game tools; hint goes in user input, not instructions", () => {
  const specs = TOOL_SPECS as { type: string; name?: string }[];
  const fn = specs.filter((t) => t.type === "function").map((t) => t.name);
  if (fn.join() !== "search_chats,remember,forget,recall,game_status,game_leaderboard,jx3_info" || specs.length !== 8) throw new Error(fn.join());
  const ins = systemInstructions();
  if (!ins.includes("game_status") || !ins.includes("game_leaderboard") || !ins.includes("不能替任何人落子") || !ins.includes("公开、公平") || ins.includes("—") || /\p{Extended_Pictographic}/u.test(ins)) throw new Error("rules");
  if (/进行中的小游戏：/.test(ins)) throw new Error("hint must not be in instructions");
  const inp = buildUserInput({ askerName: "甲", peerName: "乙", now: new Date("2026-11-18T01:00:00Z"), mems: [], history: [], names: {}, question: "q", gameHint: "进行中的小游戏：井字棋（轮到你）" });
  if (!inp.includes("进行中的小游戏：井字棋（轮到你）")) throw new Error(inp);
  if (buildUserInput({ askerName: "甲", peerName: "乙", now: new Date(), mems: [], history: [], names: {}, question: "q" }).includes("小游戏")) throw new Error("no hint when none");
});

Deno.test("end to end: hint in first request input; instructions and tools byte-identical across pairs with different games", async () => {
  const reqs: Record<string, unknown>[] = [];
  for (const [asker, peer, withGame] of [[ME, PEER, true], [OTHER, PEER, false]] as [string, string, boolean][]) {
    const tables = { ttt_games: withGame ? [ttt(4, ME, PEER, "x........", PEER)] : [] };
    const db = fakeAdmin(tables);
    // deno-lint-ignore no-explicit-any
    const admin: any = {
      from: (t: string) => {
        if (t === "ttt_games" || t === "sling_games" || t === "pool_games") return db.from(t);
        // deno-lint-ignore no-explicit-any
        const b: any = {};
        for (const m of ["select", "insert", "update", "eq", "in", "or", "order", "limit", "upsert", "delete"]) b[m] = () => b;
        const out = t === "agent_jobs" ? { id: 7, asker, peer, message_id: 100, status: "running" }
          : t === "friendships" ? [{ id: 1 }] : t === "profiles" ? [{ id: asker, nickname: "小红" }, { id: peer, nickname: "小明" }]
          : t === "messages" ? { sender_id: asker, body: "怎么走", id: 200 } : [];
        b.maybeSingle = b.single = () => Promise.resolve({ data: out, error: null });
        // deno-lint-ignore no-explicit-any
        b.then = (r: any, e: any) => Promise.resolve({ data: t === "messages" ? [] : out, error: null }).then(r, e);
        return b;
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    };
    await runJob({
      admin, apiKey: "k", model: "m", push: () => Promise.resolve(),
      fetchFn: ((_u: string, init: RequestInit) => { reqs.push(JSON.parse(String(init.body))); return Promise.resolve(new Response(JSON.stringify({ id: "r", output: [{ type: "message", content: [{ type: "output_text", text: "好" }] }] }))); }) as unknown as typeof fetch,
    }, 7);
  }
  const [a, b] = reqs as { instructions: string; tools: unknown; input: { content: string }[] }[];
  if (!a.input[0].content.includes("进行中的小游戏：井字棋（轮到小明）")) throw new Error(a.input[0].content);
  if (b.input[0].content.includes("小游戏")) throw new Error("no hint for pair without games");
  if (a.instructions !== b.instructions || JSON.stringify(a.tools) !== JSON.stringify(b.tools)) throw new Error("must stay static");
});

Deno.test("game_leaderboard ddz: DM pair + overall totals, group ranking only this group's members", async () => {
  const lo = ME < PEER ? ME : PEER, hi = ME < PEER ? PEER : ME;
  const db = fakeAdmin({ ddz_scores: [
    { id: 1, dm_lo: lo, dm_hi: hi, user_id: ME, total: 12, wins: 3, games: 5 },
    { id: 2, dm_lo: lo, dm_hi: hi, user_id: PEER, total: -12, wins: 2, games: 5 },
    { id: 3, group_id: 7, user_id: ME, total: -4, wins: 1, games: 3 },
    { id: 4, group_id: 7, user_id: OTHER, total: 9, wins: 2, games: 3 },
    { id: 5, group_id: 8, user_id: PEER, total: 30, wins: 6, games: 9 },
  ] });
  let o = j(await gameRecord(db, ME, PEER, names, { game: "ddz" }));
  if (o.together["小红(提问人)"] !== "+12分，3胜/5局" || o.together["小明"] !== "-12分，2胜/5局") throw new Error(JSON.stringify(o));
  if (o.overall["小红(提问人)"] !== "+8分，4胜/8局" || o.overall["小明"] !== "+18分，8胜/14局") throw new Error(JSON.stringify(o));
  const gnames = { [ME]: "小红", [OTHER]: "阿杰" };
  o = j(await ddzRecord(db, ME, { group: 7 }, gnames));
  if (o.scope !== "本群" || o.ranking.join("|") !== "1. 阿杰 +9分，2胜/3局|2. 小红(提问人) -4分，1胜/3局") throw new Error(JSON.stringify(o));
  o = j(await ddzRecord(db, ME, { group: 99 }, gnames));
  if (o.ranking !== "这个群还没人打过斗地主") throw new Error(JSON.stringify(o));
  o = j(await gameRecord(fakeAdmin({ ddz_scores: [] }), ME, PEER, names, { game: "ddz" }));
  if (typeof o.together !== "string" || o.overall["小明"] !== "0分，0胜/0局") throw new Error(JSON.stringify(o));
});
