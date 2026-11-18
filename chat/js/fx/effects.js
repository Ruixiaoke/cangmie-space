// 单个特效表情的全屏动画

import { overlay } from './battle.js';
import { anim, centerOf, part, rnd, say, squash, tf } from './prims.js';
import { h } from '../utils.js';

export function fxWater(st, av) {
  var c = centerOf(st, av), W = st.clientWidth;
  var gx = Math.min(W - 44, c.x + c.r + 92), gy = c.y + 4;
  var gun = part(st, '🔫', '', gx, gy, 64);
  anim(gun, [{ transform: tf(160, 0), opacity: 0 }, { transform: tf(-8, 0, 'rotate(-6deg)'), opacity: 1, offset: .7 }, { transform: tf(0, 0), opacity: 1 }], 380, 0, 'cubic-bezier(0.22,1,0.36,1)');
  anim(gun, [{ transform: tf(0, 0), opacity: 1 }, { transform: tf(5, 0, 'rotate(5deg)'), opacity: 1 }, { transform: tf(0, 0), opacity: 1 }], 110, 420, null, false, 11);
  anim(gun, [{ transform: tf(0, 0), opacity: 1 }, { transform: tf(140, 10, 'rotate(10deg)'), opacity: 0 }], 360, 2350, 'ease-in');
  say(st, '滋滋滋～', gx - 10, gy - 58, 450);
  var mx = gx - 30, my = gy - 12; // 枪口
  var wet = h('div', { class: 'fx-wet' });
  av.appendChild(wet);
  var N = 42, start = 420;
  for (var i = 0; i < N; i++) {
    var tx = c.x + rnd(-0.1, 0.6) * c.r, ty = c.y + rnd(-0.6, 0.5) * c.r;
    var d = h('span', { class: 'fx-p fx-drop', 'aria-hidden': 'true' });
    d.style.left = mx + 'px'; d.style.top = my + 'px'; d.style.opacity = '0';
    st.appendChild(d);
    var dx = tx - mx, dy = ty - my, s = rnd(.7, 1.3);
    anim(d, [{ transform: tf(0, 0, 'scale(' + s + ')'), opacity: 1 }, { transform: tf(dx * .5, dy * .5 - 14, 'scale(' + s + ')'), opacity: 1 },
      { transform: tf(dx, dy, 'scale(' + s + ')'), opacity: .9 }], 240, start + i * 28, 'linear', true);
    if (i % 2 === 0) splash(st, tx, ty, start + i * 28 + 240);
  }
  // 被打中：抖一抖，慢慢变湿
  anim(av, [{ transform: 'translateX(0) rotate(0)' }, { transform: 'translateX(-5px) rotate(-4deg)' }, { transform: 'translateX(4px) rotate(3deg)' }, { transform: 'translateX(0) rotate(0)' }], 180, 660, null, false, 8);
  anim(wet, [{ opacity: 0 }, { opacity: .85 }], 900, 700, 'ease-in');
  for (var k = 0; k < 6; k++) {
    var drip = part(st, '💧', '', c.x + rnd(-.6, .6) * c.r, c.y + c.r * rnd(.55, .85), rnd(14, 20));
    anim(drip, [{ transform: tf(0, 0, 'scale(.3)'), opacity: 0 }, { transform: tf(0, 6, 'scale(1)'), opacity: 1, offset: .3 }, { transform: tf(0, 90), opacity: 0 }],
      900, 1500 + k * 170, 'cubic-bezier(.5,0,.9,.6)', true);
  }
  return 2900;
}
function splash(st, x, y, delay) {
  for (var j = 0; j < 2; j++) {
    var p = h('span', { class: 'fx-p fx-drop', 'aria-hidden': 'true' });
    p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.opacity = '0';
    st.appendChild(p);
    var ang = rnd(-Math.PI * .45, Math.PI * .45), dist = rnd(26, 60), dx = Math.cos(ang) * dist * .9, dy = Math.sin(ang) * dist;
    anim(p, [{ transform: tf(0, 0, 'scale(.8)'), opacity: 1 }, { transform: tf(dx * .7, dy * .7 - 18, 'scale(.6)'), opacity: .9 },
      { transform: tf(dx, dy + 34, 'scale(.4)'), opacity: 0 }], 520, delay, 'ease-out', true);
  }
}

