// 弹弓大战小程序

import { errText } from '../errors.js';
import { APP, closeApp, openApp } from './host.js';
import { rankButton } from './leaderboard.js';
import { AV_R, PLAT_X, PLAT_Y, SL_AMMO, SL_ANCHOR, SLH, SLW, SlSim, slPreview } from './sling-sim.js';
import { firePush } from '../notify.js';
import { poolOf } from './pool.js';
import { tttOf, tttPerson, tttRow } from './ttt.js';
import { S, avatarUrl, makeAvatar, sb } from '../state.js';
import { popCheer, mascotSrc } from '../mascot.js';
import { $, clear, h, isVisible, lsGet, lsSet, toast } from '../utils.js';

/* global Matter */

// ===== 弹弓大战 =====
var SG = { games: {}, want: [], pend: {}, tm: 0 };
export function slReset() { SG.games = {}; SG.want = []; SG.pend = {}; }
export function slOf(body) {
  var m = typeof body === 'string' ? /^\[弹弓大战\]#(\d{1,15})$/.exec(body) : null;
  return m ? parseInt(m[1], 10) : null;
}
export function gameKind(body) {
  var t = tttOf(body);
  if (t != null) return { k: 'ttt', id: t };
  var s = slOf(body);
  if (s != null) return { k: 'sling', id: s };
  var p = poolOf(body);
  return p != null ? { k: 'pool', id: p } : null;
}
function slStatus(g) {
  var me = S.me.id;
  if (!g) return { t: g === null ? '对局不可用' : '载入中…', you: false };
  if (g.status === 'active') return g.next_player === me ? { t: '轮到你了', you: true } : { t: '等 Ta 出手', you: false };
  if (g.status === 'resigned') return { t: g.winner === me ? 'Ta 认输了' : '你认输了', you: false };
  return { t: g.winner === me ? '你赢了' : 'Ta 赢了', you: false };
}
function slScores(g) { return g.player_a === S.me.id ? [g.score_a, g.score_b] : [g.score_b, g.score_a]; }
export function slFillCard(el) {
  var m = el._m, id = el._gcid;
  if (!m || id == null || !S.me) return;
  var g = SG.games[id];
  var sig = id + '|' + (g ? [g.score_a, g.score_b, g.status, g.next_player, g.winner].join('|') : 'x') + '|' + S.me.id;
  if (!g && !SG.pend[id] && SG.games[id] === undefined) slQueue(id);
  if (el._gsig === sig) return;
  el._gsig = sig;
  var st = slStatus(g), sc = g ? slScores(g) : [0, 0];
  el._bubble.innerHTML = '<div class="gc-sl"><img src="sling/icon-slingshot.png" alt="" draggable="false"><span class="gc-score">' + sc[0] + ':' + sc[1] + '</span></div><div class="gc-txt"><b>弹弓大战</b><span class="gc-st' + (st.you ? ' you' : '') + '">' + st.t + '</span></div>';
}
function slEachCard(fn) { if (S.chat) S.chat.nodes.forEach(function (el) { if (el._gkind === 'sling' && el._gcid != null) fn(el); }); }
function slQueue(id) {
  if (SG.pend[id]) return;
  SG.pend[id] = 1; SG.want.push(id);
  clearTimeout(SG.tm);
  SG.tm = setTimeout(slFetchGames, 0);
}
function slFetchGames() {
  var ids = SG.want.splice(0);
  if (!ids.length || !sb) return;
  sb.from('sling_games').select('*').in('id', ids).then(function (r) {
    ids.forEach(function (id) { delete SG.pend[id]; });
    if (r.error) return;
    var got = {};
    (r.data || []).forEach(function (g) { got[g.id] = 1; slPut(g); });
    ids.forEach(function (id) { if (!got[id] && !SG.games[id]) SG.games[id] = null; slEachCard(function (el) { if (el._gcid === id) slFillCard(el); }); });
  }, function () { ids.forEach(function (id) { delete SG.pend[id]; }); });
}
export function slResync() {
  slEachCard(function (el) { delete SG.pend[el._gcid]; slQueue(el._gcid); });
  if (APP.cur && APP.cur.id === 'sling') {
    var id = APP.cur.params.id;
    sb.from('sling_games').select('*').eq('id', id).maybeSingle().then(function (r) { if (r.data) slPut(r.data); }, function () { /* 离线 */ });
  }
}
function slPut(g) {
  g = tttRow(g);
  if (!g || g.id == null) return;
  var old = SG.games[g.id];
  if (old && Date.parse(old.updated_at) > Date.parse(g.updated_at)) return;
  SG.games[g.id] = g;
  slEachCard(function (el) { if (el._gcid === g.id) slFillCard(el); });
  if (APP.cur && APP.cur.id === 'sling' && APP.cur.params.id === g.id) slV.update(g);
}
function slShowing(id) { return !!(APP.cur && APP.cur.id === 'sling' && APP.cur.params.id === id && S.chat); }
export function onSlingGame(p) {
  var g = p && p.new;
  if (!g || g.id == null || !S.me) return;
  var prev = SG.games[g.id];
  slPut(g);
  if (p.eventType === 'UPDATE' && prev && g.status === 'active' && g.next_player === S.me.id && prev.turn_no !== g.turn_no && !slShowing(g.id) && isVisible()) toast('轮到你了（弹弓大战）');
}
function slStartHere() {
  var c = S.chat;
  if (!c) return;
  if (APP.cur && APP.cur.id === 'sling') return;
  var peer = c.peer;
  sb.rpc('sling_start', { p_peer: peer }).then(function (r) {
    if (r.error) return toast(errText(r.error));
    var g = tttRow(r.data);
    slPut(g);
    if (S.chat && S.chat.peer === peer) openApp('sling', { id: g.id });
  }, function (e) { toast(errText(e)); });
}

