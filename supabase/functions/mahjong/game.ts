// 麻将牌桌的服务器逻辑：规则引擎（rules.gen.js）+ 超时托管 + 机器人 + 结算
//
// 桌子永远是 4 个座位。开始时空座位补机器人；座位保持玩家选的位置（座位号就是出牌顺序）。再来一局保持座位。
// 桌子属于一个群（group_id）或者一对好友（dm_lo / dm_hi）；私聊桌的权限是「这两个人且还是 accepted 好友」，对局结束不写系统提示行。
//
// 和 HTTP / 鉴权 / 数据库细节分开：数据库、时钟、随机数、推送全部从参数传入，方便本地用假的实现测试（和 ddz/game.ts 一样）。
// 服务器是唯一的裁判：完整状态（含四家手牌和牌墙）只存在 mj_state（只有 service role 能读）；
// 每个真人自己的手牌和当前能做的事写进 mj_hands（RLS：只有本人能读），旁观者只能看到 mj_games.pub（只有张数、牌河、亮出来的组）。
import * as R from "./rules.gen.js";

// rules.gen.js 是纯 JS，类型靠推断会很别扭，这里统一当 any 用
// deno-lint-ignore no-explicit-any
const { apply, botAction, newGame, pending, privateView, publicView, timeoutAction, tileName, MJ_RULES_VERSION } = R as any;

// ---- 调参：全部数字集中在这里 ----
export const TURN_MS = 20_000; // 真人出牌的时间
export const CLAIM_MS = 8_000; // 吃碰杠胡窗口：真人表态的时间，超时算「过」
export const TICK_GRACE_MS = 500; // 过了截止时间这么久，tick 才算数（给在最后一刻操作的人留余地）
export const MISS_LIMIT = 2; // 连续出牌超时几次进入托管
export const MAX_AUTO_STEPS = 600; // 机器人 / 托管连续动作的次数上限（一局最多几百步，防死循环）

export type GameRow = {
  id: number;
  group_id: number | null;
  dm_lo: string | null;
  dm_hi: string | null;
  created_by: string | null;
  message_id: number | null;
  status: "waiting" | "playing" | "over" | "closed";
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
// mj_state.state：g 是引擎状态（含所有手牌和牌墙），misses 是每个座位连续出牌超时的次数
export type StateDoc = { g: Json; misses: number[] };
export type HandRow = { seat: number; user_id: string; round: number; step: number; cards: number[]; drawn: number | null; opts: Json; ag: number[] };
export type Commit = {
  game: number;
  version: number;
  patch: { status: string; pub: Json; auto: boolean[]; round: number; deadline: string | null; seats?: (string | null)[]; bots?: boolean[] };
  state: StateDoc;
  hands: HandRow[];
  scores: { user_id: string; delta: number; win: boolean }[];
  line: string | null;
  actor: string | null;
};
export interface Store {
  getGame(id: number): Promise<GameRow | null>;
  getState(id: number): Promise<StateDoc | null>;
  // 群桌：user 是群成员；私聊桌：user 是这对好友之一且好友关系还在
  canAccess(row: GameRow, user: string): Promise<boolean>;
  names(ids: string[]): Promise<Record<string, string>>;
  groupName(group: number): Promise<string>;
  // 原子提交：version 对不上返回 false；这个群 / 这对好友已经有另一张没结束的桌子抛 Error("table_exists")
  commit(c: Commit): Promise<boolean>;
}
export type PushPayload = { title: string; body: string; tag: string; group?: number; peer?: string };
export type Deps = {
  store: Store;
  now: () => number;
  rng: () => () => number; // 每次请求新建一个随机数发生器（生产环境用 crypto 种子）
  push?: (user: string, payload: PushPayload) => Promise<unknown>;
};
export type Result = { status: number; body: Record<string, unknown> };

const ACTIONS = ["start", "discard", "hu", "peng", "gang", "chi", "pass", "angang", "bugang", "tick", "auto_off", "rematch"];

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

type Seating = { seats: (string | null)[]; bots: boolean[] };

function isMachine(t: Seating, auto: boolean[], seat: number): boolean {
  return !!t.bots[seat] || !!auto[seat] || !t.seats[seat];
}

export function botName(bots: boolean[], seat: number): string {
  let n = 0;
  for (let i = 0; i <= seat; i++) if (bots[i]) n++;
  return "机器人" + n;
}

function resultLine(g: Json, seatName: (i: number) => string): string {
  const r = g.result;
  if (r.type === "draw") return "麻将：流局";
  if (r.type === "zimo") return `麻将：${seatName(r.winner)} 自摸，${r.fan} 番`;
  if (r.type === "qianggang") return `麻将：${seatName(r.winner)} 抢杠胡，${seatName(r.from)} 点炮，${r.fan} 番`;
  return `麻将：${seatName(r.winner)} 胡了，${seatName(r.from)} 点炮，${r.fan} 番`;
}

// 处理一个请求。返回 HTTP 状态和 JSON 体
export async function handle(deps: Deps, uid: string, body: Json): Promise<Result> {
  if (!body || typeof body !== "object") return fail(400, "invalid_body");
  const gameId = body.game;
  if (!Number.isSafeInteger(gameId) || gameId <= 0) return fail(400, "invalid_body");
  const action = body.action;
  if (typeof action !== "string" || !ACTIONS.includes(action)) return fail(400, "invalid_body");
  if (["discard", "angang", "bugang"].includes(action) && !(Number.isInteger(body.tile) && body.tile >= 0 && body.tile < 34)) return fail(400, "bad_tile");
  if (action === "chi" && !(Array.isArray(body.with) && body.with.length === 2 && body.with.every((x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < 34))) return fail(400, "bad_tile");
  if (body.version !== undefined && !Number.isSafeInteger(body.version)) return fail(400, "invalid_body");

  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await deps.store.getGame(gameId);
    if (!row) return fail(404, "table_not_found");
    if (!(await deps.store.canAccess(row, uid))) return fail(403, row.group_id != null ? "not_group_member" : "not_friends");
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
        game: { id: row.id, status: c.patch.status, pub: c.patch.pub, seats: c.patch.seats ?? row.seats, bots: c.patch.bots ?? row.bots, auto: c.patch.auto, round: c.patch.round, deadline: c.patch.deadline, version: row.version + 1 },
      },
    };
  }
  return fail(409, "conflict");
}

