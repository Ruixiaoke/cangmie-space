// 台球小程序（9球 / 8球）

import { errText } from '../errors.js';
import { APP, closeApp, openApp } from './host.js';
import { rankButton } from './leaderboard.js';
import { BR, HEAD, PH, POCKETS, PW, PoolSim, poolCueNear, poolFromState, poolGroupOf, poolInput, poolJudge, poolJudge8, poolLowest, poolOtherGroup, poolRack, poolRack8, poolTargets8 } from './pool-sim.js';
import { firePush } from '../notify.js';
import { tttPerson, tttRow } from './ttt.js';
import { S, makeAvatar, sb } from '../state.js';
import { popCheer } from '../mascot.js';
import { $, clear, h, isVisible, lsGet, lsSet, toast } from '../utils.js';

// ===== 9球 / 8球台球 =====
// 8球（休闲版，不叫袋）：开球不分组；开球后第一个合法进球的球组（全色 1-7 / 花色 9-15）归出杆方；之后必须先碰自己的球组（清空后才是 8 号），
// 合法进自己的球组继续出杆；打进 8 号：自己的球组已清空且没犯规 = 赢，提前打进或打 8 号时犯规 = 输。犯规同样给对手自由球。判定在 pool-sim.js 的 poolJudge8。
// 9球 规则（标准 9 球，去掉 push-out 和三次犯规判负）：每杆白球必须先碰台面上编号最小的球；合法打进任何球可以继续出杆；
// 合法打进 9 号赢下这一盘（开球、组合球都算）。犯规 = 白球落袋 / 先碰错球 / 没碰到球 / 碰球后没有球进袋也没有球碰库；
// 犯规后对手自由球（白球拿起来，拖到台面任意不压球的位置）；犯规时落袋的 9 号放回置球点。
// 物理和判定在 pool-sim.js（确定性）；出杆方的设备模拟，把输入和落定后的台面一起上传，对手重放同一杆的动画再对齐到上传的状态。
var PG = { games: {}, want: [], pend: {}, tm: 0 };
export function poolReset() { PG.games = {}; PG.want = []; PG.pend = {}; }
export function poolOf(body) {
  var m = typeof body === 'string' ? /^\[[89]球台球\]#(\d{1,15})$/.exec(body) : null;
  return m ? parseInt(m[1], 10) : null;
}
// 聊天里这条邀请是几球（邀请消息的开头就是 8球台球 / 9球台球）
export function poolName(body) { return typeof body === 'string' && body.indexOf('[8') === 0 ? '8球台球' : '9球台球'; }
var FOUL_TEXT = { scratch: '母球落袋', wrong: '没有先碰最小号球', none: '没有碰到球', rail: '没有球进袋也没有球碰库' };
var FOUL_TEXT8 = { scratch: '母球落袋', wrong: '没有先碰自己的球', none: '没有碰到球', rail: '没有球进袋也没有球碰库' };
var GNAME = { solid: '全色', stripe: '花色' };
function plEight(g) { return !!g && g.mode === 'eight'; }
function plFoulText(g, f) { return (plEight(g) ? FOUL_TEXT8 : FOUL_TEXT)[f]; }
// 排行榜里这一局算哪张榜（给 + 面板的排行榜入口用）
export function poolRankGame() {
  var g = APP.cur && APP.cur.id === 'pool' ? PG.games[APP.cur.params.id] : null;
  return plEight(g) ? 'pool8' : 'pool';
}
function plStatus(g) {
  var me = S.me.id;
  if (!g) return { t: g === null ? '对局不可用' : '载入中…', you: false };
  if (g.status === 'active') return g.next_player === me ? { t: g.in_hand ? '自由球' : '轮到你了', you: true } : { t: '等 Ta 出杆', you: false };
  if (g.status === 'resigned') return { t: g.winner === me ? 'Ta 认输了' : '你认输了', you: false };
  return { t: g.winner === me ? '你赢了这一盘' : 'Ta 赢了这一盘', you: false };
}
function plScores(g) { return g.player_a === S.me.id ? [g.score_a, g.score_b] : [g.score_b, g.score_a]; }
export function poolFillCard(el) {
  var m = el._m, id = el._gcid;
  if (!m || id == null || !S.me) return;
  var g = PG.games[id];
  var sig = id + '|' + (g ? [g.score_a, g.score_b, g.status, g.next_player, g.winner, g.in_hand, g.mode].join('|') : 'x') + '|' + S.me.id;
  if (!g && !PG.pend[id] && PG.games[id] === undefined) plQueue(id);
  if (el._gsig === sig) return;
  el._gsig = sig;
  var st = plStatus(g), sc = g ? plScores(g) : [0, 0];
  el._bubble.innerHTML = '<div class="gc-pool"><span class="gc-pball' + (plEight(g) ? ' e8' : '') + '" aria-hidden="true"></span><span class="gc-score">' + sc[0] + ':' + sc[1] + '</span></div><div class="gc-txt"><b>' + (plEight(g) ? '8球台球' : '9球台球') + '</b><span class="gc-st' + (st.you ? ' you' : '') + '">' + st.t + '</span></div>';
}
function plEachCard(fn) { if (S.chat) S.chat.nodes.forEach(function (el) { if (el._gkind === 'pool' && el._gcid != null) fn(el); }); }
function plQueue(id) {
  if (PG.pend[id]) return;
  PG.pend[id] = 1; PG.want.push(id);
  clearTimeout(PG.tm);
  PG.tm = setTimeout(plFetchGames, 0);
}
function plFetchGames() {
  var ids = PG.want.splice(0);
  if (!ids.length || !sb) return;
  sb.from('pool_games').select('*').in('id', ids).then(function (r) {
    ids.forEach(function (id) { delete PG.pend[id]; });
    if (r.error) return;
    var got = {};
    (r.data || []).forEach(function (g) { got[g.id] = 1; plPut(g); });
    ids.forEach(function (id) { if (!got[id] && !PG.games[id]) PG.games[id] = null; plEachCard(function (el) { if (el._gcid === id) poolFillCard(el); }); });
  }, function () { ids.forEach(function (id) { delete PG.pend[id]; }); });
}
export function poolResync() {
  plEachCard(function (el) { delete PG.pend[el._gcid]; plQueue(el._gcid); });
  if (APP.cur && APP.cur.id === 'pool') {
    var id = APP.cur.params.id;
    sb.from('pool_games').select('*').eq('id', id).maybeSingle().then(function (r) { if (r.data) plPut(r.data); }, function () { /* 离线 */ });
  }
}
function plPut(g) {
  g = tttRow(g);
  if (!g || g.id == null) return;
  var old = PG.games[g.id];
  if (old && Date.parse(old.updated_at) > Date.parse(g.updated_at)) return;
  PG.games[g.id] = g;
  plEachCard(function (el) { if (el._gcid === g.id) poolFillCard(el); });
  if (APP.cur && APP.cur.id === 'pool' && APP.cur.params.id === g.id) poolV.update(g);
}
function plShowing(id) { return !!(APP.cur && APP.cur.id === 'pool' && APP.cur.params.id === id && S.chat); }
export function onPoolGame(p) {
  var g = p && p.new;
  if (!g || g.id == null || !S.me) return;
  var prev = PG.games[g.id];
  plPut(g);
  if (p.eventType === 'UPDATE' && prev && g.status === 'active' && g.next_player === S.me.id && prev.turn_no !== g.turn_no && !plShowing(g.id) && isVisible()) toast('轮到你了（' + (plEight(g) ? '8球台球' : '9球台球') + '）');
}
function plStartHere(mode) {
  var c = S.chat;
  if (!c) return;
  if (APP.cur && APP.cur.id === 'pool') return;
  var peer = c.peer;
  sb.rpc('pool_start', { p_peer: peer, p_mode: mode }).then(function (r) {
    if (r.error) return toast(errText(r.error));
    var g = tttRow(r.data);
    plPut(g);
    if (g.mode !== mode && (g.mode === 'eight' || mode === 'eight')) toast('你们还有一局' + (plEight(g) ? '8球' : '9球') + '没打完');
    if (S.chat && S.chat.peer === peer) openApp('pool', { id: g.id });
  }, function (e) { toast(errText(e)); });
}