// 敲头：小锤子从右上方敲三下，冒星星
export function fxHammer(st, av) {
  var c = centerOf(st, av);
  var hx = c.x + c.r * .55, hy = c.y - c.r - 18;
  var hm = part(st, '🔨', '', hx, hy, 70);
  hm.style.transformOrigin = '85% 85%';
  var up = 'rotate(55deg)', hit = 'rotate(-25deg)';
  anim(hm, [{ transform: tf(80, -60, up), opacity: 0 }, { transform: tf(0, 0, up), opacity: 1 }], 300, 0, 'ease-out');
  for (var i = 0; i < 3; i++) {
    var t = 380 + i * 480;
    anim(hm, [{ transform: tf(0, 0, up), opacity: 1 }, { transform: tf(-6, 10, hit), opacity: 1, offset: .35 }, { transform: tf(0, 0, up), opacity: 1 }], 440, t, 'cubic-bezier(.6,0,.4,1)', false, 1);
    squash(av, t + 150, .18);
    for (var s = 0; s < 4; s++) {
      var star = part(st, s % 2 ? '⭐' : '💫', '', c.x + rnd(-.3, .3) * c.r, c.y - c.r * .85, rnd(16, 24));
      var a = rnd(-Math.PI, 0), d = rnd(40, 70);
      anim(star, [{ transform: tf(0, 0, 'scale(.3)'), opacity: 1 }, { transform: tf(Math.cos(a) * d, Math.sin(a) * d, 'scale(1) rotate(160deg)'), opacity: 1, offset: .6 },
        { transform: tf(Math.cos(a) * d * 1.2, Math.sin(a) * d * 1.2 + 10, 'scale(.8) rotate(220deg)'), opacity: 0 }], 600, t + 150, 'ease-out', true);
    }
    say(st, '咚！', c.x - c.r - 24 + i * 6, c.y - c.r * .6 - i * 16, t + 150);
  }
  anim(hm, [{ transform: tf(0, 0, up), opacity: 1 }, { transform: tf(90, -70, up), opacity: 0 }], 320, 1900, 'ease-in');
  // 鼓起一个小包
  var bump = part(st, '', '', c.x + c.r * .1, c.y - c.r + 4, 0);
  bump.style.cssText += ';width:28px;height:24px;border-radius:50% 50% 40% 40%;background:#ffb3c6;box-shadow:inset 0 1px 0 rgba(255,255,255,.6),0 1px 3px rgba(24,14,6,.25)';
  anim(bump, [{ transform: tf(0, 0, 'scale(0)'), opacity: 1 }, { transform: tf(0, -6, 'scale(1.2)'), opacity: 1, offset: .6 }, { transform: tf(0, -4, 'scale(1)'), opacity: 1 }], 380, 1380, 'cubic-bezier(0.22,1,0.36,1)');
  return 2500;
}

