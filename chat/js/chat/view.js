// 聊天页：打开 / 关闭、消息合并、加载、渲染消息列表

import { NORMAL, bubbleFold } from '../bubble/state.js';
import { rowState, settleBev, startDecay, stopDecay, syncShow } from '../bubble/view.js';
import { agentResync, renderLive, resetLive } from '../agent/live.js';
import { isAgentMsg } from '../agent/info.js';
import { buildDeco, updateRow } from './row.js';
import { autosize } from '../composer.js';
import { PAGE } from '../config.js';
import { loadAll } from '../data.js';
import { errText } from '../errors.js';
import { playFx, stopFx } from '../fx/engine.js';
import { fxOf } from '../fx/table.js';
import { closeActMenu } from '../menu.js';
import { closeApp, openApp } from '../miniapps/host.js';
import { closeLeaderboard } from '../miniapps/leaderboard.js';
import { closeNotifications } from '../notify.js';
import { closePanels } from '../plus.js';
import { jumpToQuote, markReplyGone, resetQuoteUi } from '../quote.js';
import { markReadIfNeeded } from '../read.js';
import { applySkin } from '../skins/index.js';
import { sand, sandDisable, sandKill, sandNew } from '../skins/sand.js';
import { S, makeAvatar, profileOf, sb } from '../state.js';
import { emptyState } from '../mascot.js';
import { $, clear, h, isVisible, toast } from '../utils.js';
import { convOf, peerFromConv } from '../views/chats.js';

// ===== 聊天页 =====
function chatKey(m) { return m.key; }
export function renderChatHeader() {
  var c = S.chat; if (!c) return;
  var p = profileOf(c.peer) || (convOf(c.peer) ? peerFromConv(convOf(c.peer)) : null);
  clear($('chatAvatar')).appendChild(makeAvatar(p, 40));
  $('chatName').textContent = p ? p.nickname : '好友';
  $('chatUser').textContent = p ? '@' + p.username : '';
}

export async function openChat(peerId, fromHistory) {
  if (!S.me || !convOf(peerId)) {
    // 可能是刚成为好友，先刷新一次
    await loadAll();
    if (!convOf(peerId)) return toast('你们还不是好友');
  }
  if (S.chat && S.chat.peer === peerId) return;
  S.chat = { peer: peerId, msgs: [], ids: new Set(), nodes: new Map(), hasMore: false, loadingOlder: false, loaded: false,
    bstate: {}, bshow: {}, btstate: {}, btshow: {}, finfo: {}, bev: [], fxApplied: new Set(), agentJobs: {} };
  if (!fromHistory) { try { history.pushState({ chat: peerId }, ''); } catch (e) { /* 忽略 */ } }
  $('chat').hidden = false;
  closePanels();
  $('input').value = '';
  autosize();
  resetQuoteUi();
  clear($('rows'));
  resetLive();
  clear($('chatEmpty'));
  $('olderRow').hidden = true;
  renderChatHeader();
  closeNotifications('msg-' + peerId);
  applySkin();
  startDecay();
  await fetchLatest(true);
  if (S.chat && S.chat.peer === peerId) { markReadIfNeeded(); agentResync(); }
}
export function closeChat() {
  if (!S.chat) return;
  closeLeaderboard();
  closeApp();
  S.chat = null;
  stopFx(); stopDecay(); closeActMenu(); resetLive();
  sandDisable();
  $('chat').hidden = true;
  closePanels();
  resetQuoteUi();
  $('input').blur();
  loadAll();
}

