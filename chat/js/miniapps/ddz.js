// 斗地主小程序（群聊和私聊里的三人 / 四人牌局）：缓存、聊天卡片、实时同步、开桌；界面在 ddz-view.js，规则在 ddz-rules.js
//
// 后端：supabase/migrations/20261203000000_doudizhu.sql + 20261204000000_ddz_4p_dm.sql（表 + 大厅 RPC：群里 ddz_open，私聊 ddz_open_dm）、
// supabase/functions/ddz（叫分 / 出牌 / 开始（补机器人）/ 超时托管 / 机器人 / 结算）。
// 桌子属于一个群（group_id）或者一对好友（dm_lo / dm_hi），累计积分缓存按 scoreKey 分开。
// 手牌是秘密：自己的手牌只能从 ddz_hands（RLS 只给本人）或 ddz 函数的返回里拿；ddz_games.pub 里别人的手牌只有张数。

import { errText } from '../errors.js';
import { APP, closeApp, openApp } from './host.js';
import { createTable, botName } from './ddz-view.js';
import { ddzOf } from './ddz-token.js';
import { firePush } from '../notify.js';
import { S, nameOf, profileOf, sb } from '../state.js';
import { clear, h, isVisible, toast } from '../utils.js';
import { convOf, peerFromConv } from '../views/chats.js';

// ===== 斗地主 =====
var DZ = { games: {}, hands: {}, scores: {}, want: [], pend: {}, tm: 0, handPend: {}, scPend: {} };
export function ddzReset() { DZ.games = {}; DZ.hands = {}; DZ.scores = {}; DZ.want = []; DZ.pend = {}; DZ.handPend = {}; DZ.scPend = {}; }
// 群聊和私聊里都把邀请消息当卡片
export function ddzKind(body) {
  var id = ddzOf(body);
  return id != null ? { k: 'ddz', id: id } : null;
}
// 累计积分按群或按好友对分开存
function scoreKey(r) { return r.group_id != null ? 'g' + r.group_id : r.dm_lo ? 'd' + r.dm_lo + r.dm_hi : null; }

function statusText(g) {
  if (!g) return g === null ? '牌桌不可用' : '载入中…';
  var n = 0, i;
  for (i = 0; i < 4; i++) if (g.seats[i] || g.bots[i]) n++;
  if (g.status === 'waiting') return n ? '等人入座，已坐 ' + n + ' 个' : '等人入座';
  if (g.status === 'bidding') return '叫分中';
  if (g.status === 'playing') return '对局中';
  if (g.status === 'closed') return '已关闭';
  var w = g.pub && g.pub.winner;
  return '已结束' + (w ? '，' + (w === 'landlord' ? '地主' : '农民') + '赢' : '');
}
function seatNames(g) {
  var out = [];
  for (var i = 0; i < 4; i++) {
    if (g.seats[i]) out.push(g.seats[i] === (S.me && S.me.id) ? '我' : ((ddzPerson(g.seats[i]) || {}).nickname || nameOf(g.seats[i])));
    else if (g.bots[i]) out.push(botName(g.bots, i));
  }
  return out;
}
export function ddzFillCard(el) {
  var m = el._m, id = el._gcid;
  if (!m || id == null || !S.me) return;
  var g = DZ.games[id];
  var sig = id + '|' + (g ? [g.version, g.status].join('|') : 'x') + '|' + S.me.id + '|' + (g ? g.seats.map(function (u) { return u ? (profileOf(u) || {}).nickname : ''; }).join(',') : '');
  if (!g && !DZ.pend[id] && DZ.games[id] === undefined) queueGame(id);
  if (el._gsig === sig) return;
  el._gsig = sig;
  var b = clear(el._bubble);
  var icon = h('img', { class: 'gc-ddz-ico', src: 'ddz/icon-ddz.png', alt: '', draggable: 'false' });
  icon.addEventListener('error', function () { icon.replaceWith(h('span', { class: 'gc-ddz-ico fb', text: '斗' })); });
  var names = g ? seatNames(g) : [];
  var txt = h('div', { class: 'gc-txt' },
    h('b', { text: '斗地主' }),
    h('span', { class: 'gc-st' + (g && (g.status === 'bidding' || g.status === 'playing') ? ' you' : ''), text: statusText(g) }),
    names.length ? h('span', { class: 'gc-names', text: names.join('、') }) : null);
  b.appendChild(icon);
  b.appendChild(txt);
  b.appendChild(h('span', { class: 'gc-go', text: '去看看' }));
}
function ddzEachCard(fn) { if (S.chat) S.chat.nodes.forEach(function (el) { if (el._gkind === 'ddz' && el._gcid != null) fn(el); }); }
function queueGame(id) {
  if (DZ.pend[id]) return;
  DZ.pend[id] = 1; DZ.want.push(id);
  clearTimeout(DZ.tm);
  DZ.tm = setTimeout(fetchGames, 0);
}
function fetchGames() {
  var ids = DZ.want.splice(0);
  if (!ids.length || !sb) return;
  sb.from('ddz_games').select('*').in('id', ids).then(function (r) {
    ids.forEach(function (id) { delete DZ.pend[id]; });
    if (r.error) return;
    var got = {};
    (r.data || []).forEach(function (g) { got[g.id] = 1; putGame(g); });
    ids.forEach(function (id) { if (!got[id] && !DZ.games[id]) DZ.games[id] = null; ddzEachCard(function (el) { if (el._gcid === id) ddzFillCard(el); }); });
  }, function () { ids.forEach(function (id) { delete DZ.pend[id]; }); });
}
export function ddzResync() {
  ddzEachCard(function (el) { delete DZ.pend[el._gcid]; queueGame(el._gcid); });
  if (APP.cur && APP.cur.id === 'ddz') { var id = APP.cur.params.id; queueGame(id); fetchHand(id); fetchScores(id); }
}

