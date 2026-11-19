// 斗地主牌桌的服务器逻辑：规则引擎（rules.gen.js）+ 超时托管 + 机器人 + 结算
//
// 和 HTTP / 鉴权 / 数据库细节分开：数据库、时钟、随机数、推送全部从参数传入，方便本地用假的实现测试（和 agent-chat/agent.ts 一样）。
// 服务器是唯一的裁判：完整状态（含三家手牌）只存在 ddz_state（只有 service role 能读）；
// 每个真人自己的手牌写进 ddz_hands（RLS：只有本人能读），旁观者只能看到 ddz_games.pub（别人的手牌只有张数）。
import * as R from "./rules.gen.js";

// rules.gen.js 是纯 JS，类型靠推断会很别扭，这里统一当 any 用
// deno-lint-ignore no-explicit-any
const { apply, botAction, newGame, publicView, DDZ_RULES_VERSION } = R as any;

// ---- 调参：全部数字集中在这里 ----
export const BID_MS = 20_000; // 真人叫分的时间
export const PLAY_MS = 30_000; // 真人出牌的时间
export const TICK_GRACE_MS = 500; // 过了截止时间这么久，tick 才算数（给在最后一刻出牌的人留余地）
export const MISS_LIMIT = 2; // 连续超时几次进入托管
export const MAX_AUTO_STEPS = 400; // 机器人 / 托管连续出牌的次数上限（一局最多几百手，防死循环）

export type GameRow = {
  id: number;
  group_id: number;
  created_by: string | null;
  message_id: number | null;
  status: "waiting" | "bidding" | "playing" | "over" | "closed";
  seats: (string | null)[];
  bots: boolean[];
  auto: boolean[];
  round: number;
  pub: Json;
  deadline: string | null;
  version: number;
};
// deno-lint-ignore no-explicit-any
type Json = any;
// ddz_state.state：g 是引擎状态（含所有手牌），misses 是每个座位连续超时的次数，first 是这一局第一个叫分的座位
export type StateDoc = { g: Json; misses: number[]; first: number };
export type Commit = {
  game: number;
  version: number;
  patch: { status: string; pub: Json; auto: boolean[]; round: number; deadline: string | null };
  state: StateDoc;
  hands: { seat: number; user_id: string; round: number; cards: number[] }[];
  scores: { user_id: string; delta: number; win: boolean }[];
  line: string | null;
  actor: string | null;
};
export interface Store {
  getGame(id: number): Promise<GameRow | null>;
  getState(id: number): Promise<StateDoc | null>;
  isMember(group: number, user: string): Promise<boolean>;
  names(ids: string[]): Promise<Record<string, string>>;
  groupName(group: number): Promise<string>;
  // 原子提交：version 对不上返回 false；这个群已经有另一张没结束的桌子抛 Error("table_exists")
  commit(c: Commit): Promise<boolean>;
}
export type PushPayload = { title: string; body: string; tag: string; group?: number };
export type Deps = {
  store: Store;
  now: () => number;
  rng: () => () => number; // 每次请求新建一个随机数发生器（生产环境用 crypto 种子）
  push?: (user: string, payload: PushPayload) => Promise<unknown>;
};
export type Result = { status: number; body: Record<string, unknown> };

const ACTIONS = ["start", "bid", "play", "pass", "tick", "auto_off", "rematch"];

// 用 crypto.getRandomValues 做种子的 PRNG（sfc32）；引擎的 rng 要求返回 [0, 1)
export function cryptoRng(): () => number {
  const s = new Uint32Array(4);
  crypto.getRandomValues(s);
  let [a, b, c, d] = [s[0], s[1], s[2], s[3]];
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
}

function fail(status: number, error: string): Result {
  return { status, body: { error } };
}

function isMachine(row: GameRow, auto: boolean[], seat: number): boolean {
  return !!row.bots[seat] || !!auto[seat] || !row.seats[seat];
}

export function botName(bots: boolean[], seat: number): string {
  let n = 0;
  for (let i = 0; i <= seat; i++) if (bots[i]) n++;
  return "机器人" + n;
}