// ---- 开局前选玩法：9球 / 8球 ----
var PK = { el: null, card: null, btns: {}, keyFn: null, lastFocus: null };
var PK_MODES = [
  { id: 'nine', label: '9球', img: 'pool/mode-9.png', desc: '最小号先碰，打进 9 号赢' },
  { id: 'eight', label: '8球', img: 'pool/mode-8.png', desc: '全色花色，打进 8 号赢' }
];
export function poolLastMode() { return lsGet('pool.mode') === 'eight' ? 'eight' : 'nine'; }
function plPickBall(m) { return h('span', { class: 'pk-ball ' + m.id, 'aria-hidden': 'true' }, h('i', { text: m.id === 'eight' ? '8' : '9' })); }
function plBuildPicker(chat) {
  var el = h('div', { id: 'poolPick', hidden: true });
  el.addEventListener('click', function (ev) { if (ev.target === el) plClosePicker(); });
  var x = h('button', { type: 'button', class: 'rk-x', 'aria-label': '关闭' });
  x.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-x"/></svg>';
  x.addEventListener('click', plClosePicker);
  var row = h('div', { class: 'pk-row' });
  PK_MODES.forEach(function (m) {
    var img = h('img', { class: 'pk-img', src: m.img, alt: '', draggable: 'false' });
    var holder = h('span', { class: 'pk-ic' }, img);
    img.addEventListener('error', function () { holder.replaceChildren(plPickBall(m)); }); // 图还没生成好：退成画出来的球
    var b = h('button', { type: 'button', class: 'pk-btn', 'data-m': m.id }, holder, h('b', { text: m.label }), h('span', { class: 'pk-desc', text: m.desc }));
    b.addEventListener('click', function () { lsSet('pool.mode', m.id); plClosePicker(true); plStartHere(m.id); });
    PK.btns[m.id] = b; row.appendChild(b);
  });
  var card = h('div', { class: 'rk-card pk-card', role: 'dialog', tabindex: '-1', 'aria-modal': 'true', 'aria-label': '选择玩法' },
    h('div', { class: 'rk-head' }, h('h3', { text: '选玩法' }), x), row);
  el.appendChild(card);
  PK.card = card; PK.x = x;
  chat.appendChild(el);
  PK.el = el;
}
function plOpenPicker() {
  var chat = $('chat');
  if (!chat) return;
  if (!PK.el) plBuildPicker(chat);
  PK.lastFocus = document.activeElement;
  PK.el.hidden = false;
  void PK.el.offsetWidth;
  PK.el.classList.add('show');
  document.addEventListener('keydown', PK.keyFn = plPickKey, true);
  var last = poolLastMode();
  PK_MODES.forEach(function (m) { PK.btns[m.id].classList.toggle('last', m.id === last); });
  PK.btns[last].focus({ preventScroll: true });
}
function plClosePicker(chosen) {
  if (!PK.el || PK.el.hidden) return;
  PK.el.hidden = true;
  PK.el.classList.remove('show');
  document.removeEventListener('keydown', PK.keyFn, true);
  var f = PK.lastFocus;
  PK.lastFocus = null;
  if (!chosen && f && f.focus && document.body.contains(f)) { try { f.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ } }
}
function plPickKey(ev) {
  if (ev.key === 'Escape') { ev.stopPropagation(); plClosePicker(); return; }
  if (ev.key !== 'Tab') return;
  var order = [PK.btns.nine, PK.btns.eight, PK.x], i = order.indexOf(document.activeElement);
  var n = order[(i + (ev.shiftKey ? order.length - 1 : 1)) % order.length]; // Tab 只在浮层里转圈
  ev.preventDefault();
  n.focus({ preventScroll: true });
}