// 飞吻：爱心从下面飘过来，脸红，盖一个唇印
export function fxKiss(st, av) {
  var c = centerOf(st, av), W = st.clientWidth, H = st.clientHeight;
  var hearts = ['💗', '💕', '💖', '❤️'];
  for (var i = 0; i < 14; i++) {
    var sx = rnd(W * .1, W * .9), sy = H + 20;
    var ht = part(st, hearts[i % 4], '', sx, sy, rnd(20, 32));
    var dx = c.x + rnd(-.5, .5) * c.r - sx, dy = c.y + rnd(-.4, .4) * c.r - sy, sw = rnd(-40, 40);
    anim(ht, [{ transform: tf(0, 0, 'scale(.6)'), opacity: 0 }, { transform: tf(dx * .4 + sw, dy * .4, 'scale(1)'), opacity: 1, offset: .35 },
      { transform: tf(dx * .8 - sw * .5, dy * .8, 'scale(1)'), opacity: 1, offset: .8 }, { transform: tf(dx, dy, 'scale(.2)'), opacity: 0 }],
      1000, i * 70, 'ease-in-out', true);
  }
  for (var b = 0; b < 2; b++) {
    var bl = h('div', { class: 'fx-blush' });
    bl.style[b ? 'right' : 'left'] = '10%';
    av.appendChild(bl);
    anim(bl, [{ opacity: 0 }, { opacity: 1 }], 500, 1000);
  }
  for (var p = 0; p < 3; p++) anim(av, [{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }], 300, 900 + p * 330, 'ease-out', false, 1);
  var lips = part(st, '💋', '', c.x + c.r * .35, c.y + c.r * .1, 46);
  anim(lips, [{ transform: tf(0, 0, 'scale(3) rotate(-30deg)'), opacity: 0 }, { transform: tf(0, 0, 'scale(.9) rotate(-12deg)'), opacity: 1, offset: .7 },
    { transform: tf(0, 0, 'scale(1) rotate(-12deg)'), opacity: 1 }], 380, 1150, 'ease-in');
  say(st, 'mua～', c.x - c.r - 10, c.y - c.r - 6, 1200);
  return 2600;
}

// 拍拍：一只手在头顶拍几下
export function fxPat(st, av) {
  var c = centerOf(st, av);
  var hx = c.x, hy = c.y - c.r - 30;
  var hand = part(st, '🫳', '', hx, hy, 60);
  anim(hand, [{ transform: tf(0, -60), opacity: 0 }, { transform: tf(0, 0), opacity: 1 }], 280, 0, 'ease-out');
  for (var i = 0; i < 5; i++) {
    var t = 320 + i * 300;
    anim(hand, [{ transform: tf(0, 0, 'rotate(0)'), opacity: 1 }, { transform: tf(i % 2 ? 6 : -6, 22, 'rotate(' + (i % 2 ? 6 : -6) + 'deg)'), opacity: 1, offset: .45 }, { transform: tf(0, 0), opacity: 1 }],
      300, t, 'ease-in-out', false, 1);
    squash(av, t + 110, .12);
    var sp = part(st, '✨', '', c.x + (i % 2 ? 1 : -1) * c.r * rnd(.7, 1), c.y - c.r * rnd(.3, .8), rnd(16, 22));
    anim(sp, [{ transform: tf(0, 0, 'scale(.2)'), opacity: 0 }, { transform: tf(0, -10, 'scale(1.1)'), opacity: 1, offset: .4 }, { transform: tf(0, -24, 'scale(.6)'), opacity: 0 }], 600, t + 110, 'ease-out', true);
  }
  anim(hand, [{ transform: tf(0, 0), opacity: 1 }, { transform: tf(0, -50), opacity: 0 }], 300, 1850, 'ease-in');
  say(st, '拍拍～', c.x + c.r + 26, c.y - c.r * .5, 500);
  return 2400;
}