// ---- 素材 ----
var SL_IMG_SRC = {
  biscuit: 'sling/block-biscuit.png', chocolate: 'sling/block-chocolate.png', wafer: 'sling/block-wafer.png',
  carrot: 'sling/ammo-carrot.png', snowball: 'sling/ammo-snowball.png', chili: 'sling/ammo-chili.png',
  boom: 'sling/fx-boom.png', ice: 'sling/fx-ice.png', flag: 'sling/flag.png', sling: 'sling/slingshot.png',
  bgDay: 'sling/bg-day.jpg', bgNight: 'sling/bg-night.jpg', mascot: 'zangjian.png'
};
var SLI = null;
function slLoadImages() {
  if (SLI) return;
  SLI = {};
  Object.keys(SL_IMG_SRC).forEach(function (k) {
    var im = new Image();
    im.onload = function () { im._ok = true; if (SV) SV.dirty = true; };
    im.src = SL_IMG_SRC[k];
    SLI[k] = im;
  });
}
function slDark() {
  var t = document.documentElement.getAttribute('data-theme');
  return t === 'dark' || (t !== 'light' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
var SL_AMMO_NAME = { carrot: '胡萝卜', snowball: '雪球', chili: '辣椒' };
var SL_CRUMB = { biscuit: ['#e1ac62', '#c58d44'], chocolate: ['#6b3e26', '#8a5233'], wafer: ['#f4a8bc', '#fbe3c8'] };

var SV = null; // 当前打开的这一局的界面状态
function slPerson(id) { return tttPerson(id); }
export var slV = {
  id: 'sling',
  scope: 'dm',
  label: '弹弓大战',
  img: 'sling/icon-slingshot.png',
  run: function () { slStartHere(); },
  mount: function (box, params) {
    SV = {
      id: params.id, box: box, g: SG.games[params.id] || null, sim: null, mode: 'idle', ammo: 'carrot',
      cam: { x: 300, y: 567, s: 0.5 }, camSet: false, parts: [], trail: [], aim: null, shownTurn: -1, round: -1,
      up: false, sure: false, sureTm: 0, raf: 0, last: 0, acc: 0, dirty: true, off: null, appear: 1, holdUntil: 0,
      local: null, replay: null, delay: 0, syncTok: 0, busy: false, shake: 0, cw: 300, ch: 300, dpr: 1, avImg: [null, null], persons: [null, null],
      hint: lsGet('sling.hint') !== '1', bgKey: '', skyTop: '#f9c9d0', ground: '#d89a3c', frames: 0
    };
    var V = SV;
    var root = h('div', { class: 'sl' });
    if (typeof Matter === 'undefined') {
      root.appendChild(h('div', { class: 'sl-msg', text: '没有加载到游戏引擎，请检查网络后刷新页面。' }));
      box.appendChild(root);
      return;
    }
    slLoadImages();
    V.hud = h('div', { class: 'sl-hud' });
    V.stage = h('div', { class: 'sl-stage' });
    V.cv = h('canvas', { 'aria-label': '弹弓大战' });
    V.hintEl = h('div', { class: 'sl-hint', text: '向后拖动弹弓，松手发射' });
    V.hintEl.hidden = true;
    V.stage.appendChild(V.cv); V.stage.appendChild(V.hintEl);
    V.bar = h('div', { class: 'sl-bar' });
    V.chips = {};
    V.ammoRow = h('div', { class: 'sl-ammo' });
    ['carrot', 'snowball', 'chili'].forEach(function (k) {
      var b = h('button', { type: 'button', class: 'sl-chip', 'aria-label': SL_AMMO_NAME[k] }, h('img', { src: SL_IMG_SRC[k], alt: '', draggable: 'false' }), h('span', { text: SL_AMMO_NAME[k] }));
      b.addEventListener('click', function () { V.ammo = k; slChips(); V.dirty = true; });
      V.chips[k] = b; V.ammoRow.appendChild(b);
    });
    V.act = h('div', { class: 'sl-act' });
    V.bar.appendChild(V.ammoRow); V.bar.appendChild(V.act);
    root.appendChild(V.hud); root.appendChild(V.stage); root.appendChild(V.bar);
    box.appendChild(root);
    box.appendChild(rankButton('sling', 'rk-fab'));
    V.ctx = V.cv.getContext('2d');
    V.ro = window.ResizeObserver ? new ResizeObserver(function () { slResize(); }) : null;
    if (V.ro) V.ro.observe(V.stage);
    slResize();
    slBindInput();
    slChips();
    if (V.g) { slPeople(); slHud(); }
    V.raf = requestAnimationFrame(slLoop);
    var id = params.id;
    sb.from('sling_games').select('*').eq('id', id).maybeSingle().then(function (r) {
      if (!SV || SV.id !== id) return;
      if (r.data) slPut(r.data);
      else if (!SV.g) { toast('找不到这局弹弓大战'); closeApp(); }
    }, function () { /* 离线：显示缓存 */ });
    if (V.g) slSync();
  },
  unmount: function () {
    if (SV) {
      cancelAnimationFrame(SV.raf); clearTimeout(SV.sureTm); clearTimeout(SV.celTm);
      if (SV.ro) SV.ro.disconnect();
      SV.dead = true;
    }
    SV = null;
  },
  same: function (a, b) { return a.id === b.id; },
  update: function (g) {
    if (!SV) return;
    SV.g = g;
    if (!SV.persons[0]) slPeople();
    slSync();
    slEnded();
  }
};
function slSide(g) { return g.player_a === S.me.id ? 0 : 1; }
function slPeople() {
  var V = SV, g = V.g;
  if (!g) return;
  [g.player_a, g.player_b].forEach(function (pid, k) {
    V.persons[k] = slPerson(pid);
    var p = V.persons[k], url = p && avatarUrl(p.avatar_path), im = new Image();
    im.onload = function () { im._ok = true; if (SV) SV.dirty = true; };
    im.onerror = function () { im._ok = false; };
    V.avImg[k] = im;
    im.src = url || mascotSrc(pid);
  });
  V.hudBuilt = false;
}
function slResize() {
  var V = SV;
  if (!V || !V.cv) return;
  var r = V.stage.getBoundingClientRect();
  V.dpr = Math.min(window.devicePixelRatio || 1, 2);
  V.cw = Math.max(80, Math.round(r.width)); V.ch = Math.max(80, Math.round(r.height));
  V.cv.width = Math.round(V.cw * V.dpr); V.cv.height = Math.round(V.ch * V.dpr);
  V.camSet = false; V.dirty = true;
}
function slChips() {
  var V = SV;
  Object.keys(V.chips).forEach(function (k) { V.chips[k].classList.toggle('on', V.ammo === k); V.chips[k].setAttribute('aria-pressed', V.ammo === k ? 'true' : 'false'); });
}
function slMyTurn() {
  var V = SV, g = V.g;
  return !!g && g.status === 'active' && g.next_player === S.me.id && V.mode === 'idle' && !V.up && V.shownTurn === g.turn_no && !!V.sim;
}
function slHud() {
  var V = SV, g = V.g;
  if (!V.hud || !g) return;
  var me = S.me.id;
  if (!V.hudBuilt) {
    V.hudBuilt = true;
    clear(V.hud);
    V.hAv = []; V.hSc = [];
    var cols = [];
    [0, 1].forEach(function (k) {
      var p = V.persons[k] || slPerson(k === 0 ? g.player_a : g.player_b);
      var pid = k === 0 ? g.player_a : g.player_b;
      var av = h('div', { class: 'sl-av', title: pid === me ? '你' : (p ? p.nickname : 'Ta') }, makeAvatar(p, 36));
      var sc = h('b', { class: 'sl-score', text: '0' });
      V.hAv.push(av); V.hSc.push(sc);
      cols.push(h('div', { class: 'sl-pl' + (k ? ' r' : '') }, k ? sc : av, k ? av : sc));
    });
    V.hMid = h('div', { class: 'sl-mid' });
    V.hStat = h('span', { class: 'sl-stat', role: 'status' });
    V.hWind = h('span', { class: 'sl-wind' });
    V.hMid.appendChild(V.hStat); V.hMid.appendChild(V.hWind);
    V.hud.appendChild(cols[0]); V.hud.appendChild(V.hMid); V.hud.appendChild(cols[1]);
  }
  V.hSc[0].textContent = g.score_a; V.hSc[1].textContent = g.score_b;
  var active = g.status === 'active';
  if (active) V.wasActive = true;
  var turnId = !active ? null : (V.up ? (g.player_a === me ? g.player_b : g.player_a) : g.next_player);
  if (V.mode === 'sim' && V.local) turnId = me;
  V.hAv[0].classList.toggle('turn', !!turnId && turnId === g.player_a);
  V.hAv[1].classList.toggle('turn', !!turnId && turnId === g.player_b);
  var st = slStatus(g);
  if (active && V.up) st = { t: '等 Ta 出手', you: false };
  if (V.mode === 'sim') st = V.local ? { t: '发射！', you: true } : { t: 'Ta 出手了', you: false };
  V.hStat.textContent = st.t;
  V.hStat.classList.toggle('you', st.you);
  var w = Number(g.wind) || 0, lv = Math.round(Math.abs(w) * 5);
  var wsig = active ? w : 'x';
  if (V.wsig !== wsig) {
    V.wsig = wsig;
    if (!active) { V.hWind.innerHTML = ''; }
    else if (lv === 0) V.hWind.innerHTML = '<span>无风</span>';
    else {
      var len = 14 + lv * 5;
      V.hWind.innerHTML = '<svg viewBox="0 0 40 14" width="' + len + '" height="14" aria-hidden="true" style="' + (w < 0 ? 'transform:scaleX(-1)' : '') + '"><path d="M1 7h34M28 2l8 5-8 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span>风 ' + lv + '</span>';
    }
  }
  slActions();
  V.dirty = true;
}
function slActions() {
  var V = SV, g = V.g, box = clear(V.act);
  V.ammoRow.hidden = !(g && g.status === 'active');
  if (!g) return;
  if (g.status === 'active') {
    var b = h('button', { type: 'button', class: 'btn small quiet' + (V.sure ? ' sure' : ''), text: V.sure ? '再点确认' : '认输' });
    b.addEventListener('click', slResign);
    box.appendChild(b);
  } else {
    var again = h('button', { type: 'button', class: 'btn', text: '再来一局' });
    again.disabled = V.busy;
    again.addEventListener('click', slAgain);
    box.appendChild(again);
  }
}

// ---- 同步：最新状态 / 重放对手的上一发 ----
function slSeen(id) { var v = parseInt(lsGet('sling.seen.' + id), 10); return isNaN(v) ? 0 : v; }
function slSetSeen(id, n) { if (n > slSeen(id)) lsSet('sling.seen.' + id, String(n)); }
function slBuildScene(g) {
  var V = SV;
  V.sim = new SlSim(g.seed, g.state, Number(g.wind) || 0);
  V.round = g.round_no; V.shownTurn = g.turn_no; V.off = null; V.appear = 0; V.trail = [];
  V.camSet = false; V.dirty = true;
  slHud();
}
function slSync() {
  var V = SV, g = V && V.g;
  if (!V || !g || !V.cv) return;
  slHud();
  if (V.mode !== 'idle') return; // 一发打完 / 庆祝结束后会再来一次
  if (V.shownTurn === g.turn_no && V.round === g.round_no) return;
  if (V.fetching) { V.again = true; return; }
  V.fetching = true;
  var id = g.id, tok = ++V.syncTok;
  sb.from('sling_shots').select('*').eq('game_id', id).order('turn_no', { ascending: false }).limit(2).then(function (r) {
    return r;
  }, function () { return { error: true }; }).then(function (r) {
    if (!SV || SV.id !== id) return;
    V = SV; V.fetching = false;
    var cur = V.g, shots = r && !r.error && r.data ? r.data : [];
    if (V.mode !== 'idle') return;
    var last = shots[0];
    var replay = !!last && last.shooter !== S.me.id && last.turn_no === cur.turn_no - 1 && last.turn_no > slSeen(id);
    if (replay && V.shownTurn === last.turn_no + 1 && V.round === cur.round_no) replay = false;
    if (replay) {
      var prev = shots[1], pre = prev && prev.round_no === last.round_no && prev.turn_no === last.turn_no - 1 ? prev.result : null;
      slStartReplay(last, pre);
    } else {
      if (last && last.shooter !== S.me.id) slSetSeen(id, last.turn_no);
      slBuildScene(cur);
    }
    if (V.again) { V.again = false; if (V.mode === 'idle') slSync(); }
  });
}
function slStartReplay(shot, pre) {
  var V = SV, g = V.g;
  V.sim = new SlSim(shot.seed, pre, Number(shot.wind) || 0);
  V.round = shot.round_no; V.shownTurn = shot.turn_no; V.off = null; V.appear = 1; V.trail = [];
  V.replay = { shot: shot }; V.local = null; V.mode = 'sim'; V.delay = 0.7; V.acc = 0;
  V.sim.fire(shot.shooter === g.player_a ? 0 : 1, shot.ammo, Number(shot.angle), Number(shot.power));
  V.dirty = true;
  slHud();
}
function slBeginFire(angle, power) {
  var V = SV, g = V.g;
  var side = slSide(g);
  V.local = { turn: g.turn_no, ammo: V.ammo, angle: angle, power: power, game: g.id, side: side };
  V.replay = null; V.mode = 'sim'; V.delay = 0; V.acc = 0; V.trail = [];
  // 每一发都从服务器的状态重新搭一个场景来模拟：和对方重放时用的起点完全一样，两边的动画才最接近
  V.sim = new SlSim(g.seed, g.state, Number(g.wind) || 0);
  V.off = null;
  V.sim.fire(side, V.ammo, angle, power);
  V.dirty = true;
  if (V.hint) { V.hint = false; lsSet('sling.hint', '1'); V.hintEl.hidden = true; }
  slHud();
}
function slEvents(V) {
  var ev = V.sim.ev.splice(0), i, e, k;
  for (i = 0; i < ev.length; i++) {
    e = ev[i];
    if (e.t === 'break') {
      var cc = SL_CRUMB[e.type] || SL_CRUMB.biscuit;
      for (k = 0; k < 9; k++) V.parts.push({ x: e.x + (Math.random() - 0.5) * e.w * 0.7, y: e.y + (Math.random() - 0.5) * e.h * 0.7, vx: (Math.random() - 0.5) * 6, vy: -Math.random() * 6 - 1, r: 2.5 + Math.random() * 4, c: cc[k % 2], life: 0, max: 0.9 + Math.random() * 0.6, rot: Math.random() * 6 });
    } else if (e.t === 'boom') {
      V.parts.push({ fx: 'boom', x: e.x, y: e.y, life: 0, max: 0.6 });
      V.shake = 0.35;
    } else if (e.t === 'freeze') {
      for (k = 0; k < 6; k++) V.parts.push({ x: e.x, y: e.y, vx: (Math.random() - 0.5) * 5, vy: -Math.random() * 4, r: 2 + Math.random() * 3, c: '#e6f4ff', life: 0, max: 0.7, rot: 0 });
    } else if (e.t === 'hit' && e.s > 0.15) {
      for (k = 0; k < 3; k++) V.parts.push({ x: e.x, y: e.y, vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 3, r: 2 + Math.random() * 2, c: '#fff3d6', life: 0, max: 0.4, rot: 0 });
    } else if (e.t === 'projEnd') {
      V.holdUntil = performance.now() + 700; V.holdAt = { x: Math.max(0, Math.min(SLW, e.x)), y: Math.max(200, Math.min(900, e.y)) };
    }
  }
}
function slPosOffsets(V, mutate) {
  var sim = V.sim, before = [], i, all = sim.blocks.concat(sim.av);
  for (i = 0; i < all.length; i++) before.push({ x: all[i].position.x, y: all[i].position.y, a: all[i].angle, in: !all[i].sl.broken });
  mutate();
  var off = [];
  for (i = 0; i < all.length; i++) {
    var b = all[i], o = before[i];
    off.push(o.in && !b.sl.broken ? { x: o.x - b.position.x, y: o.y - b.position.y, a: o.a - b.angle } : null);
  }
  V.off = off;
}
function slEndSim() {
  var V = SV, sim = V.sim, g = V.g;
  if (V.local) {
    sim.settle(); // 8 秒上限截停时可能还有东西在半空：先落定再拍快照上传
    var L = V.local, snap = sim.snapshot(), knocked = sim.enemyKnocked();
    if (!knocked && sim.knocked[L.side]) { // 自己的头像被炸下去了：放回堡顶，不算分
      // 放到这一列现在最高的表面上（塔可能已经被打矮了，按最初的塔顶高度放会悬空）
      var la = sim.layouts[L.side].av, top = PLAT_Y;
      sim.blocks.forEach(function (b) {
        if (!b.sl.broken && b.sl.side === L.side && b.bounds.min.x < la.x + AV_R && b.bounds.max.x > la.x - AV_R) top = Math.min(top, b.bounds.min.y);
      });
      snap.v[L.side] = [la.x, Math.round((top - AV_R - 1) * 10) / 10, 0];
    }
    slPosOffsets(V, function () { sim.applyState(snap); sim.sleepAll(); });
    V.mode = 'idle'; V.local = null;
    V.shownTurn = L.turn + 1; V.up = true;
    slHud();
    slUpload({ game: L.game, turn: L.turn, ammo: L.ammo, angle: L.angle, power: L.power, snap: snap, knocked: knocked }, 0);
    if (knocked) slCelebrate(true, false);
  } else if (V.replay) {
    var sh = V.replay.shot;
    slPosOffsets(V, function () { sim.applyState(sh.result); sim.sleepAll(); });
    V.mode = 'idle'; V.replay = null;
    V.shownTurn = sh.turn_no + 1;
    slSetSeen(sh.game_id, sh.turn_no);
    slHud();
    if (sh.knocked) slCelebrate(false, false); else slSync();
  }
  V.dirty = true;
}
// 击落后的小庆祝，然后换新的堡垒；赢了/输了的动效在对局状态到达时再补
function slCelebrate(mine, over) {
  var V = SV, k, cols = ['#e1ac62', '#6b3e26', '#f4a8bc', '#ffe08a', '#ff8fab'];
  V.mode = 'celebrate';
  if (mine) {
    for (k = 0; k < 60; k++) V.parts.push({ x: 800 + Math.random() * 400, y: 300 + Math.random() * 100, vx: (Math.random() - 0.5) * 8, vy: Math.random() * 3, r: 3 + Math.random() * 4, c: cols[k % 5], life: 0, max: 1.6 + Math.random(), rot: Math.random() * 6 });
    popCheer('打中了！');
  } else V.shake = 0.6;
  clearTimeout(V.celTm);
  V.celTm = setTimeout(function () { if (SV === V) { V.mode = 'idle'; slSync(); slEnded(); } }, 1900);
}
function slEnded() {
  var V = SV, g = V && V.g;
  if (!V || !g || V.endShown || g.status === 'active') return;
  if (V.mode !== 'idle') return;
  if (V.shownTurn !== g.turn_no && g.status !== 'resigned') return;
  V.endShown = true;
  if (!V.wasActive) return; // 打开时就已经结束：不放动效
  if (g.winner === S.me.id) popCheer('你赢了！');
  else if (g.status !== 'resigned') V.shake = 0.8;
}
function slUpload(a, tries) {
  var V = SV, id = a.game;
  var done = function () { if (SV && SV.id === id) { SV.up = false; SV.dirty = true; slHud(); if (SV.mode === 'idle') slSync(); } };
  var args = { p_game: a.game, p_turn_no: a.turn, p_ammo: a.ammo, p_angle: a.angle, p_power: a.power, p_result: a.snap, p_knocked: a.knocked };
  var terminal = { not_your_turn: 1, stale_turn: 1, game_over: 1, game_not_found: 1, invalid_ammo: 1, invalid_shot: 1, not_authenticated: 1 };
  var retry = function () {
    if (tries >= 6) { toast('网络不好，这一发没有发出去'); if (SV && SV.id === id) { SV.shownTurn = -1; SV.up = false; slSync(); } return; }
    setTimeout(function () { slUpload(a, tries + 1); }, Math.min(8000, 1000 * Math.pow(2, tries)));
  };
  sb.rpc('sling_shoot', args).then(function (r) {
    if (!r.error) {
      var d = r.data || {};
      if (d.game) slPut(d.game);
      firePush('sling_turn', d.shot_id);
      done();
      return;
    }
    var msg = r.error.message || '';
    if (!terminal[msg]) { retry(); return; }
    // 已经提交过 / 回合过期：以服务器为准
    sb.from('sling_shots').select('id,shooter').eq('game_id', id).eq('turn_no', a.turn).maybeSingle().then(function (q) {
      if (q.data && q.data.shooter === S.me.id) firePush('sling_turn', q.data.id);
      else if (msg !== 'game_over') toast(errText(r.error));
      sb.from('sling_games').select('*').eq('id', id).maybeSingle().then(function (gq) {
        if (SV && SV.id === id && !(q.data && q.data.shooter === S.me.id)) { SV.shownTurn = -1; }
        if (gq.data) slPut(gq.data);
        done();
      }, done);
    }, done);
  }, retry);
}
function slResign() {
  var V = SV, g = V && V.g;
  if (!g || g.status !== 'active') return;
  if (!V.sure) {
    V.sure = true; slActions();
    V.sureTm = setTimeout(function () { if (SV === V) { V.sure = false; slActions(); } }, 3000);
    return;
  }
  clearTimeout(V.sureTm); V.sure = false;
  var id = g.id;
  sb.rpc('sling_resign', { p_game: id }).then(function (r) {
    if (r.error) { toast(errText(r.error)); sb.from('sling_games').select('*').eq('id', id).maybeSingle().then(function (q) { if (q.data) slPut(q.data); }); return; }
    slPut(r.data);
  }, function (e) { toast(errText(e)); });
}
function slAgain() {
  var V = SV, g = V && V.g;
  if (!g || V.busy) return;
  var other = g.player_a === S.me.id ? g.player_b : g.player_a, id = g.id;
  V.busy = true; slActions();
  sb.rpc('sling_start', { p_peer: other }).then(function (r) {
    if (SV && SV.id === id) SV.busy = false;
    if (r.error) { toast(errText(r.error)); if (SV) slActions(); return; }
    var ng = tttRow(r.data);
    slPut(ng);
    if (S.chat && S.chat.peer === other) openApp('sling', { id: ng.id });
  }, function (e) { if (SV) { SV.busy = false; slActions(); } toast(errText(e)); });
}

// ---- 输入：向后拖，松手发射 ----
function slBindInput() {
  var V = SV, cv = V.cv, MAXD = 150;
  function calc(ev) {
    // 用屏幕上的位移除以当前缩放：镜头还在移动时也不影响拉的距离和角度
    var side = slSide(V.g), dir = side === 0 ? 1 : -1;
    var dx = (ev.clientX - V.aim.sx) / V.cam.s, dy = (ev.clientY - V.aim.sy) / V.cam.s, len = Math.sqrt(dx * dx + dy * dy);
    if (len > MAXD) { dx *= MAXD / len; dy *= MAXD / len; len = MAXD; }
    V.aim.dx = dx; V.aim.dy = dy;
    var lx = -dx * dir, ly = dy; // 发射方向 = 拖动的反方向（向前为正，向上为正）
    V.aim.valid = len >= 14 && lx > 4;
    var ang = Math.atan2(ly, Math.max(lx, 0.001)) * 180 / Math.PI;
    V.aim.angle = Math.round(Math.max(-30, Math.min(85, ang)) * 10) / 10;
    V.aim.power = Math.round(Math.max(0.05, Math.min(1, len / MAXD)) * 100) / 100;
    V.dirty = true;
  }
  cv.addEventListener('pointerdown', function (ev) {
    if (!slMyTurn() || V.aim) return;
    V.aim = { sx: ev.clientX, sy: ev.clientY, dx: 0, dy: 0, id: ev.pointerId, valid: false, angle: 30, power: 0.5 };
    try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
    ev.preventDefault();
    if (V.hintEl) V.hintEl.hidden = true;
  });
  cv.addEventListener('pointermove', function (ev) { if (V.aim && ev.pointerId === V.aim.id) { calc(ev); ev.preventDefault(); } });
  function end(ev, cancel) {
    if (!V.aim || ev.pointerId !== V.aim.id) return;
    calc(ev);
    var a = V.aim;
    V.aim = null; V.dirty = true;
    if (!cancel && a.valid && slMyTurn()) slBeginFire(a.angle, a.power);
  }
  cv.addEventListener('pointerup', function (ev) { end(ev, false); });
  cv.addEventListener('pointercancel', function (ev) { end(ev, true); });
}

// ---- 主循环 ----
function slLoop(ts) {
  var V = SV;
  if (!V || V.dead) return;
  V.raf = requestAnimationFrame(slLoop);
  var dt = V.last ? Math.min(0.05, (ts - V.last) / 1000) : 0.016;
  V.last = ts;
  if (document.hidden) return;
  var busy = false;
  if (V.mode === 'sim' && V.sim) {
    busy = true;
    if (V.delay > 0) V.delay -= dt;
    else {
      V.acc += dt;
      var n = 0;
      while (V.acc >= 1 / 60 && n < 4) {
        V.acc -= 1 / 60; n++;
        V.sim.step();
        if (V.sim.proj) { V.trail.push({ x: V.sim.proj.position.x, y: V.sim.proj.position.y }); if (V.trail.length > 40) V.trail.shift(); }
        if (V.sim.over) break;
      }
      if (V.acc > 0.1) V.acc = 0;
      slEvents(V);
      if (V.sim.over) { slEndSim(); busy = true; }
    }
  }
  if (V.appear < 1) { V.appear = Math.min(1, V.appear + dt * 2.2); busy = true; }
  if (V.parts.length) {
    busy = true;
    var i, p, w = dt * 60;
    for (i = V.parts.length - 1; i >= 0; i--) {
      p = V.parts[i]; p.life += dt;
      if (p.life > p.max) { V.parts.splice(i, 1); continue; }
      if (!p.fx) { p.vy += 0.35 * w; p.x += p.vx * w; p.y += p.vy * w; p.rot += 0.1 * w; }
    }
  }
  if (V.shake > 0) { V.shake = Math.max(0, V.shake - dt); busy = true; }
  if (V.off) {
    var any = false, f = Math.pow(0.001, dt), j;
    for (j = 0; j < V.off.length; j++) {
      var o = V.off[j];
      if (!o) continue;
      o.x *= f; o.y *= f; o.a *= f;
      if (Math.abs(o.x) + Math.abs(o.y) + Math.abs(o.a) > 0.05) any = true;
    }
    if (any) busy = true; else V.off = null;
  }
  if (V.aim) busy = true;
  var dk = slDark();
  if (dk !== V.dk) { V.dk = dk; V.dirty = true; }
  if (slCamUpdate(V, dt)) busy = true;
  var hint = V.hint && slMyTurn() && !V.aim;
  if (V.hintEl && V.hintEl.hidden === hint) V.hintEl.hidden = !hint;
  if (busy || V.dirty) { V.dirty = false; slDraw(V, ts); V.frames++; }
}
function slCamUpdate(V, dt) {
  var s0 = V.ch / 620, vw = V.cw / s0, vh = V.ch / s0, tx, ty, ts = s0, c = V.cam, g = V.g;
  var sim = V.sim, now = performance.now();
  var side = g ? slSide(g) : 0;
  if (V.mode === 'sim' && sim && V.delay <= 0 && sim.proj) {
    tx = sim.proj.position.x; ty = Math.min(sim.proj.position.y, 640);
  } else if (V.mode === 'sim' && V.holdUntil > now && V.holdAt) {
    tx = V.holdAt.x; ty = V.holdAt.y;
  } else if (V.mode === 'sim' && V.delay > 0 && V.replay) {
    var rs = V.replay.shot.shooter === g.player_a ? 0 : 1;
    tx = rs === 0 ? 40 + vw / 2 : SLW - 40 - vw / 2; ty = PLAT_Y - 260;
  } else if (g && slMyTurn()) {
    tx = side === 0 ? 40 + vw / 2 : SLW - 40 - vw / 2; ty = PLAT_Y - 260;
  } else {
    ts = V.cw / 1800; tx = SLW / 2; ty = 500;
    vw = V.cw / ts; vh = V.ch / ts;
  }
  if (vw <= SLW) tx = Math.max(vw / 2, Math.min(SLW - vw / 2, tx)); else tx = SLW / 2;
  if (vh <= SLH) ty = Math.max(vh / 2, Math.min(SLH - vh / 2, ty)); else ty = SLH / 2;
  if (!V.camSet) { c.x = tx; c.y = ty; c.s = ts; V.camSet = true; return true; }
  var k = 1 - Math.exp(-dt * (V.mode === 'sim' && sim && sim.proj ? 9 : 4.5));
  var dx = tx - c.x, dy = ty - c.y, ds = ts - c.s;
  if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3 && Math.abs(ds) < 0.0004) { c.x = tx; c.y = ty; c.s = ts; return false; }
  c.x += dx * k; c.y += dy * k; c.s += ds * Math.min(1, k * 0.9);
  return true;
}
function slBg(V) {
  var key = slDark() ? 'bgNight' : 'bgDay', im = SLI[key];
  if (V.bgKey !== key && im && im._ok) {
    V.bgKey = key;
    try {
      var cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
      var cx = cv.getContext('2d'); cx.drawImage(im, 0, 0);
      var a = cx.getImageData(4, 2, 1, 1).data, b = cx.getImageData(Math.floor(im.naturalWidth / 2), im.naturalHeight - 3, 1, 1).data;
      V.skyTop = 'rgb(' + a[0] + ',' + a[1] + ',' + a[2] + ')'; V.ground = 'rgb(' + b[0] + ',' + b[1] + ',' + b[2] + ')';
    } catch (e) { V.skyTop = key === 'bgNight' ? '#2a1b2c' : '#f9c9d0'; V.ground = key === 'bgNight' ? '#4a2c1a' : '#d89a3c'; }
  }
  if (!V.bgKey) { var dk = slDark(); V.skyTop = dk ? '#2a1b2c' : '#f9c9d0'; V.ground = dk ? '#4a2c1a' : '#d89a3c'; }
  return im && im._ok ? im : null;
}
function slDraw(V, ts) {
  var c = V.ctx, cam = V.cam, k = V.dpr * cam.s, sim = V.sim, i, b, shx = 0;
  var bg = slBg(V);
  if (V.shake > 0) shx = Math.sin(ts / 22) * V.shake * 9;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = V.skyTop; c.fillRect(0, 0, V.cv.width, V.cv.height);
  c.setTransform(k, 0, 0, k, V.dpr * (V.cw / 2 - cam.x * cam.s + shx), V.dpr * (V.ch / 2 - cam.y * cam.s));
  c.fillStyle = V.ground; c.fillRect(-3000, SLH - 1, SLW + 6000, 4000);
  if (bg) c.drawImage(bg, 0, 0, SLW, SLH);
  else { c.fillStyle = V.skyTop; c.fillRect(0, 0, SLW, SLH); c.fillStyle = V.ground; c.fillRect(0, PLAT_Y, PLAT_X, 200); c.fillRect(SLW - PLAT_X, PLAT_Y, PLAT_X, 200); }
  if (!sim) return;
  var g = V.g, side = g ? slSide(g) : 0, wind = g ? Number(g.wind) || 0 : 0;
  // 旗子和弹弓
  var lay = sim.layouts, sw = SLI.sling._ok;
  for (i = 0; i < 2; i++) {
    // 旗子插在头像脚下那一层：跟着头像走，塔被打矮了也不会悬空
    var fl = lay[i].flag, av0 = lay[i].av, avb = sim.av[i], im = SLI.flag;
    if (im._ok) {
      c.save(); c.translate(avb.position.x + (fl.x - av0.x), avb.position.y + (fl.y - av0.y)); c.rotate((i === 0 ? 1 : 1) * wind * 0.22);
      c.drawImage(im, -14, -50, 34, 50); c.restore();
    }
    var ax = i === 0 ? SL_ANCHOR.x : SLW - SL_ANCHOR.x;
    c.save(); c.translate(ax, PLAT_Y + 6); if (i === 1) c.scale(-1, 1);
    if (sw) c.drawImage(SLI.sling, -52, -166, 104, 172);
    else { c.fillStyle = '#6b3e26'; c.fillRect(-8, -130, 16, 136); }
    c.restore();
  }
  // 方块（带冲击后的回弹偏移，让快照对齐不突兀）
  var all = sim.blocks, off = V.off, nb = all.length;
  c.globalAlpha = V.appear;
  for (i = 0; i < nb; i++) {
    b = all[i];
    if (b.sl.broken) continue;
    var o = off && off[i], bx = b.position.x + (o ? o.x : 0), by = b.position.y + (o ? o.y : 0), ba = b.angle + (o ? o.a : 0), d = b.sl;
    c.save(); c.translate(bx, by + (1 - V.appear) * -30); c.rotate(ba);
    var bi = SLI[d.type];
    if (bi._ok) c.drawImage(bi, -d.w / 2 - 1.5, -d.h / 2 - 1.5, d.w + 3, d.h + 3);
    else { c.fillStyle = d.type === 'chocolate' ? '#6b3e26' : d.type === 'wafer' ? '#f4a8bc' : '#e1ac62'; c.fillRect(-d.w / 2, -d.h / 2, d.w, d.h); }
    var hr = d.hp / d.maxhp;
    if (hr < 0.65) {
      c.strokeStyle = 'rgba(50,25,10,' + (0.55 * (1 - hr)).toFixed(2) + ')'; c.lineWidth = 2; c.beginPath();
      var q = (d.id * 7) % 5 - 2;
      c.moveTo(-8 + q, -d.h / 2); c.lineTo(-2 + q, -4); c.lineTo(-12 + q, 6); c.lineTo(-6 + q, d.h / 2);
      if (hr < 0.35) { c.moveTo(14, -d.h / 2); c.lineTo(8, 2); c.lineTo(16, d.h / 2); }
      c.stroke();
    }
    if (d.frozen) {
      c.fillStyle = 'rgba(150,205,245,0.38)'; c.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
      if (SLI.ice._ok) { c.globalAlpha = V.appear; c.drawImage(SLI.ice, -d.w / 2 - 4, -d.h / 2 - 4, d.w + 8, d.h + 8); c.drawImage(SLI.ice, -d.w / 2 - 4, -d.h / 2 - 4, d.w + 8, d.h + 8); }
      c.strokeStyle = 'rgba(210,235,255,0.9)'; c.lineWidth = 2; c.strokeRect(-d.w / 2 + 1, -d.h / 2 + 1, d.w - 2, d.h - 2);
    }
    c.restore();
  }
  // 头像
  for (i = 0; i < 2; i++) {
    var a = sim.av[i], oo = off && off[nb + i], ax2 = a.position.x + (oo ? oo.x : 0), ay2 = a.position.y + (oo ? oo.y : 0) + (1 - V.appear) * -30;
    var mine = (i === side), im2 = V.avImg[i];
    c.save(); c.translate(ax2, ay2); c.rotate(a.angle + (oo ? oo.a : 0));
    c.beginPath(); c.arc(0, 0, AV_R + 3, 0, 6.2832); c.fillStyle = '#f6e8dc'; c.fill();
    c.save(); c.beginPath(); c.arc(0, 0, AV_R + 1, 0, 6.2832); c.clip();
    if (im2 && im2._ok) { var iw = im2.naturalWidth, ih = im2.naturalHeight, m = Math.min(iw, ih); c.drawImage(im2, (iw - m) / 2, (ih - m) / 2, m, m, -AV_R - 1, -AV_R - 1, 2 * AV_R + 2, 2 * AV_R + 2); }
    c.restore();
    c.lineWidth = 3; c.strokeStyle = mine ? '#ff8fab' : '#8a5233'; c.beginPath(); c.arc(0, 0, AV_R + 2, 0, 6.2832); c.stroke();
    c.restore();
  }
  c.globalAlpha = 1;
  // 瞄准：橡皮筋、装好的弹药、弹道点
  var ammoK = V.ammo, r0 = SL_AMMO[ammoK].r, ap = SLI[ammoK];
  if (slMyTurn() || (V.mode === 'idle' && V.aim)) {
    var dir = side === 0 ? 1 : -1, ax3 = side === 0 ? SL_ANCHOR.x : SLW - SL_ANCHOR.x, ay3 = SL_ANCHOR.y;
    var px = ax3, py = ay3;
    if (V.aim) { px += V.aim.dx; py += V.aim.dy; }
    c.strokeStyle = '#ff8fab'; c.lineWidth = 6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(ax3 - 20 * dir, ay3 + 4); c.lineTo(px, py); c.lineTo(ax3 + 20 * dir, ay3 + 4); c.stroke();
    if (ap._ok) c.drawImage(ap, px - r0 * 1.25, py - r0 * 1.25, r0 * 2.5, r0 * 2.5);
    if (V.aim && V.aim.valid) {
      var pts = slPreview(side, V.aim.angle, V.aim.power, wind, 40), j;
      for (j = 2; j < pts.length; j += 3) {
        var f = 1 - j / pts.length;
        c.beginPath(); c.arc(pts[j].x, pts[j].y, 3 + 4 * f, 0, 6.2832);
        c.fillStyle = 'rgba(255,255,255,' + (0.35 + 0.6 * f).toFixed(2) + ')'; c.fill();
        c.lineWidth = 1.5; c.strokeStyle = 'rgba(107,62,38,' + (0.3 + 0.5 * f).toFixed(2) + ')'; c.stroke();
      }
    }
  }
  // 飞行中的弹药和拖尾
  if (sim.proj) {
    var pj = sim.proj, pim = SLI[pj.sl.ammo], t, tr = V.trail;
    for (t = 0; t < tr.length; t += 3) {
      c.beginPath(); c.arc(tr[t].x, tr[t].y, 2 + 3 * (t / tr.length), 0, 6.2832);
      c.fillStyle = 'rgba(255,255,255,' + (0.5 * t / tr.length).toFixed(2) + ')'; c.fill();
    }
    c.save(); c.translate(pj.position.x, pj.position.y); c.rotate(pj.angle);
    var rr = pj.sl.r * 1.3;
    if (pim._ok) c.drawImage(pim, -rr, -rr, rr * 2, rr * 2);
    c.restore();
  }
  // 粒子
  for (i = 0; i < V.parts.length; i++) {
    var p = V.parts[i], lf = p.life / p.max;
    if (p.fx === 'boom') {
      var sz = 120 + 300 * Math.min(1, lf * 1.6);
      c.globalAlpha = 1 - lf * lf;
      if (SLI.boom._ok) c.drawImage(SLI.boom, p.x - sz / 2, p.y - sz / 2, sz, sz);
      c.globalAlpha = 1;
    } else {
      c.save(); c.globalAlpha = 1 - lf; c.translate(p.x, p.y); c.rotate(p.rot);
      c.fillStyle = p.c; c.fillRect(-p.r, -p.r * 0.7, p.r * 2, p.r * 1.4); c.restore();
    }
  }
}
