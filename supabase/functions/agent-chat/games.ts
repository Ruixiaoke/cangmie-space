// 榴莲看小游戏：game_status（对局状态 + 帮建议用的预计算）、game_leaderboard（这两个人的战绩）、user input 里的「进行中的小游戏」一行
//
// 全部只读。用 service role 查，所以每条查询都必须同时带上「这一对好友」的过滤（两个玩家列 = 提问人和对方，两种顺序），
// 查别的对局（别的好友对、别人的 id）只会得到空结果，永远不碰。
// 规则和几何是客户端代码的精简移植（Edge Function 只会打包 supabase/functions 里的文件，不能 import chat/js）：
//   井字棋 chat/js/miniapps/ttt.js；弹弓 chat/js/miniapps/sling-sim.js（slLayout 摆堡垒）；台球 chat/js/miniapps/pool-sim.js
//   （PW / PH / BR / POCKETS / poolRack / poolRack8 / poolTargets8 / poolGroupOf）。改了那边的规则或尺寸，这里要跟着改。
// 新增一个小游戏时，也要在这里加：gameHint 一行、game_status 的详情、game_leaderboard 的游戏名（见 .claude/skills/chat-miniapp/SKILL.md）。

// deno-lint-ignore no-explicit-any
type Db = any;
type Names = Record<string, string>;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export const STATUS_MAX_CHARS = 2500; // game_status 详情的字数上限，超了先去掉预计算的建议
export const LIST_PER_KIND = 2;
export const BOARD_GAMES = ["ttt", "sling", "pool", "pool8"];

type Kind = "ttt" | "sling" | "pool";
const KINDS: Kind[] = ["ttt", "sling", "pool"];
const TABLE: Record<Kind, { table: string; a: string; b: string; cols: string }> = {
  ttt: { table: "ttt_games", a: "player_x", b: "player_o", cols: "id,player_x,player_o,board,next_player,status,winner" },
  sling: { table: "sling_games", a: "player_a", b: "player_b", cols: "id,player_a,player_b,status,winner,score_a,score_b,round_no,seed,wind,next_player,state" },
  pool: { table: "pool_games", a: "player_a", b: "player_b", cols: "id,player_a,player_b,status,winner,score_a,score_b,rack_no,seed,next_player,state,in_hand,last_foul,mode,group_a" },
};
const KIND_NAME: Record<Kind, string> = { ttt: "井字棋", sling: "弹弓大战", pool: "台球" };

function pairFilter(k: Kind, a: string, b: string): string {
  const t = TABLE[k];
  return `and(${t.a}.eq.${a},${t.b}.eq.${b}),and(${t.a}.eq.${b},${t.b}.eq.${a})`;
}

function poolName(g: Row): string {
  return g.mode === "eight" ? "8球台球" : "9球台球";
}

// ---------- user input 里的一行 ----------
// 每张表一条查询（只取 1 条进行中的）。失败就当没有，绝不影响回复。
export async function gameHint(admin: Db, asker: string, peer: string, names: Names): Promise<string> {
  const peerName = names[peer] ?? "好友";
  const turn = (g: Row) => (g.next_player === asker ? "轮到你" : g.next_player === peer ? "轮到" + peerName : "");
  const parts: string[] = [];
  for (const k of KINDS) {
    try {
      const t = TABLE[k];
      const { data } = await admin.from(t.table).select(t.cols.replace(/,state/, "") ).or(pairFilter(k, asker, peer)).eq("status", "active").order("id", { ascending: false }).limit(1);
      const g = (data ?? [])[0] as Row | undefined;
      if (!g) continue;
      const mineIsA = g[t.a] === asker;
      let score = "";
      if (k !== "ttt") score = (mineIsA ? `${g.score_a}:${g.score_b}` : `${g.score_b}:${g.score_a}`) + "，";
      const name = k === "pool" ? poolName(g) : KIND_NAME[k];
      parts.push(`${name}（${score}${turn(g)}）`.replace("，）", "）").replace("（）", ""));
    } catch { /* 忽略 */ }
  }
  return parts.length ? "进行中的小游戏：" + parts.join("、") : "";
}

// ---------- 通用 ----------
const label = (id: string | null, asker: string, names: Names) => (id ? (names[id] ?? "?") + (id === asker ? "(提问人)" : "") : null);