// 雪球：从右上扔来一个雪球，头像被冻上一层霜，抖一抖
export function fxSnow(st, av) {
  var c = centerOf(st, av), W = st.clientWidth;
  var sx = Math.min(W - 30, c.x + c.r + 110), sy = c.y - 40;
  var tx = c.x + c.r * .3 - sx, ty = c.y - c.r * .1 - sy;
  var ball = part(st, '', 'fx-snowball', sx, sy, 0);
  anim(ball, [{ transform: tf(0, 0, 'scale(.7) rotate(0)'), opacity: 1 }, { transform: tf(tx * .5, ty * .5 - 56, 'scale(1) rotate(180deg)'), opacity: 1, offset: .55 },
    { transform: tf(tx, ty, 'scale(1.1) rotate(360deg)'), opacity: 1, offset: .96 }, { transform: tf(tx, ty, 'scale(1.4)'), opacity: 0 }], 540, 160, 'ease-in');
  var ice = h('div', { class: 'fx-ice' });
  av.appendChild(ice);
  anim(ice, [{ opacity: 0 }, { opacity: .9 }], 900, 720, 'ease-in');
  squash(av, 700, .2);
  anim(av, [{ transform: 'translateX(0)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' }], 90, 1000, null, false, 12);
  for (var i = 0; i < 12; i++) {
    var f = part(st, '❄️', '', c.x + c.r * .3, c.y - c.r * .1, rnd(14, 24)), a = rnd(0, Math.PI * 2), d = rnd(40, 90);
    anim(f, [{ transform: tf(0, 0, 'scale(.3)'), opacity: 1 }, { transform: tf(Math.cos(a) * d, Math.sin(a) * d, 'scale(1) rotate(120deg)'), opacity: 1, offset: .6 },
      { transform: tf(Math.cos(a) * d * 1.1, Math.sin(a) * d * 1.1 + 20, 'scale(.7) rotate(180deg)'), opacity: 0 }], 800, 700, 'ease-out', true);
  }
  for (var k = 0; k < 10; k++) {
    var sn = part(st, '❄️', '', c.x + rnd(-1.4, 1.4) * c.r, c.y - c.r * 1.6, rnd(12, 20));
    anim(sn, [{ transform: tf(0, 0), opacity: 0 }, { transform: tf(rnd(-12, 12), 40, 'rotate(60deg)'), opacity: .9, offset: .3 }, { transform: tf(rnd(-24, 24), 170, 'rotate(200deg)'), opacity: 0 }], 1500, 900 + k * 150, 'ease-in-out', true);
  }
  say(st, '好冷！', c.x - c.r - 20, c.y - c.r * .5, 1000);
  return 2800;
}

// 辣椒：塞一个辣椒进嘴，脸红冒烟喷火
export function fxPepper(st, av) {
  var c = centerOf(st, av), W = st.clientWidth;
  var sx = Math.min(W - 40, c.x + c.r + 100), sy = c.y + 20;
  var pp = part(st, '🌶️', '', sx, sy, 56);
  var dx = c.x + c.r * .25 - sx, dy = c.y + c.r * .35 - sy;
  anim(pp, [{ transform: tf(120, 0, 'rotate(-30deg)'), opacity: 0 }, { transform: tf(0, 0, 'rotate(-20deg)'), opacity: 1, offset: .35 }, { transform: tf(dx, dy, 'rotate(-60deg) scale(.8)'), opacity: 1, offset: .78 }, { transform: tf(dx, dy, 'rotate(-60deg) scale(.1)'), opacity: 0 }], 760, 0, 'ease-in-out');
  var hot = h('div', { class: 'fx-hotov' });
  av.appendChild(hot);
  anim(hot, [{ opacity: 0 }, { opacity: .85 }], 800, 760, 'ease-in');
  squash(av, 760, .2);
  anim(av, [{ transform: 'translateX(0) rotate(0)' }, { transform: 'translateX(-3px) rotate(-2deg)' }, { transform: 'translateX(3px) rotate(2deg)' }, { transform: 'translateX(0) rotate(0)' }], 130, 1000, null, false, 9);
  for (var i = 0; i < 8; i++) {
    var side = i % 2 ? 1 : -1;
    var sm = part(st, '💨', '', c.x + side * c.r * .8, c.y - c.r * .1, rnd(20, 28));
    anim(sm, [{ transform: tf(0, 0, 'scale(.4)'), opacity: 0 }, { transform: tf(side * 14, -30, 'scale(1)'), opacity: .9, offset: .35 }, { transform: tf(side * 30, -86, 'scale(1.3)'), opacity: 0 }], 1000, 1000 + i * 150, 'ease-out', true);
  }
  for (var f = 0; f < 3; f++) {
    var fl = part(st, '🔥', '', c.x + (f - 1) * c.r * .5, c.y - c.r - 6, 30 + f % 2 * 8);
    anim(fl, [{ transform: tf(0, 10, 'scale(.2)'), opacity: 0 }, { transform: tf(0, -4, 'scale(1.15)'), opacity: 1, offset: .3 }, { transform: tf(0, -10, 'scale(.9)'), opacity: 1, offset: .6 }, { transform: tf(0, -22, 'scale(.3)'), opacity: 0 }], 1100, 1200 + f * 260, 'ease-out', true);
  }
  for (var s = 0; s < 4; s++) {
    var sw = part(st, '💦', '', c.x + (s % 2 ? 1 : -1) * c.r * rnd(.6, .95), c.y - c.r * .5, 18);
    anim(sw, [{ transform: tf(0, 0, 'scale(.3)'), opacity: 0 }, { transform: tf(0, 10, 'scale(1)'), opacity: 1, offset: .3 }, { transform: tf(0, 60), opacity: 0 }], 800, 1300 + s * 200, 'ease-in', true);
  }
  say(st, '好辣！', c.x - c.r - 16, c.y - c.r * .6, 1100);
  return 2900;
}

