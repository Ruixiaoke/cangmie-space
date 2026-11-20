// 桌面端（宽屏）：双栏布局下的判断和键盘操作
//   布局全在 css/desktop.css（同一个断点）；这里只管 JS 行为：
//   - isDesktop()：左栏列表 + 右栏聊天同时可见时为真（切会话不再写浏览器历史，见 chat/view.js）
//   - Esc：先关最上层的东西（表情 / + 面板、小程序、群资料、排行榜），都没有就关掉当前聊天
//   - Alt+↑ / Alt+↓：切到列表里的上一个 / 下一个会话

import { S } from './state.js';
import { $ } from './utils.js';

export var DESK_MQ = '(min-width: 960px)';
var mq = window.matchMedia ? window.matchMedia(DESK_MQ) : null;
export function isDesktop() { return !!(mq && mq.matches); }

function visible(id) { var el = $(id); return !!(el && !el.hidden); }

export function initDesktop(api) {
  // 捕获阶段注册：比 quote.js 等模块自己的 Esc 处理先执行，一次只关一层，关了就不再往下传
  document.addEventListener('keydown', function (ev) {
    if (!isDesktop() || ev.defaultPrevented || ev.isComposing) return;
    if (ev.key === 'Escape') {
      // 这些层自己处理 Esc（长按菜单、引用弹窗、正在引用、@ 助手选择框），让它们来
      var menu = $('actMenu');
      if ((menu && menu.classList.contains('show')) || visible('qsheet') || visible('atPop') || (S.chat && S.chat.quote)) return;
      var done = function () { ev.preventDefault(); ev.stopImmediatePropagation(); };
      if (visible('emojiPanel') || visible('plusPanel')) { api.closePanels(); done(); return; }
      if (visible('appLayer')) { api.closeApp(); done(); return; }
      if (api.closeOverlay()) { done(); return; }
      if (S.chat) { api.closeChat(); done(); }
      return;
    }
    if (ev.altKey && !ev.ctrlKey && !ev.metaKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      var cards = Array.prototype.slice.call(document.querySelectorAll('#chatList .card[data-conv]'));
      if (!cards.length) return;
      var i = cards.findIndex(function (c) { return c.classList.contains('on'); });
      var next = i < 0 ? (ev.key === 'ArrowDown' ? 0 : cards.length - 1) : i + (ev.key === 'ArrowDown' ? 1 : -1);
      if (next < 0 || next >= cards.length) return;
      ev.preventDefault();
      cards[next].click();
      cards[next].scrollIntoView({ block: 'nearest' });
      var input = $('input');
      if (input) setTimeout(function () { input.focus(); }, 0);
    }
  }, true);
}
