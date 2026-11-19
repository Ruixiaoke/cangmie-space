// 飞行棋牌桌界面：大厅 / 棋盘 / 骰子 / 逐格动画 / 倒计时 / 结算（数据和网络在 fxq.js，规则在 fxq-rules.js）
//
// 服务器给的是「最近的事件」（pub.log：掷骰子 / 走棋 / 过）：这里把新增的事件一条一条回放（逐格移动、跳、飞、撞），
// 界面上显示的是回放出来的状态 D，回放完再和服务器的最终状态对齐。隔得太久（事件缺了一段）就直接跳到最终状态。
// 棋盘是一块 0..100 的方形坐标系：外圈 52 格（每边 13 格），四个角是机库，每边中间向里是各自的 6 格停机坪，中心是终点。

import { CENTRE, FLY_FROM, FLY_TO, canMove, homeCount, progress, ranking } from './fxq-rules.js';
import { errText } from '../errors.js';
import { S, makeAvatar } from '../state.js';
import { clear, h, toast } from '../utils.js';
import { openLeaderboard, rankButton } from './leaderboard.js';

export var COLORS = [
  { name: '红', img: 'fxq/plane-red.png' },
  { name: '黄', img: 'fxq/plane-yellow.png' },
  { name: '蓝', img: 'fxq/plane-blue.png' },
  { name: '绿', img: 'fxq/plane-green.png' }
];
var TURN_TOTAL = 15; // 和服务器一致，只用来画倒计时
var STEP_MS = 150, ROLL_MS = 520, JUMP_MS = 380, FLY_MS = 700, HIT_MS = 520;
var NS = 'http://www.w3.org/2000/svg';
var PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