// 吹风机：一阵风从右边吹来，头发乱飞，头像被吹得歪来歪去
export function fxDryer(st, av) {
  var c = centerOf(st, av), W = st.clientWidth;
  var gx = Math.min(W - 40, c.x + c.r + 100), gy = c.y - 8;
  var src = part(st, '🌬️', '', gx, gy, 62);
  anim(src, [{ transform: tf(140, 0), opacity: 0 }, { transform: tf(0, 0), opacity: 1 }], 340, 0, 'cubic-bezier(0.22,1,0.36,1)');
  anim(src, [{ transform: tf(0, 0), opacity: 1 }, { transform: tf(3, 0, 'rotate(4deg)'), opacity: 1 }, { transform: tf(0, 0), opacity: 1 }], 120, 400, null, false, 14);
  anim(src, [{ transform: tf(0, 0), opacity: 1 }, { transform: tf(140, 0), opacity: 0 }], 340, 2150, 'ease-in');
  for (var i = 0; i < 16; i++) {
    var y = c.y + rnd(-1.1, 1.1) * c.r, w = rnd(50, 110);
    var g = part(st, '', 'fx-gust', gx - 30, y, 0);
    g.style.width = w + 'px';
    anim(g, [{ transform: tf(0, 0), opacity: 0 }, { transform: tf(-(gx - c.x) * .6, rnd(-8, 8)), opacity: .9, offset: .4 }, { transform: tf(-(gx - 40) - 40, rnd(-12, 12)), opacity: 0 }], 600, 420 + i * 100, 'linear', true);
  }
  anim(av, [{ transform: 'rotate(0) translateX(0)' }, { transform: 'rotate(-9deg) translateX(-8px)' }, { transform: 'rotate(6deg) translateX(-3px)' }, { transform: 'rotate(0) translateX(0)' }], 360, 520, 'ease-in-out', false, 5);
  for (var k = 0; k < 7; k++) {
    var lf = part(st, k % 2 ? '🍃' : '〰️', '', gx - 20, c.y + rnd(-1.2, 1.2) * c.r, rnd(14, 22));
    anim(lf, [{ transform: tf(0, 0, 'rotate(0)'), opacity: 0 }, { transform: tf(-(gx - c.x) * .7, rnd(-30, 30), 'rotate(260deg)'), opacity: 1, offset: .45 }, { transform: tf(-(gx + 20), rnd(-50, 50), 'rotate(520deg)'), opacity: 0 }], 1100, 560 + k * 200, 'ease-in-out', true);
  }
  say(st, '呼～', gx - 10, gy - 64, 500);
  return 2700;
}

