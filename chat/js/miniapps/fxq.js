// 飞行棋小程序（群聊和私聊里的 2 到 4 人棋局）：缓存、聊天卡片、实时同步、开桌；界面在 fxq-view.js，规则在 fxq-rules.js
//
// 后端：supabase/migrations/20261212000000_feixingqi.sql（表 + 大厅 RPC：群里 fxq_open，私聊 fxq_open_dm）、
// supabase/functions/fxq（开始 / 掷骰子 / 选飞机 / 超时托管 / 机器人 / 结算 / 再来一局）。
// 桌子属于一个群（group_id）或者一对好友（dm_lo / dm_hi），累计胜场缓存按 scoreKey 分开。
// 没有秘密信息：整局状态都在 fxq_games.pub 里（飞机位置、轮到谁、骰子、最近的事件），所有人通过 select + Realtime 直接看到。

import { errText } from '../errors.js';
import { APP, closeApp, openApp } from './host.js';
import { createTable, botName } from './fxq-view.js';
import { fxqOf } from './fxq-token.js';
import { firePush } from '../notify.js';
import { S, nameOf, profileOf, sb } from '../state.js';
import { clear, h, isVisible, toast } from '../utils.js';
import { convOf, peerFromConv } from '../views/chats.js';

// ===== 飞行棋 =====
var FX = { games: {}, scores: {}, want: [], pend: {}, tm: 0, scPend: {} };
export function fxqReset() { FX.games = {}; FX.scores = {}; FX.want = []; FX.pend = {}; FX.scPend = {}; }
// 群聊和私聊里都把邀请消息当卡片
export function fxqKind(body) {
  var id = fxqOf(body);
  return id != null ? { k: 'fxq', id: id } : null;
}
// 累计胜场按群或按好友对分开存
function scoreKey(r) { return r.group_id != null ? 'g' + r.group_id : r.dm_lo ? 'd' + r.dm_lo + r.dm_hi : null; }

function fxqPerson(uid) {
  if (S.me && uid === S.me.id) return S.me;
  return profileOf(uid) || (convOf(uid) ? peerFromConv(convOf(uid)) : null);
}
function seatLabel(g, i) {
  if (g.seats[i]) return g.seats[i] === (S.me && S.me.id) ? '我' : ((fxqPerson(g.seats[i]) || {}).nickname || nameOf(g.seats[i]));
  if (g.bots[i]) return botName(g.bots, i);
  return '';
}
function statusText(g) {
  if (!g) return g === null ? '牌桌不可用' : '载入中…';
  var n = 0, i;
  for (i = 0; i < 4; i++) if (g.seats[i] || g.bots[i]) n++;
  if (g.status === 'waiting') return n ? '等人入座，已坐 ' + n + ' 个' : '等人入座';
  if (g.status === 'playing') return '对局中';
  if (g.status === 'closed') return '已关闭';
  var w = g.pub && g.pub.winner;
  return '已结束' + (w !== null && w !== undefined ? '，' + seatLabel(g, w) + '赢' : '');
}
function seatNames(g) {
  var out = [];
  for (var i = 0; i < 4; i++) { var t = seatLabel(g, i); if (t) out.push(t); }
  return out;
}
export function fxqFillCard(el) {
  var m = el._m, id = el._gcid;
  if (!m || id == null || !S.me) return;
  var g = FX.games[id];
  var sig = id + '|' + (g ? [g.version, g.status].join('|') : 'x') + '|' + S.me.id + '|' + (g ? g.seats.map(function (u) { return u ? (profileOf(u) || {}).nickname : ''; }).join(',') : '');
  if (!g && !FX.pend[id] && FX.games[id] === undefined) queueGame(id);
  if (el._gsig === sig) return;
  el._gsig = sig;
  var b = clear(el._bubble);
  var icon = h('img', { class: 'gc-fxq-ico', src: 'fxq/icon-fxq.png', alt: '', draggable: 'false' });
  icon.addEventListener('error', function () { icon.replaceWith(h('span', { class: 'gc-fxq-ico fb', text: '飞' })); });
  var names = g ? seatNames(g) : [];
  var txt = h('div', { class: 'gc-txt' },
    h('b', { text: '飞行棋' }),
    h('span', { class: 'gc-st' + (g && g.status === 'playing' ? ' you' : ''), text: statusText(g) }),
    names.length ? h('span', { class: 'gc-names', text: names.join('、') }) : null);
  b.appendChild(icon);
  b.appendChild(txt);
  b.appendChild(h('span', { class: 'gc-go', text: '去看看' }));
}
function fxqEachCard(fn) { if (S.chat) S.chat.nodes.forEach(function (el) { if (el._gkind === 'fxq' && el._gcid != null) fn(el); }); }
function queueGame(id) {
  if (FX.pend[id]) return;
  FX.pend[id] = 1; FX.want.push(id);
  clearTimeout(FX.tm);
  FX.tm = setTimeout(fetchGames, 0);
}
function fetchGames() {
  var ids = FX.want.splice(0);
  if (!ids.length || !sb) return;
  sb.from('fxq_games').select('*').in('id', ids).then(function (r) {
    ids.forEach(function (id) { delete FX.pend[id]; });
    if (r.error) return;
    var got = {};
    (r.data || []).forEach(function (g) { got[g.id] = 1; putGame(g); });
    ids.forEach(function (id) { if (!got[id] && !FX.games[id]) FX.games[id] = null; fxqEachCard(function (el) { if (el._gcid === id) fxqFillCard(el); }); });
  }, function () { ids.forEach(function (id) { delete FX.pend[id]; }); });
}
export function fxqResync() {
  fxqEachCard(function (el) { delete FX.pend[el._gcid]; queueGame(el._gcid); });
  if (APP.cur && APP.cur.id === 'fxq') { var id = APP.cur.params.id; queueGame(id); fetchScores(id); }
}