export function botName(bots, seat) {
  var n = 0;
  for (var i = 0; i <= seat; i++) if (bots[i]) n++;
  return '机器人' + n;
}
function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
function svg(tag, attrs) {
  var el = document.createElementNS(NS, tag);
  for (var k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

// ===== 棋盘几何（0..100）=====
var SP = 80 / 13;
function nodeXY(i) {
  var k = Math.floor(i / 13), t = (i % 13 + 0.5) * SP;
  return k === 0 ? [10 + t, 10] : k === 1 ? [90, 10 + t] : k === 2 ? [90 - t, 90] : [10, 90 - t];
}
function entryOf(seat) { return (13 * seat + 45) % 52; }
function armDir(seat) { // 从中心指向这个颜色停机坪入口的单位向量
  var p = nodeXY(entryOf(seat));
  return [(p[0] - 50) / 40, (p[1] - 50) / 40];
}
function stretchXY(seat, k) {
  var p = nodeXY(entryOf(seat)), u = armDir(seat), d = 40 / 7 * k;
  return [p[0] - u[0] * d, p[1] - u[1] * d];
}
var HANGAR = [[27, 27], [73, 27], [73, 73], [27, 73]];
function hangarXY(seat, i) { return [HANGAR[seat][0] + (i % 2 ? 6 : -6), HANGAR[seat][1] + (i < 2 ? -6 : 6)]; }
function centreXY(seat, i) {
  var a = armDir(seat), px = -a[1], py = a[0];
  return [50 + a[0] * 4.6 + px * (i - 1.5) * 3, 50 + a[1] * 4.6 + py * (i - 1.5) * 3];
}
function spotXY(seat, r, i) {
  if (r < 0) return hangarXY(seat, i);
  if (r <= 45) return nodeXY((13 * seat + r) % 52);
  if (r < CENTRE) return stretchXY(seat, r - 45);
  return centreXY(seat, i);
}
function angOf(dx, dy) { return Math.atan2(dx, -dy) * 180 / Math.PI; }
function headingAt(seat, r) {
  if (r < 0) { var a = nodeXY(13 * seat), hp = HANGAR[seat]; return angOf(a[0] - hp[0], a[1] - hp[1]); }
  if (r >= CENTRE) return 0;
  if (r > 44) { var u = armDir(seat); return angOf(-u[0], -u[1]); }
  var p = nodeXY((13 * seat + r) % 52), q = nodeXY((13 * seat + r + 1) % 52);
  return angOf(q[0] - p[0], q[1] - p[1]);
}

function boardSvg() {
  var s = svg('svg', { viewBox: '0 0 100 100', class: 'fq-svg', 'aria-hidden': 'true', focusable: 'false' });
  s.appendChild(svg('rect', { x: 1, y: 1, width: 98, height: 98, rx: 7, class: 'fq-bg' }));
  var c, i, k, p;
  for (c = 0; c < 4; c++) {
    s.appendChild(svg('rect', { x: HANGAR[c][0] - 13, y: HANGAR[c][1] - 13, width: 26, height: 26, rx: 5, class: 'fq-hg c' + c }));
    for (i = 0; i < 4; i++) { p = hangarXY(c, i); s.appendChild(svg('circle', { cx: p[0], cy: p[1], r: 4.4, class: 'fq-slot' })); }
  }
  for (c = 0; c < 4; c++) { // 中心：四块三角，对着各自的停机坪
    var a = armDir(c), px = -a[1], py = a[0];
    s.appendChild(svg('polygon', { points: '50,50 ' + (50 + a[0] * 7 + px * 7) + ',' + (50 + a[1] * 7 + py * 7) + ' ' + (50 + a[0] * 7 - px * 7) + ',' + (50 + a[1] * 7 - py * 7), class: 'fq-ct c' + c }));
  }
  for (c = 0; c < 4; c++) for (k = 1; k <= 6; k++) {
    p = stretchXY(c, k);
    s.appendChild(svg('rect', { x: p[0] - 2.5, y: p[1] - 2.5, width: 5, height: 5, rx: 1.2, class: 'fq-st c' + c }));
  }
  for (i = 0; i < 52; i++) { // 外圈：颜色 = 编号 % 4
    p = nodeXY(i);
    s.appendChild(svg('circle', { cx: p[0], cy: p[1], r: 2.8, class: 'fq-sq c' + (i % 4) }));
  }
  for (c = 0; c < 4; c++) { // 起飞格
    p = nodeXY(13 * c);
    s.appendChild(svg('circle', { cx: p[0], cy: p[1], r: 3.6, class: 'fq-start c' + c }));
  }
  for (c = 0; c < 4; c++) { // 飞格：一条绕过拐角的虚线飞到落点
    var A = nodeXY((13 * c + FLY_FROM) % 52), B = nodeXY((13 * c + FLY_TO) % 52);
    var mx = (A[0] + B[0]) / 2 - 50, my = (A[1] + B[1]) / 2 - 50, ml = Math.sqrt(mx * mx + my * my) || 1;
    var cx = (A[0] + B[0]) / 2 + mx / ml * 7, cy = (A[1] + B[1]) / 2 + my / ml * 7;
    s.appendChild(svg('path', { d: 'M' + A[0] + ' ' + A[1] + ' Q' + cx + ' ' + cy + ' ' + B[0] + ' ' + B[1], class: 'fq-fly c' + c }));
    var tx = B[0] - cx, ty = B[1] - cy, tl = Math.sqrt(tx * tx + ty * ty) || 1;
    tx /= tl; ty /= tl;
    s.appendChild(svg('polygon', { points: (B[0] + tx * 1.5) + ',' + (B[1] + ty * 1.5) + ' ' + (B[0] - tx * 3 - ty * 2.4) + ',' + (B[1] - ty * 3 + tx * 2.4) + ' ' + (B[0] - tx * 3 + ty * 2.4) + ',' + (B[1] - ty * 3 - tx * 2.4), class: 'fq-arrow c' + c }));
    s.appendChild(svg('circle', { cx: A[0], cy: A[1], r: 3.5, class: 'fq-fly-from c' + c }));
    var t = svg('text', { x: A[0], y: A[1] + 1.5, class: 'fq-fly-t', 'text-anchor': 'middle' });
    t.textContent = '飞';
    s.appendChild(t);
  }
  return s;
}

function newD(pub) {
  return { round: pub.round, seq: pub.seq, planes: JSON.parse(JSON.stringify(pub.planes)), turn: pub.turn, roll: pub.roll, die: pub.roll, note: '' };
}

// host: { person(id), scores(), act(body), sit(seat), stand(), setBot(seat, on), start(), rematch(), leave(), refreshScores(), dm }
export function createTable(box, host) {
  var T = { g: null, D: null, queue: [], qseq: 0, playing: false, ui: 0, busy: false, dead: false, sheet: false, sheetRound: -1, sheetHidden: false, tickV: -1, tickAt: 0, mode: '', els: null, rolling: false, noteTm: 0, hint: false };
  var root = h('div', { class: 'fxq' });
  box.appendChild(root);

  function mySeat() { var x = T.g; return x && S.me ? x.seats.indexOf(S.me.id) : -1; }
  function live() { var x = T.g; return !!x && x.status === 'playing'; }
  function nameOfSeat(s) {
    var x = T.g;
    if (x.seats[s]) { var p = host.person(x.seats[s]); return p ? p.nickname : '好友'; }
    if (x.bots[s]) return botName(x.bots, s);
    return '空位';
  }
  function avatarOfSeat(s, size) {
    var x = T.g;
    if (x.seats[s] && !x.bots[s]) return makeAvatar(host.person(x.seats[s]), size);
    var b = h('div', { class: 'avatar fq-bot', style: 'width:' + size + 'px;height:' + size + 'px' }, h('span', { text: '机' }));
    return b;
  }
  function idle() { return !T.queue.length && !T.playing; }
  function myTurn() { var x = T.g, D = T.D; return live() && idle() && D && mySeat() >= 0 && D.turn === mySeat() && !x.auto[mySeat()]; }

  // ----- 回放 -----
  function feed(initial) {
    var x = T.g, pub = x && x.pub;
    if (!pub || !pub.planes || (x.status !== 'playing' && x.status !== 'over')) { T.D = null; T.queue = []; T.qseq = 0; T.mode = ''; render(); return; }
    var D = T.D;
    var evs = (pub.log || []).filter(function (e) { return e.s > T.qseq; });
    var gap = D && pub.seq > T.qseq && (!evs.length || evs[0].s !== T.qseq + 1);
    if (!D || D.round !== pub.round || pub.seq < T.qseq || gap || initial) {
      D = T.D = newD(pub); T.queue = []; T.qseq = pub.seq; T.sheet = false; T.sheetRound = -1; T.sheetHidden = false;
      if (T.mode === 'table') { placeAll(); updateUi(); } else render();
      afterReplay(true);
      return;
    }
    T.queue = T.queue.concat(evs); T.qseq = pub.seq;
    if (T.mode !== 'table') render();
    pump();
  }
  async function pump() {
    if (T.playing || T.dead) return;
    T.playing = true;
    while (T.queue.length && !T.dead) {
      var e = T.queue.shift();
      try { await play(e); } catch (err) { /* 动画出错不影响对局 */ }
      T.D.seq = e.s;
    }
    T.playing = false;
    if (T.dead) return;
    settle();
    afterReplay(false);
  }
  function settle() { // 回放完：和服务器的最终状态对齐
    var pub = T.g.pub, D = T.D;
    D.planes = JSON.parse(JSON.stringify(pub.planes)); D.turn = pub.turn; D.roll = pub.roll; D.seq = pub.seq;
    if (pub.roll !== null && pub.roll !== undefined) D.die = pub.roll;
    placeAll(); updateUi();
  }
  function afterReplay(instant) {
    var x = T.g;
    if (!x || x.status !== 'over' || !x.pub || T.sheetRound === x.pub.round) return;
    T.sheetRound = x.pub.round;
    var go = function () { if (T.dead) return; T.sheet = true; T.sheetHidden = false; host.refreshScores(); render(); };
    if (instant) go(); else setTimeout(go, 900);
  }
  function note(text, ms) {
    T.D.note = text; updateUi();
    clearTimeout(T.noteTm);
    T.noteTm = setTimeout(function () { if (T.D) { T.D.note = ''; updateUi(); } }, ms || 1600);
  }
  async function play(e) {
    var D = T.D, pl = D.planes;
    if (e.k === 'roll') {
      D.die = e.v; D.roll = null;
      await rollDie(e.v, e.seat);
    } else if (e.k === 'pass') {
      note(e.why === 'sixes' ? '连着三个 6，这轮作废' : '没有能走的飞机', 1200);
      await sleep(900);
    } else if (e.k === 'move') {
      var seat = e.seat, i = e.plane;
      if (e.takeoff) { note('起飞'); pl[seat][i] = 0; placeOne(seat, i); await sleep(STEP_MS * 2); }
      else {
        for (var q = 0; q < e.path.length; q++) { pl[seat][i] = e.path[q]; placeOne(seat, i); await sleep(STEP_MS); }
        if (e.jump !== null && e.jump !== undefined) { note('跳'); await sleep(120); pl[seat][i] = e.jump; placeOne(seat, i, 'jump'); await sleep(JUMP_MS); }
        if (e.fly !== null && e.fly !== undefined) { note('飞'); await sleep(120); pl[seat][i] = e.fly; placeOne(seat, i, 'fly'); await sleep(FLY_MS); }
        if (e.home) note('到家了', 1400);
      }
      if (e.cap && e.cap.length) {
        note('撞回了 ' + nameOfSeat(e.cap[0][0]) + ' 的飞机', 1700);
        e.cap.forEach(function (c) { var el = T.els.pl[c[0]][c[1]]; if (el) el.classList.add('hit'); });
        await sleep(HIT_MS);
        e.cap.forEach(function (c) { pl[c[0]][c[1]] = -1; var el = T.els.pl[c[0]][c[1]]; if (el) el.classList.remove('hit'); placeOne(c[0], c[1]); });
        await sleep(300);
      }
      pl[seat][i] = e.to; placeAll();
      D.turn = e.seat; updateUi();
    }
  }
  async function rollDie(v, seat) {
    T.rolling = true;
    T.D.die = null; T.D.rollSeat = seat; updateUi();
    var t0 = Date.now();
    while (Date.now() - t0 < ROLL_MS && !T.dead) { T.D.face = 1 + Math.floor(Math.random() * 6); updateUi(); await sleep(70); }
    T.rolling = false; T.D.face = null; T.D.die = v; updateUi();
    await sleep(380);
  }

  // ----- 棋盘（只建一次，之后只更新飞机位置和状态）-----
  function render() {
    if (T.dead) return;
    var x = T.g;
    clear(root);
    T.els = null; T.mode = '';
    root.classList.toggle('lobby', !x || x.status === 'waiting' || x.status === 'closed');
    if (!x) { root.appendChild(h('div', { class: 'fxq-loading', text: '载入中…' })); return; }
    if (x.status === 'waiting' || x.status === 'closed') { renderLobby(); return; }
    if (!T.D) { root.appendChild(h('div', { class: 'fxq-loading', text: '载入中…' })); return; }
    renderTable();
    if (T.sheet && x.status === 'over') renderSheet();
    else if (x.status === 'over' && T.sheetHidden && idle()) {
      var again = h('button', { type: 'button', class: 'btn small fxq-reopen', text: '看结果' });
      again.addEventListener('click', function () { T.sheet = true; T.sheetHidden = false; render(); });
      root.appendChild(again);
    }
  }
  function renderTable() {
    var x = T.g, pub = x.pub;
    T.mode = 'table';
    var els = T.els = { chips: {}, pl: [[], [], [], []], die: null, status: null, pips: null };
    var strip = h('div', { class: 'fxq-strip' });
    pub.order.forEach(function (s) {
      var chip = h('div', { class: 'fxq-chip c' + s, 'data-seat': s });
      var av = h('div', { class: 'fxq-av' }, avatarOfSeat(s, 30));
      var sec = h('span', { class: 'fxq-sec', hidden: true });
      av.appendChild(sec);
      var nm = h('b', { text: s === mySeat() ? '我' : nameOfSeat(s) });
      var pips = h('div', { class: 'fxq-home' });
      for (var k = 0; k < 4; k++) pips.appendChild(h('i'));
      chip.appendChild(av); chip.appendChild(nm); chip.appendChild(pips);
      chip.appendChild(h('span', { class: 'fxq-tag', hidden: true, text: '托管' }));
      els.chips[s] = { el: chip, sec: sec, pips: pips, tag: chip.lastChild };
      strip.appendChild(chip);
    });
    root.appendChild(strip);

    var wrap = h('div', { class: 'fxq-boardwrap' });
    var board = els.board = h('div', { class: 'fxq-board' });
    board.appendChild(boardSvg());
    var layer = els.layer = h('div', { class: 'fxq-planes' });
    pub.order.forEach(function (s) {
      for (var i = 0; i < 4; i++) {
        var el = h('button', { type: 'button', class: 'fxq-pl c' + s, 'data-s': s, 'data-i': i, 'aria-label': COLORS[s].name + '色飞机' });
        var im = h('img', { src: COLORS[s].img, alt: '', draggable: 'false' });
        im.addEventListener('error', function (ev) { ev.target.parentNode.classList.add('fb'); });
        el.appendChild(im);
        el.appendChild(h('span', { class: 'fxq-cnt', hidden: true }));
        el.addEventListener('click', onPlane);
        el._ang = headingAt(s, -1);
        els.pl[s][i] = el;
        layer.appendChild(el);
      }
    });
    board.appendChild(layer);
    wrap.appendChild(board);
    root.appendChild(wrap);

    var bar = h('div', { class: 'fxq-bar' });
    var die = els.die = h('button', { type: 'button', class: 'fxq-die', 'aria-label': '掷骰子' });
    for (var p = 0; p < 9; p++) die.appendChild(h('i'));
    die.addEventListener('click', onRoll);
    els.status = h('div', { class: 'fxq-status' });
    els.sub = h('div', { class: 'fxq-sub' });
    var txt = h('div', { class: 'fxq-stxt' }, els.status, els.sub);
    var side = h('div', { class: 'fxq-side' });
    els.auto = h('button', { type: 'button', class: 'btn small ghost fxq-auto', text: '取消托管', hidden: true });
    els.auto.addEventListener('click', function () { doAct({ action: 'auto_off' }); });
    side.appendChild(els.auto);
    side.appendChild(rankButton('fxq', 'fxq-rk'));
    bar.appendChild(die); bar.appendChild(txt); bar.appendChild(side);
    root.appendChild(bar);
    sizeBoard();
    placeAll(true);
    updateUi();
  }
  function sizeBoard() {
    if (!T.els) return;
    var W = root.clientWidth || 360, H = root.clientHeight || 520;
    var bs = Math.max(200, Math.min(W - 12, H - 58 - 96));
    T.els.board.style.setProperty('--bs', bs + 'px');
  }
  function placeOne(seat, i, how) {
    if (!T.els || !T.D) return;
    var el = T.els.pl[seat][i], r = T.D.planes[seat][i];
    if (!el) return;
    var p = spotXY(seat, r, i), ang = headingAt(seat, r);
    var d = ((ang - el._ang) % 360 + 540) % 360 - 180;
    el._ang += d;
    el.style.left = p[0] + '%'; el.style.top = p[1] + '%';
    el.style.setProperty('--rot', el._ang.toFixed(1) + 'deg');
    el.classList.remove('jump', 'fly');
    if (how) { void el.offsetWidth; el.classList.add(how); }
    el.classList.toggle('home', r === CENTRE);
    el.classList.toggle('inhangar', r < 0);
    restack();
  }
  function placeAll(noAnim) {
    if (!T.els || !T.D) return;
    var els = T.els;
    if (noAnim) els.layer.classList.add('noanim');
    T.g.pub.order.forEach(function (s) { for (var i = 0; i < 4; i++) placeOne(s, i); });
    if (noAnim) { void els.layer.offsetWidth; els.layer.classList.remove('noanim'); }
  }
  // 同一个人的几架飞机叠在同一格：只显示编号最小的那架，上面标张数
  function restack() {
    if (!T.els || !T.D) return;
    T.g.pub.order.forEach(function (s) {
      var groups = {}, pl = T.D.planes[s], i;
      for (i = 0; i < 4; i++) { var r = pl[i]; if (r < 0 || r >= CENTRE) { var el0 = T.els.pl[s][i]; el0.classList.remove('stackhide'); el0.querySelector('.fxq-cnt').hidden = true; continue; } (groups[r] = groups[r] || []).push(i); }
      Object.keys(groups).forEach(function (r) {
        groups[r].forEach(function (i2, n) {
          var el = T.els.pl[s][i2], cnt = el.querySelector('.fxq-cnt');
          el.classList.toggle('stackhide', n > 0);
          cnt.hidden = !(n === 0 && groups[r].length > 1);
          cnt.textContent = '×' + groups[r].length;
        });
      });
    });
  }

  // ----- 状态 / 骰子 / 高亮 -----
  function movable() { // 现在可以点的飞机：{ seat -> [plane] }
    var D = T.D, m = mySeat(), out = {};
    if (!myTurn() || D.roll === null || D.roll === undefined || D.roll === 0) return out;
    out[m] = [];
    for (var i = 0; i < 4; i++) {
      var r = D.planes[m][i];
      if (!canMove(r, D.roll)) continue;
      if (T.els.pl[m][i].classList.contains('stackhide')) continue;
      out[m].push(i);
    }
    return out;
  }
  function updateUi() {
    var x = T.g, D = T.D, els = T.els;
    if (T.dead || !x || !D || !els) return;
    var pub = x.pub, m = mySeat(), over = x.status === 'over';
    pub.order.forEach(function (s) {
      var c = els.chips[s], hc = over ? pub.winner === s : false;
      c.el.classList.toggle('turn', !over && D.turn === s && idle());
      c.el.classList.toggle('win', hc);
      var n = homeCount({ planes: D.planes }, s);
      Array.prototype.forEach.call(c.pips.children, function (p, k) { p.classList.toggle('on', k < n); });
      c.tag.hidden = !(x.auto[s] && !x.bots[s] && !over);
    });
    // 骰子
    var die = els.die, face = T.rolling ? D.face : D.die, who = T.rolling ? D.rollSeat : D.turn;
    die.className = 'fxq-die c' + (who === undefined || who === null ? 0 : who) + (T.rolling ? ' rolling' : '') + (myTurn() && (D.roll === null || D.roll === undefined) ? ' ready' : '');
    Array.prototype.forEach.call(die.children, function (p, k) { p.classList.toggle('on', !!face && PIPS[face].indexOf(k) >= 0); });
    die.disabled = !(myTurn() && (D.roll === null || D.roll === undefined) && !T.busy);
    // 飞机高亮
    var mv = movable();
    pub.order.forEach(function (s) {
      for (var i = 0; i < 4; i++) {
        var el = els.pl[s][i], on = !!(mv[s] && mv[s].indexOf(i) >= 0);
        el.classList.toggle('can', on);
        el.disabled = !on;
      }
    });
    // 文案
    var st = '', sub = D.note || '';
    var who = function (q) { return q === m ? '你' : nameOfSeat(q); };
    if (over) st = pub.winner === m ? '你赢了' : nameOfSeat(pub.winner) + ' 赢了';
    else if (T.rolling) st = who(D.rollSeat) + ' 掷骰子';
    else if (!idle()) st = D.rollSeat !== undefined && D.die ? who(D.rollSeat) + ' 掷到 ' + D.die : '';
    else {
      var cur = D.turn, pick = D.roll !== null && D.roll !== undefined;
      if (m >= 0 && cur === m && x.auto[m]) st = '托管中';
      else if (m >= 0 && cur === m) st = pick ? '掷到 ' + D.roll + '，点一架飞机' : '轮到你了，点骰子';
      else st = '等 ' + nameOfSeat(cur) + (pick ? ' 选飞机' : ' 掷骰子');
    }
    els.status.textContent = st;
    els.sub.textContent = sub || (m < 0 && !over ? '旁观中' : '');
    els.auto.hidden = !(m >= 0 && x.auto[m] && !over);
    // 倒计时
    var dl = x.deadline ? Date.parse(x.deadline) : NaN;
    pub.order.forEach(function (s) { els.chips[s].sec.hidden = true; els.chips[s].el.classList.remove('urgent'); });
    if (live() && idle() && Number.isFinite(dl)) {
      var left = dl - Date.now(), cc = els.chips[D.turn];
      if (cc) {
        cc.sec.hidden = false; cc.sec.textContent = String(Math.max(0, Math.ceil(left / 1000)));
        cc.el.classList.toggle('urgent', left < 5000);
        cc.el.style.setProperty('--f', Math.max(0, Math.min(1, left / (TURN_TOTAL * 1000))).toFixed(3));
      }
    }
  }
  T.ui = setInterval(function () {
    updateUi();
    var x = T.g;
    if (T.dead || !x || !live() || !idle() || !x.deadline) return;
    // 过了截止时间：任何在看的客户端都可以催一下（带一点随机延迟，错开）；失败（还没到点 / 别人先催了）每 2 秒再试
    var left = Date.parse(x.deadline) - Date.now();
    if (left < -700 && (T.tickV !== x.version || Date.now() - T.tickAt > 2500)) {
      T.tickV = x.version; T.tickAt = Date.now() + Math.random() * 600;
      host.act({ action: 'tick' });
    }
  }, 250);

  // ----- 动作 -----
  function doAct(body) {
    if (T.busy) return;
    T.busy = true; updateUi();
    host.act(body).then(function (r) {
      T.busy = false;
      if (r && r.error) toast(errText({ message: r.error }));
      if (!T.dead) updateUi();
    });
  }
  function onRoll() { if (myTurn() && (T.D.roll === null || T.D.roll === undefined)) doAct({ action: 'roll' }); }
  function onPlane(ev) {
    var el = ev.currentTarget;
    if (!el.classList.contains('can')) return;
    doAct({ action: 'move', plane: Number(el.getAttribute('data-i')) });
  }

  // ----- 大厅 -----
  function lbtn(text, cls, fn) {
    var b = h('button', { type: 'button', class: cls, text: text });
    b.addEventListener('click', fn);
    return b;
  }
  function renderLobby() {
    var x = T.g;
    var lb = h('div', { class: 'fxq-lobby' });
    lb.appendChild(h('div', { class: 'fxq-title', text: x.status === 'closed' ? '这局已关闭' : '飞行棋' }));
    lb.appendChild(h('div', { class: 'fxq-subt', text: x.status === 'closed' ? '回到聊天，再开一局吧' : '2 到 4 人，空位可以加机器人' }));
    var sc = host.scores();
    var m = mySeat(), filled = 0, humans = 0, bots = 0;
    [0, 1, 2, 3].forEach(function (s) {
      var taken = x.seats[s] || x.bots[s];
      if (taken) filled++;
      if (x.seats[s]) humans++;
      if (x.bots[s]) bots++;
      var row = h('div', { class: 'fxq-lrow c' + s + (taken ? ' on' : '') });
      var ico = h('img', { class: 'fxq-lico', src: COLORS[s].img, alt: '', draggable: 'false' });
      ico.addEventListener('error', function () { ico.replaceWith(h('span', { class: 'fxq-lico fb', text: COLORS[s].name })); });
      row.appendChild(ico);
      row.appendChild(h('div', { class: 'fxq-lav' }, taken ? avatarOfSeat(s, 40) : h('span', { class: 'fxq-empty', text: COLORS[s].name })));
      var nm = h('div', { class: 'fxq-lnm' }, h('b', { text: taken ? nameOfSeat(s) : '空位' }));
      if (x.seats[s]) {
        var r = sc[x.seats[s]];
        nm.appendChild(h('span', { class: 'fxq-lsub', text: r ? '累计 ' + r.wins + ' 胜，' + r.games + ' 局' : '还没玩过' }));
      } else if (x.bots[s]) nm.appendChild(h('span', { class: 'fxq-lsub', text: '机器人' }));
      row.appendChild(nm);
      var ops = h('div', { class: 'fxq-lops' });
      if (x.status === 'waiting') {
        if (!taken) {
          ops.appendChild(lbtn('坐这里', 'btn small', function () { host.sit(s); }));
          if (m >= 0) ops.appendChild(lbtn('加机器人', 'btn small ghost', function () { host.setBot(s, true); }));
        } else if (x.bots[s] && m >= 0) ops.appendChild(lbtn('移除', 'btn small ghost', function () { host.setBot(s, false); }));
        else if (x.seats[s] === (S.me && S.me.id)) ops.appendChild(lbtn('站起来', 'btn small ghost', function () { host.stand(); }));
      }
      row.appendChild(ops);
      lb.appendChild(row);
    });
    if (x.status === 'waiting') {
      if (m >= 0) {
        // 按钮上写清楚会发生什么
        var label = filled < 2 ? '开始（至少要 2 人）' : '开始（' + filled + ' 人' + (bots ? '，含 ' + bots + ' 个机器人' : '') + '）';
        var st = lbtn(label, 'btn fxq-start', function () { host.start(); });
        st.disabled = filled < 2 || humans < 1;
        lb.appendChild(st);
      } else lb.appendChild(h('div', { class: 'fxq-subt', text: filled >= 4 ? '人满了，等他们开始' : '你可以坐到空位上一起玩' }));
    }
    root.appendChild(lb);
    root.appendChild(rankButton('fxq', 'fxq-rk fxq-rk-lobby'));
  }

  // ----- 结算 -----
  function renderSheet() {
    var x = T.g, pub = x.pub, me = mySeat();
    var shade = h('div', { class: 'fxq-shade' });
    var sh = h('div', { class: 'fxq-sheet', role: 'dialog', 'aria-label': '结算' });
    var iWin = me >= 0 ? pub.winner === me : null;
    sh.appendChild(h('div', { class: 'fxq-res ' + (iWin === null ? '' : iWin ? 'win' : 'lose'), text: iWin === null ? nameOfSeat(pub.winner) + ' 赢了' : iWin ? '你赢了' : nameOfSeat(pub.winner) + ' 赢了' }));
    var list = h('div', { class: 'fxq-rrows' });
    var sc = host.scores(), st = { order: pub.order, planes: pub.planes, winner: pub.winner };
    ranking(st).forEach(function (s, idx) {
      var u = x.seats[s], r = u && !x.bots[s] ? sc[u] : null;
      var row = h('div', { class: 'fxq-rrow c' + s + (s === me ? ' me' : '') });
      row.appendChild(h('span', { class: 'fxq-rank', text: String(idx + 1) }));
      row.appendChild(h('div', { class: 'fxq-rav' }, avatarOfSeat(s, 36)));
      row.appendChild(h('div', { class: 'fxq-rnm' }, h('b', { text: nameOfSeat(s) + '（' + COLORS[s].name + '）' }),
        h('span', { text: '到家 ' + homeCount(st, s) + '/4，走了 ' + progress(st, s) + ' 步' + (r ? '，累计 ' + r.wins + ' 胜' : '') })));
      list.appendChild(row);
    });
    sh.appendChild(list);
    var ops = h('div', { class: 'fxq-sheet-ops' });
    if (me >= 0) ops.appendChild(lbtn('再来一局', 'btn', function () { host.rematch(); }));
    ops.appendChild(lbtn('排行榜', 'btn ghost', function () { openLeaderboard('fxq'); }));
    ops.appendChild(lbtn('离开', 'btn ghost', function () { host.leave(); }));
    sh.appendChild(ops);
    sh.appendChild(lbtn('收起', 'fxq-peek', function () { T.sheet = false; T.sheetHidden = true; render(); }));
    shade.appendChild(sh);
    root.appendChild(shade);
  }

  return {
    update: function (game, initial) {
      var prevStatus = T.g && T.g.status;
      T.g = game;
      if (game.status === 'waiting' || game.status === 'closed') { T.D = null; T.queue = []; T.qseq = 0; T.sheet = false; render(); return; }
      var restart = prevStatus === 'waiting' || prevStatus === 'closed';
      feed(!!initial && !restart && !T.D);
    },
    setScores: function () { if (!T.dead && T.sheet) render(); else if (!T.dead && T.mode === '' && T.g && T.g.status === 'waiting') render(); },
    resize: function () { if (!T.dead) sizeBoard(); },
    destroy: function () { T.dead = true; clearTimeout(T.noteTm); clearInterval(T.ui); T.queue = []; }
  };
}
