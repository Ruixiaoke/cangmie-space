// 胜场排行榜：我和好友的战绩，井字棋 / 弹弓 / 9球 / 8球 四张榜（后端 game_leaderboard，见 supabase/migrations/20261123000000_leaderboard.sql）

import { errText } from '../errors.js';
import { S, makeAvatar, sb } from '../state.js';
import { $, clear, h } from '../utils.js';

// ===== 胜场排行榜 =====
// 共用的浮层：任何小程序调 openLeaderboard('ttt' | 'sling' | 'pool' | 'pool8') 就能打开，默认停在传进来的那张榜。
// 每张榜缓存 30 秒（切 tab 秒开）；每次打开都会重新拉一次，数据回来前先显示缓存。
var GAMES = [
  { id: 'ttt', label: '井字棋', note: '赢下一局算 1 胜，对方认输也算，平局不计' },
  { id: 'sling', label: '弹弓', note: '赢下一整场算 1 胜，单次击倒不算' },
  { id: 'pool', label: '9球', note: '9球：每赢下一盘球算 1 胜，认输算负' },
  { id: 'pool8', label: '8球', note: '8球：每赢下一盘球算 1 胜，提前打进 8 号或认输算负' }
];
var TTL = 30000;
var LB = { card: null, el: null, game: 'ttt', cache: {}, tok: 0, keyFn: null, tabs: {}, list: null, note: null, lastFocus: null };
export function lbReset() { LB.cache = {}; closeLeaderboard(); }