// 新数据进缓存；version 更小的不覆盖新的
function putGame(g) {
  if (!g || g.id == null) return;
  var old = FX.games[g.id];
  if (old && old.version > g.version) return;
  FX.games[g.id] = g;
  fxqEachCard(function (el) { if (el._gcid === g.id) fxqFillCard(el); });
  if (showing(g.id) && TB) TB.update(g, false);
}
function showing(id) { return !!(APP.cur && APP.cur.id === 'fxq' && APP.cur.params.id === id && S.chat); }
// 这桌的累计胜场键：群桌 g<群 id>，私聊桌 d<lo><hi>；牌桌还没取回来时用当前会话猜（群 id / 我和对方）
function keyOfGame(id) {
  var g = FX.games[id];
  if (g) return scoreKey(g);
  var c = S.chat;
  if (!c || !S.me) return null;
  if (c.gid != null) return 'g' + c.gid;
  return c.peer ? 'd' + (S.me.id < c.peer ? S.me.id + c.peer : c.peer + S.me.id) : null;
}
function fetchScores(id) {
  var key = keyOfGame(id), g = FX.games[id], c = S.chat;
  if (!sb || key == null || FX.scPend[key]) return;
  var q = sb.from('fxq_scores').select('*');
  if (g ? g.group_id != null : c && c.gid != null) q = q.eq('group_id', g ? g.group_id : c.gid);
  else {
    var lo = g ? g.dm_lo : (S.me.id < c.peer ? S.me.id : c.peer), hi = g ? g.dm_hi : (S.me.id < c.peer ? c.peer : S.me.id);
    q = q.eq('dm_lo', lo).eq('dm_hi', hi);
  }
  FX.scPend[key] = 1;
  q.then(function (r) {
    delete FX.scPend[key];
    (r.data || []).forEach(putScore);
  }, function () { delete FX.scPend[key]; });
}
function putScore(r) {
  var key = r ? scoreKey(r) : null;
  if (!key) return;
  var m = FX.scores[key] || (FX.scores[key] = {});
  m[r.user_id] = r;
  if (APP.cur && APP.cur.id === 'fxq' && TB) TB.setScores();
}

// 实时
export function onFxqGame(p) {
  var g = p && p.new;
  if (!g || g.id == null || !S.me || p.eventType === 'DELETE') return;
  var prev = FX.games[g.id];
  putGame(g);
  if (p.eventType !== 'UPDATE' || !prev || showing(g.id) || !isVisible()) return;
  var me = g.seats.indexOf(S.me.id);
  if (me < 0) return;
  if ((prev.status === 'waiting' || prev.status === 'over') && g.status === 'playing') toast('飞行棋开局了');
  else if (g.status === 'playing' && g.pub && g.pub.turn === me && prev.pub && prev.pub.turn !== me && !g.auto[me]) toast('轮到你了（飞行棋）');
}
export function onFxqScore(p) { if (p && p.new && p.eventType !== 'DELETE') putScore(p.new); }