function oneLine(k: Kind, g: Row, asker: string, names: Names): string {
  const t = TABLE[k];
  const A = label(g[t.a], asker, names), B = label(g[t.b], asker, names);
  const turn = g.status === "active" ? "，轮到" + (label(g.next_player, asker, names) ?? "?") : "";
  const win = g.winner ? "，" + (names[g.winner] ?? "?") + "赢" : "";
  if (k === "ttt") return `井字棋 #${g.id} X=${A} O=${B} ${g.status}${turn}${win}`;
  const head = k === "sling" ? `弹弓大战 #${g.id} 第${g.round_no}局` : `${poolName(g)} #${g.id} 第${g.rack_no}盘`;
  return `${head} ${A} ${g.score_a}:${g.score_b} ${B} ${g.status}${turn}${win}`;
}

// ---------- 井字棋 ----------
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
// side 落在哪些空格能立刻连成三个
export function tttWinningCells(board: string, side: "x" | "o"): number[] {
  const out: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] !== ".") continue;
    const b = board.slice(0, i) + side + board.slice(i + 1);
    if (LINES.some((l) => l.every((c) => b[c] === side))) out.push(i + 1);
  }
  return out;
}

function tttDetail(g: Row, asker: string, names: Names): Row {
  const board: string = g.board;
  const rows = [0, 1, 2].map((r) => board.slice(r * 3, r * 3 + 3).toUpperCase());
  const x = label(g.player_x, asker, names), o = label(g.player_o, asker, names);
  const out: Row = { game: "ttt", id: g.id, X: x, O: o, status: g.status, winner: label(g.winner, asker, names), board: rows, cells: "格子编号1到9，按行从左到右" };
  if (g.status !== "active") return out;
  const mover: "x" | "o" = g.next_player === g.player_x ? "x" : "o";
  const legal: number[] = [];
  for (let i = 0; i < 9; i++) if (board[i] === ".") legal.push(i + 1);
  const xw = tttWinningCells(board, "x"), ow = tttWinningCells(board, "o");
  out.turn = label(g.next_player, asker, names);
  out.legal = legal;
  out.x_wins_at = xw;
  out.o_wins_at = ow;
  const mine = mover === "x" ? xw : ow, theirs = mover === "x" ? ow : xw;
  out.mover_best = mine.length ? { win_now: mine } : theirs.length ? { must_block: theirs } : "没有立即的输赢，按常规占中心、角";
  return out;
}

// ---------- 弹弓大战（堡垒布局，移植自 sling-sim.js 的 slLayout）----------
const SLW = 2000, PLAT_Y = 827, PLAT_X = 490, BS = 56, AV_R = 24;
const SL_TYPES: Record<string, { w: number; h: number }> = { biscuit: { w: 55, h: 55 }, chocolate: { w: 55, h: 55 }, wafer: { w: 111, h: 55 } };
const SL_TYPE_NAME: Record<string, string> = { biscuit: "饼干", chocolate: "巧克力", wafer: "威化" };
function slRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type SlBlock = { type: string; x: number; y: number; w: number; h: number };
export function slLayoutA(seed: number): { blocks: SlBlock[]; av: { x: number; y: number } } {
  const r = slRng(seed), blocks: SlBlock[] = [];
  const x0 = 112, rowsN = 3 + (r() < 0.5 ? 1 : 0);
  const span = [4, r() < 0.5 ? 4 : 3, r() < 0.5 ? 3 : 2, 2];
  let off = 0, topL = 0, topR = 0, pOff = 0, pN = 4;
  for (let row = 0; row < rowsN; row++) {
    const n = span[row];
    let used = 0;
    off = row === 0 ? 0 : pOff + Math.min(pN - n, Math.floor(r() * (pN - n + 1)));
    pOff = off; pN = n;
    const cy = PLAT_Y - (row + 0.5) * BS;
    while (used < n) {
      let type: string, wide = false;
      if (n - used >= 2 && r() < 0.32) { type = "wafer"; wide = true; }
      else type = r() < (row === 0 ? 0.5 : 0.3) ? "chocolate" : "biscuit";
      const cols = wide ? 2 : 1, d = SL_TYPES[type];
      blocks.push({ type, x: x0 + (off + used + cols / 2) * BS, y: cy - 0.5, w: d.w, h: d.h });
      used += cols;
    }
    topL = x0 + off * BS; topR = x0 + (off + n) * BS;
  }
  const top = PLAT_Y - rowsN * BS;
  return { blocks, av: { x: (topL + topR) / 2, y: top - AV_R - 1 } };
}