type Step = { error: string; status: number } | { commit: Commit; seat: number; hand: Json | null; push: (() => Promise<unknown>) | null };

async function step(deps: Deps, uid: string, row: GameRow, body: Json): Promise<Step> {
  const action = body.action as string;
  let seat4: Seating = { seats: row.seats, bots: row.bots };
  let seatOf = row.seats.indexOf(uid);
  const live = row.status === "playing";
  const rng = deps.rng();
  const now = deps.now();
  const auto = row.auto.slice();
  let doc: StateDoc | null = null;
  let g: Json;
  let misses: number[];
  let fresh = false; // 新开一局（start / rematch）
  let patchSeats = false; // 开始时补了机器人：这次提交要把新座位写回桌子
  const err = (status: number, error: string): Step => ({ error, status });

  if (action === "start" || action === "rematch") {
    if (action === "start" ? row.status !== "waiting" : row.status !== "over") return err(400, "bad_phase");
    if (seatOf < 0) return err(403, "not_seated");
    if (!row.seats.some((s) => !!s)) return err(400, "no_human");
    let dealer: number, quan: number;
    if (action === "start") {
      // 空座位补机器人，补满 4 个
      const bots = row.bots.slice();
      for (let i = 0; i < 4; i++) if (!row.seats[i] && !bots[i]) bots[i] = true;
      seat4 = { seats: row.seats.slice(), bots };
      patchSeats = true;
      dealer = Math.floor(rng() * 4);
      quan = 0;
    } else {
      for (let i = 0; i < 4; i++) if (!row.seats[i] && !row.bots[i]) return err(400, "not_full");
      const prev = await deps.store.getState(row.id);
      dealer = prev ? prev.g.nextDealer : Math.floor(rng() * 4);
      quan = prev ? prev.g.nextQuan : 0;
    }
    g = newGame({ rng, dealer, quan });
    misses = [0, 0, 0, 0];
    auto.fill(false);
    fresh = true;
  } else {
    if (!live) return err(400, "bad_phase");
    doc = await deps.store.getState(row.id);
    if (!doc) return err(500, "state_missing");
    g = doc.g;
    misses = doc.misses.slice();

    if (action === "tick") {
      const due = row.deadline ? Date.parse(row.deadline) + TICK_GRACE_MS : NaN;
      const waiting = (pending(g) as number[]).filter((s) => !isMachine(seat4, auto, s));
      if (waiting.length && !(Number.isFinite(due) && now >= due)) return err(409, "too_early");
      // 超时：出牌的人替他打一张（连续超时 MISS_LIMIT 次就一直托管，直到他自己操作）；窗口里没表态的人算「过」
      for (const s of waiting) {
        if (!(pending(g) as number[]).includes(s)) continue; // 前面的人放弃后窗口已经结算
        const r = apply(g, s, timeoutAction(g, s));
        if (!r.ok) return err(500, "auto_failed");
        g = r.state;
      }
      if (waiting.length && doc.g.phase === "discard") { // 出牌超时才计数；吃碰杠窗口里的超时不算
        const s = waiting[0];
        misses[s]++;
        if (misses[s] >= MISS_LIMIT) auto[s] = true;
      }
    } else if (action === "auto_off") {
      if (seatOf < 0) return err(403, "not_seated");
      auto[seatOf] = false;
      misses[seatOf] = 0;
    } else {
      if (seatOf < 0) return err(403, "not_seated");
      const act = action === "discard" || action === "angang" || action === "bugang" ? { kind: action, tile: body.tile }
        : action === "chi" ? { kind: "chi", with: body.with }
        : { kind: action };
      const r = apply(g, seatOf, act);
      if (!r.ok) return err(400, r.error);
      g = r.state;
      misses[seatOf] = 0;
      auto[seatOf] = false; // 任何操作都解除托管
    }
  }

  // 机器人和托管的座位立刻表态 / 出牌，直到轮到真人（或者结束）
  for (let n = 0; g.phase !== "over" && n < MAX_AUTO_STEPS; n++) {
    const machines = (pending(g) as number[]).filter((s) => isMachine(seat4, auto, s));
    if (!machines.length) break;
    const s = machines[0];
    const r = apply(g, s, botAction(g, s));
    if (!r.ok) return err(500, "auto_failed");
    g = r.state;
  }

  const over = g.phase === "over";
  const before = doc ? doc.g : null;
  const progressed = fresh || !before || before.step !== g.step;
  let deadline: string | null = null;
  if (!over) {
    if (progressed || !row.deadline) deadline = new Date(now + (g.phase === "claim" ? CLAIM_MS : TURN_MS)).toISOString();
    else deadline = row.deadline;
  }
  const round = fresh ? row.round + 1 : row.round;
  const pub = { ...publicView(g), v: MJ_RULES_VERSION, round };

  const hands: HandRow[] = [];
  for (let i = 0; i < 4; i++) {
    const u = seat4.seats[i];
    if (!u) continue;
    const pv = privateView(g, i);
    hands.push({ seat: i, user_id: u, round, step: g.step, cards: pv.cards, drawn: pv.drawn, opts: pv.opts, ag: pv.ag });
  }

  let scores: Commit["scores"] = [];
  let line: string | null = null;
  let actor: string | null = null;
  if (over) {
    const r = g.result;
    for (let i = 0; i < 4; i++) {
      const u = seat4.seats[i];
      if (!u) continue;
      scores.push({ user_id: u, delta: r.scores[i], win: r.winner === i });
    }
    const humans = seat4.seats.filter((s): s is string => !!s);
    const nm = await deps.store.names(humans);
    const seatName = (i: number) => (seat4.seats[i] ? (nm[seat4.seats[i] as string] ?? "好友") : botName(seat4.bots, i));
    // 系统提示行只在群里写：私聊里没有系统作者
    line = row.group_id != null ? resultLine(g, seatName) : null;
    actor = seatOf >= 0 ? uid : humans[0] ?? null;
    if (!actor) { line = null; scores = []; }
  }

  const commit: Commit = {
    game: row.id,
    version: row.version,
    patch: patchSeats ? { status: g.phase === "over" ? "over" : "playing", pub, auto, round, deadline, seats: seat4.seats, bots: seat4.bots } : { status: g.phase === "over" ? "over" : "playing", pub, auto, round, deadline },
    state: { g, misses },
    hands,
    scores,
    line,
    actor,
  };

  // 推送：开局通知其他真人；之后每次轮到一个新的真人（出牌 / 可以吃碰杠胡），通知他一次（不推给正在操作的人，页面在前台的人服务端会跳过）
  let push: (() => Promise<unknown>) | null = null;
  const pusher = deps.push;
  if (pusher) {
    const prevPend = new Set<number>(before ? (pending(before) as number[]) : []);
    const now4 = over ? [] : (pending(g) as number[]);
    const notes: { user: string; body: string }[] = [];
    if (fresh) {
      for (const u of new Set(seat4.seats.filter((s): s is string => !!s && s !== uid))) notes.push({ user: u, body: "麻将开局了，来看看" });
    } else {
      for (const s of now4) {
        const u = seat4.seats[s];
        if (!u || u === uid || seat4.bots[s] || auto[s] || prevPend.has(s)) continue;
        notes.push({ user: u, body: g.phase === "claim" ? "有牌可以吃碰杠胡，快来看看" : "轮到你出牌了" });
      }
      if (over) {
        for (const u of new Set(seat4.seats.filter((s): s is string => !!s && s !== uid))) notes.push({ user: u, body: "这局麻将打完了，来看结果" });
      }
    }
    if (notes.length) {
      push = async () => {
        const gid = row.group_id;
        const title = gid != null ? await deps.store.groupName(gid) : ((await deps.store.names([uid]))[uid] ?? "好友");
        const where = gid != null ? { group: gid } : { peer: uid };
        await Promise.allSettled(notes.map((n) => pusher(n.user, { title, body: n.body, tag: "mj-" + row.id, ...where })));
      };
    }
  }
  return { commit, seat: seatOf, hand: seatOf >= 0 ? { round, step: g.step, ...privateView(g, seatOf) } : null, push };
}

// 给测试和榴莲的格式化用：把牌编码变成中文名
export function tilesText(tiles: number[]): string {
  return tiles.map((t) => tileName(t)).join("");
}
