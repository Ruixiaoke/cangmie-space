// 舞台零件与对战

import { BEV } from '../bubble/bev.js';
import { anim, centerOf, part, rnd, tf } from './prims.js';
import { RC_IDX, RECIPES } from '../recipes.js';
import { S, makeAvatar } from '../state.js';
import { h } from '../utils.js';

export function overlay(st, cls, behind) {
  var o = h('div', { class: cls, 'aria-hidden': 'true' });
  if (behind && st.firstChild) st.insertBefore(o, st.firstChild); else st.appendChild(o);
  return o;
}
// 配方名牌：命中某个有名字的变化时，在说明下面亮一个小标签
export function stageTag(st, name, delay) {
  var tg = h('div', { class: 'fx-tag', text: name });
  st.appendChild(tg);
  anim(tg, [{ opacity: 0, transform: 'translateX(-50%) translateY(8px)' }, { opacity: 1, transform: 'translateX(-50%) translateY(0)' }], 320, delay, 'cubic-bezier(0.22,1,0.36,1)');
}
// 有名字的状态变化（蒸汽浴、碎冰、打嗝、吹不散……）在舞台上也补一层粒子，时间对准“命中”那一刻
export function stageExtra(st, av, fx, info) {
  var c = centerOf(st, av), start = fx.at || 800, end = 0, named = null;
  if (info.ev && RC_IDX[info.ev] != null) named = info.ev; else if (info.x && RC_IDX[info.x] != null) named = info.x;
  if (named) stageTag(st, RECIPES[RC_IDX[named]].name, start);
  if (info.ev && RC_IDX[info.ev] != null) end = Math.max(end, stageParts(st, c, info.ev, start));
  if (info.x) end = Math.max(end, stageParts(st, c, info.x, start + 300));
  return end ? end + 300 : 0;
}
function stageParts(st, c, ev, start) {
  var def = BEV[ev], end = start;
  if (!def) return end;
  [def.a, def.b].forEach(function (p) {
    if (!p) return;
    var n = Math.min(p[1] * 2, 14);
    for (var i = 0; i < n; i++) end = Math.max(end, stageOne(st, c, p[0], p[2], start + i * 55, i, n));
  });
  return end;
}
function stageOne(st, c, emoji, how, delay, idx, n) {
  var size = rnd(20, 30), x = c.x + rnd(-.7, .7) * c.r, y = c.y + rnd(-.5, .5) * c.r, dx = 0, dy = 0, dur = 1000, fr;
  if (how === 'orbit') {
    var a0 = idx / n * Math.PI * 2, R = c.r * 1.3;
    fr = [];
    for (var s = 0; s <= 12; s++) {
      var an = a0 + s / 12 * Math.PI * 2;
      fr.push({ transform: tf(Math.cos(an) * R - (x - c.x), Math.sin(an) * R * .8 - (y - c.y), 'scale(' + (s === 0 || s === 12 ? .5 : 1) + ')'), opacity: s === 0 || s === 12 ? 0 : 1 });
    }
    anim(part(st, emoji, '', x, y, size), fr, 1700, delay, 'ease-in-out', true);
    return delay + 1700;
  }
  if (how === 'up' || how === 'steam') { dx = rnd(-20, 20); dy = rnd(-100, -50); }
  else if (how === 'fall') { y = c.y - c.r * .3; dx = rnd(-30, 30); dy = rnd(90, 150); }
  else if (how === 'spray') { y = c.y + c.r * .5; dx = rnd(-40, 40); dy = rnd(40, 90); }
  else if (how === 'fling') { dx = (idx % 2 ? 1 : -1) * rnd(90, 150); dy = rnd(-20, 40); }
  else if (how === 'spit') { x = c.x + c.r * .2; y = c.y + c.r * .35; dx = (idx % 2 ? 1 : -1) * rnd(100, 150); dy = rnd(-30, 20); }
  else { var ag = rnd(0, Math.PI * 2), d = rnd(60, 110); x = c.x; y = c.y; dx = Math.cos(ag) * d; dy = Math.sin(ag) * d - 10; }
  var el = part(st, emoji, '', x, y, size);
  anim(el, [{ transform: tf(0, 0, 'scale(.4)'), opacity: 0 }, { transform: tf(dx * .45, dy * .45 - (how === 'spit' ? 40 : 0), 'scale(1)'), opacity: 1, offset: .3 },
    { transform: tf(dx, dy, 'scale(.9) rotate(' + rnd(-90, 90) + 'deg)'), opacity: 0 }], dur, delay, how === 'fall' ? 'cubic-bezier(.5,0,.9,.6)' : 'ease-out', true);
  return delay + dur;
}

