// 9球 / 8球台球的物理和规则（纯计算，不碰 DOM）
//
// 跨设备一致性：这里只用 + - × ÷ 和 Math.sqrt（IEEE 754 要求结果完全一致），
// 不用 sin / cos / atan2 / pow / exp 等（不同 JS 引擎的实现可能差最后一位）。
// 随机数只用整数运算（Math.imul、位运算）。出杆输入 = 归一化后取整的方向向量 + 取整的力度，
// 同样的输入 + 同样的起始状态 = 任何设备上逐位相同的结果。

// 台面（球心可以到达的区域外沿 = 库边内沿），单位是"点"，竖屏：宽 PW、高 PH
export var PW = 340;
export var PH = 600;
export var BR = 10.5; // 球半径
export var FOOT = { x: PW / 2, y: 170 }; // 置球点（1 号球）
export var HEAD = { x: PW / 2, y: 450 }; // 开球时的白球位置

var DT = 1 / 240; // 每个子步 1/240 秒
export var SUB = 4; // 每个 tick（1/60 秒）4 个子步
var VMAX = 1500; // 力度 1 的出杆速度（点/秒）
var ROLL_A = 120; // 滚动摩擦：恒定减速
var ROLL_K = 0.28; // 滚动摩擦：和速度成正比的部分（1/秒）
var VSTOP = 5; // 低于这个速度就停下
var E_BALL = 0.96; // 球和球的弹性
var E_WALL = 0.82; // 库边的弹性
var E_POST = 0.62; // 袋口库角的弹性
export var MAX_TICKS = 60 * 30; // 一杆最多模拟 30 秒（实际远用不到）

// 袋口：capture = 球心进入这个圆就落袋；posts = 袋口两侧库角的小圆柱（让球能在袋口弹跳）
var POST_R = 2.2;
var MC = 28; // 角袋：库边从角落退开的距离
var MS = 21; // 边袋：库边在中线两侧退开的距离
export var POCKETS = [
  { x: -4, y: -4, r: 19.5 }, { x: PW + 4, y: -4, r: 19.5 },
  { x: -7, y: PH / 2, r: 17 }, { x: PW + 7, y: PH / 2, r: 17 },
  { x: -4, y: PH + 4, r: 19.5 }, { x: PW + 4, y: PH + 4, r: 19.5 }
];
var POSTS = [
  [0, MC], [MC, 0], [PW, MC], [PW - MC, 0], [0, PH - MC], [MC, PH], [PW, PH - MC], [PW - MC, PH],
  [0, PH / 2 - MS], [0, PH / 2 + MS], [PW, PH / 2 - MS], [PW, PH / 2 + MS]
];

// ---- 整数随机数（mulberry32）----
export function poolRng(seed) {
  var s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0; // 0 .. 2^32-1 的整数
  };
}

// 摆球：1 在顶、9 在正中，2-8 用种子洗牌放在其余 7 个位置。返回球数组（含白球 id 0）：[{id, x, y}]
export function poolRack(seed) {
  var rnd = poolRng(seed);
  var gx = 2 * BR + 0.02, gy = Math.sqrt(3) * (BR + 0.01);
  // 菱形：1-2-3-2-1 五排，顶点（1 号）在置球点，往远离白球的方向（y 变小）排
  var pos = [], row, k, rows = [1, 2, 3, 2, 1];
  for (row = 0; row < 5; row++) {
    for (k = 0; k < rows[row]; k++) pos.push({ x: FOOT.x + (k - (rows[row] - 1) / 2) * gx, y: FOOT.y - row * gy });
  }
  var rest = [2, 3, 4, 5, 6, 7, 8], i, j, t;
  for (i = rest.length - 1; i > 0; i--) { j = rnd() % (i + 1); t = rest[i]; rest[i] = rest[j]; rest[j] = t; }
  var ids = [1, rest[0], rest[1], rest[2], 9, rest[3], rest[4], rest[5], rest[6]]; // pos 的顺序：0 | 1 2 | 3 4 5 | 6 7 | 8
  var out = [{ id: 0, x: HEAD.x, y: HEAD.y }];
  for (i = 0; i < 9; i++) out.push({ id: ids[i], x: pos[i].x, y: pos[i].y });
  return out;
}

