// 吉祥物图片：藏剑和纯阳两个 Q 版小人（加载失败时退化成文字字符，不出现裂图）

import { $, clear, h } from './utils.js';

var CHARS = [
  { normal: 'zangjian.png', cheer: 'zangjian-cheer.png', glyph: '剑' },
  { normal: 'chunyang.png', cheer: 'chunyang-cheer.png', glyph: '道' }
];
// 皮肤 id → 固定用 CHARS 里的第几个吉祥物（没写的皮肤照常按 seed 挑）
var SKIN_MASCOT = { chunyang: 1 };
// seed 可选：传同一个字符串（如用户 id）总是得到同一个角色；不传就随机
function pick(seed) {
  var only = SKIN_MASCOT[document.documentElement.getAttribute('data-skin')];
  if (only != null) return CHARS[only]; // 有的皮肤固定用一个吉祥物
  if (seed == null) return CHARS[Math.floor(Math.random() * CHARS.length)];
  var n = 0, s = String(seed);
  for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
  return CHARS[n % CHARS.length];
}
export function mascotSrc(seed) { return pick(seed).normal; }
export function mascot(kind, cls, seed) {
  var c = pick(seed);
  var wrap = document.createDocumentFragment();
  var img = h('img', { class: 'mascot ' + (cls || ''), src: kind === 'cheer' ? c.cheer : c.normal, alt: '', draggable: 'false' });
  img.addEventListener('error', function () {
    var f = h('span', { class: 'mascot-fallback ' + (cls || ''), text: c.glyph, 'aria-hidden': 'true' });
    if (img.parentNode) img.parentNode.replaceChild(f, img);
  });
  wrap.appendChild(img);
  return wrap;
}
export function setMascot(box, kind) { clear(box).appendChild(mascot(kind)); }
export function emptyState(text, tiny) {
  return h('div', { class: 'empty' + (tiny ? ' tiny' : '') }, mascot('normal', 'bob'), h('p', { text: text }));
}
export function popCheer(text) {
  var pop = $('pop');
  clear(pop).appendChild(h('div', { class: 'cheer-pop' }, mascot('cheer'), h('div', { class: 'shout', text: text || '好耶！' })));
  pop.hidden = false;
  setTimeout(function () { pop.hidden = true; clear(pop); }, 1700);
}