// 新数据进缓存；version 更小的不覆盖新的
function putGame(g) {
  if (!g || g.id == null) return;
  var old = DZ.games[g.id];
  if (old && old.version > g.version) return;
  DZ.games[g.id] = g;
  ddzEachCard(function (el) { if (el._gcid === g.id) ddzFillCard(el); });
  if (showing(g.id) && TB) TB.update(g, false);
}
function showing(id) { return !!(APP.cur && APP.cur.id === 'ddz' && APP.cur.params.id === id && S.chat); }
function putHand(id, cards, round) {
  var cur = DZ.hands[id];
  if (cur && cur.round > round) return;
  DZ.hands[id] = { round: round, cards: cards };
  if (showing(id) && TB) TB.setHand();
}
function fetchHand(id) {
  if (!sb || DZ.handPend[id]) return;
  DZ.handPend[id] = 1;
  sb.from('ddz_hands').select('*').eq('game_id', id).then(function (r) {
    delete DZ.handPend[id];
    var mine = (r.data || []).filter(function (x) { return S.me && x.user_id === S.me.id; })[0];
    if (mine) putHand(id, mine.cards, mine.round);
  }, function () { delete DZ.handPend[id]; });
}
// 这桌的累计积分键：群桌 g<群 id>，私聊桌 d<lo><hi>；牌桌还没取回来时用当前会话猜（群 id / 我和对方）
function keyOfGame(id) {
  var g = DZ.games[id];
  if (g) return scoreKey(g);
  var c = S.chat;
  if (!c || !S.me) return null;
  if (c.gid != null) return 'g' + c.gid;
  return c.peer ? 'd' + (S.me.id < c.peer ? S.me.id + c.peer : c.peer + S.me.id) : null;
}
function fetchScores(id) {
  var key = keyOfGame(id), g = DZ.games[id], c = S.chat;
  if (!sb || key == null || DZ.scPend[key]) return;
  var q = sb.from('ddz_scores').select('*');
  if (g ? g.group_id != null : c && c.gid != null) q = q.eq('group_id', g ? g.group_id : c.gid);
  else {
    var lo = g ? g.dm_lo : (S.me.id < c.peer ? S.me.id : c.peer), hi = g ? g.dm_hi : (S.me.id < c.peer ? c.peer : S.me.id);
    q = q.eq('dm_lo', lo).eq('dm_hi', hi);
  }
  DZ.scPend[key] = 1;
  q.then(function (r) {
    delete DZ.scPend[key];
    (r.data || []).forEach(putScore);
  }, function () { delete DZ.scPend[key]; });
}
function putScore(r) {
  var key = r ? scoreKey(r) : null;
  if (!key) return;
  var m = DZ.scores[key] || (DZ.scores[key] = {});
  m[r.user_id] = r;
  if (APP.cur && APP.cur.id === 'ddz' && TB) TB.setScores();
}

// 实时
export function onDdzGame(p) {
  var g = p && p.new;
  if (!g || g.id == null || !S.me || p.eventType === 'DELETE') return;
  var prev = DZ.games[g.id];
  putGame(g);
  if (p.eventType !== 'UPDATE' || !prev || showing(g.id) || !isVisible()) return;
  var me = g.seats.indexOf(S.me.id);
  if (me < 0) return;
  if (prev.status === 'waiting' && (g.status === 'bidding' || g.status === 'playing')) toast('斗地主开局了');
  else if ((g.status === 'bidding' || g.status === 'playing') && g.pub && g.pub.turn === me && prev.pub && prev.pub.turn !== me && !g.auto[me]) toast('轮到你了（斗地主）');
}
export function onDdzHand(p) {
  var r = p && p.new;
  if (!r || r.game_id == null || !S.me || r.user_id !== S.me.id || p.eventType === 'DELETE') return;
  putHand(r.game_id, r.cards, r.round);
}
export function onDdzScore(p) { if (p && p.new && p.eventType !== 'DELETE') putScore(p.new); }