// 8球摆球：15 个球摆三角形（顶点 1 排在置球点），8 号在第 3 排正中，后排两个角一个全色一个花色，其余的用种子洗牌。
// 全色 1-7，花色 9-15。返回球数组（含白球 id 0）
export function poolRack8(seed) {
  var rnd = poolRng(seed);
  var gx = 2 * BR + 0.02, gy = Math.sqrt(3) * (BR + 0.01);
  var pos = [], row, k, i, j, t;
  for (row = 0; row < 5; row++) {
    for (k = 0; k <= row; k++) pos.push({ x: FOOT.x + (k - row / 2) * gx, y: FOOT.y - row * gy });
  }
  // pos 的顺序：0 | 1 2 | 3 4 5 | 6 7 8 9 | 10 11 12 13 14；8 号 = 4（第 3 排正中），后排两角 = 10 和 14
  var solids = [1, 2, 3, 4, 5, 6, 7], stripes = [9, 10, 11, 12, 13, 14, 15];
  var s1 = solids.splice(rnd() % 7, 1)[0], s2 = stripes.splice(rnd() % 7, 1)[0];
  var c10 = rnd() % 2 === 0 ? s1 : s2, c14 = c10 === s1 ? s2 : s1;
  var rest = solids.concat(stripes);
  for (i = rest.length - 1; i > 0; i--) { j = rnd() % (i + 1); t = rest[i]; rest[i] = rest[j]; rest[j] = t; }
  var ids = [], r = 0;
  for (i = 0; i < 15; i++) {
    if (i === 4) ids.push(8);
    else if (i === 10) ids.push(c10);
    else if (i === 14) ids.push(c14);
    else ids.push(rest[r++]);
  }
  var out = [{ id: 0, x: HEAD.x, y: HEAD.y }];
  for (i = 0; i < 15; i++) out.push({ id: ids[i], x: pos[i].x, y: pos[i].y });
  return out;
}

// 出杆输入：方向取整到 1e-6、力度取整到 1e-3。UI 算好后存进数据库，两边的模拟都从这里开始
export function poolInput(vx, vy, power) {
  var len = Math.sqrt(vx * vx + vy * vy);
  if (!(len > 0)) return null;
  var dx = Math.round(vx / len * 1e6) / 1e6, dy = Math.round(vy / len * 1e6) / 1e6;
  var p = Math.round(Math.max(0.02, Math.min(1, power)) * 1000) / 1000;
  return { dx: dx, dy: dy, power: p };
}

function r3(v) { return Math.round(v * 1000) / 1000; }

