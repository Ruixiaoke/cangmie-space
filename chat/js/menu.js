// 长按菜单（微信风格）：新增菜单项往 MSG_ACTIONS 里加一项

import { reduced } from './bubble/view.js';
import { FX, fxOf } from './fx/table.js';
import { APP } from './miniapps/host.js';
import { poolOf } from './miniapps/pool.js';
import { slOf } from './miniapps/sling.js';
import { ddzOf } from './miniapps/ddz-token.js';
import { mjOf } from './miniapps/mahjong-token.js';
import { fxqOf } from './miniapps/fxq-token.js';
import { tttOf } from './miniapps/ttt.js';
import { startQuote } from './quote.js';
import { sendBody } from './send.js';
import { S } from './state.js';
import { $, clear, cut, h, toast } from './utils.js';

// ===== 长按菜单（微信风格）：复制 / 用表情打；以后加“引用”只要往 MSG_ACTIONS 里加一项 =====
function copyText(text) {
  function done() { toast('已复制'); }
  function fail() { toast('复制失败，请手动选择文字'); }
  function fallback() {
    var ta = h('textarea', { readonly: true, 'aria-hidden': 'true', style: 'position:fixed;left:-9999px;top:0;opacity:0;font-size:16px' });
    ta.value = text;
    $('shell').appendChild(ta);
    try { ta.select(); ta.setSelectionRange(0, text.length); if (document.execCommand('copy')) done(); else fail(); } catch (e) { fail(); }
    ta.parentNode.removeChild(ta);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
}
function isGroup() { return !!(S.chat && S.chat.gid != null); } // 群里只有斗地主、麻将、飞行棋是卡片，其余小游戏邀请是普通文字
function isCardBody(body) { return ddzOf(body) != null || mjOf(body) != null || fxqOf(body) != null || (!isGroup() && (tttOf(body) != null || slOf(body) != null || poolOf(body) != null)); }
var MSG_ACTIONS = [
  { id: 'copy', label: '复制', icon: 'i-copy', show: function (m) { return !!m.author && m.author !== 'system' || !m.author && !fxOf(m.body) && !isCardBody(m.body); }, run: function (m) { copyText(m.body); } },
  // 引用：自己和对方已发出的消息都能引用（发送中的还没有 id，不显示）
  { id: 'quote', label: '引用', icon: 'i-reply', show: function (m) { return !!(S.chat && m.id != null && m.author !== 'system'); }, run: function (m) { startQuote(m); } },
  { id: 'hit', label: '用表情打', icon: 'i-smile',
    show: function (m) { var c = S.chat; return !!(c && m.id != null && c.ids.has(m.id) && m.sender_id !== S.me.id && !m.author && !fxOf(m.body) && !isCardBody(m.body)); },
    run: function (m, el) { openFxPick(m, el); } }
];
var menuEl = null;
export function svgIcon(id) {
  var s = document.createElement('span');
  s.innerHTML = '<svg class="i" aria-hidden="true"><use href="#' + id + '"/></svg>';
  return s.firstChild;
}
// 把浮层放在气泡上方（放不下就翻到下方），限制在聊天栏和视口里，小箭头对准气泡中心
function placeFloat(box, el) {
  var chat = $('chat'), cr = chat.getBoundingClientRect(), br = el._bubble.getBoundingClientRect();
  box.hidden = false; box.classList.remove('show'); box.classList.remove('below');
  box.style.left = '0px'; box.style.top = '0px';
  var mw = box.offsetWidth, mh = box.offsetHeight, topBar = chat.querySelector('.top').getBoundingClientRect().bottom;
  var cx = br.left + br.width / 2;
  var left = Math.max(cr.left + 8, Math.min(cx - mw / 2, cr.right - 8 - mw));
  var top = br.top - mh - 10, below = false;
  if (top < topBar + 4) { top = br.bottom + 10; below = true; }
  var maxTop = cr.bottom - mh - 8;
  if (top > maxTop) top = Math.max(topBar + 4, maxTop);
  box.style.left = (left - cr.left) + 'px'; box.style.top = (top - cr.top) + 'px';
  box.style.setProperty('--ax', Math.max(16, Math.min(mw - 16, cx - left)) + 'px');
  if (below) box.classList.add('below');
  void box.offsetWidth;
  box.classList.add('show');
}
function hideFloat(box) { box.classList.remove('show'); box.hidden = true; }
export function closeActMenu() {
  if (menuEl && menuEl._bw) menuEl._bw.classList.remove('menu-on');
  menuEl = null;
  hideFloat($('actMenu')); hideFloat($('fxPick'));
}
function openActMenu(el) {
  var m = el._m, c = S.chat;
  if (!m || !c || APP.cur) return false;
  var items = MSG_ACTIONS.filter(function (a) { return a.show(m); });
  if (!items.length) return false;
  closeActMenu();
  var box = clear($('actMenu'));
  items.forEach(function (a) {
    var b = h('button', { type: 'button', role: 'menuitem' }, svgIcon(a.icon), h('span', { text: a.label }));
    b.addEventListener('click', function () {
      if (a.id === 'hit') { hideFloat($('actMenu')); a.run(m, el); } else { closeActMenu(); a.run(m, el); }
    });
    box.appendChild(b);
  });
  menuEl = el;
  el._bw.classList.add('menu-on');
  placeFloat(box, el);
  return true;
}
function openFxPick(m, el) {
  var box = clear($('fxPick'));
  Object.keys(FX).forEach(function (tok) {
    var fx = FX[tok];
    var b = h('button', { type: 'button', role: 'menuitem', 'aria-label': fx.name, title: fx.name, text: fx.icon });
    b.addEventListener('click', function () {
      closeActMenu();
      if (S.chat && m.id != null && S.chat.ids.has(m.id)) sendBody(tok + '#' + m.id);
    });
    box.appendChild(b);
  });
  placeFloat(box, el);
}
function rowOfTarget(t) {
  var box = $('msgs'), inBubble = false;
  while (t && t !== box) {
    if (t.classList) {
      if (t.classList.contains('bubble')) inBubble = true;
      if (t.classList.contains('row')) return inBubble && t._m ? t : null;
    }
    t = t.parentNode;
  }
  return null;
}
// 点特效气泡里的引用：滚到被打中的那条消息并闪一下
export function jumpTo(tid) {
  var c = S.chat; if (!c) return;
  var key = null;
  c.msgs.forEach(function (m) { if (m.id === tid) key = m.key; });
  var el = key && c.nodes.get(key);
  if (!el) { toast('这条消息太早了，先往上翻翻看'); return; }
  var box = $('msgs'), r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  var top = box.scrollTop + (r.top + r.height / 2) - (b.top + b.height / 2);
  try { box.scrollTo({ top: top, behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) { box.scrollTop = top; }
  el._bw.classList.remove('flash'); void el._bw.offsetWidth; el._bw.classList.add('flash');
  setTimeout(function () { el._bw.classList.remove('flash'); }, 1300);
}
export function targetQuoteText(tid) {
  var c = S.chat, out = '';
  if (!c) return out;
  c.msgs.forEach(function (m) { if (m.id === tid && !fxOf(m.body)) out = cut(String(m.body).replace(/\s+/g, ' '), 8); });
  return out;
}
export function bindLongPress() {
  var box = $('msgs'), lp = { tm: 0, x: 0, y: 0, fired: false, at: 0 };
  function cancel() { if (lp.tm) { clearTimeout(lp.tm); lp.tm = 0; } }
  box.addEventListener('touchstart', function (ev) {
    cancel(); lp.fired = false;
    if (ev.touches.length !== 1) return;
    var el = rowOfTarget(ev.target); if (!el) return;
    lp.x = ev.touches[0].clientX; lp.y = ev.touches[0].clientY;
    lp.tm = setTimeout(function () {
      lp.tm = 0;
      if (!el.parentNode || !openActMenu(el)) return;
      lp.fired = true; lp.at = Date.now();
      try { var sel = window.getSelection(); if (sel) sel.removeAllRanges(); } catch (e) { /* 忽略 */ }
    }, 450);
  }, { passive: true });
  box.addEventListener('touchmove', function (ev) {
    var t = ev.touches[0];
    if (lp.tm && t && (Math.abs(t.clientX - lp.x) > 10 || Math.abs(t.clientY - lp.y) > 10)) cancel();
  }, { passive: true });
  // 只有长按真的触发之后才阻止默认行为，不影响普通的选字和滚动
  function end(ev) { cancel(); if (lp.fired) { lp.fired = false; if (ev.cancelable) ev.preventDefault(); } }
  box.addEventListener('touchend', end, { passive: false });
  box.addEventListener('touchcancel', end, { passive: false });
  box.addEventListener('contextmenu', function (ev) {
    var el = rowOfTarget(ev.target);
    if (!el) return;
    if (Date.now() - lp.at < 800) { ev.preventDefault(); return; } // 安卓长按会再补一个 contextmenu
    if (openActMenu(el)) ev.preventDefault();
  });
  box.addEventListener('scroll', function () { if (menuEl) closeActMenu(); }, { passive: true });
  document.addEventListener('pointerdown', function (ev) {
    if (!menuEl) return;
    if ($('actMenu').contains(ev.target) || $('fxPick').contains(ev.target)) return;
    closeActMenu();
  }, true);
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && menuEl) closeActMenu(); });
}