// ===== 网络 =====
function fnError(e) {
  var ctx = e && e.context;
  if (ctx && typeof ctx.json === 'function') return ctx.json().then(function (j) { return j && j.error ? j.error : 'unknown'; }, function () { return 'unknown'; });
  return Promise.resolve((e && e.message) || 'unknown');
}
// 调 fxq 函数；返回 { error: 码 } 或成功时把新状态放进缓存
function call(body) {
  return sb.functions.invoke('fxq', { body: body }).then(function (r) {
    if (r.error) return fnError(r.error).then(function (c) { return { error: c }; });
    var d = r.data;
    if (!d || !d.game) return { error: 'unknown' };
    var cur = FX.games[body.game] || {};
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

// + 面板：开桌（已经有没结束的桌子就直接回到那一桌）；群里 fxq_open(群)，私聊里 fxq_open_dm(好友)
function fxqStartHere() {
  var c = S.chat;
  if (!c) return;
  if (APP.cur && APP.cur.id === 'fxq') return;
  var gid = c.gid, peer = c.peer;
  var req = gid != null ? sb.rpc('fxq_open', { p_group: gid }) : sb.rpc('fxq_open_dm', { p_peer: peer });
  req.then(function (r) {
    if (r.error) return toast(errText(r.error));
    var g = r.data;
    putGame(g);
    if (g.version === 1 && g.message_id) firePush('message', g.message_id); // 刚建的桌子：让群里 / 对方收到推送
    if (S.chat && S.chat.gid === gid && S.chat.peer === peer) openApp('fxq', { id: g.id });
  }, function (e) { toast(errText(e)); });
}

var TB = null; // 当前打开的牌桌界面
export var fxqV = {
  id: 'fxq',
  scope: 'any', // 私聊和群聊里都能开
  label: '飞行棋',
  img: 'fxq/icon-fxq.png',
  strip: 'hidden',
  flush: true,
  run: function () { fxqStartHere(); },
  mount: function (box, params) {
    var id = params.id;
    TB = createTable(box, {
      dm: !S.chat || S.chat.gid == null,
      person: fxqPerson,
      scores: function () { return FX.scores[keyOfGame(id)] || {}; },
      refreshScores: function () { fetchScores(id); },
      act: function (body) { return call(Object.assign({ game: id }, body)); }, // 错误码交给界面提示（tick 的失败不用提示）
      sit: function (seat) { rpc('fxq_sit', { p_game: id, p_seat: seat }); },
      stand: function () { rpc('fxq_stand', { p_game: id }); },
      setBot: function (seat, on) { rpc('fxq_set_bot', { p_game: id, p_seat: seat, p_on: on }); },
      start: function () { call({ game: id, action: 'start' }).then(function (r) { if (r && r.error) toast(errText({ message: r.error })); }); },
      rematch: function () { call({ game: id, action: 'rematch' }).then(function (r) { if (r && r.error) toast(errText({ message: r.error })); }); },
      leave: function () { closeApp(); }
    });
    var cached = FX.games[id];
    if (cached) TB.update(cached, true);
    fetchScores(id);
    sb.from('fxq_games').select('*').eq('id', id).maybeSingle().then(function (r) {
      if (!TB || !APP.cur || APP.cur.params.id !== id) return;
      if (r.data) { if (!FX.games[id]) { FX.games[id] = r.data; TB.update(r.data, true); } else putGame(r.data); }
      else if (!FX.games[id]) { toast('找不到这局飞行棋'); closeApp(); }
    }, function () { /* 离线：显示缓存 */ });
    var onResize = function () { if (TB) TB.resize(); };
    window.addEventListener('resize', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    fxqV._onResize = onResize;
  },
  unmount: function () {
    if (TB) TB.destroy();
    TB = null;
    if (fxqV._onResize) {
      window.removeEventListener('resize', fxqV._onResize);
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', fxqV._onResize);
      fxqV._onResize = null;
    }
  },
  same: function (a, b) { return a.id === b.id; },
  update: function (g) { if (TB) TB.update(g, false); }
};