// ===== 网络 =====
function fnError(e) {
  var ctx = e && e.context;
  if (ctx && typeof ctx.json === 'function') return ctx.json().then(function (j) { return j && j.error ? j.error : 'unknown'; }, function () { return 'unknown'; });
  return Promise.resolve((e && e.message) || 'unknown');
}
// 调 ddz 函数；返回 { error: 码 } 或成功时把新状态和我的手牌放进缓存
function call(body) {
  return sb.functions.invoke('ddz', { body: body }).then(function (r) {
    if (r.error) return fnError(r.error).then(function (c) { return { error: c }; });
    var d = r.data;
    if (!d || !d.game) return { error: 'unknown' };
    if (d.hand) putHand(body.game, d.hand, d.game.round);
    var cur = DZ.games[body.game] || {};
    putGame(Object.assign({}, cur, d.game, { id: body.game }));
    return d;
  }, function (e) { return { error: (e && e.message) || 'network' }; });
}
function rpc(name, args) {
  return sb.rpc(name, args).then(function (r) {
    if (r.error) { toast(errText(r.error)); return null; }
    putGame(r.data);
    return r.data;
  }, function (e) { toast(errText(e)); return null; });
}

// + 面板：开桌（已经有没结束的桌子就直接回到那一桌）；群里 ddz_open(群)，私聊里 ddz_open_dm(好友)
function ddzStartHere() {
  var c = S.chat;
  if (!c) return;
  if (APP.cur && APP.cur.id === 'ddz') return;
  var gid = c.gid, peer = c.peer;
  var call = gid != null ? sb.rpc('ddz_open', { p_group: gid }) : sb.rpc('ddz_open_dm', { p_peer: peer });
  call.then(function (r) {
    if (r.error) return toast(errText(r.error));
    var g = r.data;
    putGame(g);
    if (g.version === 1 && g.message_id) firePush('message', g.message_id); // 刚建的桌子：让群里 / 对方收到推送
    if (S.chat && S.chat.gid === gid && S.chat.peer === peer) openApp('ddz', { id: g.id });
  }, function (e) { toast(errText(e)); });
}
function ddzPerson(uid) {
  if (S.me && uid === S.me.id) return S.me;
  return profileOf(uid) || (convOf(uid) ? peerFromConv(convOf(uid)) : null);
}

var TB = null; // 当前打开的牌桌界面
export var ddzV = {
  id: 'ddz',
  scope: 'any', // 私聊和群聊里都能开
  label: '斗地主',
  img: 'ddz/icon-ddz.png',
  strip: 'hidden',
  flush: true,
  run: function () { ddzStartHere(); },
  mount: function (box, params) {
    var id = params.id;
    TB = createTable(box, {
      dm: !S.chat || S.chat.gid == null,
      person: ddzPerson,
      hand: function () { return DZ.hands[id] || null; },
      scores: function () { return DZ.scores[keyOfGame(id)] || {}; },
      refreshHand: function () { fetchHand(id); },
      refreshScores: function () { fetchScores(id); },
      act: function (body) { return call(Object.assign({ game: id }, body)); }, // 错误码交给界面提示（tick 的失败不用提示）
      sit: function (seat) { rpc('ddz_sit', { p_game: id, p_seat: seat }); },
      stand: function () { rpc('ddz_stand', { p_game: id }); },
      setBot: function (seat, on) { rpc('ddz_set_bot', { p_game: id, p_seat: seat, p_on: on }); },
      start: function () { call({ game: id, action: 'start' }).then(function (r) { if (r && r.error) toast(errText({ message: r.error })); }); },
      rematch: function () { call({ game: id, action: 'rematch' }).then(function (r) { if (r && r.error) toast(errText({ message: r.error })); }); },
      leave: function () { closeApp(); }
    });
    var cached = DZ.games[id];
    if (cached) TB.update(cached, true);
    fetchHand(id); fetchScores(id);
    sb.from('ddz_games').select('*').eq('id', id).maybeSingle().then(function (r) {
      if (!TB || !APP.cur || APP.cur.params.id !== id) return;
      if (r.data) { if (!DZ.games[id]) { DZ.games[id] = r.data; TB.update(r.data, true); } else putGame(r.data); }
      else if (!DZ.games[id]) { toast('找不到这桌斗地主'); closeApp(); }
    }, function () { /* 离线：显示缓存 */ });
    var onResize = function () { if (TB) TB.resize(); };
    window.addEventListener('resize', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    ddzV._onResize = onResize;
  },
  unmount: function () {
    if (TB) TB.destroy();
    TB = null;
    if (ddzV._onResize) {
      window.removeEventListener('resize', ddzV._onResize);
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', ddzV._onResize);
      ddzV._onResize = null;
    }
  },
  same: function (a, b) { return a.id === b.id; },
  update: function (g) { if (TB) TB.update(g, false); }
};