// 一方堡垒的简述。state.b 的顺序：A 方全部方块，再 B 方（镜像，数量相同）；每项 [x,y,角度,hp,冻住,碎了]
function slFortress(side: 0 | 1, lay: ReturnType<typeof slLayoutA>, state: Row | null): Row {
  const n = lay.blocks.length, base = 112;
  const alive: { type: string; x: number; y: number; w: number; frozen: boolean }[] = [];
  const counts: Record<string, number> = {};
  let frozen = 0;
  lay.blocks.forEach((d, i) => {
    const s = state?.b?.[side * n + i] as number[] | undefined;
    const broken = s ? s[5] === 1 : false;
    const x0 = s ? s[0] : (side === 0 ? d.x : SLW - d.x), y0 = s ? s[1] : d.y;
    const onPlat = side === 0 ? x0 < PLAT_X + 20 : x0 > SLW - PLAT_X - 20;
    if (broken || y0 > PLAT_Y + 10 || !onPlat) return;
    alive.push({ type: d.type, x: x0, y: y0, w: d.w, frozen: !!(s && s[4] === 1) });
    counts[d.type] = (counts[d.type] ?? 0) + 1;
    if (s && s[4] === 1) frozen++;
  });
  // 每一列的高度（块数，一块 = 56）。列从堡垒外侧往内侧数（A 方从左，B 方从右）
  const cols: number[] = [];
  for (const b of alive) {
    const left = side === 0 ? b.x - b.w / 2 - base : SLW - base - (b.x + b.w / 2);
    const top = Math.max(0, (PLAT_Y - (b.y - 27.5)) / BS);
    for (let c = Math.round(left / BS); c < Math.round(left / BS) + Math.round(b.w / BS); c++) {
      if (c >= 0 && c < 8) cols[c] = Math.max(cols[c] ?? 0, Math.round(top * 10) / 10);
    }
  }
  const av = state?.v?.[side] as number[] | undefined;
  const ax = av ? av[0] : side === 0 ? lay.av.x : SLW - lay.av.x, ay = av ? av[1] : lay.av.y;
  const fell = ay > PLAT_Y + 40 || (side === 0 ? ax > PLAT_X + 40 : ax < SLW - PLAT_X - 40);
  const cover = alive.filter((b) => b.y < ay && Math.abs(b.x - ax) < b.w / 2 + AV_R * 0.8).length;
  return {
    blocks: `${alive.length}/${n}`,
    types: Object.entries(counts).map(([t, c]) => SL_TYPE_NAME[t] + c).join(" "),
    col_heights: Array.from({ length: Math.max(0, ...Object.keys(cols).map(Number)) + 1 }, (_, i) => cols[i] ?? 0),
    avatar: fell ? "已经掉下去" : cover ? `被${cover}块盖着，不容易打到` : "头顶没有遮挡，暴露",
    ...(frozen ? { frozen } : {}),
  };
}

function slingDetail(g: Row, asker: string, names: Names): Row {
  const A = label(g.player_a, asker, names), B = label(g.player_b, asker, names);
  const out: Row = {
    game: "sling", id: g.id, left_A: A, right_B: B, score: `${A} ${g.score_a} : ${g.score_b} ${B}`, win_at: 3, round: g.round_no,
    status: g.status, winner: label(g.winner, asker, names),
  };
  if (g.status !== "active") return out;
  const lay = slLayoutA(Number(g.seed));
  const st = g.state && typeof g.state === "object" ? g.state : null;
  const moverIsA = g.next_player === g.player_a;
  const wind = Number(g.wind) || 0;
  out.turn = label(g.next_player, asker, names);
  out.wind = wind + (wind === 0 ? "" : (wind > 0) === moverIsA ? "（顺风，把球往前送）" : "（逆风，要多加力或抬高）");
  out.ammo = "胡萝卜(重，砸坏方块)、雪球(冻住方块，之后更易碎)、辣椒(碰到就爆炸)；不限量，每发自选";
  out.fortress_A = slFortress(0, lay, st);
  out.fortress_B = slFortress(1, lay, st);
  out.note = "打倒对方头像(掉下平台)赢一局；先赢3局赢；列高度单位=一块方块";
  return out;
}

