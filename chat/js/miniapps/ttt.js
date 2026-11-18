// 井字棋小程序

import { errText } from '../errors.js';
import { APP, closeApp, openApp } from './host.js';
import { rankButton } from './leaderboard.js';
import { S, makeAvatar, profileOf, sb } from '../state.js';
import { popCheer } from '../mascot.js';
import { clear, h, isVisible, toast } from '../utils.js';
import { convOf, peerFromConv } from '../views/chats.js';

// ===== 井字棋 =====
var TTT = { games: {}, want: [], pend: {}, tm: 0 };
export function tttReset() { TTT.games = {}; TTT.want = []; TTT.pend = {}; }
export function tttOf(body) {
  var m = typeof body === 'string' ? /^\[井字棋\]#(\d{1,15})$/.exec(body) : null;
  return m ? parseInt(m[1], 10) : null;
}
export function tttRow(d) { return Array.isArray(d) ? d[0] : d; }
function markSvg(c, anim) {
  var d = c === 'x' ? '<path d="M14 14 34 34" pathLength="1"/><path d="M34 14 14 34" pathLength="1"/>' : '<circle cx="24" cy="24" r="12" pathLength="1"/>';
  return '<svg class="mk ' + c + (anim ? ' anim' : '') + '" viewBox="0 0 48 48" aria-hidden="true">' + d + '</svg>';
}
function tttStatus(g) {
  var me = S.me.id;
  if (!g) return { t: g === null ? '对局不可用' : '载入中…', you: false };
  if (g.status === 'active') return g.next_player === me ? { t: '轮到你了', you: true } : { t: '等 Ta 下', you: false };
  if (g.status === 'draw') return { t: '平局', you: false };
  if (g.status === 'resigned') return { t: g.winner === me ? 'Ta 认输了' : '你认输了', you: false };
  return { t: g.winner === me ? '你赢了' : 'Ta 赢了', you: false };
}
export function tttFillCard(el) {
  var m = el._m, id = el._gcid;
  if (!m || id == null || !S.me) return;
  var g = TTT.games[id];
  var sig = id + '|' + (g ? [g.board, g.status, g.next_player, g.winner].join('|') : 'x') + '|' + S.me.id;
  if (!g && !TTT.pend[id] && TTT.games[id] === undefined) queueGame(id);
  if (el._gsig === sig) return;
  el._gsig = sig;
  var cells = '', i, ch, st = tttStatus(g);
  for (i = 0; i < 9; i++) {
    ch = g ? g.board.charAt(i) : '.';
    cells += '<span class="gc-cell">' + (ch === 'x' || ch === 'o' ? markSvg(ch) : '') + '</span>';
  }
  el._bubble.innerHTML = '<div class="gc-board">' + cells + '</div><div class="gc-txt"><b>井字棋</b><span class="gc-st' + (st.you ? ' you' : '') + '">' + st.t + '</span></div>';
}
function tttEachCard(fn) { if (S.chat) S.chat.nodes.forEach(function (el) { if (el._gkind === 'ttt' && el._gcid != null) fn(el); }); }
function queueGame(id) {
  if (TTT.pend[id]) return;
  TTT.pend[id] = 1; TTT.want.push(id);
  clearTimeout(TTT.tm);
  TTT.tm = setTimeout(fetchGames, 0);
}
function fetchGames() {
  var ids = TTT.want.splice(0);
  if (!ids.length || !sb) return;
  sb.from('ttt_games').select('*').in('id', ids).then(function (r) {
    ids.forEach(function (id) { delete TTT.pend[id]; });
    if (r.error) return;
    var got = {};
    (r.data || []).forEach(function (g) { got[g.id] = 1; putGame(g); });
    ids.forEach(function (id) { if (!got[id] && !TTT.games[id]) TTT.games[id] = null; tttEachCard(function (el) { if (el._gcid === id) tttFillCard(el); }); });
  }, function () { ids.forEach(function (id) { delete TTT.pend[id]; }); });
}
export function tttResync() {
  tttEachCard(function (el) { delete TTT.pend[el._gcid]; queueGame(el._gcid); });
  if (APP.cur && APP.cur.id === 'ttt') queueGame(APP.cur.params.id);
}
// 新数据进缓存；旧的不覆盖新的
function putGame(g) {
  g = tttRow(g);
  if (!g || g.id == null) return;
  var old = TTT.games[g.id];
  if (old && Date.parse(old.updated_at) > Date.parse(g.updated_at)) return;
  TTT.games[g.id] = g;
  tttEachCard(function (el) { if (el._gcid === g.id) tttFillCard(el); });
  if (APP.cur && APP.cur.id === 'ttt' && APP.cur.params.id === g.id) tttV.update(g);
}
function tttShowing(id) { return !!(APP.cur && APP.cur.id === 'ttt' && APP.cur.params.id === id && S.chat); }
export function onTttGame(p) {
  var g = p && p.new;
  if (!g || g.id == null || !S.me) return;
  var prev = TTT.games[g.id];
  putGame(g);
  if (p.eventType === 'UPDATE' && prev && g.status === 'active' && g.next_player === S.me.id && prev.board !== g.board && !tttShowing(g.id) && isVisible()) toast('轮到你了（井字棋）');
}
// + 面板：开一局（已有进行中的就直接回到那一局）
function tttStartHere() {
  var c = S.chat;
  if (!c) return;
  if (APP.cur && APP.cur.id === 'ttt') return; // 已经开着，保持
  var peer = c.peer;
  sb.rpc('ttt_start', { p_peer: peer }).then(function (r) {
    if (r.error) return toast(errText(r.error));
    var g = tttRow(r.data);
    putGame(g);
    if (S.chat && S.chat.peer === peer) openApp('ttt', { id: g.id });
  }, function (e) { toast(errText(e)); });
}

