// 自动生成，不要手改：来源 chat/js/miniapps/fxq-rules.js，由 supabase/functions/fxq/gen-rules.py 生成
// 飞行棋规则引擎：浏览器（高亮可走的飞机、回放动画）和服务器（唯一裁判）共用，服务器那份是 supabase/functions/fxq/gen-rules.py 复制出来的 rules.gen.js。
// 纯函数，不碰 DOM、不碰网络；随机数（骰子）从参数传入。
//
// ===== 规则（标准中国飞行棋，2 到 4 人）=====
// 座位 = 颜色：0 红、1 黄、2 蓝、3 绿（座位不压紧，空座位就是没人）。每人 4 架飞机，开局都在机库里。
// 主环 52 格，编号 0..51 顺时针，格子的颜色按 编号 % 4 轮流：红 黄 蓝 绿 红 黄 蓝 绿 ……
// 每种颜色的起飞格（出机库后落的格）是 13 * 座位：红 0、黄 13、蓝 26、绿 39。
// 用「相对步数」r 描述一架飞机（只看自己的路程）：
//   r = -1      在机库里
//   r = 0       在自己的起飞格
//   r = 1..45   在主环上，对应的环格编号 = (13 * 座位 + r) % 52（走 46 格后拐进自己的停机坪入口）
//   r = 46..51  自己的 6 格停机坪（别人进不来，不会被撞）
//   r = 52      终点（中心），到家
// 规则：
//   1. 掷到 6 才能起飞：机库里的飞机落到起飞格（r = 0）。起飞不触发跳 / 飞。
//   2. 掷到 6 再掷一次；连续第三次掷到 6，这一轮作废（不走，换下一家）。
//   3. 掷到几就走几格。没有任何飞机能动（比如全在机库里又没掷到 6）就自动过。只有一种走法就自动走。
//   4. 落点（走完点数之后）如果是自己颜色的格子（r 是 4 的倍数，r = 4..40）：跳到下一个自己颜色的格子（r + 4），一次移动只跳一次。
//      r = 44 再跳就进停机坪了，所以只有 r + 4 <= 45 才跳。
//   5. 每种颜色有一个「飞」格：r = 16，飞到 r = 28（环上往前 12 格，棋盘上画成一条绕过拐角的虚线）。
//      直接落在 r = 16 就飞；落在 r = 12 先跳到 r = 16 再接着飞（跳一次之后可以再飞）。飞完不再跳。
//   6. 最终落点上如果有别家的飞机（环上，不管几架），全部被撞回各自的机库。自己的飞机可以叠在一起。停机坪里没有人能撞。
//   7. 走过 r = 45 之后进自己的停机坪，到 r = 52 终点必须刚好；点数多出来的部分折回去（r = 51 掷 3：先到 52，再退 2，停在 50）。
//   8. 先让 4 架飞机都到家的人赢，对局到此结束；其他人按进度排名（到家的飞机数多的在前，再比所有飞机走过的格数）。
// 机器人：能撞就撞 > 到家 > 起飞 > 落在飞 / 跳的格子 > 挪走最危险的那架（后面 6 格内有别家的飞机）> 走得最远的那架。

export var FXQ_RULES_VERSION = 1;
export var LOOP = 52;
export var LAST_LOOP = 45; // 主环上的最后一格（r）
export var CENTRE = 52;
export var FLY_FROM = 16;
export var FLY_TO = 28;
export var JUMP = 4;
export var PLANES = 4;

export function nodeOf(seat, r) { return (13 * seat + r) % LOOP; }
export function onLoop(r) { return r >= 0 && r <= LAST_LOOP; }

// 开一局：seats 是 4 个布尔（哪几个座位有人）；first 是先手座位（必须是有人的座位）
export function newGame(opts) {
  var seats = opts.seats, order = [], planes = [], i;
  for (i = 0; i < 4; i++) {
    if (seats[i]) { order.push(i); planes.push([-1, -1, -1, -1]); } else planes.push(null);
  }
  var first = opts.first;
  if (order.indexOf(first) < 0) first = order[0];
  return { v: FXQ_RULES_VERSION, n: order.length, order: order, planes: planes, turn: first, first: first, roll: null, sixes: 0, phase: 'playing', winner: null, rank: null, seq: 0, last: null };
}
function clone(st) { return JSON.parse(JSON.stringify(st)); }
function nextSeat(st, seat) { var i = st.order.indexOf(seat); return st.order[(i + 1) % st.order.length]; }

