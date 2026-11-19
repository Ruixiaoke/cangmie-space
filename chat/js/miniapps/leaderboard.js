// 排行榜：井字棋 / 弹弓 / 9球 / 8球 四张胜场榜（后端 game_leaderboard，见 supabase/migrations/20261123000000_leaderboard.sql），
// 加斗地主、麻将两张积分榜（后端 ddz_leaderboard / mj_leaderboard，见 supabase/migrations/20261205000000_ddz_leaderboard.sql 和 20261211000000_mahjong.sql，有「好友」「本群」两个范围）

import { errText } from '../errors.js';
import { S, makeAvatar, sb } from '../state.js';
import { $, clear, h } from '../utils.js';

// ===== 胜场排行榜 =====
// 共用的浮层：任何小程序调 openLeaderboard('ttt' | 'sling' | 'pool' | 'pool8' | 'ddz' | 'mahjong') 就能打开，默认停在传进来的那张榜。
// 每张榜（斗地主还要加上范围和群）缓存 30 秒（切 tab 秒开）；每次打开都会重新拉一次，数据回来前先显示缓存。
var GAMES = [
  { id: 'ttt', label: '井字棋', note: '赢下一局算 1 胜，对方认输也算，平局不计' },
  { id: 'sling', label: '弹弓', note: '赢下一整场算 1 胜，单次击倒不算' },
  { id: 'pool', label: '9球', note: '9球：每赢下一盘球算 1 胜，认输算负' },
  { id: 'pool8', label: '8球', note: '8球：每赢下一盘球算 1 胜，提前打进 8 号或认输算负' },
  { id: 'ddz', label: '斗地主', note: '积分：地主赢拿 2 倍（四人局 3 倍），农民各拿 1 倍，输了扣同样的分；倍数看叫分、炸弹和春天', points: true, rpc: 'ddz_leaderboard' },
  { id: 'mahjong', label: '麻将', note: '积分：自摸三家各付番数，点炮一家付三倍番数；番 = 底 1 + 碰碰胡、七对、混一色、清一色、门清、杠上开花、抢杠胡、海底捞月', points: true, rpc: 'mj_leaderboard' },
  { id: 'fxq', label: '飞行棋', note: '第一个让 4 架飞机都到家的人算 1 胜，其他人算输一局，机器人不计', scoped: true, rpc: 'fxq_leaderboard', subs: { friends: '我和好友的胜场', group: '本群成员的胜场' } }
];
var PTS_SUB = { friends: '我和好友的积分', group: '本群成员的积分' };
var TTL = 30000;
var LB = { card: null, el: null, game: 'ttt', scope: 'friends', gid: null, cache: {}, tok: 0, keyFn: null, tabs: {}, segs: {}, seg: null, sub: null, list: null, note: null, lastFocus: null };
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
  // 群里打开：斗地主榜默认看本群；私聊里没有「本群」，看好友
  LB.gid = S.chat && S.chat.gid != null ? S.chat.gid : null;
  LB.scope = LB.gid != null ? 'group' : 'friends';
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
  var seg = h('div', { class: 'rk-seg', role: 'group', 'aria-label': '榜的范围', hidden: true });
  [['friends', '好友'], ['group', '本群']].forEach(function (o) {
    var t = h('button', { type: 'button', class: 'rk-segb', text: o[1], 'data-s': o[0] });
    t.addEventListener('click', function () { pickScope(o[0]); });
    LB.segs[o[0]] = t; seg.appendChild(t);
  });
  LB.seg = seg;
  var x = h('button', { type: 'button', class: 'rk-x', 'aria-label': '关闭' });
  x.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-x"/></svg>';
  x.addEventListener('click', closeLeaderboard);
  LB.note = h('p', { class: 'rk-note' });
  LB.list = h('div', { class: 'rk-list', role: 'tabpanel', 'aria-live': 'polite' });
  var card = h('div', { class: 'rk-card', role: 'dialog', tabindex: '-1', 'aria-modal': 'true', 'aria-label': '排行榜' },
    h('div', { class: 'rk-head' }, h('h3', { text: '排行榜' }), (LB.sub = h('span', { class: 'rk-sub', text: '我和好友的胜场' })), x),
    tabs, seg, LB.note, LB.list);
  el.appendChild(card);
  LB.card = card;
  chat.appendChild(el);
  LB.el = el;
}
function keyOf(g) { return g.points || g.scoped ? g.id + '|' + LB.scope + '|' + (LB.scope === 'group' ? LB.gid : '') : g.id; }
function pick(id, force) {
  LB.game = id;
  var g = gameOf(id);
  Object.keys(LB.tabs).forEach(function (k) {
    LB.tabs[k].classList.toggle('on', k === id);
    LB.tabs[k].setAttribute('aria-selected', k === id ? 'true' : 'false');
  });
  // 标签多了会横向滚动：选中的那个滚进可见范围（只动标签栏，不动整页）
  var tab = LB.tabs[id], bar = tab && tab.parentNode;
  if (bar && bar.scrollWidth > bar.clientWidth) {
    var l = tab.getBoundingClientRect().left - bar.getBoundingClientRect().left + bar.scrollLeft, r = l + tab.offsetWidth;
    if (l < bar.scrollLeft) bar.scrollLeft = l - 4;
    else if (r > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = r - bar.clientWidth + 4;
  }
  LB.note.textContent = g.note;
  LB.seg.hidden = !(g.points || g.scoped);
  LB.segs.group.hidden = LB.gid == null;
  if (g.points || g.scoped) {
    Object.keys(LB.segs).forEach(function (k) { LB.segs[k].classList.toggle('on', k === LB.scope); LB.segs[k].setAttribute('aria-pressed', k === LB.scope ? 'true' : 'false'); });
    LB.sub.textContent = (g.subs || PTS_SUB)[LB.scope];
  } else LB.sub.textContent = '我和好友的胜场';
  var c = LB.cache[keyOf(g)];
  if (c) render(g, c.rows);
  else showMsg('载入中…');
  if (force || !c || Date.now() - c.t > TTL) load(g, !!c);
}
function pickScope(sc) {
  if (LB.scope === sc) return;
  LB.scope = sc;
  pick(LB.game, false);
}
// 打开浮层时一定重新拉；切 tab 时缓存没过期（30 秒）就不拉
function load(g, quiet) {
  var tok = ++LB.tok, key = keyOf(g);
  if (!sb) return showMsg('暂时连不上，请稍后再试', true);
  var call = g.points || g.scoped ? sb.rpc(g.rpc, { p_group: LB.scope === 'group' ? LB.gid : null }) : sb.rpc('game_leaderboard', { p_game: g.id });
  call.then(function (r) {
    if (tok !== LB.tok || !LB.el || LB.el.hidden) return;
    if (r.error) { if (!quiet) showMsg(errText(r.error), true); return; }
    LB.cache[key] = { t: Date.now(), rows: r.data || [] };
    if (LB.game === g.id && keyOf(g) === key) render(g, LB.cache[key].rows);
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
// 名次：胜、负都一样就并列（1, 1, 3）；斗地主按积分和胜场
function render(g, rows) {
  var box = clear(LB.list), me = S.me && S.me.id, rank = 0, prev = null, i;
  if (!rows.length) return showMsg('还没有数据');
  var solo = rows.length === 1;
  for (i = 0; i < rows.length; i++) {
    var r = rows[i], key = g.points ? r.total + '/' + r.wins : g.scoped ? r.wins + '/' + r.games : r.wins + '/' + r.losses;
    if (key !== prev) { rank = i + 1; prev = key; }
    box.appendChild(g.points ? ddzRowEl(r, rank, r.user_id === me) : g.scoped ? fxqRowEl(r, rank, r.user_id === me) : rowEl(r, rank, r.user_id === me));
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
// 斗地主：右边是积分（带正负号，负分红色），下面一行「12 胜 / 30 局」
function ddzRowEl(r, rank, mine) {
  var total = Number(r.total), wins = Number(r.wins), games = Number(r.games);
  var sec = games ? wins + ' 胜 / ' + games + ' 局' : '还没玩过';
  var badge = h('span', { class: 'rk-rank' + (rank <= 3 && games > 0 && total > 0 ? ' top' : ''), text: String(rank) });
  if (rank <= 3 && games > 0 && total > 0) {
    var img = h('img', { class: 'rk-medal', src: 'rank/medal-' + rank + '.png', alt: '第 ' + rank + ' 名', draggable: 'false' });
    img.addEventListener('error', function () { img.replaceWith(h('span', { class: 'rk-rank top n' + rank, text: String(rank) })); });
    badge = img;
  }
  var av = r.avatar_path ? { avatar_path: r.avatar_path, nickname: r.nickname } : { nickname: r.nickname };
  return h('div', { class: 'rk-row' + (mine ? ' me' : '') + (games === 0 ? ' zero' : '') },
    badge,
    makeAvatar(av, 36),
    h('div', { class: 'rk-who' },
      h('b', null, r.nickname || 'Ta', mine ? h('i', { text: '我' }) : null),
      h('span', { text: sec })),
    h('div', { class: 'rk-wins rk-pts' + (total < 0 ? ' neg' : total > 0 ? ' pos' : '') },
      h('b', { text: (total > 0 ? '+' : '') + total }), h('span', { text: '分' })));
}
// 飞行棋：右边是胜场，下面一行「N 局」
function fxqRowEl(r, rank, mine) {
  var wins = Number(r.wins), games = Number(r.games);
  var badge = h('span', { class: 'rk-rank' + (rank <= 3 && wins > 0 ? ' top' : ''), text: String(rank) });
  if (rank <= 3 && wins > 0) {
    var img = h('img', { class: 'rk-medal', src: 'rank/medal-' + rank + '.png', alt: '第 ' + rank + ' 名', draggable: 'false' });
    img.addEventListener('error', function () { img.replaceWith(h('span', { class: 'rk-rank top n' + rank, text: String(rank) })); });
    badge = img;
  }
  var av = r.avatar_path ? { avatar_path: r.avatar_path, nickname: r.nickname } : { nickname: r.nickname };
  return h('div', { class: 'rk-row' + (mine ? ' me' : '') + (games === 0 ? ' zero' : '') },
    badge,
    makeAvatar(av, 36),
    h('div', { class: 'rk-who' },
      h('b', null, r.nickname || 'Ta', mine ? h('i', { text: '我' }) : null),
      h('span', { text: games ? games + ' 局' : '还没玩过' })),
    h('div', { class: 'rk-wins' }, h('b', { text: String(wins) }), h('span', { text: '胜' })));
}
