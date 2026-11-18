// 输入栏与表情面板

import { EMOJIS } from './config.js';
import { FX } from './fx/table.js';
import { closePanels } from './plus.js';
import { sendBody } from './send.js';
import { $, h } from './utils.js';

// ===== 输入栏 =====
export function autosize() {
  var t = $('input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 112) + 'px';
}
export function buildEmojiPanel() {
  var row = $('fxRow');
  Object.keys(FX).forEach(function (body) {
    var fx = FX[body];
    var b = h('button', { type: 'button', 'aria-label': '发送' + fx.name },
      h('span', { class: 'ico', text: fx.icon, 'aria-hidden': 'true' }), fx.name);
    b.addEventListener('pointerdown', function (ev) { ev.preventDefault(); });
    b.addEventListener('click', function () { closePanels(); sendBody(body); });
    row.appendChild(b);
  });
  var p = $('emojiGrid');
  EMOJIS.forEach(function (e) {
    var b = h('button', { type: 'button', text: e, 'aria-label': e });
    b.addEventListener('pointerdown', function (ev) { ev.preventDefault(); }); // 不抢输入框焦点
    b.addEventListener('click', function () {
      var t = $('input');
      var s = t.selectionStart == null ? t.value.length : t.selectionStart, en = t.selectionEnd == null ? s : t.selectionEnd;
      if (t.value.length - (en - s) + e.length > 2000) return;
      t.value = t.value.slice(0, s) + e + t.value.slice(en);
      t.selectionStart = t.selectionEnd = s + e.length;
      autosize();
    });
    p.appendChild(b);
  });
}
