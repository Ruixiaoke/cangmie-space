// 特效动画的小零件：坐标、粒子、随机数

import { h } from '../utils.js';

export function rnd(a, b) { return a + Math.random() * (b - a); }
export function tf(x, y, rest) { return 'translate(-50%,-50%) translate(' + x + 'px,' + y + 'px)' + (rest ? ' ' + rest : ''); }
export function centerOf(st, el) {
  var s = st.getBoundingClientRect(), r = el.getBoundingClientRect();
  return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2, r: r.width / 2 };
}
// 放一个粒子在 (x, y)，用 tf() 写关键帧（tf 会把它的中心对准坐标）
export function part(st, text, cls, x, y, size) {
  var el = h('span', { class: 'fx-p ' + (cls || ''), text: text || null, 'aria-hidden': 'true' });
  el.style.left = x + 'px'; el.style.top = y + 'px';
  if (size) el.style.fontSize = size + 'px';
  el.style.transform = tf(0, 0); el.style.opacity = '0';
  st.appendChild(el);
  return el;
}
// fill 只用 forwards：延迟期间不占用 transform，不会盖住先开始的动画；给了 iter 的是一次性动作，结束后不保留
export function anim(el, frames, dur, delay, easing, cleanup, iter) {
  var a = el.animate(frames, { duration: dur, delay: delay || 0, easing: easing || 'ease-out', iterations: iter || 1, fill: iter ? 'none' : 'forwards' });
  if (cleanup) a.onfinish = function () { if (el.parentNode) el.parentNode.removeChild(el); };
  return a;
}
export function squash(av, delay, amt) {
  anim(av, [{ transform: 'scale(1,1)' }, { transform: 'scale(' + (1 + amt) + ',' + (1 - amt) + ')' }, { transform: 'scale(1,1)' }], 260, delay, 'cubic-bezier(0.22,1,0.36,1)');
}
export function say(st, text, x, y, delay) {
  var el = part(st, text, 'fx-say', x, y);
  anim(el, [{ transform: tf(0, 10, 'scale(.4)'), opacity: 0 }, { transform: tf(0, 0, 'scale(1.1)'), opacity: 1, offset: .25 },
    { transform: tf(0, -4, 'scale(1)'), opacity: 1, offset: .8 }, { transform: tf(0, -14), opacity: 0 }], 1100, delay, 'ease-out');
}

// 水枪：从右边滋水，头像被打湿、抖一抖、往下滴水
