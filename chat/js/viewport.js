// 键盘与视口（iOS 键盘弹出时让输入栏保持可见）

import { nearBottom, scrollToBottom } from './chat/view.js';
import { layoutApp } from './miniapps/host.js';
import { S } from './state.js';
import { $ } from './utils.js';

// ===== 键盘与视口（iOS 键盘弹出时让输入栏保持可见） =====
export function fitViewport() {
  var vv = window.visualViewport, shell = $('shell');
  if (!vv) return;
  shell.style.height = vv.height + 'px';
  shell.style.top = vv.offsetTop + 'px';
  layoutApp();
  if (S.chat && nearBottom()) scrollToBottom();
}