// ---- 模拟 ----
// balls: [{id, x, y}]（在台面上的球；id 0 = 白球）
export function PoolSim(balls) {
  this.b = [];
  for (var i = 0; i < balls.length; i++) {
    this.b.push({ id: balls[i].id, x: balls[i].x, y: balls[i].y, vx: 0, vy: 0, on: true, pi: -1, px: 0, py: 0 });
  }
  this.first = null; // 白球第一个碰到的球
  this.rail = false; // 白球碰到目标球之后，有没有球碰库
  this.potted = []; // 落袋的球（按顺序，含白球）
  this.ev = []; // 给动画用的事件：{t:'hit'|'rail'|'pocket', ...}
  this.ticks = 0;
  this.failsafe = 0;
}
PoolSim.prototype.ball = function (id) {
  for (var i = 0; i < this.b.length; i++) if (this.b[i].id === id) return this.b[i];
  return null;
};
PoolSim.prototype.shoot = function (dx, dy, power) {
  var c = this.ball(0);
  if (!c || !c.on) return false;
  c.vx = dx * power * VMAX; c.vy = dy * power * VMAX;
  return true;
};
PoolSim.prototype.moving = function () {
  for (var i = 0; i < this.b.length; i++) if (this.b[i].on && (this.b[i].vx !== 0 || this.b[i].vy !== 0)) return true;
  return false;
};
PoolSim.prototype.pocket = function (b, pi) {
  b.on = false; b.pi = pi; b.px = b.x; b.py = b.y; b.vx = 0; b.vy = 0;
  this.potted.push(b.id);
  this.ev.push({ t: 'pocket', id: b.id, p: pi, x: b.px, y: b.py });
};
PoolSim.prototype.nearPocket = function (a) {
  var bk = 0, bd = 1e18, k, q;
  for (k = 0; k < 6; k++) { q = (a.x - POCKETS[k].x) * (a.x - POCKETS[k].x) + (a.y - POCKETS[k].y) * (a.y - POCKETS[k].y); if (q < bd) { bd = q; bk = k; } }
  return bk;
};
PoolSim.prototype.railHit = function (b, v) {
  if (this.first !== null) this.rail = true;
  if (v > 25) this.ev.push({ t: 'rail', id: b.id, s: v, x: b.x, y: b.y });
};
PoolSim.prototype.sub = function () {
  var bs = this.b, n = bs.length, i, j, a, c;
  // 摩擦 + 移动
  for (i = 0; i < n; i++) {
    a = bs[i];
    if (!a.on) continue;
    var sp = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
    if (sp === 0) continue;
    var ns = sp - (ROLL_A + ROLL_K * sp) * DT;
    if (ns < VSTOP) {
      a.vx = 0; a.vy = 0;
      // 停在袋口的坡上（球心已越过库边线）：掉进最近的袋，不让球停在库外
      if (a.x < BR - 0.001 || a.x > PW - BR + 0.001 || a.y < BR - 0.001 || a.y > PH - BR + 0.001) this.pocket(a, this.nearPocket(a));
      continue;
    }
    var f = ns / sp;
    a.vx *= f; a.vy *= f;
    a.x += a.vx * DT; a.y += a.vy * DT;
  }
  // 球和球（按编号顺序成对处理，顺序固定）
  var D = 2 * BR, D2 = D * D;
  for (i = 0; i < n; i++) {
    a = bs[i];
    if (!a.on) continue;
    for (j = i + 1; j < n; j++) {
      c = bs[j];
      if (!c.on) continue;
      var dx = c.x - a.x, dy = c.y - a.y, d2 = dx * dx + dy * dy;
      if (d2 >= D2) continue;
      var d = Math.sqrt(d2), nx, ny;
      if (d < 1e-9) { nx = 1; ny = 0; d = 0; } else { nx = dx / d; ny = dy / d; }
      var vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
      var corr = (D - d) / 2;
      a.x -= nx * corr; a.y -= ny * corr; c.x += nx * corr; c.y += ny * corr;
      if (vn < 0) {
        var imp = -(1 + E_BALL) * vn / 2;
        a.vx -= imp * nx; a.vy -= imp * ny; c.vx += imp * nx; c.vy += imp * ny;
        if (this.first === null && (a.id === 0 || c.id === 0)) this.first = a.id === 0 ? c.id : a.id;
        this.ev.push({ t: 'hit', a: a.id, b: c.id, s: -vn, x: a.x + nx * BR, y: a.y + ny * BR });
      }
    }
  }
  // 袋口 / 库角 / 库边
  var lo = BR, hx = PW - BR, hy = PH - BR, mid = PH / 2;
  for (i = 0; i < n; i++) {
    a = bs[i];
    if (!a.on) continue;
    var k, p, hit = false;
    for (k = 0; k < 6; k++) {
      p = POCKETS[k];
      var qx = a.x - p.x, qy = a.y - p.y;
      if (qx * qx + qy * qy < p.r * p.r) { this.pocket(a, k); hit = true; break; }
    }
    if (hit) continue;
    for (k = 0; k < 12; k++) {
      var ex = a.x - POSTS[k][0], ey = a.y - POSTS[k][1], e2 = ex * ex + ey * ey, rr = BR + POST_R;
      if (e2 >= rr * rr) continue;
      var ed = Math.sqrt(e2), mx, my;
      if (ed < 1e-9) { mx = 0; my = 1; ed = 0; } else { mx = ex / ed; my = ey / ed; }
      a.x += mx * (rr - ed); a.y += my * (rr - ed);
      var evn = a.vx * mx + a.vy * my;
      if (evn < 0) { a.vx -= (1 + E_POST) * evn * mx; a.vy -= (1 + E_POST) * evn * my; this.railHit(a, -evn); }
    }
    // 左右库：只在两个袋口之间有库边（袋口范围内球可以滑进去）
    var inSide = a.y > MC && a.y < PH - MC && !(a.y > mid - MS && a.y < mid + MS);
    if (inSide) {
      if (a.x < lo) { a.x = lo; if (a.vx < 0) { this.railHit(a, -a.vx); a.vx = -a.vx * E_WALL; a.vy *= 0.985; } }
      else if (a.x > hx) { a.x = hx; if (a.vx > 0) { this.railHit(a, a.vx); a.vx = -a.vx * E_WALL; a.vy *= 0.985; } }
    }
    var inEnd = a.x > MC && a.x < PW - MC;
    if (inEnd) {
      if (a.y < lo) { a.y = lo; if (a.vy < 0) { this.railHit(a, -a.vy); a.vy = -a.vy * E_WALL; a.vx *= 0.985; } }
      else if (a.y > hy) { a.y = hy; if (a.vy > 0) { this.railHit(a, a.vy); a.vy = -a.vy * E_WALL; a.vx *= 0.985; } }
    }
    // 保险：理论上不会出界；万一出了（极端撞击），算落进最近的袋，不让球飞出桌外
    if (a.x < -BR * 2 || a.x > PW + BR * 2 || a.y < -BR * 2 || a.y > PH + BR * 2) {
      this.failsafe++;
      this.pocket(a, this.nearPocket(a));
    }
  }
};
PoolSim.prototype.tick = function () {
  for (var s = 0; s < SUB; s++) this.sub();
  this.ticks++;
  return this.moving() && this.ticks < MAX_TICKS;
};
// 一口气打完。返回 {first, rail, potted}
PoolSim.prototype.run = function () {
  while (this.tick()) { /* 继续 */ }
  this.settle();
  return this.result();
};
// 到时间上限还在动的球强制停下
PoolSim.prototype.settle = function () {
  for (var i = 0; i < this.b.length; i++) { this.b[i].vx = 0; this.b[i].vy = 0; }
};
PoolSim.prototype.result = function () {
  return { first: this.first, rail: this.rail, potted: this.potted.slice() };
};
// 落定后的快照：[[id, x, y], ...]，只含台面上的球，坐标取到 0.001（存进数据库的就是这个）
PoolSim.prototype.snapshot = function () {
  var out = [];
  for (var i = 0; i < this.b.length; i++) if (this.b[i].on) out.push([this.b[i].id, r3(this.b[i].x), r3(this.b[i].y)]);
  return out;
};
export function poolFromState(arr) {
  var o = [];
  for (var i = 0; i < arr.length; i++) o.push({ id: arr[i][0], x: arr[i][1], y: arr[i][2] });
  return o;
}