export function homeCount(st, seat) {
  var c = 0, ps = st.planes[seat];
  for (var i = 0; i < PLANES; i++) if (ps[i] === CENTRE) c++;
  return c;
}
export function progress(st, seat) {
  var s = 0, ps = st.planes[seat];
  for (var i = 0; i < PLANES; i++) s += ps[i] + 1;
  return s;
}
// 名次：赢家第一，其他人按到家数、进度、座位排
export function ranking(st) {
  var list = st.order.slice();
  list.sort(function (a, b) {
    if (st.winner === a) return -1;
    if (st.winner === b) return 1;
    return homeCount(st, b) - homeCount(st, a) || progress(st, b) - progress(st, a) || a - b;
  });
  return list;
}

// 这架飞机掷 roll 能不能动
export function canMove(r, roll) {
  if (r === -1) return roll === 6;
  return r >= 0 && r < CENTRE;
}
// 这个座位掷 roll 之后的所有走法；站在同一格的飞机走法一样，只列一个（机库里的飞机也只列一个）
export function legalMoves(st, seat, roll) {
  var ps = st.planes[seat], out = [], seen = {};
  if (!ps) return out;
  for (var i = 0; i < PLANES; i++) {
    var r = ps[i];
    if (!canMove(r, roll) || seen[r]) continue;
    seen[r] = 1;
    out.push({ plane: i, takeoff: r === -1 });
  }
  return out;
}

// 模拟走一步（不改状态）：返回 { plane, from, to（终点格 r）, path（逐格经过的 r）, jump（跳到的 r 或 null）, fly（飞到的 r 或 null）, cap（被撞的 [座位, 飞机]）, takeoff, home }
export function simulate(st, seat, plane, roll) {
  var r = st.planes[seat][plane], path = [], jump = null, fly = null, to, i, pos;
  var res = { plane: plane, from: r, to: 0, path: path, jump: null, fly: null, cap: [], takeoff: r === -1, home: false };
  if (r === -1) {
    path.push(0);
    to = 0;
  } else {
    for (i = 1; i <= roll; i++) {
      pos = r + i;
      if (pos > CENTRE) pos = 2 * CENTRE - pos;
      path.push(pos);
    }
    to = path[path.length - 1];
    if (to > 0 && to <= LAST_LOOP) {
      if (to === FLY_FROM) fly = FLY_TO;
      else if (to % JUMP === 0 && to + JUMP <= LAST_LOOP) {
        jump = to + JUMP;
        if (jump === FLY_FROM) fly = FLY_TO;
      }
    }
  }
  var fin = fly !== null ? fly : jump !== null ? jump : to;
  res.jump = jump; res.fly = fly; res.to = fin;
  res.home = fin === CENTRE;
  if (onLoop(fin)) {
    var node = nodeOf(seat, fin);
    for (var k = 0; k < st.order.length; k++) {
      var s = st.order[k];
      if (s === seat) continue;
      for (var j = 0; j < PLANES; j++) {
        var rj = st.planes[s][j];
        if (onLoop(rj) && nodeOf(s, rj) === node) res.cap.push([s, j]);
      }
    }
  }
  return res;
}

// 后面 6 格内有几架别家的飞机追得上这架（机库里的飞机在这格是别人起飞格时也算一架）
export function danger(st, seat, r) {
  if (!onLoop(r)) return 0;
  var node = nodeOf(seat, r), n = 0;
  for (var k = 0; k < st.order.length; k++) {
    var s = st.order[k];
    if (s === seat) continue;
    var hangar = false;
    for (var j = 0; j < PLANES; j++) {
      var rj = st.planes[s][j];
      if (rj === -1) hangar = true;
      else if (onLoop(rj)) {
        var d = (node - nodeOf(s, rj) + LOOP) % LOOP;
        if (d >= 1 && d <= 6) n++;
      }
    }
    if (hangar && node === nodeOf(s, 0)) n++;
  }
  return n;
}

