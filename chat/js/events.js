// 事件绑定

import { setAuthMode, submitAuth } from './auth.js';
import { closeChat, loadOlder, openChat, scrollToBottom } from './chat/view.js';
import { bindAtPicker } from './agent/picker.js';
import { autosize } from './composer.js';
import { bindLongPress } from './menu.js';
import { closeApp, layoutApp } from './miniapps/host.js';
import { closePanels, setPanel } from './plus.js';
import { bindSwipeQuote } from './quote.js';
import { refreshAll } from './realtime.js';
import { sendCurrent } from './send.js';
import { S } from './state.js';
import { $, isVisible } from './utils.js';
import { fitViewport } from './viewport.js';
import { doSearch } from './views/friends.js';
import { showTab } from './views/tabs.js';

// ===== 事件 =====
export function bind() {
  $('segLogin').addEventListener('click', function () { setAuthMode('login'); });
  $('segRegister').addEventListener('click', function () { setAuthMode('register'); });
  $('authForm').addEventListener('submit', submitAuth);
  $('searchForm').addEventListener('submit', doSearch);
  document.querySelectorAll('#tabbar button').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.dataset.tab); });
  });
  $('chatBack').addEventListener('click', function () {
    if (history.state && history.state.chat) history.back(); else closeChat();
  });
  window.addEventListener('popstate', function () { if (S.chat) closeChat(); });
  $('emojiBtn').addEventListener('click', function () { setPanel($('emojiPanel').hidden ? 'emoji' : null); });
  $('plusBtn').addEventListener('click', function () { setPanel($('plusPanel').hidden ? 'plus' : null); });
  $('appClose').addEventListener('click', closeApp);
  var send = $('sendBtn');
  send.addEventListener('pointerdown', function (ev) { ev.preventDefault(); }); // 点发送不收起键盘
  send.addEventListener('click', sendCurrent);
  var input = $('input');
  input.addEventListener('input', autosize);
  bindAtPicker();
  input.addEventListener('focus', function () { closePanels(); setTimeout(function () { window.scrollTo(0, 0); if (S.chat) scrollToBottom(); }, 250); });
  input.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing || ev.keyCode === 229) return;
    if (window.matchMedia('(pointer:fine)').matches) { ev.preventDefault(); sendCurrent(); } // 电脑上回车发送，手机上回车换行
  });
  if (window.ResizeObserver) new ResizeObserver(function () { layoutApp(); }).observe($('composer')); // 输入框变高/引用条出现
  $('msgs').addEventListener('scroll', function () { if ($('msgs').scrollTop < 60) loadOlder(); }, { passive: true });
  bindSwipeQuote();
  bindLongPress();
  document.addEventListener('visibilitychange', function () {
    if (isVisible() && S.me) refreshAll();
  });
  window.addEventListener('online', function () { if (S.me) refreshAll(); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    window.visualViewport.addEventListener('scroll', fitViewport);
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (ev) {
      var d = ev.data || {};
      if (d.type !== 'notification-click' || !S.me) return;
      if (d.peer && /^[0-9a-f-]{36}$/i.test(d.peer)) { showTab('chats'); openChat(d.peer.toLowerCase()); }
      else if (d.tab) { if (S.chat) closeChat(); showTab(d.tab); }
    });
  }
}