function winLine(g: Json, seatName: (i: number) => string): string {
  const L = g.landlord as number;
  const times = g.multiplier + " 倍";
  const tail = g.spring ? "，春天" : "";
  if (g.winner === "landlord") return `斗地主：地主 ${seatName(L)} 赢了，${times}${tail}`;
  const farmers = [0, 1, 2].filter((i) => i !== L).map(seatName).join("、");
  return `斗地主：农民 ${farmers} 赢了，${times}${tail}`;
}

// 处理一个请求。返回 HTTP 状态和 JSON 体
export async function handle(deps: Deps, uid: string, body: Json): Promise<Result> {
  if (!body || typeof body !== "object") return fail(400, "invalid_body");
  const gameId = body.game;
  if (!Number.isSafeInteger(gameId) || gameId <= 0) return fail(400, "invalid_body");
  const action = body.action;
  if (typeof action !== "string" || !ACTIONS.includes(action)) return fail(400, "invalid_body");
  if (action === "bid" && !Number.isInteger(body.value)) return fail(400, "bad_bid");
  if (action === "play" && (!Array.isArray(body.cards) || body.cards.length > 20 || !body.cards.every(Number.isInteger))) return fail(400, "illegal_combo");
  if (body.version !== undefined && !Number.isSafeInteger(body.version)) return fail(400, "invalid_body");

  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await deps.store.getGame(gameId);
    if (!row) return fail(404, "table_not_found");
    if (!(await deps.store.isMember(row.group_id, uid))) return fail(403, "not_group_member");
    if (attempt === 0 && body.version !== undefined && body.version !== row.version) return fail(409, "conflict");

    const out = await step(deps, uid, row, body);
    if ("error" in out) return fail(out.status, out.error);
    let ok: boolean;
    try {
      ok = await deps.store.commit(out.commit);
    } catch (e) {
      if (e instanceof Error && e.message === "table_exists") return fail(409, "table_exists");
      throw e;
    }
    if (!ok) continue; // 别人先改了：重读重试一次
    if (out.push) {
      const p = out.push;
      try { await p(); } catch { /* 推送失败不影响牌局 */ }
    }
    const c = out.commit;
    return {
      status: 200,
      body: {
        ok: true,
        seat: out.seat,
        hand: out.hand,
        game: { id: row.id, status: c.patch.status, pub: c.patch.pub, auto: c.patch.auto, round: c.patch.round, deadline: c.patch.deadline, version: row.version + 1 },
      },
    };
  }
  return fail(409, "conflict");
}

type Step = { error: string; status: number } | { commit: Commit; seat: number; hand: number[] | null; push: (() => Promise<unknown>) | null };