// 机器人选哪架：能撞就撞 > 到家 > 起飞 > 落在飞 / 跳的格子 > 挪走最危险的 > 走得最远的
export function botPick(st, seat, roll) {
  var moves = legalMoves(st, seat, roll), best = null, bestScore = -1e9;
  for (var i = 0; i < moves.length; i++) {
    var p = moves[i].plane, sim = simulate(st, seat, p, roll), score = 0, k;
    if (sim.cap.length) {
      score += 10000 * sim.cap.length;
      for (k = 0; k < sim.cap.length; k++) score += st.planes[sim.cap[k][0]][sim.cap[k][1]];
    }
    if (sim.home) score += 5000;
    if (sim.takeoff) score += 3000;
    if (sim.fly !== null) score += 2000;
    else if (sim.jump !== null) score += 1500;
    var dNow = sim.takeoff ? 0 : danger(st, seat, sim.from);
    score += 100 * dNow;
    if (onLoop(sim.to)) {
      var after = clone(st);
      after.planes[seat][p] = sim.to;
      score -= 60 * danger(after, seat, sim.to);
    }
    score += sim.from + 1;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}
export function botAction(st, seat) {
  if (st.roll === null || st.roll === undefined) return { kind: 'roll' };
  return { kind: 'move', plane: botPick(st, seat, st.roll) };
}

function event(st, e) { e.s = ++st.seq; return e; }

// 走一步：改 st（已经是副本），返回事件；之后按点数决定换人还是再掷
function doMove(st, seat, plane, roll, events) {
  var sim = simulate(st, seat, plane, roll);
  st.planes[seat][plane] = sim.to;
  for (var i = 0; i < sim.cap.length; i++) st.planes[sim.cap[i][0]][sim.cap[i][1]] = -1;
  events.push(event(st, { k: 'move', seat: seat, plane: plane, v: roll, from: sim.from, path: sim.path, jump: sim.jump, fly: sim.fly, to: sim.to, cap: sim.cap, takeoff: sim.takeoff, home: sim.home }));
  st.roll = null;
  if (homeCount(st, seat) === PLANES) {
    st.phase = 'over'; st.winner = seat; st.rank = ranking(st);
    return;
  }
  if (roll === 6) return; // 掷到 6：同一个人再掷一次（sixes 留着）
  st.turn = nextSeat(st, seat); st.sixes = 0;
}
function endTurn(st, seat, why, v, events) {
  events.push(event(st, { k: 'pass', seat: seat, why: why, v: v }));
  st.roll = null; st.sixes = 0; st.turn = nextSeat(st, seat);
}

// 动作：{ kind: 'roll' } 掷骰子；{ kind: 'move', plane } 选一架飞机走（掷完之后有不止一种走法时才需要）
// 返回 { ok: true, state, events } 或 { ok: false, error }
export function apply(state, seat, action, rng) {
  if (state.phase !== 'playing') return { ok: false, error: 'game_over' };
  if (state.turn !== seat) return { ok: false, error: 'not_your_turn' };
  var st = clone(state), events = [];
  if (!action || (action.kind !== 'roll' && action.kind !== 'move')) return { ok: false, error: 'bad_action' };
  if (action.kind === 'roll') {
    if (st.roll !== null) return { ok: false, error: 'pick_a_plane' };
    var v = 1 + Math.floor(rng() * 6);
    if (v > 6) v = 6;
    events.push(event(st, { k: 'roll', seat: seat, v: v }));
    if (v === 6) st.sixes++;
    if (st.sixes >= 3) { endTurn(st, seat, 'sixes', v, events); return { ok: true, state: st, events: events }; }
    var moves = legalMoves(st, seat, v);
    if (moves.length === 0) { endTurn(st, seat, 'none', v, events); return { ok: true, state: st, events: events }; }
    if (moves.length === 1) { doMove(st, seat, moves[0].plane, v, events); return { ok: true, state: st, events: events }; }
    st.roll = v;
    return { ok: true, state: st, events: events };
  }
  if (st.roll === null) return { ok: false, error: 'roll_first' };
  var p = action.plane;
  if (!Number.isInteger(p) || p < 0 || p >= PLANES) return { ok: false, error: 'bad_plane' };
  if (!canMove(st.planes[seat][p], st.roll)) return { ok: false, error: 'bad_plane' };
  doMove(st, seat, p, st.roll, events);
  return { ok: true, state: st, events: events };
}