var TV = null; // 当前打开的这一局的界面状态
export function tttPerson(id) {
  if (S.me && id === S.me.id) return S.me;
  return profileOf(id) || (convOf(id) ? peerFromConv(convOf(id)) : null);
}
export var tttV = {
  // 小程序注册信息（+ 面板按这里显示按钮；run = 点按钮时做什么）
  id: 'ttt',
  scope: 'dm',
  label: '井字棋',
  icon: 'i-grid',
  run: function () { tttStartHere(); },
  mount: function (box, params) {
    TV = { box: box, id: params.id, g: TTT.games[params.id] || null, pending: null, built: false, prevStatus: null, sure: false, sureTm: 0, busy: false, winFor: null };
    var t = h('div', { class: 'ttt' });
    TV.players = h('div', { class: 'ttt-players' });
    TV.status = h('div', { class: 'ttt-status', role: 'status' });
    TV.board = h('div', { class: 'ttt-board' });
    TV.cells = [];
    for (var i = 0; i < 9; i++) (function (i) {
      var b = h('button', { type: 'button', class: 'ttt-cell', 'aria-label': '第 ' + (i + 1) + ' 格' });
      b.addEventListener('click', function () { tttTap(i); });
      TV.cells.push(b); TV.board.appendChild(b);
    })(i);
    TV.actions = h('div', { class: 'ttt-actions' });
    t.appendChild(TV.players); t.appendChild(TV.status); t.appendChild(TV.board); t.appendChild(TV.actions);
    box.appendChild(t);
    box.appendChild(rankButton('ttt', 'rk-fab'));
    tttRender(true);
    var id = params.id;
    sb.from('ttt_games').select('*').eq('id', id).maybeSingle().then(function (r) {
      if (!TV || TV.id !== id) return;
      if (r.data) putGame(r.data);
      else if (!TV.g) { toast('找不到这局井字棋'); closeApp(); }
    }, function () { /* 离线：显示缓存 */ });
  },
  unmount: function () { if (TV) clearTimeout(TV.sureTm); TV = null; },
  same: function (a, b) { return a.id === b.id; },
  update: function (g) {
    if (!TV) return;
    TV.g = g;
    if (TV.pending != null && g.board.charAt(TV.pending) !== '.') TV.pending = null;
    tttRender(false);
  }
};
function tttMyMark(g) { return g.player_x === S.me.id ? 'x' : 'o'; }
function tttRender(initial) {
  var g = TV.g, me = S.me.id, i;
  if (g && !TV.built) {
    TV.built = true;
    clear(TV.players);
    [g.player_x, g.player_o].forEach(function (pid, k) {
      var p = tttPerson(pid), mk = k === 0 ? 'x' : 'o';
      var av = h('div', { class: 'ttt-av' }, makeAvatar(p, 56));
      var bd = h('span', { class: 'ttt-badge' }); bd.innerHTML = markSvg(mk);
      av.appendChild(bd);
      var box = h('div', { class: 'ttt-p', 'data-pid': pid }, av, h('b', { text: pid === me ? '你' : (p ? p.nickname : 'Ta') }));
      if (k === 1) TV.players.appendChild(h('span', { class: 'ttt-vs', text: 'VS' }));
      TV.players.appendChild(box);
    });
    var c = TV.players.children;
    TV.pBoxes = [c[0], c[2]];
  }
  var board = g ? g.board : '.........';
  var active = !!g && g.status === 'active';
  var myTurn = active && g.next_player === me && TV.pending == null;
  var mine = g ? tttMyMark(g) : 'x';
  for (i = 0; i < 9; i++) {
    var k = board.charAt(i);
    if (TV.pending === i) k = mine;
    var cell = TV.cells[i];
    if (cell._k !== k) {
      var anim = !initial && cell._k === '.' && k !== '.';
      cell.innerHTML = k === '.' ? '' : markSvg(k, anim);
      cell._k = k;
    }
    var open = myTurn && k === '.';
    cell.classList.toggle('open', open);
    cell.setAttribute('aria-disabled', open ? 'false' : 'true');
  }
  if (TV.pBoxes) {
    // 轮到谁：我刚落子、还没确认的时候，轮到对方
    var turnId = !active ? null : TV.pending != null ? (g.player_x === me ? g.player_o : g.player_x) : g.next_player;
    TV.pBoxes[0].classList.toggle('turn', !!turnId && turnId === g.player_x);
    TV.pBoxes[1].classList.toggle('turn', !!turnId && turnId === g.player_o);
  }
  var st = TV.pending != null ? { t: '等 Ta 下', you: false } : tttStatus(g);
  TV.status.textContent = st.t;
  TV.status.classList.toggle('you', st.you);
  // 连线
  var old = TV.board.querySelector('.ttt-win');
  if (g && g.win_line) {
    if (TV.winFor !== g.id) {
      TV.winFor = g.id;
      if (old) old.parentNode.removeChild(old);
      var ps = g.win_line.split(',').map(function (x) { return parseInt(x, 10); });
      var K = 0.09, W = 3 + 2 * K;
      function ctr(n) { return [((n % 3) * (1 + K) + 0.5) / W * 100, (Math.floor(n / 3) * (1 + K) + 0.5) / W * 100]; }
      var a = ctr(ps[0]), z = ctr(ps[2]);
      var dx = z[0] - a[0], dy = z[1] - a[1], len = Math.sqrt(dx * dx + dy * dy), ex = dx / len * 7, ey = dy / len * 7;
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('class', 'ttt-win' + (initial ? '' : ' anim'));
      svg.setAttribute('aria-hidden', 'true');
      var ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1', a[0] - ex); ln.setAttribute('y1', a[1] - ey); ln.setAttribute('x2', z[0] + ex); ln.setAttribute('y2', z[1] + ey);
      ln.setAttribute('pathLength', '1');
      svg.appendChild(ln); TV.board.appendChild(svg);
    }
  } else if (old) { old.parentNode.removeChild(old); TV.winFor = null; }
  tttActions();
  // 只有“亲眼看着结束”才有动效
  if (g && !initial && TV.prevStatus === 'active' && g.status !== 'active') {
    if (g.winner === me) popCheer('你赢了！');
    else if (g.winner && g.status !== 'resigned') {
      TV.board.classList.remove('shake'); void TV.board.offsetWidth; TV.board.classList.add('shake');
    }
  }
  if (g) TV.prevStatus = g.status;
}
function tttActions() {
  var g = TV.g, box = clear(TV.actions);
  if (!g) return;
  if (g.status === 'active') {
    var b = h('button', { type: 'button', class: 'btn small quiet' + (TV.sure ? ' sure' : ''), text: TV.sure ? '再点一次确认认输' : '认输' });
    b.addEventListener('click', tttResign);
    box.appendChild(b);
  } else {
    var again = h('button', { type: 'button', class: 'btn', text: '再来一局' });
    again.disabled = TV.busy;
    again.addEventListener('click', tttAgain);
    box.appendChild(again);
  }
}
function tttSync(id) {
  sb.from('ttt_games').select('*').eq('id', id).maybeSingle().then(function (r) { if (r.data) putGame(r.data); });
}
function tttTap(i) {
  var g = TV && TV.g;
  if (!g || g.status !== 'active' || g.next_player !== S.me.id || TV.pending != null || g.board.charAt(i) !== '.') return;
  var id = g.id;
  TV.pending = i; // 乐观：先画上去
  tttRender(false);
  sb.rpc('ttt_move', { p_game: id, p_cell: i }).then(function (r) {
    if (TV && TV.id === id) TV.pending = null;
    if (r.error) {
      toast(errText(r.error));
      if (TV && TV.id === id) tttRender(false); // 回滚
      tttSync(id);
      return;
    }
    putGame(r.data); // update() 会重画
    if (TV && TV.id === id) tttRender(false);
  }, function (e) {
    if (TV && TV.id === id) { TV.pending = null; tttRender(false); }
    toast(errText(e));
  });
}
function tttResign() {
  var g = TV && TV.g;
  if (!g || g.status !== 'active') return;
  if (!TV.sure) {
    TV.sure = true; tttActions();
    TV.sureTm = setTimeout(function () { if (TV) { TV.sure = false; tttActions(); } }, 3000);
    return;
  }
  clearTimeout(TV.sureTm); TV.sure = false;
  var id = g.id;
  sb.rpc('ttt_resign', { p_game: id }).then(function (r) {
    if (r.error) { toast(errText(r.error)); tttSync(id); return; }
    putGame(r.data);
  }, function (e) { toast(errText(e)); });
}
function tttAgain() {
  var g = TV && TV.g;
  if (!g || TV.busy) return;
  var other = g.player_x === S.me.id ? g.player_o : g.player_x, id = g.id;
  TV.busy = true; tttActions();
  sb.rpc('ttt_start', { p_peer: other }).then(function (r) {
    if (TV && TV.id === id) { TV.busy = false; }
    if (r.error) { toast(errText(r.error)); if (TV) tttActions(); return; }
    var ng = tttRow(r.data);
    putGame(ng);
    if (S.chat && S.chat.peer === other) openApp('ttt', { id: ng.id });
  }, function (e) { if (TV) { TV.busy = false; tttActions(); } toast(errText(e)); });
}