export function msgFromRow(r) {
  return { key: 'm' + r.id, id: r.id, sender_id: r.sender_id, receiver_id: r.receiver_id, body: r.body, created_at: r.created_at, read_at: r.read_at, reply_to: r.reply_to == null ? null : r.reply_to, author: r.author || null, status: 'sent' };
}
function peerFilter(peer) {
  var me = S.me.id;
  return 'and(sender_id.eq.' + me + ',receiver_id.eq.' + peer + '),and(sender_id.eq.' + peer + ',receiver_id.eq.' + me + ')';
}
// 合并服务器返回的消息：按 id 去重，已有的更新已读状态
function mergeRows(rows) {
  var c = S.chat; if (!c) return false;
  var changed = false;
  rows.forEach(function (r) {
    if (c.ids.has(r.id)) {
      var ex = c.msgs.find(function (m) { return m.id === r.id; });
      if (ex && ex.read_at !== r.read_at) { ex.read_at = r.read_at; changed = true; }
      if (ex && markReplyGone(ex, r)) changed = true;
      return;
    }
    // 乐观消息已经被确认成同一个 id 的情况在 confirmSent 里处理，这里只加新的
    c.ids.add(r.id);
    c.msgs.push(msgFromRow(r));
    changed = true;
  });
  if (changed) sortMsgs();
  return changed;
}
export function sortMsgs() {
  var c = S.chat;
  c.msgs.sort(function (a, b) {
    if (a.id != null && b.id != null) return a.id - b.id;
    if (a.id != null) return -1;
    if (b.id != null) return 1;
    return a.seq - b.seq;
  });
}
export async function fetchLatest(first) {
  var c = S.chat; if (!c) return;
  var peer = c.peer;
  var r = await sb.from('messages').select('*').or(peerFilter(peer)).order('id', { ascending: false }).limit(PAGE);
  if (!S.chat || S.chat.peer !== peer) return;
  if (r.error) return toast(errText(r.error));
  var rows = r.data || [];
  if (first) c.hasMore = rows.length === PAGE;
  var stick = nearBottom() || first;
  mergeRows(rows);
  c.loaded = true;
  renderMsgs({ stick: stick, quiet: !!first });
}
export async function loadOlder() {
  var c = S.chat;
  if (!c || !c.hasMore || c.loadingOlder || !c.loaded) return;
  var oldest = c.msgs.find(function (m) { return m.id != null; });
  if (!oldest) return;
  c.loadingOlder = true;
  $('olderRow').hidden = false;
  var box = $('msgs'), prevH = box.scrollHeight, prevTop = box.scrollTop, peer = c.peer;
  var r = await sb.from('messages').select('*').or(peerFilter(peer)).lt('id', oldest.id).order('id', { ascending: false }).limit(PAGE);
  if (!S.chat || S.chat.peer !== peer) return;
  c.loadingOlder = false;
  $('olderRow').hidden = true;
  if (r.error) return toast(errText(r.error));
  var rows = r.data || [];
  c.hasMore = rows.length === PAGE;
  mergeRows(rows);
  renderMsgs({ stick: false, quiet: true });
  box.scrollTop = prevTop + (box.scrollHeight - prevH); // 保持当前位置不跳
}
export function nearBottom() {
  var b = $('msgs');
  return b.scrollHeight - b.scrollTop - b.clientHeight < 90;
}
export function scrollToBottom() { var b = $('msgs'); b.scrollTop = b.scrollHeight; }