// ---------- 台球（移植自 pool-sim.js）----------
const PW = 340, PH = 600, BR = 10.5;
const FOOT = { x: PW / 2, y: 170 }, HEAD = { x: PW / 2, y: 450 };
const POCKETS = [
  { x: -4, y: -4 }, { x: PW + 4, y: -4 }, { x: -7, y: PH / 2 }, { x: PW + 7, y: PH / 2 }, { x: -4, y: PH + 4 }, { x: PW + 4, y: PH + 4 },
];
const POCKET_NAME = ["左上", "右上", "左中", "右中", "左下", "右下"];
function poolRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}
type Ball = [number, number, number];
function rack9(seed: number): Ball[] {
  const rnd = poolRng(seed);
  const gx = 2 * BR + 0.02, gy = Math.sqrt(3) * (BR + 0.01);
  const pos: { x: number; y: number }[] = [], rows = [1, 2, 3, 2, 1];
  for (let row = 0; row < 5; row++) for (let k = 0; k < rows[row]; k++) pos.push({ x: FOOT.x + (k - (rows[row] - 1) / 2) * gx, y: FOOT.y - row * gy });
  const rest = [2, 3, 4, 5, 6, 7, 8];
  for (let i = rest.length - 1; i > 0; i--) { const j = rnd() % (i + 1); const t = rest[i]; rest[i] = rest[j]; rest[j] = t; }
  const ids = [1, rest[0], rest[1], rest[2], 9, rest[3], rest[4], rest[5], rest[6]];
  const out: Ball[] = [[0, HEAD.x, HEAD.y]];
  for (let i = 0; i < 9; i++) out.push([ids[i], pos[i].x, pos[i].y]);
  return out;
}
function rack8(seed: number): Ball[] {
  const rnd = poolRng(seed);
  const gx = 2 * BR + 0.02, gy = Math.sqrt(3) * (BR + 0.01);
  const pos: { x: number; y: number }[] = [];
  for (let row = 0; row < 5; row++) for (let k = 0; k <= row; k++) pos.push({ x: FOOT.x + (k - row / 2) * gx, y: FOOT.y - row * gy });
  const solids = [1, 2, 3, 4, 5, 6, 7], stripes = [9, 10, 11, 12, 13, 14, 15];
  const s1 = solids.splice(rnd() % 7, 1)[0], s2 = stripes.splice(rnd() % 7, 1)[0];
  const c10 = rnd() % 2 === 0 ? s1 : s2, c14 = c10 === s1 ? s2 : s1;
  const rest = solids.concat(stripes);
  for (let i = rest.length - 1; i > 0; i--) { const j = rnd() % (i + 1); const t = rest[i]; rest[i] = rest[j]; rest[j] = t; }
  const ids: number[] = [];
  let r = 0;
  for (let i = 0; i < 15; i++) ids.push(i === 4 ? 8 : i === 10 ? c10 : i === 14 ? c14 : rest[r++]);
  const out: Ball[] = [[0, HEAD.x, HEAD.y]];
  for (let i = 0; i < 15; i++) out.push([ids[i], pos[i].x, pos[i].y]);
  return out;
}
export const poolGroupOf = (id: number): "solid" | "stripe" | null => (id >= 1 && id <= 7 ? "solid" : id >= 9 && id <= 15 ? "stripe" : null);
export function poolTargets8(balls: Ball[], group: string | null, brk: boolean): number[] {
  const out: number[] = [];
  for (const b of balls) {
    const id = b[0];
    if (id === 0) continue;
    if (brk) out.push(id);
    else if (!group) { if (id !== 8) out.push(id); }
    else if (poolGroupOf(id) === group) out.push(id);
  }
  if (group && !brk && !out.length && balls.some((b) => b[0] === 8)) out.push(8);
  return out;
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// 对每个目标球：挑「切球角最小、没被挡」的袋口。粗略估计，不是物理模拟。
// 切球角 = 白球打向「幽灵球位置」的方向，和目标球到袋口方向的夹角；0 度 = 白球、目标球、袋口三点一线。
export function poolHelper(balls: Ball[], targets: number[]): Row[] {
  const cue = balls.find((b) => b[0] === 0);
  if (!cue) return [];
  const out: (Row & { _s: number })[] = [];
  for (const id of targets) {
    const t = balls.find((b) => b[0] === id);
    if (!t) continue;
    let best: (Row & { _s: number }) | null = null;
    POCKETS.forEach((p, pi) => {
      const ux = p.x - t[1], uy = p.y - t[2], ul = Math.hypot(ux, uy);
      if (ul < 1) return;
      const gx = t[1] - (ux / ul) * 2 * BR, gy = t[2] - (uy / ul) * 2 * BR;
      const vx = gx - cue[1], vy = gy - cue[2], vl = Math.hypot(vx, vy);
      if (vl < 1) return;
      const cut = Math.acos(Math.max(-1, Math.min(1, (vx * ux + vy * uy) / (vl * ul)))) * 180 / Math.PI;
      const blockers: number[] = [];
      for (const o of balls) {
        if (o[0] === 0 || o[0] === id) continue;
        if (distToSeg(o[1], o[2], cue[1], cue[2], gx, gy) < 2 * BR || distToSeg(o[1], o[2], t[1], t[2], p.x, p.y) < 2 * BR) blockers.push(o[0]);
      }
      const total = vl + ul;
      const s = cut + (blockers.length ? 1000 : 0) + (cut > 85 ? 500 : 0) + total / 1000;
      if (!best || s < best._s) {
        best = {
          _s: s, ball: id, pocket: POCKET_NAME[pi], cut_deg: Math.round(cut), dist_cue: Math.round(vl + 2 * BR), dist_pocket: Math.round(ul),
          blocked_by: blockers.length ? blockers : undefined,
          level: cut > 85 ? "几乎打不进" : blockers.length ? "被挡" : cut + total / 20 < 25 ? "容易" : cut + total / 20 < 50 ? "一般" : cut + total / 20 < 75 ? "较难" : "很难",
        };
      }
    });
    if (best) out.push(best);
  }
  out.sort((a, b) => a._s - b._s);
  return out.slice(0, 4).map(({ _s, ...rest }) => rest);
}

function poolDetail(g: Row, asker: string, names: Names): Row {
  const eight = g.mode === "eight";
  const A = label(g.player_a, asker, names), B = label(g.player_b, asker, names);
  const out: Row = {
    game: eight ? "pool8" : "pool9", id: g.id, mode: eight ? "8球(休闲，不叫袋)" : "9球", A, B, score: `${A} ${g.score_a} : ${g.score_b} ${B}`, rack: g.rack_no,
    status: g.status, winner: label(g.winner, asker, names),
  };
  if (g.status !== "active") return out;
  const arr: Ball[] | null = Array.isArray(g.state?.b) ? (g.state.b as Ball[]) : null;
  const brk = !arr;
  const balls: Ball[] = arr ?? (eight ? rack8(Number(g.seed)) : rack9(Number(g.seed)));
  const hasCue = balls.some((b) => b[0] === 0);
  const moverIsA = g.next_player === g.player_a;
  out.turn = label(g.next_player, asker, names);
  out.break_shot = brk;
  out.in_hand = !!g.in_hand || !hasCue; // 白球在手：可以把白球放在台面任意合法位置
  out.last_foul = g.last_foul ?? null;
  out.foul_note = "scratch=白球落袋 wrong=先碰错球 none=没碰到球 rail=没进球也没球碰库";
  let targets: number[];
  if (eight) {
    const gA: string | null = g.group_a ?? null, gB = gA === "solid" ? "stripe" : gA === "stripe" ? "solid" : null;
    const left = (grp: string | null) => (grp ? balls.filter((b) => poolGroupOf(b[0]) === grp).length : null);
    out.groups = { [A as string]: gA ?? "未定", [B as string]: gB ?? "未定", note: "solid=1到7全色 stripe=9到15花色，8号最后打" };
    out.left = { [A as string]: left(gA), [B as string]: left(gB) };
    const mg = moverIsA ? gA : gB;
    targets = poolTargets8(balls, mg, brk);
    out.legal_first_contact = brk ? "开球，随便碰" : !mg ? "未分组：除8号外任何球" : targets.length === 1 && targets[0] === 8 ? [8] : targets;
  } else {
    const low = balls.filter((b) => b[0] > 0).reduce((m, b) => Math.min(m, b[0]), 99);
    targets = low === 99 ? [] : [low];
    out.legal_first_contact = targets;
  }
  out.table = `${PW}x${PH}，球半径${BR}；x向右，y向下(0在上方)；白球开球位置(${HEAD.x},${HEAD.y})`;
  out.balls = balls.map((b) => [b[0], Math.round(b[1]), Math.round(b[2])]);
  out.pockets = POCKETS.map((p, i) => `${POCKET_NAME[i]}(${p.x},${p.y})`);
  if (hasCue && targets.length && !brk) {
    out.helper_rough = poolHelper(balls, targets);
    out.helper_note = "粗略几何估计：cut_deg=切球角(0=三点一线,越大越难)，只看直线和球半径，没算库边弹射和力度";
  }
  return out;
}

// ---------- 对外 ----------
function shrink(o: Row): string {
  let s = JSON.stringify(o);
  if (s.length <= STATUS_MAX_CHARS) return s;
  delete o.helper_note; delete o.foul_note; delete o.ammo;
  s = JSON.stringify(o);
  if (s.length <= STATUS_MAX_CHARS) return s;
  delete o.helper_rough;
  s = JSON.stringify(o);
  if (s.length <= STATUS_MAX_CHARS) return s;
  delete o.pockets; delete o.table;
  return JSON.stringify(o);
}

export async function gameStatus(admin: Db, asker: string, peer: string, names: Names, args: Row): Promise<string> {
  const game = args.game;
  const hasId = args.id !== undefined && args.id !== null;
  if (game !== undefined && game !== null && !KINDS.includes(game as Kind)) return JSON.stringify({ error: "bad_game", allowed: KINDS });
  if (hasId && (!Number.isSafeInteger(args.id) || (args.id as number) <= 0)) return JSON.stringify({ error: "bad_id" });
  if (hasId && !game) return JSON.stringify({ error: "game_required_with_id" });

  if (!game) {
    const lines: string[] = [];
    for (const k of KINDS) {
      const t = TABLE[k];
      const { data, error } = await admin.from(t.table).select(t.cols.replace(/,state/, "")).or(pairFilter(k, asker, peer)).order("id", { ascending: false }).limit(8);
      if (error) return JSON.stringify({ error: "status_failed" });
      const rows = (data ?? []) as Row[];
      const picked = [...rows.filter((r) => r.status === "active"), ...rows.filter((r) => r.status !== "active")].slice(0, LIST_PER_KIND);
      for (const r of picked) lines.push(oneLine(k, r, asker, names));
    }
    return JSON.stringify({ games: lines.length ? lines : "这两个人还没有玩过小游戏", hint: "要看细节用 game_status 带上 game 和 id" });
  }

  const k = game as Kind, t = TABLE[k];
  let q = admin.from(t.table).select(t.cols).or(pairFilter(k, asker, peer));
  if (hasId) q = q.eq("id", args.id);
  else q = q.order("id", { ascending: false }).limit(8);
  const { data, error } = await q;
  if (error) return JSON.stringify({ error: "status_failed" });
  let rows = (data ?? []) as Row[];
  if (hasId) rows = rows.filter((r) => r.id === args.id && [r[t.a], r[t.b]].every((u) => u === asker || u === peer));
  else rows = [...rows.filter((r) => r.status === "active"), ...rows.filter((r) => r.status !== "active")];
  const g = rows[0];
  if (!g) return JSON.stringify({ error: hasId ? "game_not_found" : "no_game" });
  const detail = k === "ttt" ? tttDetail(g, asker, names) : k === "sling" ? slingDetail(g, asker, names) : poolDetail(g, asker, names);
  return shrink(detail);
}

// 这两个人的战绩：每人的总胜负 + 两人之间的交手。只返回这两个人，不带任何别的好友（SQL 函数 agent_game_record 保证）
export async function gameRecord(admin: Db, asker: string, peer: string, names: Names, args: Row): Promise<string> {
  const game = args.game;
  if (typeof game !== "string" || !BOARD_GAMES.includes(game)) return JSON.stringify({ error: "bad_game", allowed: BOARD_GAMES });
  const { data, error } = await admin.rpc("agent_game_record", { p_a: asker, p_b: peer, p_game: game });
  if (error) return JSON.stringify({ error: "record_failed" });
  const r = (Array.isArray(data) ? data[0] : data) as Row | null;
  if (!r) return JSON.stringify({ error: "record_failed" });
  const a = names[asker] ?? "好友", b = names[peer] ?? "好友";
  return JSON.stringify({
    game,
    totals: { [a]: `${r.a_wins}胜${r.a_losses}负`, [b]: `${r.b_wins}胜${r.b_losses}负` },
    head_to_head: `${a} ${r.a_h2h} : ${r.b_h2h} ${b}`,
    note: game === "ttt" ? "平局不算" : game === "sling" ? "按整场算" : "按盘算",
  });
}
