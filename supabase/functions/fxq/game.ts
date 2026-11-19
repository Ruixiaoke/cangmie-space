// 飞行棋牌桌的服务器逻辑：规则引擎（rules.gen.js）+ 骰子 + 超时托管 + 机器人 + 结算 + 推送
//
// 桌子有 4 个座位（座位号 = 颜色：0 红 1 黄 2 蓝 3 绿，不压紧）。开始时至少坐了 2 个（真人 + 机器人）才能开；人数就是坐了几个。
// 再来一局保持同样的座位。桌子属于一个群（group_id）或者一对好友（dm_lo / dm_hi）；私聊桌的权限是「这两个人且还是 accepted 好友」，对局结束不写系统提示行。
//
// 和 HTTP / 鉴权 / 数据库细节分开：数据库、时钟、随机数、推送全部从参数传入，方便本地用假的实现测试（和 ddz/game.ts 一样）。
// 服务器是唯一的裁判：骰子在这里掷（客户端不能选点数），走法在这里校验。飞行棋没有秘密信息，整局状态都在 fxq_games.pub 里，
// 真人通过 select + Realtime 直接看到；pub.log 是最近的事件（掷骰子 / 走棋 / 过），客户端用它逐步回放动画。
import * as R from "./rules.gen.js";

// rules.gen.js 是纯 JS，类型靠推断会很别扭，这里统一当 any 用
// deno-lint-ignore no-explicit-any
const { apply, botAction, newGame, FXQ_RULES_VERSION } = R as any;

// ---- 调参：全部数字集中在这里 ----
export const TURN_MS = 15_000; // 真人掷骰子 / 选飞机的时间
export const TICK_GRACE_MS = 500; // 过了截止时间这么久，tick 才算数（给在最后一刻操作的人留余地）
export const MISS_LIMIT = 2; // 连续超时几次进入托管
export const MAX_AUTO_STEPS = 3000; // 机器人 / 托管连续行动的次数上限（防死循环；一整局全是机器人也就几百步）
export const REPLAY_MS = 450; // 机器人 / 托管连着走的每条事件，给真人的截止时间多加这么久（客户端要逐步播放动画）
export const REPLAY_MAX_MS = 6000;
export const LOG_KEEP = 60; // pub.log 保留最近多少条事件

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
export type Commit = {
  game: number;
  version: number;
  patch: { status: string; pub: Json; auto: boolean[]; round: number; deadline: string | null };
  scores: { user_id: string; win: boolean }[];
  line: string | null;
  actor: string | null;
};
export interface Store {
  getGame(id: number): Promise<GameRow | null>;
  // 群桌：user 是群成员；私聊桌：user 是这对好友之一且好友关系还在
  canAccess(row: GameRow, user: string): Promise<boolean>;
  names(ids: string[]): Promise<Record<string, string>>;
  groupName(group: number): Promise<string>;
  // 原子提交：version 对不上返回 false
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

const ACTIONS = ["start", "roll", "move", "tick", "auto_off", "rematch"];

// 用 crypto.getRandomValues 做种子的 PRNG（sfc32）；返回 [0, 1)
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

function isMachine(row: { seats: (string | null)[]; bots: boolean[] }, auto: boolean[], seat: number): boolean {
  return !!row.bots[seat] || !!auto[seat] || !row.seats[seat];
}

export function botName(bots: boolean[], seat: number): string {
  let n = 0;
  for (let i = 0; i <= seat; i++) if (bots[i]) n++;
  return "机器人" + n;
}
const COLOR = ["红", "黄", "蓝", "绿"];
export const colorName = (seat: number) => COLOR[seat] ?? "";

// 处理一个请求。返回 HTTP 状态和 JSON 体
export async function handle(deps: Deps, uid: string, body: Json): Promise<Result> {
  if (!body || typeof body !== "object") return fail(400, "invalid_body");
  const gameId = body.game;
  if (!Number.isSafeInteger(gameId) || gameId <= 0) return fail(400, "invalid_body");
  const action = body.action;
  if (typeof action !== "string" || !ACTIONS.includes(action)) return fail(400, "invalid_body");
  if (action === "move" && !Number.isInteger(body.plane)) return fail(400, "bad_plane");
  if (body.version !== undefined && !Number.isSafeInteger(body.version)) return fail(400, "invalid_body");

  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await deps.store.getGame(gameId);
    if (!row) return fail(404, "table_not_found");
    if (!(await deps.store.canAccess(row, uid))) return fail(403, row.group_id != null ? "not_group_member" : "not_friends");
    if (attempt === 0 && body.version !== undefined && body.version !== row.version) return fail(409, "conflict");

    const out = await step(deps, uid, row, body);
    if ("error" in out) return fail(out.status, out.error);
    const ok = await deps.store.commit(out.commit);
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
        game: { id: row.id, status: c.patch.status, pub: c.patch.pub, seats: row.seats, bots: row.bots, auto: c.patch.auto, round: c.patch.round, deadline: c.patch.deadline, version: row.version + 1 },
      },
    };
  }
  return fail(409, "conflict");
}