async function step(deps: Deps, uid: string, row: GameRow, body: Json): Promise<Step> {
  const action = body.action as string;
  const seatOf = row.seats.indexOf(uid);
  const live = row.status === "bidding" || row.status === "playing";
  const rng = deps.rng();
  const now = deps.now();
  const auto = row.auto.slice();
  let doc: StateDoc | null = null;
  let g: Json;
  let misses: number[];
  let first: number;
  let fresh = false; // 新开一局（start / rematch）
  const err = (status: number, error: string): Step => ({ error, status });

  if (action === "start" || action === "rematch") {
    if (action === "start" ? row.status !== "waiting" : row.status !== "over") return err(400, "bad_phase");
    if (seatOf < 0) return err(403, "not_seated");
    for (let i = 0; i < 3; i++) if (!row.seats[i] && !row.bots[i]) return err(400, "not_full");
    if (!row.seats.some((s) => !!s)) return err(400, "no_human");
    const prev = action === "rematch" ? await deps.store.getState(row.id) : null;
    first = prev ? (prev.first + 1) % 3 : Math.floor(rng() * 3);
    g = newGame({ rng, firstSeat: first });
    misses = [0, 0, 0];
    auto[0] = auto[1] = auto[2] = false;
    fresh = true;
  } else {
    if (!live) return err(400, "bad_phase");
    doc = await deps.store.getState(row.id);
    if (!doc) return err(500, "state_missing");
    g = doc.g;
    misses = doc.misses.slice();
    first = doc.first;

    if (action === "tick") {
      const due = row.deadline ? Date.parse(row.deadline) + TICK_GRACE_MS : NaN;
      const seat = g.turn as number;
      const machineTurn = isMachine(row, auto, seat);
      if (!machineTurn && !(Number.isFinite(due) && now >= due)) return err(409, "too_early");
      if (!machineTurn) {
        // 超时：用机器人替他出这一手；连续超时 MISS_LIMIT 次就一直托管，直到他自己操作
        const r = apply(g, seat, botAction(g, seat), rng);
        if (!r.ok) return err(500, "auto_failed");
        g = r.state;
        misses[seat]++;
        if (misses[seat] >= MISS_LIMIT) auto[seat] = true;
      }
    } else if (action === "auto_off") {
      if (seatOf < 0) return err(403, "not_seated");
      auto[seatOf] = false;
      misses[seatOf] = 0;
    } else {
      // bid / play / pass
      if (seatOf < 0) return err(403, "not_seated");
      if (g.turn !== seatOf) return err(400, "not_your_turn");
      const act = action === "bid" ? { kind: "bid", value: body.value } : action === "play" ? { kind: "play", cards: body.cards } : { kind: "pass" };
      const r = apply(g, seatOf, act, rng);
      if (!r.ok) return err(400, r.error);
      g = r.state;
      misses[seatOf] = 0;
      auto[seatOf] = false; // 任何操作都解除托管
    }
  }

  // 机器人和托管的座位立刻连着出牌，直到轮到一个真人（或者结束）
  for (let n = 0; g.phase !== "over" && isMachine(row, auto, g.turn) && n < MAX_AUTO_STEPS; n++) {
    const seat = g.turn as number;
    const r = apply(g, seat, botAction(g, seat), rng);
    if (!r.ok) return err(500, "auto_failed");
    g = r.state;
  }

  const over = g.phase === "over";
  const before = doc ? doc.g : null;
  const progressed = fresh || !before || before.phase !== g.phase || before.turn !== g.turn || before.log.length !== g.log.length;
  let deadline: string | null = null;
  if (!over) {
    if (progressed || !row.deadline) deadline = new Date(now + (g.phase === "bidding" ? BID_MS : PLAY_MS)).toISOString();
    else deadline = row.deadline;
  }
  const round = fresh ? row.round + 1 : row.round;
  const pub = { ...publicView(g, null), v: DDZ_RULES_VERSION, round, first, finalHands: over ? g.hands : null };

  const hands: Commit["hands"] = [];
  for (let i = 0; i < 3; i++) {
    const u = row.seats[i];
    if (!u) continue;
    if (fresh || !before || JSON.stringify(before.hands[i]) !== JSON.stringify(g.hands[i])) hands.push({ seat: i, user_id: u, round, cards: g.hands[i] });
  }

  let scores: Commit["scores"] = [];
  let line: string | null = null;
  let actor: string | null = null;
  if (over) {
    const L = g.landlord as number;
    for (let i = 0; i < 3; i++) {
      const u = row.seats[i];
      if (!u) continue;
      scores.push({ user_id: u, delta: g.scores[i], win: (g.winner === "landlord") === (i === L) });
    }
    const humans = row.seats.filter((s): s is string => !!s);
    const nm = await deps.store.names(humans);
    const seatName = (i: number) => (row.seats[i] ? (nm[row.seats[i] as string] ?? "好友") : botName(row.bots, i));
    line = winLine(g, seatName);
    actor = seatOf >= 0 ? uid : humans[0] ?? null;
    if (!actor) { line = null; scores = []; }
  }

  const status = g.phase as string;
  const commit: Commit = {
    game: row.id,
    version: row.version,
    patch: { status, pub, auto, round, deadline },
    state: { g, misses, first },
    hands,
    scores,
    line,
    actor,
  };

  let push: (() => Promise<unknown>) | null = null;
  const pusher = deps.push;
  if (fresh && pusher) {
    const to = row.seats.filter((s): s is string => !!s && s !== uid);
    push = async () => {
      const title = await deps.store.groupName(row.group_id);
      await Promise.allSettled(to.map((u) => pusher(u, { title, body: "斗地主开局了，来看看", tag: "ddz-" + row.id, group: row.group_id })));
    };
  }
  return { commit, seat: seatOf, hand: seatOf >= 0 ? g.hands[seatOf] : null, push };
}