// 对战：两个头像面对面，特效来回飞，最后各中一发
export function fxBattle(st, fx, otherP) {
  var W = st.clientWidth, H = st.clientHeight, ay = H * .4, ax = W * .24, bx = W * .76, mid = (ax + bx) / 2;
  function side(prof, xp) {
    var a = makeAvatar(prof, 88), w = h('div', { class: 'fx-av' }, a);
    w.style.left = xp + 'px';
    st.appendChild(w);
    return a;
  }
  var la = side(S.me, ax), lb = side(otherP, bx);
  anim(la, [{ transform: 'rotate(0)' }, { transform: 'rotate(8deg)' }], 300, 0, 'ease-out');
  anim(lb, [{ transform: 'rotate(0)' }, { transform: 'rotate(-8deg)' }], 300, 0, 'ease-out');
  var pa = part(st, fx.icon, '', ax, ay, 44), pb = part(st, fx.icon, '', bx, ay, 44);
  var dm = mid - ax;
  function round(t, dur) {
    anim(pa, [{ transform: tf(0, 0, 'scale(.6)'), opacity: 1 }, { transform: tf(dm, 0, 'scale(1.1)'), opacity: 1 }], dur, t, 'ease-in');
    anim(pb, [{ transform: tf(0, 0, 'scale(.6) scaleX(-1)'), opacity: 1 }, { transform: tf(-dm, 0, 'scale(1.1) scaleX(-1)'), opacity: 1 }], dur, t, 'ease-in');
  }
  function back(t, dur) {
    anim(pa, [{ transform: tf(dm, 0, 'scale(1.1)'), opacity: 1 }, { transform: tf(0, 0, 'scale(.6)'), opacity: 1 }], dur, t, 'cubic-bezier(0.22,1,0.36,1)');
    anim(pb, [{ transform: tf(-dm, 0, 'scale(1.1) scaleX(-1)'), opacity: 1 }, { transform: tf(0, 0, 'scale(.6) scaleX(-1)'), opacity: 1 }], dur, t, 'cubic-bezier(0.22,1,0.36,1)');
  }
  function spark(t, size) {
    var sp = part(st, '💥', '', mid, ay, size);
    anim(sp, [{ transform: tf(0, 0, 'scale(.2)'), opacity: 1 }, { transform: tf(0, 0, 'scale(1.2)'), opacity: 1, offset: .5 }, { transform: tf(0, 0, 'scale(1.5)'), opacity: 0 }], 480, t, 'ease-out', true);
    for (var i = 0; i < 6; i++) {
      var an = rnd(0, Math.PI * 2), d = rnd(40, 80), s = part(st, '✨', '', mid, ay, rnd(14, 22));
      anim(s, [{ transform: tf(0, 0, 'scale(.3)'), opacity: 1 }, { transform: tf(Math.cos(an) * d, Math.sin(an) * d, 'scale(1)'), opacity: 0 }], 600, t, 'ease-out', true);
    }
  }
  round(300, 460); spark(760, 60); back(780, 480);
  round(1400, 340); spark(1740, 84); back(1760, 420);
  // 最后一轮：各自穿过去，打中对面
  anim(pa, [{ transform: tf(0, 0, 'scale(.6)'), opacity: 1 }, { transform: tf(bx - ax, 0, 'scale(1.3)'), opacity: 1, offset: .9 }, { transform: tf(bx - ax, 0, 'scale(1.6)'), opacity: 0 }], 520, 2250, 'ease-in');
  anim(pb, [{ transform: tf(0, 0, 'scale(.6) scaleX(-1)'), opacity: 1 }, { transform: tf(ax - bx, 0, 'scale(1.3) scaleX(-1)'), opacity: 1, offset: .9 }, { transform: tf(ax - bx, 0, 'scale(1.6) scaleX(-1)'), opacity: 0 }], 520, 2250, 'ease-in');
  function hitAv(el, rot, t) {
    anim(el, [{ transform: 'rotate(' + rot + 'deg) scale(1)' }, { transform: 'rotate(' + rot + 'deg) scale(1.14,.86)' }, { transform: 'rotate(' + (rot * -.5) + 'deg) scale(.94,1.06)' }, { transform: 'rotate(' + rot + 'deg) scale(1)' }], 420, t, 'cubic-bezier(0.22,1,0.36,1)');
  }
  hitAv(la, 8, 2720); hitAv(lb, -8, 2720);
  for (var i = 0; i < 8; i++) {
    var side2 = i % 2, px = side2 ? bx : ax, an = rnd(0, Math.PI * 2), d = rnd(40, 70), q = part(st, i % 3 ? '💫' : '⭐', '', px, ay, rnd(16, 24));
    anim(q, [{ transform: tf(0, 0, 'scale(.3)'), opacity: 1 }, { transform: tf(Math.cos(an) * d, Math.sin(an) * d - 20, 'scale(1)'), opacity: 0 }], 700, 2720, 'ease-out', true);
  }
  var lab = part(st, '对战！', 'fx-say fx-big', mid, ay - 90, 0);
  anim(lab, [{ transform: tf(0, 10, 'scale(.4)'), opacity: 0 }, { transform: tf(0, 0, 'scale(1.15)'), opacity: 1, offset: .3 }, { transform: tf(0, 0, 'scale(1)'), opacity: 1 }], 420, 2300, 'cubic-bezier(0.22,1,0.36,1)');
  return 3500;
}