type Step = { error: string; status: number } | { commit: Commit; seat: number; push: (() => Promise<unknown>) | null };

async function step(deps: Deps, uid: string, row: GameRow, body: Json): Promise<Step> {
  const action = body.action as string;
  const seatOf = row.seats.indexOf(uid);
  const rng = deps.rng();
  const now = deps.now();
  const auto = row.auto.slice();
  const err = (status: number, error: string): Step => ({ error, status });
  const prev: Json = row.pub && row.pub.planes ? row.pub : null;
  let st: Json;
  let misses: number[];
  let log: Json[] = [];
  let fresh = false;

  if (action === "start" || action === "rematch") {
    if (action === "start" ? row.status !== "waiting" : row.status !== "over") return err(400, "bad_phase");
    if (seatOf < 0) return err(403, "not_seated");
    if (!row.seats.some((s) => !!s)) return err(400, "no_human");
    const active = [0, 1, 2, 3].map((i) => !!row.seats[i] || !!row.bots[i]);
    if (active.filter(Boolean).length < 2) return err(400, "not_full");
    let first: number;
    if (action === "rematch" && prev && Number.isInteger(prev.first)) {
      first = prev.first;
      for (let k = 1; k <= 4; k++) { const s = (prev.first + k) % 4; if (active[s]) { first = s; break; } }
    } else {
      const list = [0, 1, 2, 3].filter((i) => active[i]);
      first = list[Math.floor(rng() * list.length)];
    }
    st = newGame({ seats: active, first });
    misses = [0, 0, 0, 0];
    auto.fill(false);
    fresh = true;
  } else {
    if (row.status !== "playing" || !prev) return err(400, "bad_phase");
    st = prev;
    // pub 里除了引擎状态，还带着 log / misses / round / v：引擎只认自己的字段，多余的原样带着
    misses = (prev.misses ?? [0, 0, 0, 0]).slice();
    log = (prev.log ?? []).slice();

    if (action === "tick") {
      const due = row.deadline ? Date.parse(row.deadline) + TICK_GRACE_MS : NaN;
      const seat = st.turn as number;
      const machineTurn = isMachine(row, auto, seat);
      if (!machineTurn && !(Number.isFinite(due) && now >= due)) return err(409, "too_early");
      if (!machineTurn) {
        // 超时：用机器人替他掷骰子 / 选飞机；连续超时 MISS_LIMIT 次就一直托管，直到他自己操作
        const r = apply(st, seat, botAction(st, seat), rng);
        if (!r.ok) return err(500, "auto_failed");
        st = r.state; log = log.concat(r.events);
        misses[seat]++;
        if (misses[seat] >= MISS_LIMIT) auto[seat] = true;
      }
    } else if (action === "auto_off") {
      if (seatOf < 0) return err(403, "not_seated");
      auto[seatOf] = false;
      misses[seatOf] = 0;
    } else {
      // roll / move
      if (seatOf < 0) return err(403, "not_seated");
      if (st.turn !== seatOf) return err(400, "not_your_turn");
      const act = action === "roll" ? { kind: "roll" } : { kind: "move", plane: body.plane };
      const r = apply(st, seatOf, act, rng);
      if (!r.ok) return err(400, r.error);
      st = r.state; log = log.concat(r.events);
      misses[seatOf] = 0;
      auto[seatOf] = false; // 任何操作都解除托管
    }
  }

  // 机器人和托管的座位立刻连着行动，直到轮到一个真人（或者结束）
  let machineEvents = 0;
  for (let n = 0; st.phase === "playing" && isMachine(row, auto, st.turn) && n < MAX_AUTO_STEPS; n++) {
    const seat = st.turn as number;
    const r = apply(st, seat, botAction(st, seat), rng);
    if (!r.ok) return err(500, "auto_failed");
    st = r.state; log = log.concat(r.events); machineEvents += r.events.length;
  }

  const over = st.phase === "over";
  const progressed = fresh || !prev || prev.seq !== st.seq;
  let deadline: string | null = null;
  if (!over) deadline = progressed || !row.deadline ? new Date(now + TURN_MS + Math.min(REPLAY_MAX_MS, REPLAY_MS * machineEvents)).toISOString() : row.deadline;
  const round = fresh ? row.round + 1 : row.round;
  if (log.length > LOG_KEEP) log = log.slice(log.length - LOG_KEEP);
  const pub = { ...st, v: FXQ_RULES_VERSION, round, misses, log };

  let scores: Commit["scores"] = [];
  let line: string | null = null;
  let actor: string | null = null;
  let winnerName = "";
  if (over) {
    const humans = row.seats.filter((s): s is string => !!s && !row.bots[row.seats.indexOf(s)]);
    for (const s of st.order as number[]) {
      const u = row.seats[s];
      if (u && !row.bots[s]) scores.push({ user_id: u, win: st.winner === s });
    }
    const nm = await deps.store.names(humans);
    const seatName = (i: number) => (row.seats[i] && !row.bots[i] ? (nm[row.seats[i] as string] ?? "好友") : botName(row.bots, i));
    winnerName = seatName(st.winner);
    // 系统提示行只在群里写：私聊里没有系统作者
    line = row.group_id != null ? `飞行棋：${winnerName}（${colorName(st.winner)}）赢了` : null;
    actor = seatOf >= 0 ? uid : humans[0] ?? null;
    if (!actor) { line = null; scores = []; }
  }

  const status = over ? "over" : "playing";
  const commit: Commit = { game: row.id, version: row.version, patch: { status, pub, auto, round, deadline }, scores, line, actor };

  // 推送：开局 / 轮到你了 / 结束；只推给别的真人，不推给托管的人
  let push: (() => Promise<unknown>) | null = null;
  const pusher = deps.push;
  if (pusher) {
    const humans = [0, 1, 2, 3].filter((s) => row.seats[s] && !row.bots[s]);
    let note: ((s: number) => string | null) | null = null;
    if (over) note = () => `飞行棋结束了，${winnerName}赢了`;
    else if (fresh) note = (s) => (st.turn === s ? "飞行棋开局了，轮到你先掷骰子" : "飞行棋开局了，来看看");
    else if (!prev || prev.turn !== st.turn) note = (s) => (st.turn === s && !auto[s] ? "轮到你了（飞行棋）" : null);
    if (note) {
      const text = note;
      push = async () => {
        const gid = row.group_id;
        const title = gid != null ? await deps.store.groupName(gid) : ((await deps.store.names([uid]))[uid] ?? "好友");
        const where = gid != null ? { group: gid } : { peer: uid };
        await Promise.allSettled(humans.filter((s) => row.seats[s] !== uid).map((s) => {
          const body = text(s);
          return body ? pusher(row.seats[s] as string, { title, body, tag: "fxq-" + row.id, ...where }) : Promise.resolve();
        }));
      };
    }
  }
  return { commit, seat: seatOf, push };
}
