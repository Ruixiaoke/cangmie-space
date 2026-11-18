// 气泡状态变化动画：BEV 表与播放

import { reduced } from './view.js';
import { rnd } from '../fx/prims.js';
import { S } from '../state.js';
import { $, h, isVisible } from '../utils.js';

// 状态变化动画：气泡本身用 CSS 动画（cls），小粒子（水滴、爱心、星星、蒸汽）是临时的 span。a / b = [表情, 个数, 运动方式]
export var BEV = {
  wet:       { a: ['💧', 5, 'spray'], cls: 'ev-wet' },
  love:      { a: ['💗', 4, 'up'], cls: 'ev-love' },
  lovemore:  { a: ['💕', 7, 'burst'], cls: 'ev-love' },
  dry:       { a: ['💨', 3, 'steam'], b: ['💧', 5, 'fling'], cls: 'ev-dry' },
  unlove:    { a: ['💔', 3, 'fall'], b: ['💗', 3, 'fall'], cls: 'ev-unlove' },
  bonk:      { a: ['⭐', 3, 'star'], cls: 'ev-bonk' },
  bounce:    { cls: 'ev-bounce' },
  evap:      { a: ['💨', 5, 'steam'], b: ['💧', 3, 'steam'], cls: 'ev-pop' },
  moreice:   { a: ['❄️', 6, 'burst'], cls: 'ev-shiver' },
  steambath: { a: ['💨', 9, 'steam'], b: ['♨️', 3, 'up'], cls: 'ev-puff' },
  soaked:    { a: ['🌸', 6, 'fall'], b: ['💧', 4, 'spray'], cls: 'ev-shake' },
  shatter:   { a: ['🧊', 8, 'burst'], b: ['✨', 4, 'burst'], cls: 'ev-bonk' },
  carrot:    { a: ['🥕', 1, 'spit'], cls: 'ev-jelly' },
  knockflowers: { a: ['🌸', 7, 'fall'], cls: 'ev-bonk' },
  meltwarm:  { a: ['💧', 6, 'fall'], b: ['💗', 2, 'up'], cls: 'ev-pop' },
  heartburst:{ a: ['💗', 8, 'burst'], cls: 'ev-pop' },
  burp:      { a: ['💨', 3, 'fling'], cls: 'ev-jelly' },
  shiver:    { a: ['💧', 2, 'fall'], cls: 'ev-shiver' },
  gentle:    { a: ['💤', 2, 'up'], cls: 'ev-pop' },
  freezewet: { a: ['❄️', 6, 'burst'], cls: 'ev-shiver' },
  freeze:    { a: ['❄️', 5, 'burst'], cls: 'ev-shiver' },
  hiss:      { a: ['💨', 5, 'steam'], cls: 'ev-shake' },
  cooldown:  { a: ['❄️', 4, 'burst'], b: ['💗', 3, 'fall'], cls: 'ev-pop' },
  melt:      { a: ['💧', 6, 'fall'], cls: 'ev-shake' },
  steam:     { a: ['💨', 4, 'steam'], cls: 'ev-dry' },
  spicylove: { a: ['🔥', 3, 'up'], b: ['💗', 4, 'up'], cls: 'ev-pop' },
  spicy:     { a: ['🔥', 3, 'up'], cls: 'ev-pop' },
  bigflame:  { a: ['🔥', 6, 'up'], cls: 'ev-flare' },
  heat:      { a: ['🔥', 3, 'up'], cls: 'ev-flare' },
  wilt:      { a: ['🥀', 3, 'fall'], b: ['🔥', 2, 'up'], cls: 'ev-shake' },
  blowdry:   { a: ['💨', 5, 'fling'], b: ['💧', 4, 'fling'], cls: 'ev-dry' },
  thaw:      { a: ['💧', 5, 'fall'], b: ['💨', 3, 'fling'], cls: 'ev-shake' },
  petalsaway:{ a: ['🌸', 8, 'fling'], cls: 'ev-wobble' },
  nodisperse:{ a: ['💗', 6, 'orbit'], cls: 'ev-wobble' },
  flare:     { a: ['🔥', 5, 'up'], cls: 'ev-flare' },
  wobble:    { cls: 'ev-wobble' },
  feed:      { a: ['🥕', 3, 'up'], cls: 'ev-puff' },
  feedmore:  { a: ['🥕', 4, 'up'], cls: 'ev-puff' },
  bloom:     { a: ['🌸', 5, 'up'], cls: 'ev-pop' },
  petalburst:{ a: ['🌸', 8, 'burst'], cls: 'ev-pop' },
  passion:   { a: ['🌸', 6, 'burst'], b: ['💗', 6, 'burst'], cls: 'ev-pop' },
  morebloom: { a: ['🌸', 6, 'burst'], cls: 'ev-pop' },
  frostflower:{ a: ['❄️', 3, 'burst'], b: ['🌸', 2, 'burst'], cls: 'ev-shiver' },
  flowerwilt:{ a: ['🥀', 3, 'fall'], cls: 'ev-shake' },
  sleep:     { a: ['💤', 3, 'up'], cls: 'ev-pop' },
  wake:      { a: ['✨', 4, 'burst'], cls: 'ev-stretch' }
};
var FROM_VARS = {
  wet: ['--wet-bg', '--wet-bd', '--wet-fg'], love: ['--love-bg', '--love-bd', '--love-fg'], passion: ['--love-bg', '--love-bd', '--love-fg'],
  frozen: ['--frozen-bg', '--frozen-bd', '--frozen-fg'], hot: ['--hot-bg', '--hot-bd', '--hot-fg'],
  plump: ['--plump-bg', '--plump-bd', '--plump-fg'], bloom: ['--bloom-bg', '--bloom-bd', '--bloom-fg']
};
function setFromTint(el, st) {
  var v = FROM_VARS[st.k], b = el._bubble.style;
  if (v) { b.setProperty('--from-bg', 'var(' + v[0] + ')'); b.setProperty('--from-bd', 'var(' + v[1] + ')'); b.setProperty('--from-fg', 'var(' + v[2] + ')'); }
  else {
    b.setProperty('--from-bg', el._m.sender_id === S.me.id ? 'var(--bub-own)' : 'var(--bub-peer)');
    b.setProperty('--from-bd', 'var(--bub-bd)'); b.setProperty('--from-fg', 'var(--t1)');
  }
}
function bevPart(bw, t, how) {
  var l, tp, dx, dy, cls = 'bp';
  if (how === 'spray') { l = rnd(15, 85); tp = 100; dx = rnd(-24, 24); dy = rnd(20, 46); }
  else if (how === 'up') { l = rnd(15, 85); tp = 0; dx = rnd(-18, 18); dy = rnd(-46, -24); }
  else if (how === 'burst') { l = rnd(30, 70); tp = 50; dx = rnd(-64, 64); dy = rnd(-48, -6); }
  else if (how === 'steam') { l = rnd(15, 85); tp = 0; dx = rnd(-10, 10); dy = rnd(-42, -24); }
  else if (how === 'fling') { l = rnd(10, 90); tp = 50; dx = (Math.random() < .5 ? -1 : 1) * rnd(40, 72); dy = rnd(-6, 30); }
  else if (how === 'fall') { l = rnd(10, 90); tp = 90; dx = rnd(-14, 14); dy = rnd(40, 66); cls += ' fall'; }
  else if (how === 'spit') { l = rnd(60, 90); tp = 60; dx = (Math.random() < .5 ? -1 : 1) * rnd(70, 100); dy = rnd(-24, 24); }
  else if (how === 'orbit') { l = 50; tp = 50; dx = 0; dy = 0; cls += ' orbit'; }
  else { l = rnd(20, 80); tp = 0; dx = rnd(-30, 30); dy = rnd(-40, -18); } // star
  var d = h('span', { class: cls, text: t, 'aria-hidden': 'true' });
  d.style.left = l + '%'; d.style.top = tp + '%'; d.style.marginLeft = '-8px'; d.style.marginTop = '-8px';
  d.style.setProperty('--dx', dx + 'px'); d.style.setProperty('--dy', dy + 'px'); d.style.setProperty('--rot', rnd(-60, 60) + 'deg');
  if (how === 'orbit') { d.style.setProperty('--a', rnd(0, 360) + 'deg'); d.style.setProperty('--rad', rnd(34, 46) + 'px'); }
  d.style.animationDelay = rnd(0, 180) + 'ms';
  bw.appendChild(d);
}
function cleanEv(el) {
  el._evT = 0;
  if (el._evCls) el._evCls.forEach(function (n) { el._bw.classList.remove(n); });
  el._evCls = null;
  el._bubble.style.removeProperty('--from-bg'); el._bubble.style.removeProperty('--from-bd'); el._bubble.style.removeProperty('--from-fg');
  var ps = el._bw.querySelectorAll('.bp');
  for (var i = 0; i < ps.length; i++) ps[i].parentNode.removeChild(ps[i]);
}
// e：一条变化事件（uid 被打中的人，tid 只打中某条气泡时的消息 id，ev 主动画，x 额外动作，before 变化前的状态）
export function bubbleEv(e) {
  var c = S.chat;
  var names = [];
  if (e.ev && BEV[e.ev]) names.push(e.ev);
  if (e.x && BEV[e.x]) names.push(e.x);
  if (!c || !names.length || reduced() || !isVisible()) return;
  var mr = $('msgs').getBoundingClientRect();
  c.nodes.forEach(function (el) {
    if (!el._m || el._sd) return;
    if (e.tid != null) { if (el._m.id !== e.tid) return; }
    else if (el._m.sender_id !== e.uid) return;
    var r = el.getBoundingClientRect();
    if (!r.height || r.bottom < mr.top || r.top > mr.bottom) return; // 只演屏幕上看得到的
    if (el._evT) { clearTimeout(el._evT); cleanEv(el); }
    void el._bw.offsetWidth; // 让同一个动画可以重新开始
    el._evCls = [BEV[names[0]].cls];
    if (!el._fxb && e.before && e.after && e.before.k !== e.after.k && names[0] !== 'dry' && names[0] !== 'unlove') { setFromTint(el, e.before); el._evCls.push('ev-tint'); }
    el._evCls.forEach(function (n) { el._bw.classList.add(n); });
    if (!el._fxb) {
      names.forEach(function (nm) {
        [BEV[nm].a, BEV[nm].b].forEach(function (p) {
          if (!p) return;
          for (var i = 0; i < p[1]; i++) bevPart(el._bw, p[0], p[2]);
        });
      });
    }
    el._evT = setTimeout(function () { cleanEv(el); }, 1800);
  });
}