// 增量渲染：按 key 复用 DOM 节点，新消息到来时不会打断正在进行的文字选择
// opts.quiet：历史加载，不播任何动画，只应用最终状态
export function renderMsgs(opts) {
  var c = S.chat; if (!c) return;
  var rows = $('rows');
  var alive = new Set();
  var prev = null;
  var quiet = !!(opts && opts.quiet) || !c.loaded;
  var fresh = [], evQueued = false;
  // 气泡状态完全由聊天记录推出；只有“刚到的”特效消息才排队播变化动画
  var fold = bubbleFold(c.msgs.filter(notAgent), Date.now()); // 榴莲的消息不参与特效 / 气泡状态
  c.bstate = fold.states; c.btstate = fold.tstates; c.finfo = fold.info;
  fold.evs.forEach(function (e) {
    if (c.fxApplied.has(e.m.key)) return;
    c.fxApplied.add(e.m.key);
    if (!quiet) { c.bev.push({ key: e.m.key, uid: e.uid, tid: e.tid, ev: e.ev, x: e.x, before: e.before, after: e.after }); evQueued = true; }
  });
  syncShow(c);
  c.msgs.forEach(function (m, i) {
    alive.add(m.key);
    var el = c.nodes.get(m.key);
    if (!el) {
      el = buildRow(m); c.nodes.set(m.key, el);
      if (sand.io) sand.io.observe(el);
      if (!quiet) fresh.push(el);
    }
    updateRow(el, m, prev);
    if (rows.children[i] !== el) rows.insertBefore(el, rows.children[i] || null);
    prev = m;
  });
  c.nodes.forEach(function (el, k) {
    if (!alive.has(k)) {
      if (sand.io) sand.io.unobserve(el);
      sandKill(el);
      if (el.parentNode) el.parentNode.removeChild(el);
      c.nodes.delete(k);
    }
  });
  var empty = clear($('chatEmpty'));
  if (c.loaded && !c.msgs.length) empty.appendChild(emptyState('打个招呼吧', true));
  renderLive();
  if (opts && opts.stick) scrollToBottom();
  if (sand.on && fresh.length && isVisible()) sandNew(fresh);
  if (evQueued) setTimeout(settleBev, 0);
}
function notAgent(m) { return !isAgentMsg(m); }
function buildRow(m) {
  var el = h('div', { class: 'row' });
  el._stamp = h('div', { class: 'stamp', hidden: true });
  el._bubble = h('div', { class: 'bubble' });
  el._bubble.addEventListener('click', function () { if (el._m && !el._m.author && fxOf(el._m.body)) playFx(el._m, true); else if (el._gcid != null) openApp(el._gkind, { id: el._gcid }); }); // 点特效气泡再看一次
  el._meta = h('div', { class: 'meta', hidden: true });
  el._av = h('div', { class: 'av-slot' });
  var col = h('div', { class: 'col' });
  el._name = h('div', { class: 'agent-name', hidden: true });
  el._deco = h('div', { class: 'deco', 'aria-hidden': 'true' });
  el._bw = h('div', { class: 'bw' }, el._bubble, el._deco);
  el._qt = h('button', { type: 'button', class: 'qt', hidden: true });
  el._qt.addEventListener('click', function () { if (el._m) jumpToQuote(el._m); });
  el.style.setProperty('--sd', (Math.random() * 7).toFixed(1) + 's');
  col.appendChild(el._name);
  col.appendChild(el._bw);
  col.appendChild(el._qt);
  col.appendChild(el._meta);
  var line = h('div', { class: 'line' });
  line.appendChild(el._av);
  line.appendChild(col);
  el._line = line;
  el.appendChild(el._stamp);
  el.appendChild(line);
  return el;
}
// 行的 class：来源方向、发送状态、气泡状态（st-*）、沙子皮肤状态（sand-*）
function stClasses(st) {
  var sc = '';
  if (st.k === 'wet') sc = ' st-wet';
  else if (st.k === 'love') sc = ' st-love st-love-' + st.lv;
  else if (st.k === 'passion') sc = ' st-passion st-love st-love-3';
  else if (st.k === 'frozen') sc = ' st-frozen';
  else if (st.k === 'hot') sc = ' st-hot';
  else if (st.k === 'plump') sc = ' st-plump st-plump-' + st.lv;
  else if (st.k === 'bloom') sc = ' st-bloom';
  if (st.as) sc += ' st-asleep';
  return sc;
}
export function refreshCls(el) {
  var m = el._m, c = S.chat; if (!m || !S.me) return;
  var agent = isAgentMsg(m);
  var own = m.sender_id === S.me.id && !agent;
  var st = c && !agent ? rowState(c, m) : NORMAL;
  var sc = el._fxb ? '' : stClasses(st); // 特效气泡本身不加装饰
  el.className = 'row ' + (own ? 'own' : 'peer') + (agent ? ' agent' : '') + (m.status === 'sending' ? ' sending' : '') + (m.status === 'failed' ? ' failed' : '') + (el._gcid != null ? ' row-game' : '') + sc +
    (el._sd === 'gone' ? ' sand-gone' : el._sd === 'build' ? ' sand-build' : '');
  if (el._dk !== sc) { el._dk = sc; buildDeco(el._deco, st, !!sc); }
}
