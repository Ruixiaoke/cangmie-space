// 引用回复

import { reduced } from './bubble/view.js';
import { loadOlder, nearBottom, scrollToBottom } from './chat/view.js';
import { fxOf } from './fx/table.js';
import { APP, closeApp } from './miniapps/host.js';
import { poolName, poolOf } from './miniapps/pool.js';
import { slOf } from './miniapps/sling.js';
import { ddzOf } from './miniapps/ddz-token.js';
import { mjOf } from './miniapps/mahjong-token.js';
import { fxqOf } from './miniapps/fxq-token.js';
import { tttOf } from './miniapps/ttt.js';
import { agentName } from './agent/info.js';
import { S, convKey, profileOf, sb } from './state.js';
import { $, cut, h, sleep, toast } from './utils.js';
import { convOf, peerFromConv } from './views/chats.js';

// ===== 引用回复 =====
// 入口：startQuote(m)，m 是当前聊天 msgs 里的一条消息（长按菜单的"引用"直接调用它）
function quoteText(body) {
  if (ddzOf(body) != null) return '斗地主';
  if (mjOf(body) != null) return '麻将';
  if (fxqOf(body) != null) return '飞行棋';
  if (tttOf(body) != null) return '井字棋';
  if (slOf(body) != null) return '弹弓大战';
  if (poolOf(body) != null) return poolName(body);
  var fx = fxOf(body);
  return fx ? fx.name : String(body || '');
}
function quoteName(sid, author) {
  if (author) return agentName(author);
  if (S.me && sid === S.me.id) return S.me.nickname || '我';
  var p = profileOf(sid) || (convOf(sid) ? peerFromConv(convOf(sid)) : null);
  return p ? p.nickname : '好友';
}
// 被引用消息的显示信息：null 没有引用；{state:'ok'|'pend'|'gone'}
function quoteInfo(m) {
  var c = S.chat;
  if (m.reply_to == null) return m.reply_gone ? { state: 'gone' } : null;
  if (!c) return { state: 'pend' };
  var id = m.reply_to;
  var src = c.msgs.find(function (x) { return x.id === id; });
  if (!src) {
    c.qcache = c.qcache || {};
    var hit = c.qcache[id];
    if (hit === 0) return { state: 'gone' };
    if (!hit) { queueQuote(id); return { state: 'pend' }; }
    src = hit;
  }
  var full = src.author ? String(src.body) : quoteText(src.body);
  return { state: 'ok', name: quoteName(src.sender_id, src.author), full: full, text: full.replace(/\s+/g, ' ') };
}
export function updateQuote(el, m) {
  var qi = quoteInfo(m);
  var sig = qi ? qi.state + '|' + (qi.name || '') + '|' + (qi.text || '') : '';
  if (el._qsig === sig) return;
  el._qsig = sig;
  if (!qi) { el._qt.hidden = true; return; }
  el._qt.hidden = false;
  el._qt.className = 'qt' + (qi.state === 'ok' ? '' : ' ' + qi.state);
  el._qt.textContent = qi.state === 'gone' ? '原消息已删除' : qi.state === 'pend' ? '加载中…' : qi.name + '：' + qi.text;
}
function refreshQuotes() {
  var c = S.chat; if (!c) return;
  c.nodes.forEach(function (el) { if (el._m) updateQuote(el, el._m); });
}
export function markReplyGone(ex, row) {
  if (ex.reply_to != null && row.reply_to == null) { ex.reply_to = null; ex.reply_gone = true; return true; }
  return false;
}
// 列表里没有的被引用消息：批量按 id 取（RLS 允许读自己会话里的消息）
function queueQuote(id) {
  var c = S.chat; if (!c) return;
  c.qpend = c.qpend || {};
  if (c.qpend[id]) return;
  c.qpend[id] = true;
  c.qwant = c.qwant || [];
  c.qwant.push(id);
  clearTimeout(c.qtimer);
  c.qtimer = setTimeout(fetchQuotes, 0);
}
function fetchQuotes() {
  var c = S.chat; if (!c) return Promise.resolve();
  var ids = (c.qwant || []).splice(0);
  if (!ids.length) return c.qflight || Promise.resolve();
  var key = convKey(c);
  var run = (async function () {
    var r;
    try { r = await sb.from('messages').select('id,sender_id,receiver_id,body,author').in('id', ids); }
    catch (e) { r = { error: e }; }
    if (S.chat !== c || convKey(c) !== key) return;
    if (r.error) { ids.forEach(function (id) { delete c.qpend[id]; }); return; }
    var got = {};
    (r.data || []).forEach(function (x) { got[x.id] = x; });
    ids.forEach(function (id) { c.qcache[id] = got[id] || 0; delete c.qpend[id]; });
    refreshQuotes();
  })();
  c.qflight = run;
  return run;
}
function renderQuoteBar() {
  var c = S.chat, bar = $('qbar');
  var nb = c ? nearBottom() : false;
  bar.hidden = !(c && c.quote);
  if (c && c.quote) $('qbarText').textContent = quoteName(c.quote.sender_id, c.quote.author) + '：' + c.quote.text;
  if (nb) scrollToBottom();
}
export function startQuote(m) {
  var c = S.chat;
  if (!c || !m || m.id == null || m.author === 'system') return false;
  if (c.gid == null && m.sender_id !== c.peer && m.sender_id !== S.me.id) return false;
  c.quote = { id: m.id, sender_id: m.sender_id, author: m.author || null, text: (m.author ? String(m.body) : quoteText(m.body)).replace(/\s+/g, ' ').slice(0, 200) };
  renderQuoteBar();
  $('input').focus();
  return true;
}
export function clearQuote() {
  var c = S.chat;
  if (c) c.quote = null;
  renderQuoteBar();
}
export function resetQuoteUi() {
  if (S.chat) S.chat.quote = null;
  $('qbar').hidden = true;
  $('qsheet').hidden = true;
}
export async function replyPrefix(row) {
  if (row.reply_to == null) return '';
  var src = S.chat && S.chat.msgs.find(function (x) { return x.id === row.reply_to; });
  var body = src ? src.body : null;
  if (body == null) {
    try {
      var r = await sb.from('messages').select('body').eq('id', row.reply_to).maybeSingle();
      if (r.data) body = r.data.body;
    } catch (e) { /* 取不到就不加前缀 */ }
  }
  return body == null ? '' : '回复「' + cut(quoteText(body).replace(/\s+/g, ' '), 20) + '」';
}
function scrollToRow(el) {
  var box = $('msgs'), r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  var top = box.scrollTop + (r.top - b.top) - (box.clientHeight - r.height) / 2;
  var calm = reduced();
  box.scrollTo({ top: Math.max(0, top), behavior: calm ? 'auto' : 'smooth' });
  setTimeout(function () {
    var bw = el._bw; if (!bw) return;
    bw.classList.remove('qflash'); void bw.offsetWidth; bw.classList.add('qflash');
    setTimeout(function () { bw.classList.remove('qflash'); }, 1600);
  }, calm ? 0 : 350);
}
function showQuoteSheet(qi) {
  $('qsName').textContent = qi.name;
  $('qsText').textContent = qi.full;
  $('qsheet').hidden = false;
}
export async function jumpToQuote(m) {
  var c = S.chat; if (!c || c.jumping) return;
  var qi = quoteInfo(m);
  if (!qi || qi.state === 'gone') return toast('原消息已删除');
  var id = m.reply_to;
  c.jumping = true;
  try {
    if (!c.ids.has(id)) {
      toast('正在找原消息…', 1500);
      var pages = 0, waits = 0;
      while (pages < 8 && waits < 40 && S.chat === c && !c.ids.has(id) && c.hasMore) {
        if (c.loadingOlder) { waits++; await sleep(150); continue; }
        pages++;
        await loadOlder();
      }
      if (S.chat !== c) return;
    }
    var el = c.nodes.get('m' + id);
    if (el) return scrollToRow(el);
    queueQuote(id);
    await fetchQuotes();
    if (c.qflight) await c.qflight;
    if (S.chat !== c) return;
    qi = quoteInfo(m);
    if (qi && qi.state === 'ok') showQuoteSheet(qi);
    else toast(qi && qi.state === 'gone' ? '原消息已删除' : '暂时取不到原消息');
  } finally { c.jumping = false; }
}
// 向右滑一条消息 = 引用它：行跟着手指走，松手弹回，滑过 56px 触发
export function bindSwipeQuote() {
  var rows = $('rows'), sw = null, TH = 56;
  function setX(x) {
    var el = sw.el;
    if (!el._rep) {
      el._rep = h('span', { class: 'rep', 'aria-hidden': 'true' });
      el._rep.innerHTML = '<svg class="i"><use href="#i-reply"/></svg>';
      el._line.appendChild(el._rep);
    }
    el._line.style.transform = x ? 'translateX(' + x + 'px)' : '';
    el._rep.style.opacity = String(Math.min(1, x / TH));
    el._rep.classList.toggle('on', x >= TH);
  }
  function pull(dx) { return dx <= 0 ? 0 : dx < TH ? dx : Math.min(TH + (dx - TH) * 0.25, TH + 24); }
  function release() {
    if (!sw) return;
    var el = sw.el, line = el._line;
    if (sw.lock) {
      line.style.transition = 'transform .3s cubic-bezier(0.22,1,0.36,1)';
      line.style.transform = '';
      if (el._rep) el._rep.style.opacity = '0';
      setTimeout(function () { line.style.transition = ''; }, 320);
    }
    sw = null;
  }
  rows.addEventListener('touchstart', function (ev) {
    if (ev.touches.length !== 1) { release(); return; }
    var row = ev.target.closest ? ev.target.closest('.row') : null;
    if (!row || !row._m || row._m.id == null || row._m.author === 'system' || !row._line) return;
    row._line.style.transition = '';
    sw = { el: row, x0: ev.touches[0].clientX, y0: ev.touches[0].clientY, lock: false, dead: false, dx: 0 };
  }, { passive: true });
  rows.addEventListener('touchmove', function (ev) {
    if (!sw || sw.dead) return;
    var t = ev.touches[0], dx = t.clientX - sw.x0, dy = t.clientY - sw.y0;
    if (!sw.lock) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx) * 0.4) { sw.dead = true; return; }
      if (dx < -12) { sw.dead = true; return; }
      if (dx > 12 && Math.abs(dy) < dx * 0.4) sw.lock = true;
      else return;
    }
    sw.dx = dx;
    if (ev.cancelable) ev.preventDefault(); // 横滑时不要让列表跟着竖向滚动
    setX(pull(dx));
  }, { passive: false });
  rows.addEventListener('touchend', function () {
    if (!sw) return;
    var hit = sw.lock && !sw.dead && sw.dx >= TH, m = sw.el._m;
    release();
    if (hit && m) { try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) { /* 忽略 */ } startQuote(m); }
  });
  rows.addEventListener('touchcancel', release);
  $('qbarX').addEventListener('click', function () { clearQuote(); $('input').focus(); });
  $('qsClose').addEventListener('click', function () { $('qsheet').hidden = true; });
  $('qsheet').addEventListener('click', function (ev) { if (ev.target === $('qsheet')) $('qsheet').hidden = true; });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (!$('qsheet').hidden) { $('qsheet').hidden = true; return; }
    if (APP.cur) { closeApp(); return; }
    if (S.chat && S.chat.quote) clearQuote();
  });
}