// 投喂：一根胡萝卜递到嘴边，嚼嚼嚼，腮帮子鼓起来
export function fxFeed(st, av) {
  var c = centerOf(st, av), W = st.clientWidth;
  var sx = Math.min(W - 40, c.x + c.r + 100), sy = c.y + c.r * .2;
  var cr = part(st, '🥕', '', sx, sy, 58);
  var dx = c.x + c.r * .3 - sx, dy = c.y + c.r * .3 - sy;
  anim(cr, [{ transform: tf(120, 0, 'rotate(-20deg)'), opacity: 0 }, { transform: tf(0, 0, 'rotate(-20deg)'), opacity: 1, offset: .4 }, { transform: tf(dx, dy, 'rotate(-35deg)'), opacity: 1, offset: .8 }, { transform: tf(dx, dy, 'rotate(-35deg) scale(.1)'), opacity: 0 }], 800, 0, 'ease-in-out');
  for (var i = 0; i < 4; i++) anim(av, [{ transform: 'scale(1,1)' }, { transform: 'scale(1.08,.94)' }, { transform: 'scale(.97,1.03)' }, { transform: 'scale(1,1)' }], 330, 820 + i * 330, 'ease-in-out', false, 1);
  for (var b = 0; b < 2; b++) {
    var bl = h('div', { class: 'fx-blush' });
    bl.style[b ? 'right' : 'left'] = '10%';
    av.appendChild(bl);
    anim(bl, [{ opacity: 0 }, { opacity: 1 }], 500, 900);
  }
  anim(av, [{ transform: 'scale(1,1)' }, { transform: 'scale(1.12,1.12)' }], 600, 2150, 'cubic-bezier(0.22,1,0.36,1)');
  for (var k = 0; k < 9; k++) {
    var fd = part(st, k % 3 === 0 ? '🥕' : '✨', '', c.x + rnd(-1.3, 1.3) * c.r, c.y - c.r * 1.7, rnd(16, 26));
    anim(fd, [{ transform: tf(0, 0, 'rotate(0)'), opacity: 0 }, { transform: tf(rnd(-10, 10), 60, 'rotate(90deg)'), opacity: 1, offset: .3 }, { transform: tf(rnd(-20, 20), 230, 'rotate(260deg)'), opacity: 0 }], 1300, 700 + k * 190, 'cubic-bezier(.5,0,.9,.6)', true);
  }
  say(st, '嚼嚼嚼', c.x - c.r - 22, c.y - c.r * .5, 900);
  return 2900;
}

// 晚安：天暗下来，月亮升起，头像摇摇晃晃，飘出 zzz
export function fxNight(st, av) {
  var c = centerOf(st, av), W = st.clientWidth, H = st.clientHeight;
  var ov = overlay(st, 'fx-night', true);
  anim(ov, [{ opacity: 0 }, { opacity: .96 }], 800, 0, 'ease-in');
  var moon = part(st, '🌙', '', Math.min(W - 50, c.x + c.r + 40), c.y - c.r - 50, 64);
  anim(moon, [{ transform: tf(0, -120, 'rotate(-30deg)'), opacity: 0 }, { transform: tf(0, 0, 'rotate(0)'), opacity: 1 }], 800, 300, 'cubic-bezier(0.22,1,0.36,1)');
  for (var i = 0; i < 14; i++) {
    var s = part(st, i % 3 ? '✨' : '⭐', '', rnd(W * .06, W * .94), rnd(H * .06, H * .7), rnd(10, 18));
    anim(s, [{ transform: tf(0, 0, 'scale(.4)'), opacity: 0 }, { transform: tf(0, 0, 'scale(1)'), opacity: 1 }, { transform: tf(0, 0, 'scale(.6)'), opacity: .3 }], 900, 500 + i * 90, 'ease-in-out', false, 3);
  }
  anim(av, [{ transform: 'rotate(0)' }, { transform: 'rotate(-4deg) translateY(4px)' }, { transform: 'rotate(4deg) translateY(4px)' }, { transform: 'rotate(0)' }], 1400, 700, 'ease-in-out', false, 2);
  for (var z = 0; z < 5; z++) {
    var zz = part(st, z % 2 ? 'z' : 'Z', 'fx-zz', c.x + c.r * .5, c.y - c.r * .6, 18 + z * 4);
    anim(zz, [{ transform: tf(0, 0, 'scale(.5)'), opacity: 0 }, { transform: tf(24 + z * 8, -40 - z * 12, 'scale(1)'), opacity: 1, offset: .35 }, { transform: tf(40 + z * 12, -90 - z * 18, 'scale(1.2)'), opacity: 0 }], 1500, 900 + z * 320, 'ease-out', true);
  }
  say(st, '晚安～', c.x - c.r - 22, c.y - c.r * .4, 1000);
  return 3000;
}