// ---- 规则 ----
// 台面上编号最小的球（不含白球）
export function poolLowest(state) {
  var m = 99;
  for (var i = 0; i < state.length; i++) if (state[i][0] > 0 && state[i][0] < m) m = state[i][0];
  return m === 99 ? null : m;
}
// 9 号球被放回置球点（沿长轴往白球方向找最近的空位）
export function poolRespot(state) {
  for (var y = FOOT.y; y <= PH - BR; y += 1) {
    var ok = true;
    for (var i = 0; i < state.length; i++) {
      var dx = state[i][1] - FOOT.x, dy = state[i][2] - y;
      if (dx * dx + dy * dy < 4 * BR * BR) { ok = false; break; }
    }
    if (ok) return [FOOT.x, y];
  }
  return [FOOT.x, FOOT.y];
}
// 判一杆：lowest = 出杆前台面上最小的球；res = sim.result()；after = 落定后的快照
// 返回 { foul: null|'scratch'|'wrong'|'none'|'rail', objs: 进袋的目标球, win, keep, state: 下一手的台面快照（犯规时没有白球 = 自由球） }
export function poolJudge(lowest, res, after) {
  var potted = res.potted, objs = [], scratch = false, i;
  for (i = 0; i < potted.length; i++) { if (potted[i] === 0) scratch = true; else objs.push(potted[i]); }
  var foul = null;
  if (scratch) foul = 'scratch';
  else if (res.first === null) foul = 'none';
  else if (res.first !== lowest) foul = 'wrong';
  else if (!objs.length && !res.rail) foul = 'rail';
  var nine = objs.indexOf(9) >= 0, win = nine && !foul;
  var state = after.slice();
  if (foul) {
    state = state.filter(function (b) { return b[0] !== 0; }); // 对手自由球：白球拿起来
    if (nine) state.push([9].concat(poolRespot(state)));
  }
  return { foul: foul, objs: objs, win: win, keep: !foul && !win && objs.length > 0, state: state };
}
// ---- 8球规则（休闲版，不叫袋）----
// 球组：全色 1-7，花色 9-15，8 号单独
export function poolGroupOf(id) { return id >= 1 && id <= 7 ? 'solid' : id >= 9 && id <= 15 ? 'stripe' : null; }
export function poolOtherGroup(g) { return g === 'solid' ? 'stripe' : g === 'stripe' ? 'solid' : null; }
// 台面上（state 里）某个球组还剩几个球
export function poolGroupLeft(state, group) {
  var n = 0;
  for (var i = 0; i < state.length; i++) if (poolGroupOf(state[i][0]) === group) n++;
  return n;
}
// 这一杆第一个碰到的球可以是哪些：{ all: true, no8: bool } 或 { ids: [...] }。
// 开球：随便碰；没分组：除 8 号外都行；已分组：自己的球组，清空之后才是 8 号
export function poolTargets8(state, group, brk) {
  var out = [], i, id;
  for (i = 0; i < state.length; i++) {
    id = state[i][0];
    if (id === 0) continue;
    if (brk) out.push(id);
    else if (!group) { if (id !== 8) out.push(id); }
    else if (poolGroupOf(id) === group) out.push(id);
  }
  if (group && !brk && !out.length) for (i = 0; i < state.length; i++) if (state[i][0] === 8) out.push(8);
  return out;
}
// 判一杆（8球）。info = { pre: 出杆前的台面快照, group: 出杆方已有的球组或 null, brk: 是不是开球 }
// res = sim.result()；after = 落定后的快照
// 返回 { foul, objs, group: 这一杆新定下的出杆方球组或 null, win, lose, keep, early: 8 号提前落袋（没犯规）, respot8: 开球 8 号放回, state }
//  - 开球：只有白球落袋 / 没碰到球算犯规；不分组、不判输赢；8 号落袋放回置球点
//  - 没分组：第一个碰的球不能是 8 号；已分组：必须先碰自己的球组（清空后才是 8 号）；
//    没有球进袋也没有球碰库 = 犯规；白球落袋 = 犯规
//  - 合法进球（没分组：任何非 8 号球；已分组：自己的球组）继续出杆；没分组时第一个落袋的球定下球组
//  - 打进 8 号（非开球）：出杆前自己的球组已经清空且没犯规 = 赢；其余（提前、或犯规）= 输
export function poolJudge8(info, res, after) {
  var potted = res.potted, objs = [], scratch = false, i, id;
  for (i = 0; i < potted.length; i++) { if (potted[i] === 0) scratch = true; else objs.push(potted[i]); }
  var group = info.group || null, brk = !!info.brk, pre = info.pre;
  var foul = null;
  if (scratch) foul = 'scratch';
  else if (res.first === null) foul = 'none';
  else if (!brk) {
    if (!group ? res.first === 8 : (poolGroupOf(res.first) !== group && !(res.first === 8 && poolGroupLeft(pre, group) === 0))) foul = 'wrong';
    else if (!objs.length && !res.rail) foul = 'rail';
  }
  var eight = objs.indexOf(8) >= 0;
  var win = false, lose = false, early = false, respot8 = false;
  if (eight && !brk) {
    win = !foul && !!group && poolGroupLeft(pre, group) === 0;
    lose = !win;
    early = lose && !foul;
  } else if (eight && brk) respot8 = true;
  var assign = null, keep = false;
  if (!foul && !win && !lose) {
    if (!group) {
      for (i = 0; i < objs.length; i++) {
        id = objs[i];
        if (id === 8) continue;
        if (!brk && !assign) assign = poolGroupOf(id); // 开球不分组
        keep = true;
      }
    } else for (i = 0; i < objs.length; i++) if (poolGroupOf(objs[i]) === group) keep = true;
  }
  var state = after.slice();
  if (foul) state = state.filter(function (b) { return b[0] !== 0; }); // 对手自由球：白球拿起来
  if (respot8) state.push([8].concat(poolRespot(state)));
  return { foul: foul, objs: objs, group: assign, win: win, lose: lose, keep: keep, early: early, respot8: respot8, state: state };
}
// 自由球 / 摆白球：位置合法吗（在台内、不压球、不在袋口附近）
export function poolCueOk(state, x, y) {
  if (x < BR || x > PW - BR || y < BR || y > PH - BR) return false;
  var i, k;
  for (i = 0; i < state.length; i++) {
    if (state[i][0] === 0) continue;
    var dx = state[i][1] - x, dy = state[i][2] - y;
    if (dx * dx + dy * dy < 4 * BR * BR) return false;
  }
  for (k = 0; k < 6; k++) {
    var qx = x - POCKETS[k].x, qy = y - POCKETS[k].y, r = POCKETS[k].r + BR * 0.5;
    if (qx * qx + qy * qy < r * r) return false;
  }
  return true;
}
// 找离 (x, y) 最近的合法摆球位置（拖动时用；螺旋向外找）
export function poolCueNear(state, x, y) {
  if (poolCueOk(state, x, y)) return [x, y];
  var best = null, bd = 1e18, st = 2;
  for (var ox = -60; ox <= 60; ox += st) {
    for (var oy = -60; oy <= 60; oy += st) {
      var d = ox * ox + oy * oy;
      if (d < bd && poolCueOk(state, x + ox, y + oy)) { bd = d; best = [x + ox, y + oy]; }
    }
  }
  return best;
}