function gameOf(id) { for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) return GAMES[i]; return GAMES[0]; }
// 入口按钮：小圆钮，奖杯图标；图片加载失败就退成一个“榜”字。game 可以是函数（点的时候才决定看哪张榜）
export function rankButton(game, cls) {
  var b = h('button', { type: 'button', class: 'rk-btn' + (cls ? ' ' + cls : ''), 'aria-label': '排行榜', title: '排行榜' });
  var img = h('img', { src: 'rank/icon-rank.png', alt: '', draggable: 'false' });
  img.addEventListener('error', function () { clear(b).appendChild(h('span', { class: 'rk-fb', text: '榜' })); });
  b.appendChild(img);
  b.addEventListener('click', function () { openLeaderboard(typeof game === 'function' ? game() : game); });
  return b;
}
export function openLeaderboard(game) {
  var chat = $('chat');
  if (!chat || !S.me) return;
  if (!LB.el) buildSheet(chat);
  LB.lastFocus = document.activeElement;
  LB.el.hidden = false;
  void LB.el.offsetWidth;
  LB.el.classList.add('show');
  document.addEventListener('keydown', LB.keyFn = onKey, true);
  pick(gameOf(game).id, true);
  LB.card.focus({ preventScroll: true });
}
export function closeLeaderboard() {
  if (!LB.el || LB.el.hidden) return;
  LB.tok++;
  LB.el.hidden = true;
  LB.el.classList.remove('show');
  document.removeEventListener('keydown', LB.keyFn, true);
  var f = LB.lastFocus;
  LB.lastFocus = null;
  if (f && f.focus && document.body.contains(f)) { try { f.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ } }
}
function onKey(ev) {
  if (ev.key !== 'Escape') return;
  ev.stopPropagation();
  closeLeaderboard();
}
function buildSheet(chat) {
  var el = h('div', { id: 'rankSheet', hidden: true });
  el.addEventListener('click', function (ev) { if (ev.target === el) closeLeaderboard(); });
  var tabs = h('div', { class: 'rk-tabs', role: 'tablist', 'aria-label': '选择游戏' });
  GAMES.forEach(function (g) {
    var t = h('button', { type: 'button', class: 'rk-tab', role: 'tab', text: g.label, 'data-g': g.id });
    t.addEventListener('click', function () { pick(g.id); });
    LB.tabs[g.id] = t; tabs.appendChild(t);
  });
  var x = h('button', { type: 'button', class: 'rk-x', 'aria-label': '关闭' });
  x.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-x"/></svg>';
  x.addEventListener('click', closeLeaderboard);
  LB.note = h('p', { class: 'rk-note' });
  LB.list = h('div', { class: 'rk-list', role: 'tabpanel', 'aria-live': 'polite' });
  var card = h('div', { class: 'rk-card', role: 'dialog', tabindex: '-1', 'aria-modal': 'true', 'aria-label': '排行榜' },
    h('div', { class: 'rk-head' }, h('h3', { text: '排行榜' }), h('span', { class: 'rk-sub', text: '我和好友的胜场' }), x),
    tabs, LB.note, LB.list);
  el.appendChild(card);
  LB.card = card;
  chat.appendChild(el);
  LB.el = el;
}
function pick(id, force) {
  LB.game = id;
  var g = gameOf(id);
  Object.keys(LB.tabs).forEach(function (k) {
    LB.tabs[k].classList.toggle('on', k === id);
    LB.tabs[k].setAttribute('aria-selected', k === id ? 'true' : 'false');
  });
  LB.note.textContent = g.note;
  var c = LB.cache[id];
  if (c) render(g, c.rows);
  else showMsg('载入中…');
  if (force || !c || Date.now() - c.t > TTL) load(g, !!c);
}
// 打开浮层时一定重新拉；切 tab 时缓存没过期（30 秒）就不拉
function load(g, quiet) {
  var tok = ++LB.tok;
  if (!sb) return showMsg('暂时连不上，请稍后再试', true);
  sb.rpc('game_leaderboard', { p_game: g.id }).then(function (r) {
    if (tok !== LB.tok || !LB.el || LB.el.hidden) return;
    if (r.error) { if (!quiet) showMsg(errText(r.error), true); return; }
    LB.cache[g.id] = { t: Date.now(), rows: r.data || [] };
    if (LB.game === g.id) render(g, LB.cache[g.id].rows);
  }, function (e) {
    if (tok !== LB.tok || !LB.el || LB.el.hidden) return;
    if (!quiet) showMsg(errText(e), true);
  });
}
function showMsg(text, retry) {
  var box = clear(LB.list);
  box.appendChild(h('div', { class: 'rk-msg', text: text }));
  if (retry) {
    var b = h('button', { type: 'button', class: 'btn small', text: '重试' });
    b.addEventListener('click', function () { showMsg('载入中…'); load(gameOf(LB.game), false); });
    box.lastChild.appendChild(b);
  }
}
// 名次：胜、负都一样就并列（1, 1, 3）
function render(g, rows) {
  var box = clear(LB.list), me = S.me && S.me.id, rank = 0, prev = null, i;
  if (!rows.length) return showMsg('还没有数据');
  var solo = rows.length === 1;
  for (i = 0; i < rows.length; i++) {
    var r = rows[i], key = r.wins + '/' + r.losses;
    if (key !== prev) { rank = i + 1; prev = key; }
    box.appendChild(rowEl(r, rank, r.user_id === me));
  }
  if (solo) box.appendChild(h('div', { class: 'rk-hint', text: '加几个好友，一起比一比' }));
}
function rowEl(r, rank, mine) {
  var total = r.wins + r.losses;
  var sec = total ? r.losses + ' 负 · 胜率 ' + Math.round(r.wins / total * 100) + '%' : '还没玩过';
  var badge = h('span', { class: 'rk-rank' + (rank <= 3 ? ' top' : ''), text: String(rank) });
  if (rank <= 3 && r.wins > 0) {
    var img = h('img', { class: 'rk-medal', src: 'rank/medal-' + rank + '.png', alt: '第 ' + rank + ' 名', draggable: 'false' });
    img.addEventListener('error', function () { img.replaceWith(h('span', { class: 'rk-rank top n' + rank, text: String(rank) })); });
    badge = img;
  }
  var av = r.avatar_path ? { avatar_path: r.avatar_path, nickname: r.nickname } : { nickname: r.nickname };
  return h('div', { class: 'rk-row' + (mine ? ' me' : '') + (r.wins === 0 ? ' zero' : '') },
    badge,
    makeAvatar(av, 36),
    h('div', { class: 'rk-who' },
      h('b', null, r.nickname || 'Ta', mine ? h('i', { text: '我' }) : null),
      h('span', { text: sec })),
    h('div', { class: 'rk-wins' }, h('b', { text: String(r.wins) }), h('span', { text: '胜' })));
}