// 送花：捧着花束过来，花瓣飘落，头上戴一圈小花
export function fxFlower(st, av) {
  var c = centerOf(st, av), W = st.clientWidth;
  var sx = Math.min(W - 44, c.x + c.r + 100), sy = c.y + c.r * .3;
  var bq = part(st, '💐', '', sx, sy, 64);
  anim(bq, [{ transform: tf(140, 20, 'rotate(20deg)'), opacity: 0 }, { transform: tf(0, 0, 'rotate(-8deg)'), opacity: 1 }], 520, 0, 'cubic-bezier(0.22,1,0.36,1)');
  anim(bq, [{ transform: tf(0, 0, 'rotate(-8deg)'), opacity: 1 }, { transform: tf(-6, -6, 'rotate(-14deg)'), opacity: 1 }, { transform: tf(0, 0, 'rotate(-8deg)'), opacity: 1 }], 600, 700, 'ease-in-out', false, 3);
  anim(bq, [{ transform: tf(0, 0, 'rotate(-8deg)'), opacity: 1 }, { transform: tf(140, 20, 'rotate(20deg)'), opacity: 0 }], 360, 2500, 'ease-in');
  for (var i = 0; i < 7; i++) {
    var an = Math.PI * (1.08 + i * .14), fl = part(st, i % 2 ? '🌼' : '🌸', '', c.x + Math.cos(an) * c.r * .98, c.y + Math.sin(an) * c.r * .98, 24);
    anim(fl, [{ transform: tf(0, 0, 'scale(0)'), opacity: 0 }, { transform: tf(0, 0, 'scale(1.3)'), opacity: 1, offset: .6 }, { transform: tf(0, 0, 'scale(1)'), opacity: 1 }], 380, 900 + i * 110, 'cubic-bezier(0.22,1,0.36,1)');
  }
  for (var b = 0; b < 2; b++) {
    var bl = h('div', { class: 'fx-blush' });
    bl.style[b ? 'right' : 'left'] = '10%';
    av.appendChild(bl);
    anim(bl, [{ opacity: 0 }, { opacity: 1 }], 500, 1200);
  }
  for (var k = 0; k < 16; k++) {
    var pt = part(st, '🌸', '', rnd(c.x - 130, c.x + 130), c.y - c.r * 1.8, rnd(14, 24));
    anim(pt, [{ transform: tf(0, 0, 'rotate(0)'), opacity: 0 }, { transform: tf(rnd(-20, 20), 70, 'rotate(120deg)'), opacity: 1, offset: .25 }, { transform: tf(rnd(-50, 50), 280, 'rotate(360deg)'), opacity: 0 }], 1700, 500 + k * 120, 'ease-in-out', true);
  }
  anim(av, [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], 400, 1300, 'ease-out', false, 2);
  say(st, '送你花花', c.x - c.r - 28, c.y - c.r * .6, 1000);
  return 2900;
}
