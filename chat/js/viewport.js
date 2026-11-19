// 键盘与视口（iOS 键盘弹出时让输入栏保持可见）

import { nearBottom, scrollToBottom } from './chat/view.js';
import { layoutApp } from './miniapps/host.js';
import { S } from './state.js';
import { $ } from './utils.js';

function typing() {
  var el = document.activeElement;
  return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
}

// ===== 键盘与视口（iOS 键盘弹出时让输入栏保持可见） =====
export function fitViewport() {
  var vv = window.visualViewport, shell = $('shell');
  if (!vv) return;
  if (typing()) {
    shell.style.height = vv.height + 'px';
    shell.style.top = vv.offsetTop + 'px';
  } else {
    // 没在打字就没有键盘：iOS 横竖屏切换后会留下页面滚动 / 过期的 offsetTop，顶上空一块还滚不回来，这里归零
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    shell.style.height = '';
    shell.style.top = '';
  }
  layoutApp();
  if (S.chat && nearBottom()) scrollToBottom();
}

// iOS 旋转后几百毫秒内视口尺寸还在变，多补几次
export function refitSoon() {
  fitViewport();
  [100, 300, 600].forEach(function (ms) { setTimeout(fitViewport, ms); });
}