// ---- 外观常量 ----
var RAIL = 15; // 木框宽度（尽量窄，把屏幕留给球；袋口会被木框外沿裁掉一点）
var MARG = 27; // 画面上要留出的边距：袋口探出台面最多这么远，不能被裁掉
var CUSH = 9; // 库边橡胶厚度
var PULL = 52; // 球杆最多往后拉多远
var FINE = 0.0009; // 微调条：每拖 1px 转多少弧度（直接拖台面大约是它的 8 倍粗）
var NOTE_MS = 4500; // 犯规提示停留多久
var COL = ['#f8f4ea', '#f2c200', '#1f55d6', '#d62f2f', '#6c35b5', '#f08a1c', '#1c8c46', '#8a2234', '#1d1d1f', '#f2c200'];
function plDark() {
  var t = document.documentElement.getAttribute('data-theme');
  return t === 'dark' || (t !== 'light' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
function r3(v) { return Math.round(v * 1000) / 1000; }
function plSeen(id) { var v = parseInt(lsGet('pool.seen.' + id), 10); return isNaN(v) ? 0 : v; }
function plSetSeen(id, n) { if (n > plSeen(id)) lsSet('pool.seen.' + id, String(n)); }

var PL_IMG_SRC = { felt: 'pool/felt.jpg', wood: 'pool/wood.jpg', cue: 'pool/cue.png', bgDay: 'pool/bg-day.jpg', bgNight: 'pool/bg-night.jpg' };
var PLI = null;
function plLoadImages() {
  if (PLI) return;
  PLI = {};
  Object.keys(PL_IMG_SRC).forEach(function (k) {
    var im = new Image();
    im.onload = function () { im._ok = true; if (PV) { PV.cache = null; PV.dirty = true; } };
    im.src = PL_IMG_SRC[k];
    PLI[k] = im;
  });
}
var PV = null; // 当前打开的这一局的界面状态
export var poolV = {
  id: 'pool',
  label: '台球',
  strip: 'hidden',
  flush: true,
  img: 'pool/icon-pool.png',
  run: function () { if (APP.cur && APP.cur.id === 'pool') return; plOpenPicker(); },
  mount: function (box, params) {
    PV = {
      id: params.id, box: box, g: PG.games[params.id] || null, eight: plEight(PG.games[params.id]), brk: false, gs: null, gpend: null, mode: 'idle', balls: [], lowest: null, shownTurn: -1, rack: -1, up: false,
      aim: { x: 0, y: -1 }, power: 0.6, cuePos: null, cuePlaced: true, drag: null, sim: null, local: null, replay: null, delay: 0, acc: 0, fire: null,
      sinks: [], note: '', raf: 0, last: 0, dirty: true, cw: 300, ch: 300, dpr: 1, s: 1, ox: 0, oy: 0,
      persons: [null, null], hudBuilt: false, sure: false, sureTm: 0, busy: false, fetching: false, again: false, syncTok: 0,
      wasActive: false, endShown: false, hint: lsGet('pool.hint') !== '1', cache: null, dk: null, pulse: 0
    };
    var V = PV;
    plLoadImages();
    var root = h('div', { class: 'pl' });
    V.hud = h('div', { class: 'pl-hud' });
    V.cv = h('canvas', { 'aria-label': V.eight ? '8球台球' : '9球台球' });
    V.hintEl = h('div', { class: 'pl-hint', text: '拖动台面瞄准，下方滑条微调，点出杆' });
    V.hintEl.hidden = true;
    V.noteEl = h('div', { class: 'pl-note', role: 'status' });
    V.magEl = h('canvas', { class: 'pl-mag', width: 176, height: 176, 'aria-hidden': 'true' });
    V.magEl.hidden = true;
    V.stage = h('div', { class: 'pl-stage' }, V.cv, V.hintEl, V.noteEl, V.magEl);
    V.fine = h('div', { class: 'pl-fine', role: 'slider', tabindex: '0', 'aria-label': '微调瞄准（左右拖动）' }, h('span', { class: 'pl-fine-l', 'aria-hidden': 'true', text: '‹' }), h('span', { class: 'pl-fine-r', 'aria-hidden': 'true', text: '›' }));
    V.pwFill = h('div', { class: 'pl-pwf' });
    V.pwKnob = h('div', { class: 'pl-pwk' });
    V.pwTrack = h('div', { class: 'pl-pwtr' }, V.pwFill, V.pwKnob);
    V.pw = h('div', { class: 'pl-pw', role: 'slider', tabindex: '0', 'aria-label': '力度', 'aria-valuemin': '2', 'aria-valuemax': '100' }, V.pwTrack);
    V.go = h('button', { type: 'button', class: 'btn pl-go', text: '出杆' });
    V.rs = h('button', { type: 'button', class: 'btn quiet pl-rs', text: '认输' });
    V.rs.addEventListener('click', plResign);
    V.btnAgain = h('button', { type: 'button', class: 'btn pl-again', text: '再来一盘' });
    V.btnAgain.addEventListener('click', plAgain);
    V.bar = h('div', { class: 'pl-ctl' }, V.fine, V.pw, V.go, V.rs, V.btnAgain);
    root.appendChild(V.hud); root.appendChild(V.stage); root.appendChild(V.bar);
    box.appendChild(root);
    box.appendChild(rankButton(function () { return poolRankGame(); }, 'rk-fab'));
    V.ctx = V.cv.getContext('2d');
    V.ro = window.ResizeObserver ? new ResizeObserver(function () { plResize(); }) : null;
    if (V.ro) V.ro.observe(V.stage);
    plResize();
    plBindInput();
    plPower(V.power);
    if (V.g) { plPeople(); plHud(); }
    V.raf = requestAnimationFrame(plLoop);
    var id = params.id;
    sb.from('pool_games').select('*').eq('id', id).maybeSingle().then(function (r) {
      if (!PV || PV.id !== id) return;
      if (r.data) plPut(r.data);
      else if (!PV.g) { toast('找不到这局台球'); closeApp(); }
    }, function () { /* 离线：显示缓存 */ });
    if (V.g) poolV.update(V.g);
  },
  unmount: function () {
    if (PV) {
      cancelAnimationFrame(PV.raf); clearTimeout(PV.sureTm); clearTimeout(PV.celTm); clearTimeout(PV.noteTm);
      if (PV.ro) PV.ro.disconnect();
      PV.dead = true;
    }
    PV = null;
  },
  same: function (a, b) { return a.id === b.id; },
  update: function (g) {
    if (!PV) return;
    PV.g = g;
    if (PV.eight !== plEight(g)) { PV.eight = plEight(g); PV.hudBuilt = false; if (PV.cv) PV.cv.setAttribute('aria-label', PV.eight ? '8球台球' : '9球台球'); }
    if (!PV.persons[0]) plPeople();
    plSync();
    plEnded();
  }
};
function plPeople() {
  var V = PV, g = V.g;
  if (!g) return;
  [g.player_a, g.player_b].forEach(function (pid, k) { V.persons[k] = tttPerson(pid); });
  V.hudBuilt = false;
}
function plResize() {
  var V = PV;
  if (!V || !V.cv) return;
  var r = V.stage.getBoundingClientRect();
  V.dpr = Math.min(window.devicePixelRatio || 1, 2);
  V.cw = Math.max(80, Math.round(r.width)); V.ch = Math.max(80, Math.round(r.height));
  V.cv.width = Math.round(V.cw * V.dpr); V.cv.height = Math.round(V.ch * V.dpr);
  var pad = 2;
  V.s = Math.min((V.cw - pad * 2) / (PW + MARG * 2), (V.ch - pad * 2) / (PH + MARG * 2));
  V.ox = (V.cw - PW * V.s) / 2; V.oy = (V.ch - PH * V.s) / 2;
  V.cache = null; V.dirty = true;
}
// 屏幕坐标 -> 台面坐标
function plPt(ev) {
  var V = PV, r = V.cv.getBoundingClientRect();
  return { x: (ev.clientX - r.left - V.ox) / V.s, y: (ev.clientY - r.top - V.oy) / V.s };
}

// ---- 台面状态 ----
function arrOf(list) { return list.map(function (b) { return [b.id, b.x, b.y]; }); }
function plCueArr() {
  var V = PV;
  for (var i = 0; i < V.balls.length; i++) if (V.balls[i][0] === 0) return V.balls[i];
  return null;
}
function plMyBase() {
  var V = PV, g = V.g;
  return !!g && g.status === 'active' && g.next_player === S.me.id && V.mode === 'idle' && !V.up && V.shownTurn === g.turn_no && !V.fire;
}
function plPlacing() { return plMyBase() && !!PV.g.in_hand && !PV.cuePlaced; }
function plAiming() { return plMyBase() && (!PV.g.in_hand || PV.cuePlaced); }
function plBuildScene(g) {
  var V = PV;
  V.balls = g.state && g.state.b ? g.state.b.map(function (b) { return [Number(b[0]), Number(b[1]), Number(b[2])]; }) : arrOf(plRackOf(g, g.seed));
  V.rack = g.rack_no; V.shownTurn = g.turn_no; V.sim = null; V.sinks = []; V.fire = null; V.winPend = null;
  V.brk = !(g.state && g.state.b);
  V.gs = { game: g.id, rack: g.rack_no, a: plGroupA(g) };
  V.lowest = V.eight ? null : poolLowest(V.balls);
  V.cuePlaced = !g.in_hand;
  V.cuePos = null;
  if (g.in_hand && g.next_player === S.me.id) {
    V.cuePos = poolCueNear(V.balls, HEAD.x, HEAD.y) || [HEAD.x, HEAD.y];
    V.cuePos = [r3(V.cuePos[0]), r3(V.cuePos[1])];
  }
  plDefaultAim();
  plNoteFor(g);
  V.dirty = true;
  plHud();
}
function plRackOf(g, seed) { return plEight(g) ? poolRack8(seed) : poolRack(seed); }
// 8球 球组：A 的球组（本地刚打出来、服务器还没回的先用本地的）和每个人的球组
function plGroupA(g) {
  var P = PV && PV.gpend;
  if (!g.group_a && P && P.game === g.id && g.turn_no === P.turn) return P.a;
  return g.group_a || null;
}
function plGroupFor(g, uid) { var a = plGroupA(g); return a ? (uid === g.player_a ? a : poolOtherGroup(a)) : null; }
// 比分栏旁边显示的球组：对手这一杆还在回放时，先不显示它刚定下的球组
function plHudGroupA(g) {
  var V = PV;
  if (!V.gs || V.gs.game !== g.id || V.gs.rack !== g.rack_no) return null;
  return V.shownTurn !== g.turn_no ? V.gs.a : plGroupA(g);
}
// 这一杆可以先碰哪些球（球号）。9球：最小号；8球：见 poolTargets8
function plTargetIds(V) {
  if (!V.g) return [];
  if (!V.eight) return V.lowest == null ? [] : [V.lowest];
  return poolTargets8(V.balls, plGroupFor(V.g, S.me.id), V.brk);
}
function plDefaultAim() {
  var V = PV, i, c = null;
  if (V.cuePlaced) { var ca = plCueArr(); if (ca) c = [ca[1], ca[2]]; } else c = V.cuePos;
  if (!c) return;
  var ids = plTargetIds(V), best = null, bd = 1e18;
  for (i = 0; i < V.balls.length; i++) {
    if (ids.indexOf(V.balls[i][0]) >= 0) {
      var dx = V.balls[i][1] - c[0], dy = V.balls[i][2] - c[1], d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = [dx, dy]; }
    }
  }
  if (best) {
    var inp = poolInput(best[0], best[1], 0.5);
    if (inp) { V.aim = { x: inp.dx, y: inp.dy }; return; }
  }
  V.aim = { x: 0, y: -1 };
}
function plNoted(id) { var v = parseInt(lsGet('pool.noted.' + id), 10); return isNaN(v) ? 0 : v; }
function plSetNoted(id, n) { if (n > plNoted(id)) lsSet('pool.noted.' + id, String(n)); }
// 刚出现的新局面带着犯规：只提示一次（记下已经提示过的回合；重开小程序、实时刷新都不会再弹）
function plNoteFor(g) {
  if (g.status !== 'active' || !g.in_hand || !g.last_foul || g.turn_no <= plNoted(g.id)) return;
  plSetNoted(g.id, g.turn_no);
  var mine = g.next_player !== S.me.id; // 犯规的人 = 不是现在轮到的人
  plNoteShow((mine ? '你' : 'Ta') + '犯规：' + plFoulText(g, g.last_foul) + (mine ? '' : '，你有自由球'), NOTE_MS);
}
// text 为空 = 立刻收起；ms = 多久后自动淡出
function plNoteShow(text, ms) {
  var V = PV;
  clearTimeout(V.noteTm);
  if (text) {
    V.note = text;
    V.noteEl.textContent = text;
    V.noteEl.hidden = false;
    void V.noteEl.offsetWidth; // 让淡入过渡生效
    V.noteEl.classList.add('on');
    if (ms) V.noteTm = setTimeout(function () { plNoteShow(''); }, ms);
  } else {
    V.note = '';
    V.noteEl.classList.remove('on');
    V.noteTm = setTimeout(function () { if (PV === V && !V.note) V.noteEl.hidden = true; }, 400);
  }
}

// ---- HUD ----
function plHud() {
  var V = PV, g = V.g;
  if (!V.hud || !g) return;
  var me = S.me.id;
  if (!V.hudBuilt) {
    V.hudBuilt = true; V.hudScored = false;
    clear(V.hud);
    V.hAv = []; V.hSc = []; V.hGrp = [];
    V.hud.classList.toggle('e8', V.eight);
    var cols = [];
    [0, 1].forEach(function (k) {
      var pid = k === 0 ? g.player_a : g.player_b, p = V.persons[k] || tttPerson(pid);
      var av = h('div', { class: 'pl-av', title: pid === me ? '你' : (p ? p.nickname : 'Ta') }, makeAvatar(p, 36));
      var sc = h('b', { class: 'pl-score', text: '0' });
      var gr = h('i', { class: 'pl-grp' });
      gr.hidden = true;
      V.hAv.push(av); V.hSc.push(sc); V.hGrp.push(gr);
      var num = V.eight ? h('div', { class: 'pl-sc' }, sc, gr) : sc;
      cols.push(h('div', { class: 'pl-pl' + (k ? ' r' : '') }, k ? num : av, k ? av : num));
    });
    V.hStat = h('span', { class: 'pl-stat', role: 'status' });
    V.hChips = h('div', { class: 'pl-chips' + (V.eight ? ' e8' : ''), 'aria-hidden': 'true' });
    V.chip = [];
    for (var n = 1; n <= (V.eight ? 15 : 9); n++) {
      var c = h('i', { class: 'pl-chip n' + n });
      V.chip[n] = c; V.hChips.appendChild(c);
    }
    V.hud.appendChild(cols[0]); V.hud.appendChild(h('div', { class: 'pl-mid' }, V.hStat, V.hChips)); V.hud.appendChild(cols[1]);
  }
  var shown = plShownScores(g);
  [0, 1].forEach(function (k) {
    var t = String(shown[k]), el = V.hSc[k];
    if (el.textContent === t) return;
    var up = V.hudScored && Number(t) > Number(el.textContent);
    el.textContent = t;
    if (up) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  });
  V.hudScored = true;
  if (V.eight) {
    var ga = plHudGroupA(g);
    [g.player_a, g.player_b].forEach(function (pid, k) {
      var gp = ga ? (k === 0 ? ga : poolOtherGroup(ga)) : null, el = V.hGrp[k];
      el.hidden = !gp;
      if (gp) { el.textContent = GNAME[gp]; el.className = 'pl-grp ' + gp; }
    });
  }
  var active = g.status === 'active';
  if (active) V.wasActive = true;
  var turnId = !active ? null : (V.up ? (g.player_a === me ? g.player_b : g.player_a) : g.next_player);
  if (V.mode === 'sim' && V.local) turnId = me;
  V.hAv[0].classList.toggle('turn', !!turnId && turnId === g.player_a);
  V.hAv[1].classList.toggle('turn', !!turnId && turnId === g.player_b);
  var st = plStatus(g);
  if (active && V.up) st = { t: '等 Ta 出杆', you: false };
  if (V.mode === 'sim' || V.fire) st = V.local || V.fire ? { t: '出杆！', you: true } : { t: 'Ta 出杆了', you: false };
  if (plPlacing()) st = { t: '摆放白球', you: true };
  V.hStat.textContent = st.t;
  V.hStat.classList.toggle('you', st.you);
  plChips();
  plActions();
  V.dirty = true;
}
// 比分栏显示的分数：跟着球台走，不等服务器
// - 自己这一杆：决胜球（9球 的 9 号 / 8球 的 8 号）一落袋，按到这一刻的判定先给得分的一方加 1（8球 提前打进 8 号 = 对手得分）；
//   之后白球也掉袋就改判；服务器的新状态到了就以服务器为准
// - 对手这一杆的回放：服务器的分数已经含这一盘，回放里决胜球落袋之前先减掉，不剧透
function plShownScores(g) {
  var V = PV, sc = [g.score_a, g.score_b], k;
  var W = V.winPend;
  if (W && W.game === g.id && g.turn_no === W.turn) { k = g.player_a === W.winner ? 0 : 1; sc[k]++; }
  // 对手这一杆结束了这一盘（9球 只有对手赢才会这样；8球 对手提前打进 8 号时是我赢），但球台还没演到（等回放 / 回放中决胜球还没落袋）
  if (g.status === 'rack_over' && g.winner && (plEight(g) || g.winner !== S.me.id) && V.rack === g.rack_no && V.shownTurn !== g.turn_no && !(V.replay && V.replay.dec)) {
    k = g.player_a === g.winner ? 0 : 1; sc[k] = Math.max(0, sc[k] - 1);
  }
  return sc;
}
function plChips() {
  var V = PV;
  if (!V.chip) return;
  var on = {}, i, list = V.sim ? V.sim.b : null;
  if (list) { for (i = 0; i < list.length; i++) if (list[i].on) on[list[i].id] = 1; }
  else for (i = 0; i < V.balls.length; i++) on[V.balls[i][0]] = 1;
  var tg = {};
  if (V.eight && V.g && V.g.status === 'active' && V.g.next_player) {
    var gha = plHudGroupA(V.g), gp = gha ? (V.g.next_player === V.g.player_a ? gha : poolOtherGroup(gha)) : null;
    if (gp && !V.brk) {
      for (i = 1; i <= 15; i++) if (poolGroupOf(i) === gp && on[i]) tg[i] = 1;
      if (!Object.keys(tg).length && on[8]) tg[8] = 1;
    }
  }
  for (i = 1; i < V.chip.length; i++) {
    V.chip[i].classList.toggle('out', !on[i]);
    V.chip[i].classList.toggle('next', V.eight ? !!tg[i] : V.lowest === i && on[i] && V.g && V.g.status === 'active');
  }
}
function plActions() {
  var V = PV, g = V.g;
  var active = !!g && g.status === 'active';
  var mine = plMyBase();
  V.bar.classList.toggle('off', !mine);
  V.bar.classList.toggle('ended', !!g && !active);
  V.go.textContent = plPlacing() ? '放好了' : '出杆';
  V.go.disabled = !mine;
  V.fine.setAttribute('aria-disabled', plAiming() ? 'false' : 'true');
  V.rs.hidden = !active;
  V.rs.textContent = V.sure ? '确认' : '认输';
  V.rs.classList.toggle('sure', V.sure);
  V.btnAgain.hidden = !g || active;
  V.btnAgain.disabled = V.busy;
}
function plPower(p) {
  var V = PV;
  V.power = Math.round(Math.max(0.05, Math.min(1, p)) * 100) / 100;
  var pc = Math.round(V.power * 100);
  V.pwFill.style.clipPath = 'inset(0 calc(' + (100 - pc) + '% + ' + (pc * 0.36 - 18) + 'px) 0 0 round 7px)';
  V.pwKnob.style.left = 'calc(' + pc + '% - ' + (pc * 0.36) + 'px)';
  V.pwKnob.textContent = pc;
  V.pw.setAttribute('aria-valuenow', String(pc));
  V.dirty = true;
}

// ---- 同步：最新状态 / 重放对手的上一杆 ----
function plSync() {
  var V = PV, g = V && V.g;
  if (!V || !g || !V.cv) return;
  plHud();
  if (V.mode !== 'idle' || V.fire) return;
  if (V.shownTurn === g.turn_no && V.rack === g.rack_no) return;
  if (V.fetching) { V.again = true; return; }
  V.fetching = true;
  var id = g.id;
  sb.from('pool_shots').select('*').eq('game_id', id).order('turn_no', { ascending: false }).limit(1).then(function (r) {
    return r;
  }, function () { return { error: true }; }).then(function (r) {
    if (!PV || PV.id !== id) return;
    V = PV; V.fetching = false;
    var cur = V.g, shots = r && !r.error && r.data ? r.data : [];
    if (V.mode !== 'idle' || V.fire) return;
    var last = shots[0];
    var replay = !!last && last.shooter !== S.me.id && last.turn_no === cur.turn_no - 1 && last.rack_no === cur.rack_no && last.turn_no > plSeen(id);
    if (replay && V.shownTurn === last.turn_no + 1 && V.rack === cur.rack_no) replay = false;
    if (replay) plStartReplay(last);
    else {
      if (last && last.shooter !== S.me.id) plSetSeen(id, last.turn_no);
      plBuildScene(cur);
    }
    if (V.again) { V.again = false; if (V.mode === 'idle') plSync(); }
  });
}
function plStartReplay(shot) {
  var V = PV;
  var arr = shot.pre && shot.pre.b ? shot.pre.b.map(function (b) { return [Number(b[0]), Number(b[1]), Number(b[2])]; }) : arrOf(plRackOf(V.g, shot.seed));
  if (shot.cue_x != null) arr = arr.filter(function (b) { return b[0] !== 0; }).concat([[0, Number(shot.cue_x), Number(shot.cue_y)]]);
  V.balls = arr; V.rack = shot.rack_no; V.shownTurn = shot.turn_no; V.sinks = []; V.cuePlaced = true; V.brk = !shot.pre;
  V.lowest = V.eight ? null : poolLowest(arr);
  V.sim = new PoolSim(poolFromState(arr));
  V.sim.shoot(Number(shot.dx), Number(shot.dy), Number(shot.power));
  V.replay = { shot: shot, dec: false }; V.local = null; V.mode = 'sim'; V.delay = 0.7; V.acc = 0;
  V.aim = { x: Number(shot.dx), y: Number(shot.dy) }; V.power = Number(shot.power);
  V.shotStick = { pull: Number(shot.power) * PULL, t: 0 };
  plNoteShow('');
  V.dirty = true;
  plHud();
}
function plFire() {
  var V = PV, g = V.g;
  if (!plMyBase()) return;
  if (plPlacing()) { plPlace(); return; }
  var inp = poolInput(V.aim.x, V.aim.y, V.power);
  if (!inp || !g) return;
  V.fire = { t: 0, inp: inp, pull: V.power * PULL };
  if (V.hint) { V.hint = false; lsSet('pool.hint', '1'); V.hintEl.hidden = true; }
  plNoteShow('');
  plHud();
}
function plPlace() {
  var V = PV;
  if (!V.cuePos) return;
  V.balls = V.balls.filter(function (b) { return b[0] !== 0; }).concat([[0, V.cuePos[0], V.cuePos[1]]]);
  V.cuePlaced = true;
  plDefaultAim();
  plHud();
}
function plBeginSim() {
  var V = PV, g = V.g, f = V.fire;
  var cue = plCueArr();
  V.local = { turn: g.turn_no, game: g.id, inp: f.inp, cue: g.in_hand && cue ? [cue[1], cue[2]] : null, lowest: poolLowest(V.balls) };
  if (V.eight) { V.local.brk = V.brk; V.local.group = plGroupFor(g, S.me.id); V.local.pre = V.balls.map(function (b) { return b.slice(); }); }
  V.replay = null; V.fire = null; V.mode = 'sim'; V.delay = 0; V.acc = 0; V.sinks = [];
  V.shotStick = { pull: f.pull, t: 1 };
  V.sim = new PoolSim(poolFromState(V.balls));
  V.sim.shoot(f.inp.dx, f.inp.dy, f.inp.power);
  V.dirty = true;
  plHud();
}
function plEvents(V) {
  var ev = V.sim.ev.splice(0), i, e;
  for (i = 0; i < ev.length; i++) {
    e = ev[i];
    if (e.t === 'pocket') {
      var p = POCKETS[e.p];
      V.sinks.push({ id: e.id, x: e.x, y: e.y, tx: p.x, ty: p.y, t: 0 });
      plChips();
      if (e.id === (V.eight ? 8 : 9) || e.id === 0) plDecCheck(V);
      try { if (navigator.vibrate && e.id !== 0) navigator.vibrate(12); } catch (er) { /* 忽略 */ }
    }
  }
}
// 决胜球（9球 的 9 号 / 8球 的 8 号）或白球落袋时：按到目前为止的结果判一次（和 poolJudge / poolJudge8 同一套规则），比分栏立刻跟上
function plDecCheck(V) {
  var res = V.sim.result(), scratch = res.potted.indexOf(0) >= 0, g = V.g;
  if (V.eight) {
    if (V.local) {
      var j = poolJudge8({ pre: V.local.pre, group: V.local.group, brk: V.local.brk }, res, V.sim.snapshot());
      V.winPend = j.win || j.lose ? { game: V.local.game, turn: V.local.turn, winner: j.win ? S.me.id : (g.player_a === S.me.id ? g.player_b : g.player_a) } : null;
    } else if (V.replay) {
      var rs = V.replay.shot;
      V.replay.dec = res.potted.indexOf(8) >= 0 && !!(rs.won || rs.lost);
    }
    plHud();
    return;
  }
  var nine = res.potted.indexOf(9) >= 0;
  if (V.local) {
    var ok = nine && !scratch && res.first === V.local.lowest;
    V.winPend = ok ? { game: V.local.game, turn: V.local.turn, winner: S.me.id } : null;
  } else if (V.replay) V.replay.dec = nine && !scratch;
  plHud();
}
function plEndSim() {
  var V = PV, sim = V.sim;
  sim.settle();
  if (V.local) {
    var L = V.local, res = sim.result(), snap = sim.snapshot(), g = V.g, j;
    if (V.eight) j = poolJudge8({ pre: L.pre, group: L.group, brk: L.brk }, res, snap);
    else j = poolJudge(L.lowest, res, snap);
    V.balls = j.state; V.sim = null; V.mode = 'idle'; V.local = null; V.cuePlaced = true;
    V.lowest = V.eight ? null : poolLowest(V.balls);
    V.shownTurn = L.turn + 1; V.up = true;
    if (V.eight) {
      var theirs = g.player_a === S.me.id ? g.player_b : g.player_a;
      V.winPend = j.win || j.lose ? { game: L.game, turn: L.turn, winner: j.win ? S.me.id : theirs } : null;
      if (j.group) {
        var ga = g.player_a === S.me.id ? j.group : poolOtherGroup(j.group);
        V.gpend = { game: L.game, turn: L.turn, a: ga };
        V.gs = { game: L.game, rack: V.rack, a: ga };
      } else if (V.gs) V.gs = { game: V.gs.game, rack: V.gs.rack, a: plGroupA(g) };
      V.brk = false;
      plNoteForShot8(g, { foul: j.foul, win: j.win, lose: j.lose, keep: j.keep, group: j.group, respot8: j.respot8 }, true);
    } else {
      V.winPend = j.win ? { game: L.game, turn: L.turn, winner: S.me.id } : null;
      plNoteForShot(j.foul, j.win, j.keep, true);
    }
    V.aim = { x: L.inp.dx, y: L.inp.dy };
    plHud();
    plUpload({ game: L.game, turn: L.turn, inp: L.inp, cue: L.cue, result: { b: j.state }, potted: res.potted, foul: j.foul, win: j.win, keep: j.keep, group: V.eight ? j.group : null, lose: V.eight ? j.lose : false, eight: V.eight }, 0);
  } else if (V.replay) {
    var sh = V.replay.shot;
    V.balls = sh.result.b.map(function (b) { return [Number(b[0]), Number(b[1]), Number(b[2])]; });
    V.sim = null; V.mode = 'idle'; V.replay = null; V.cuePlaced = true;
    V.lowest = V.eight ? null : poolLowest(V.balls);
    V.shownTurn = sh.turn_no + 1;
    plSetSeen(sh.game_id, sh.turn_no);
    if (V.eight) {
      V.brk = false;
      V.gs = { game: V.g.id, rack: V.g.rack_no, a: plGroupA(V.g) };
      var potted = (sh.potted || []).map(Number);
      plNoteForShot8(V.g, { foul: sh.foul, win: sh.won, lose: sh.lost, keep: sh.keep, group: sh.grp, respot8: !sh.pre && !sh.won && !sh.lost && potted.indexOf(8) >= 0 }, false);
    } else plNoteForShot(sh.foul, sh.won, sh.keep, false);
    plHud();
    plSync();
    plEnded();
  }
  V.dirty = true;
}
function plNoteForShot(foul, win, keep, mine) {
  var who = mine ? '你' : 'Ta';
  if (foul) { plSetNoted(PV.id, PV.shownTurn); plNoteShow(who + '犯规：' + FOUL_TEXT[foul] + (mine ? '，Ta 有自由球' : '，你有自由球'), NOTE_MS); }
  else if (win) { plNoteShow(who + '打进了 9 号球', NOTE_MS); if (mine) popCheer('进了！'); }
  else if (keep) plNoteShow(who + '进球，继续', 2200);
}
function plNoteForShot8(g, r, mine) {
  var who = mine ? '你' : 'Ta ', other = mine ? 'Ta ' : '你';
  if (r.lose) plNoteShow(who + (r.foul ? '打 8 号球时犯规了' : '提前打进了 8 号球') + '，' + other + '赢了这一盘', NOTE_MS);
  else if (r.win) {
    plNoteShow(who + '打进了 8 号球，' + (mine ? '赢了这一盘' : '这一盘你输了'), NOTE_MS);
    if (mine) popCheer('进了！');
  } else if (r.foul) {
    plSetNoted(PV.id, PV.shownTurn);
    plNoteShow(who + '犯规：' + plFoulText(g, r.foul) + (mine ? '，Ta 有自由球' : '，你有自由球'), NOTE_MS);
  } else if (r.respot8) plNoteShow(who + '开球打进了 8 号球，放回了置球点', 2800);
  else if (r.group) plNoteShow(mine ? '你打进了' + GNAME[r.group] + '，继续' : 'Ta 打进了' + GNAME[r.group] + '，你是' + GNAME[poolOtherGroup(r.group)], NOTE_MS);
  else if (r.keep) plNoteShow(who + '进球，继续', 2200);
}
function plEnded() {
  var V = PV, g = V && V.g;
  if (!V || !g || V.endShown === g.turn_no || g.status === 'active') return;
  if (V.mode !== 'idle' || V.fire) return;
  if (V.shownTurn !== g.turn_no && g.status !== 'resigned') return;
  V.endShown = g.turn_no;
  if (!V.wasActive) return; // 打开时就已经结束：不放动效
  if (g.winner === S.me.id) popCheer('你赢了这一盘！');
}
function plUpload(a, tries) {
  var id = a.game;
  var done = function () { if (PV && PV.id === id) { PV.up = false; PV.dirty = true; plHud(); if (PV.mode === 'idle') plSync(); } };
  var args = {
    p_game: a.game, p_turn_no: a.turn, p_dx: a.inp.dx, p_dy: a.inp.dy, p_power: a.inp.power,
    p_cue_x: a.cue ? a.cue[0] : null, p_cue_y: a.cue ? a.cue[1] : null,
    p_result: a.result, p_potted: a.potted, p_foul: a.foul, p_win: a.win, p_keep: a.keep
  };
  if (a.eight) { args.p_group = a.group || null; args.p_lose = !!a.lose; } // 9球 的调用和以前完全一样
  var terminal = { not_your_turn: 1, stale_turn: 1, game_over: 1, game_not_found: 1, invalid_shot: 1, invalid_cue: 1, not_authenticated: 1 };
  var retry = function () {
    if (tries >= 6) { toast('网络不好，这一杆没有发出去'); if (PV && PV.id === id) { PV.shownTurn = -1; PV.up = false; PV.winPend = null; plSync(); } return; }
    setTimeout(function () { plUpload(a, tries + 1); }, Math.min(8000, 1000 * Math.pow(2, tries)));
  };
  sb.rpc('pool_shoot', args).then(function (r) {
    if (!r.error) {
      var d = r.data || {};
      if (d.game) plPut(d.game);
      if (!a.keep) firePush('pool_turn', d.shot_id);
      done();
      return;
    }
    var msg = r.error.message || '';
    if (!terminal[msg]) { retry(); return; }
    // 已经提交过 / 回合过期 / 被拒绝：以服务器为准
    sb.from('pool_shots').select('id,shooter').eq('game_id', id).eq('turn_no', a.turn).maybeSingle().then(function (q) {
      if (q.data && q.data.shooter === S.me.id) { if (!a.keep) firePush('pool_turn', q.data.id); }
      else if (msg !== 'game_over') toast(errText(r.error));
      sb.from('pool_games').select('*').eq('id', id).maybeSingle().then(function (gq) {
        if (PV && PV.id === id && !(q.data && q.data.shooter === S.me.id)) { PV.shownTurn = -1; PV.winPend = null; }
        if (gq.data) plPut(gq.data);
        done();
      }, done);
    }, done);
  }, retry);
}
function plResign() {
  var V = PV, g = V && V.g;
  if (!g || g.status !== 'active') return;
  if (!V.sure) {
    V.sure = true; plActions();
    V.sureTm = setTimeout(function () { if (PV === V) { V.sure = false; plActions(); } }, 3000);
    return;
  }
  clearTimeout(V.sureTm); V.sure = false;
  var id = g.id;
  sb.rpc('pool_resign', { p_game: id }).then(function (r) {
    if (r.error) { toast(errText(r.error)); sb.from('pool_games').select('*').eq('id', id).maybeSingle().then(function (q) { if (q.data) plPut(q.data); }); return; }
    plPut(r.data);
  }, function (e) { toast(errText(e)); });
}
function plAgain() {
  var V = PV, g = V && V.g;
  if (!g || V.busy) return;
  var id = g.id;
  V.busy = true; plActions();
  sb.rpc('pool_rematch', { p_game: id }).then(function (r) {
    if (PV && PV.id === id) PV.busy = false;
    if (r.error) { toast(errText(r.error)); if (PV) plActions(); return; }
    plPut(r.data);
    if (PV) plActions();
  }, function (e) { if (PV) { PV.busy = false; plActions(); } toast(errText(e)); });
}

// ---- 输入：拖动瞄准 / 摆白球，右边调力度 ----
function plBindInput() {
  var V = PV, cv = V.cv;
  function aimTo(ev) {
    var c = plCueArr(), p = plPt(ev);
    if (!c) return;
    var dx = p.x - c[1], dy = p.y - c[2];
    if (dx * dx + dy * dy < 14 * 14) return; // 离白球太近：方向不稳，保持原来的
    var inp = poolInput(dx, dy, 0.5);
    if (inp) { V.aim = { x: inp.dx, y: inp.dy }; V.dirty = true; }
  }
  function moveCue(ev) {
    var p = plPt(ev), lift = ev.pointerType === 'touch' ? 34 / V.s : 0; // 手指挡住球：触屏时球放在手指上方一点
    var q = poolCueNear(V.balls, p.x, p.y - lift);
    if (q) { V.cuePos = [r3(q[0]), r3(q[1])]; V.dirty = true; }
  }
  cv.addEventListener('pointerdown', function (ev) {
    if (V.drag) return;
    var mode = plPlacing() ? 'place' : plAiming() ? 'aim' : null;
    if (!mode) return;
    V.drag = { id: ev.pointerId, mode: mode };
    try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
    ev.preventDefault();
    V.hint = false;
    if (V.hintEl) V.hintEl.hidden = true;
    plNoteShow('');
    if (mode === 'aim') aimTo(ev); else moveCue(ev);
  });
  cv.addEventListener('pointermove', function (ev) {
    if (!V.drag || ev.pointerId !== V.drag.id) return;
    if (V.drag.mode === 'aim') aimTo(ev); else moveCue(ev);
    ev.preventDefault();
  });
  function end(ev) { if (V.drag && ev.pointerId === V.drag.id) { V.drag = null; V.dirty = true; plMag(false); } }
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  // 力度条（横向）
  var pdrag = null;
  function setPw(ev) {
    var r = V.pwTrack.getBoundingClientRect();
    plPower((ev.clientX - r.left - 18) / Math.max(1, r.width - 36)); // 旋钮中心跟着手指
  }
  V.pw.addEventListener('pointerdown', function (ev) {
    if (!plMyBase()) return;
    pdrag = ev.pointerId;
    try { V.pw.setPointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
    ev.preventDefault(); setPw(ev);
  });
  V.pw.addEventListener('pointermove', function (ev) { if (pdrag === ev.pointerId) { setPw(ev); ev.preventDefault(); } });
  var pend = function (ev) { if (pdrag === ev.pointerId) pdrag = null; };
  V.pw.addEventListener('pointerup', pend);
  V.pw.addEventListener('pointercancel', pend);
  V.pw.addEventListener('keydown', function (ev) {
    if (!plMyBase() || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
    plPower(V.power + (ev.key === 'ArrowRight' ? 0.05 : -0.05)); ev.preventDefault();
  });
  V.go.addEventListener('click', plFire);
  // 微调条：相对拖动，每 1px 只转 FINE 弧度（直接拖台面粗得多），一次拖不够可以多拖几次
  function turn(rad) {
    if (!plAiming()) return;
    var c = Math.cos(rad), s = Math.sin(rad), x = V.aim.x, y = V.aim.y;
    var inp = poolInput(x * c - y * s, x * s + y * c, 0.5);
    if (inp) { V.aim = { x: inp.dx, y: inp.dy }; V.dirty = true; }
  }
  var fd = null;
  V.fine.addEventListener('pointerdown', function (ev) {
    if (!plAiming() || fd) return;
    fd = { id: ev.pointerId, x: ev.clientX, off: 0 };
    V.fineDrag = true;
    try { V.fine.setPointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
    V.hint = false; if (V.hintEl) V.hintEl.hidden = true;
    plNoteShow('');
    ev.preventDefault();
  });
  V.fine.addEventListener('pointermove', function (ev) {
    if (!fd || ev.pointerId !== fd.id) return;
    var dx = ev.clientX - fd.x;
    fd.x = ev.clientX; fd.off = (fd.off + dx) % 12;
    V.fine.style.backgroundPositionX = fd.off + 'px'; // 刻度跟着手指走
    turn(dx * FINE);
    ev.preventDefault();
  });
  function fend(ev) { if (fd && ev.pointerId === fd.id) { fd = null; V.fineDrag = false; V.dirty = true; plMag(false); } }
  V.fine.addEventListener('pointerup', fend);
  V.fine.addEventListener('pointercancel', fend);
  V.fine.addEventListener('keydown', function (ev) {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    turn((ev.key === 'ArrowRight' ? 1 : -1) * FINE * 6); ev.preventDefault();
  });
}
// 放大镜：瞄准时在角落显示"白球落点"附近的 3 倍放大图，躲开手指
function plMag(on) {
  var V = PV;
  if (!V || !V.magEl) return;
  V.magEl.hidden = !on;
}
function plMagDraw(V) {
  var p = V.magPt;
  if (!V.magEl || !p || !(V.drag && V.drag.mode === 'aim') && !V.fineDrag) { if (V.magEl && !V.magEl.hidden) V.magEl.hidden = true; return; }
  var m = V.magEl, c = m.getContext('2d'), W = m.width, k = V.dpr, half = 19 * k; // 取景 38 CSS px 见方，放大到 88 px（约 2.3 倍）
  var cx = (V.ox + p.x * V.s) * k, cy = (V.oy + p.y * V.s) * k;
  c.clearRect(0, 0, W, W);
  c.save(); c.beginPath(); c.arc(W / 2, W / 2, W / 2 - 2, 0, 6.2832); c.clip();
  c.drawImage(V.cv, cx - half, cy - half, half * 2, half * 2, 0, 0, W, W);
  c.restore();
  c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 3; c.beginPath(); c.arc(W / 2, W / 2, W / 2 - 2, 0, 6.2832); c.stroke();
  // 摆在离落点远的一角
  var left = p.x < PW / 2, top = p.y < PH * 0.3;
  m.style.left = left ? 'auto' : '8px'; m.style.right = left ? '8px' : 'auto';
  m.style.top = top ? 'auto' : '8px'; m.style.bottom = top ? '8px' : 'auto';
  m.hidden = false;
}

// ---- 主循环 ----
function plLoop(ts) {
  var V = PV;
  if (!V || V.dead) return;
  V.raf = requestAnimationFrame(plLoop);
  var dt = V.last ? Math.min(0.05, (ts - V.last) / 1000) : 0.016;
  V.last = ts;
  if (document.hidden) return;
  var busy = false, i;
  if (V.fire) {
    busy = true; V.fire.t += dt;
    if (V.fire.t >= 0.14) plBeginSim();
  }
  if (V.mode === 'sim' && V.sim) {
    busy = true;
    if (V.delay > 0) V.delay -= dt;
    else {
      V.acc += dt;
      var n = 0, more = true;
      while (V.acc >= 1 / 60 && n < 4 && more) {
        V.acc -= 1 / 60; n++;
        more = V.sim.tick();
      }
      if (V.acc > 0.1) V.acc = 0;
      plEvents(V);
      if (V.shotStick && V.shotStick.t > 0) V.shotStick.t = Math.max(0, V.shotStick.t - dt * 6);
      if (!more) { plEndSim(); busy = true; }
    }
  }
  if (V.sinks.length) {
    busy = true;
    for (i = V.sinks.length - 1; i >= 0; i--) { V.sinks[i].t += dt / 0.3; if (V.sinks[i].t >= 1) V.sinks.splice(i, 1); }
  }
  if (V.drag) busy = true;
  var dk = plDark();
  if (dk !== V.dk) { V.dk = dk; V.cache = null; V.dirty = true; }
  var hint = V.hint && plAiming() && !V.drag;
  if (V.hintEl && V.hintEl.hidden === hint) V.hintEl.hidden = !hint;
  if (plAiming() && V.g && V.g.status === 'active') { V.pulse += dt; busy = true; } // 目标球提示圈轻轻呼吸
  if (busy || V.dirty) { V.dirty = false; plDraw(V); plMagDraw(V); }
}

// ---- 画 ----
function plBase(V) {
  // 台面（木框、库边、毛毡、钻石、袋口）画一次缓存起来，每帧直接贴图
  if (V.cache && V.cache.k === V.dpr * 1000 + V.cw + ':' + V.ch + ':' + (V.dk ? 1 : 0)) return V.cache.cv;
  var cv = document.createElement('canvas');
  cv.width = V.cv.width; cv.height = V.cv.height;
  var c = cv.getContext('2d'), k = V.dpr * V.s, dk = V.dk;
  var bgIm = PLI[dk ? 'bgNight' : 'bgDay'];
  if (bgIm && bgIm._ok) {
    var bs = Math.max(cv.width / bgIm.naturalWidth, cv.height / bgIm.naturalHeight);
    c.drawImage(bgIm, (cv.width - bgIm.naturalWidth * bs) / 2, (cv.height - bgIm.naturalHeight * bs) / 2, bgIm.naturalWidth * bs, bgIm.naturalHeight * bs);
  }
  c.setTransform(k, 0, 0, k, V.dpr * V.ox, V.dpr * V.oy);
  var wood0 = dk ? '#5b3720' : '#8a5530', wood1 = dk ? '#3d2412' : '#5f3a1d';
  var gW = c.createLinearGradient(0, -RAIL, 0, PH + RAIL);
  gW.addColorStop(0, wood0); gW.addColorStop(0.5, wood1); gW.addColorStop(1, wood0);
  c.fillStyle = 'rgba(0,0,0,.22)'; plRound(c, -RAIL + 2, -RAIL + 4, PW + RAIL * 2, PH + RAIL * 2, 16); c.fill();
  c.fillStyle = gW; plRound(c, -RAIL, -RAIL, PW + RAIL * 2, PH + RAIL * 2, 16); c.fill();
  if (PLI.wood._ok) { // 木纹贴图叠在渐变上
    c.save(); plRound(c, -RAIL, -RAIL, PW + RAIL * 2, PH + RAIL * 2, 16); c.clip();
    var wp = c.createPattern(PLI.wood, 'repeat');
    if (wp.setTransform && window.DOMMatrix) wp.setTransform(new window.DOMMatrix().scale(0.45));
    c.globalAlpha = 1; c.fillStyle = wp; c.fillRect(-RAIL, -RAIL, PW + RAIL * 2, PH + RAIL * 2);
    c.globalAlpha = dk ? 0.6 : 0.3; c.fillStyle = gW; c.fillRect(-RAIL, -RAIL, PW + RAIL * 2, PH + RAIL * 2);
    c.restore();
  }
  c.strokeStyle = 'rgba(255,230,190,.28)'; c.lineWidth = 1.2; plRound(c, -RAIL + 0.6, -RAIL + 0.6, PW + RAIL * 2 - 1.2, PH + RAIL * 2 - 1.2, 15.4); c.stroke();
  // 毛毡
  var f0 = dk ? '#116a50' : '#1d8f67', f1 = dk ? '#0b4a39' : '#146b4c';
  var gF = c.createRadialGradient(PW / 2, PH * 0.45, 20, PW / 2, PH / 2, PH * 0.75);
  gF.addColorStop(0, f0); gF.addColorStop(1, f1);
  c.fillStyle = dk ? '#0a3f31' : '#12634a'; c.fillRect(-CUSH - 2, -CUSH - 2, PW + CUSH * 2 + 4, PH + CUSH * 2 + 4);
  c.fillStyle = gF; c.fillRect(0, 0, PW, PH);
  if (PLI.felt._ok) {
    c.save(); c.globalAlpha = dk ? 0.35 : 0.5; c.globalCompositeOperation = 'overlay'; c.fillStyle = c.createPattern(PLI.felt, 'repeat'); c.fillRect(0, 0, PW, PH); c.restore();
  }
  // 开球线和置球点
  c.strokeStyle = 'rgba(255,255,255,.14)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(0, HEAD.y); c.lineTo(PW, HEAD.y); c.stroke();
  c.fillStyle = 'rgba(255,255,255,.2)';
  c.beginPath(); c.arc(HEAD.x, HEAD.y, 2, 0, 6.2832); c.fill();
  c.beginPath(); c.arc(PW / 2, 170, 2, 0, 6.2832); c.fill();
  // 库边橡胶
  var cu = dk ? '#0c5a43' : '#17805a';
  c.fillStyle = cu;
  var MC = 28, MS = 21, mid = PH / 2;
  function poly(pts) { c.beginPath(); c.moveTo(pts[0], pts[1]); for (var i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); c.fill(); }
  poly([MC + 8, -CUSH, PW - MC - 8, -CUSH, PW - MC, 0, MC, 0]);
  poly([MC + 8, PH + CUSH, PW - MC - 8, PH + CUSH, PW - MC, PH, MC, PH]);
  [[-CUSH, 0, 1], [PW + CUSH, PW, -1]].forEach(function (s) {
    var o = s[0], f = s[1];
    poly([o, MC + 8, o, mid - MS - 8, f, mid - MS, f, MC]);
    poly([o, mid + MS + 8, o, PH - MC - 8, f, PH - MC, f, mid + MS]);
  });
  c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = 1.4;
  c.beginPath(); c.moveTo(MC, 0); c.lineTo(PW - MC, 0); c.moveTo(MC, PH); c.lineTo(PW - MC, PH);
  c.moveTo(0, MC); c.lineTo(0, mid - MS); c.moveTo(0, mid + MS); c.lineTo(0, PH - MC); c.moveTo(PW, MC); c.lineTo(PW, mid - MS); c.moveTo(PW, mid + MS); c.lineTo(PW, PH - MC); c.stroke();
  // 钻石
  c.fillStyle = dk ? '#e9d3a8' : '#f6e4bd';
  function dia(x, y) { c.beginPath(); c.moveTo(x, y - 3.6); c.lineTo(x + 2.4, y); c.lineTo(x, y + 3.6); c.lineTo(x - 2.4, y); c.closePath(); c.fill(); }
  var q;
  for (q = 1; q < 4; q++) { dia(PW * q / 4, -RAIL / 2 - CUSH / 2 + 1); dia(PW * q / 4, PH + RAIL / 2 + CUSH / 2 - 1); }
  for (q = 1; q < 8; q++) if (q !== 4) { dia(-RAIL / 2 - CUSH / 2 + 1, PH * q / 8); dia(PW + RAIL / 2 + CUSH / 2 - 1, PH * q / 8); }
  // 袋口
  POCKETS.forEach(function (p) {
    var r = p.r + 0.5;
    c.fillStyle = dk ? '#2a1a0f' : '#3c2514';
    c.beginPath(); c.arc(p.x, p.y, r + 2.2, 0, 6.2832); c.fill();
    var g = c.createRadialGradient(p.x, p.y, 1, p.x, p.y, r);
    g.addColorStop(0, '#000'); g.addColorStop(0.7, '#0a0a0a'); g.addColorStop(1, '#1c1c1c');
    c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, r, 0, 6.2832); c.fill();
  });
  V.cache = { k: V.dpr * 1000 + V.cw + ':' + V.ch + ':' + (V.dk ? 1 : 0), cv: cv };
  return cv;
}
function plRound(c, x, y, w, hh, r) {
  c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r); c.lineTo(x + w, y + hh - r); c.arcTo(x + w, y + hh, x + w - r, y + hh, r);
  c.lineTo(x + r, y + hh); c.arcTo(x, y + hh, x, y + hh - r, r); c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r); c.closePath();
}
function plBall(c, id, x, y, sc, ghost) {
  var r = BR * sc;
  if (!ghost) { // 阴影
    c.fillStyle = 'rgba(0,0,0,.26)'; c.beginPath(); c.arc(x + r * 0.2, y + r * 0.32, r * 1.02, 0, 6.2832); c.fill();
  }
  c.save();
  if (ghost) c.globalAlpha = ghost;
  c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.clip();
  c.fillStyle = id >= 9 || id === 0 ? '#f8f4ea' : COL[id]; c.fillRect(x - r, y - r, r * 2, r * 2);
  if (id >= 9) { c.fillStyle = COL[id - 8]; c.fillRect(x - r, y - r * 0.56, r * 2, r * 1.12); } // 花色球：白底一条色带（9 号 = 黄）
  if (id > 0) {
    c.fillStyle = '#fbf8f0'; c.beginPath(); c.arc(x, y, r * 0.5, 0, 6.2832); c.fill();
    if (BR * PV.s * sc >= 5.2) {
      c.fillStyle = '#1b1b1d'; c.font = '700 ' + (r * 0.78).toFixed(1) + 'px system-ui,-apple-system,sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(id), x, y + r * 0.05);
    }
  }
  var g = c.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.05, x, y, r * 1.05);
  g.addColorStop(0, 'rgba(255,255,255,.62)'); g.addColorStop(0.28, 'rgba(255,255,255,.08)'); g.addColorStop(0.62, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.42)');
  c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  c.restore();
}
// 瞄准线：从白球沿方向走到第一个球（鬼球位置）或库边
function plGuide(cue, d, balls) {
  var best = Infinity, hit = null, i, R2 = 2 * BR;
  for (i = 0; i < balls.length; i++) {
    var b = balls[i];
    if (b[0] === 0) continue;
    var fx = cue[1] - b[1], fy = cue[2] - b[2], B = fx * d.x + fy * d.y, C = fx * fx + fy * fy - R2 * R2, disc = B * B - C;
    if (disc < 0) continue;
    var t = -B - Math.sqrt(disc);
    if (t > 0 && t < best) { best = t; hit = b; }
  }
  var tw = Infinity;
  if (d.x > 0) tw = Math.min(tw, (PW - BR - cue[1]) / d.x); else if (d.x < 0) tw = Math.min(tw, (BR - cue[1]) / d.x);
  if (d.y > 0) tw = Math.min(tw, (PH - BR - cue[2]) / d.y); else if (d.y < 0) tw = Math.min(tw, (BR - cue[2]) / d.y);
  if (hit && best <= tw) return { t: best, hit: hit, x: cue[1] + d.x * best, y: cue[2] + d.y * best };
  return { t: tw, hit: null, x: cue[1] + d.x * tw, y: cue[2] + d.y * tw };
}
function plDraw(V) {
  var c = V.ctx, k = V.dpr * V.s, i;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, V.cv.width, V.cv.height);
  c.drawImage(plBase(V), 0, 0);
  c.setTransform(k, 0, 0, k, V.dpr * V.ox, V.dpr * V.oy);
  var list = [], sim = V.sim;
  if (sim) { for (i = 0; i < sim.b.length; i++) if (sim.b[i].on) list.push([sim.b[i].id, sim.b[i].x, sim.b[i].y]); }
  else list = V.balls;
  var aiming = plAiming(), placing = plPlacing(), cue = null;
  if (placing && V.cuePos) cue = [0, V.cuePos[0], V.cuePos[1]];
  else for (i = 0; i < list.length; i++) if (list[i][0] === 0) cue = list[i];
  // 目标球提示圈（9球：最小号；8球：已分组时自己的球组，清空后是 8 号；开球和没分组时不圈）
  var ringIds = [];
  if (aiming) ringIds = V.eight ? (V.brk || !plGroupFor(V.g, S.me.id) ? [] : plTargetIds(V)) : (V.lowest != null ? [V.lowest] : []);
  if (ringIds.length) {
    for (i = 0; i < list.length; i++) if (ringIds.indexOf(list[i][0]) >= 0) {
      var pr = BR + 3.5 + Math.sin(V.pulse * 3.2) * 1.2;
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.6; c.beginPath(); c.arc(list[i][1], list[i][2], pr, 0, 6.2832); c.stroke();
    }
  }
  // 瞄准线（在球下面）
  if ((aiming || V.fire) && cue && !sim) {
    var gd = plGuide(cue, V.aim, list);
    V.magPt = { x: gd.x, y: gd.y };
    c.save();
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1.7; c.setLineDash([2.5, 6]);
    c.beginPath(); c.moveTo(cue[1] + V.aim.x * BR, cue[2] + V.aim.y * BR); c.lineTo(gd.x, gd.y); c.stroke();
    c.setLineDash([]);
    c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 1.6;
    c.beginPath(); c.arc(gd.x, gd.y, BR, 0, 6.2832); c.stroke();
    if (gd.hit) {
      var nx = (gd.hit[1] - gd.x) / (2 * BR), ny = (gd.hit[2] - gd.y) / (2 * BR), dot = V.aim.x * nx + V.aim.y * ny;
      // 目标球的去向
      c.strokeStyle = 'rgba(255,236,170,.95)'; c.lineWidth = 2; c.setLineDash([]);
      c.beginPath(); c.moveTo(gd.hit[1] + nx * BR, gd.hit[2] + ny * BR); c.lineTo(gd.hit[1] + nx * (BR + 20 + 56 * Math.max(0.2, dot)), gd.hit[2] + ny * (BR + 20 + 56 * Math.max(0.2, dot))); c.stroke();
      // 白球的偏转（切线方向）
      var tx = V.aim.x - dot * nx, ty = V.aim.y - dot * ny, tl = Math.sqrt(tx * tx + ty * ty);
      if (tl > 0.05) {
        c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(gd.x + tx / tl * BR, gd.y + ty / tl * BR); c.lineTo(gd.x + tx / tl * (BR + 10 + 30 * tl), gd.y + ty / tl * (BR + 10 + 30 * tl)); c.stroke();
      }
    }
    c.restore();
  }
  // 球
  for (i = 0; i < list.length; i++) if (list[i][0] !== 0 || !placing) plBall(c, list[i][0], list[i][1], list[i][2], 1);
  if (placing && cue) {
    plBall(c, 0, cue[1], cue[2], 1);
    c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 1.5; c.setLineDash([3, 3]);
    c.beginPath(); c.arc(cue[1], cue[2], BR + 4, 0, 6.2832); c.stroke(); c.setLineDash([]);
  }
  // 落袋动画
  for (i = 0; i < V.sinks.length; i++) {
    var s = V.sinks[i], e = s.t * s.t * (3 - 2 * s.t);
    c.save(); c.globalAlpha = 1 - s.t * 0.7;
    plBall(c, s.id, s.x + (s.tx - s.x) * e, s.y + (s.ty - s.y) * e, 1 - 0.55 * e, 0);
    c.restore();
  }
  // 球杆
  var stick = null;
  if ((aiming || V.fire) && cue && !sim) {
    var pull = V.fire ? V.fire.pull * (1 - Math.min(1, V.fire.t / 0.14) * 1.15) : V.power * PULL;
    stick = { d: V.aim, pull: pull };
  } else if (sim && V.shotStick && V.shotStick.t > 0 && cue) stick = { d: V.aim, pull: V.shotStick.pull * V.shotStick.t * -0.3 };
  if (stick && cue) plStick(c, cue[1], cue[2], stick.d, stick.pull);
}
function plStick(c, x, y, d, pull) {
  var gap = BR + 3 + Math.max(-4, pull), len = 330;
  var bx = x - d.x * gap, by = y - d.y * gap, ex = bx - d.x * len, ey = by - d.y * len;
  if (PLI.cue._ok) {
    var chh = len * PLI.cue.naturalHeight / PLI.cue.naturalWidth * 1.9, ang = Math.atan2(d.y, d.x);
    c.save(); c.fillStyle = 'rgba(0,0,0,.2)'; c.translate(bx + 3, by + 4); c.rotate(ang); c.fillRect(-len, -chh / 4, len, chh / 2); c.restore();
    c.save(); c.translate(bx, by); c.rotate(ang); c.drawImage(PLI.cue, -len, -chh / 2, len, chh); c.restore();
    return;
  }
  var nx = -d.y, ny = d.x, w0 = 1.7, w1 = 4.6;
  c.save();
  c.fillStyle = 'rgba(0,0,0,.22)';
  c.beginPath(); c.moveTo(bx + nx * w0 + 3, by + ny * w0 + 4); c.lineTo(ex + nx * w1 + 3, ey + ny * w1 + 4); c.lineTo(ex - nx * w1 + 3, ey - ny * w1 + 4); c.lineTo(bx - nx * w0 + 3, by - ny * w0 + 4); c.closePath(); c.fill();
  var g = c.createLinearGradient(bx, by, ex, ey);
  g.addColorStop(0, '#f4f1ea'); g.addColorStop(0.035, '#f4f1ea'); g.addColorStop(0.045, '#c9a56a'); g.addColorStop(0.55, '#e8c88e'); g.addColorStop(0.62, '#3a2415'); g.addColorStop(1, '#241409');
  c.fillStyle = g;
  c.beginPath(); c.moveTo(bx + nx * w0, by + ny * w0); c.lineTo(ex + nx * w1, ey + ny * w1); c.lineTo(ex - nx * w1, ey - ny * w1); c.lineTo(bx - nx * w0, by - ny * w0); c.closePath(); c.fill();
  c.strokeStyle = '#5aa6d8'; c.lineWidth = 1.5; // 皮头
  c.beginPath(); c.moveTo(bx + nx * w0, by + ny * w0); c.lineTo(bx - nx * w0, by - ny * w0); c.stroke();
  c.restore();
}
