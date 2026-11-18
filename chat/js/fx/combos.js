// 连发三次的大招（三连）：COMBO 表

import { overlay } from './battle.js';
import { anim, centerOf, part, rnd, say, squash, tf } from './prims.js';
import { $, h } from '../utils.js';

// ===== 连发三次的大招（三连） =====
var FOODS = ['🥕', '🍎', '🍞', '🍰', '🍙', '🍓', '🍩'];
function cmbWater(st, av) {
  var c = centerOf(st, av), W = st.clientWidth, H = st.clientHeight;
  var fl = overlay(st, 'fx-flood');
  anim(fl, [{ transform: 'translateY(100%)', easing: 'cubic-bezier(0.22,1,0.36,1)' }, { transform: 'translateY(16%)', offset: .45 }, { transform: 'translateY(16%)', offset: .68, easing: 'ease-in-out' }, { transform: 'translateY(106%)' }], 3200, 0, 'linear');
  for (var i = 0; i < 18; i++) {
    var b = part(st, '🫧', '', rnd(W * .05, W * .95), H + 10, rnd(16, 30));
    anim(b, [{ transform: tf(0, 0), opacity: 0 }, { transform: tf(rnd(-16, 16), -H * .35), opacity: .9, offset: .4 }, { transform: tf(rnd(-24, 24), -H * rnd(.6, .85)), opacity: 0 }], 1500, 500 + i * 90, 'ease-out', true);
  }
  anim(av, [{ transform: 'translateY(0)' }, { transform: 'translateY(-16px)' }, { transform: 'translateY(0)' }], 1100, 1000, 'ease-in-out', false, 2);
  say(st, '咕噜咕噜', c.x, c.y - c.r - 34, 1200);
  return 3400;
}
function cmbKiss(st, av) {
  var c = centerOf(st, av), W = st.clientWidth, H = st.clientHeight, hs = ['💗', '💕', '💖', '❤️', '💘'];
  for (var i = 0; i < 56; i++) {
    var x = rnd(0, W), hr = part(st, hs[i % 5], '', x, -30, rnd(18, 36));
    anim(hr, [{ transform: tf(0, 0, 'rotate(-10deg)'), opacity: 0 }, { transform: tf(rnd(-20, 20), H * .15, 'rotate(10deg)'), opacity: 1, offset: .12 }, { transform: tf(rnd(-40, 40), H * .6, 'rotate(-10deg)'), opacity: 1, offset: .7 }, { transform: tf(rnd(-30, 30), H + 60, 'rotate(10deg)'), opacity: 0 }], rnd(1500, 2200), rnd(0, 1600), 'cubic-bezier(.4,0,.8,.7)', true);
  }
  anim(av, [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], 420, 400, 'ease-out', false, 5);
  say(st, 'mua～', c.x, c.y - c.r - 30, 600);
  return 3600;
}
function cmbHammer(st, av) {
  var c = centerOf(st, av), chat = $('chat');
  for (var i = 0; i < 3; i++) anim(chat, [{ transform: 'none' }, { transform: 'translate(-7px,4px)' }, { transform: 'translate(6px,-5px)' }, { transform: 'translate(-4px,-3px)' }, { transform: 'translate(3px,3px)' }, { transform: 'none' }], 360, 300 + i * 520, 'linear', false, 1);
  for (var s = 0; s < 3; s++) { squash(av, 300 + s * 520, .2); say(st, '咚！', c.x + (s - 1) * 60, c.y - c.r - 30 - s * 12, 320 + s * 520); }
  var N = 10;
  for (var k = 0; k < N; k++) {
    var fr = [], a0 = k / N * Math.PI * 2, R = c.r * 1.45;
    for (var q = 0; q <= 16; q++) {
      var an = a0 + q / 16 * Math.PI * 4;
      fr.push({ transform: tf(Math.cos(an) * R - (R), Math.sin(an) * R * .55, 'scale(' + (q === 0 || q === 16 ? .3 : 1) + ') rotate(' + (q * 45) + 'deg)'), opacity: q === 0 || q === 16 ? 0 : 1 });
    }
    var star = part(st, k % 2 ? '⭐' : '🌟', '', c.x + R, c.y, 24);
    anim(star, fr, 2100, 500, 'linear', true);
  }
  return 3000;
}
function cmbSnow(st, av) {
  var c = centerOf(st, av), W = st.clientWidth, H = st.clientHeight;
  var wh = overlay(st, 'fx-white');
  anim(wh, [{ opacity: 0 }, { opacity: 1, offset: .2 }, { opacity: 1, offset: .75 }, { opacity: 0 }], 3000, 0, 'ease-in-out');
  for (var i = 0; i < 90; i++) {
    var x = rnd(0, W * 1.4), f = part(st, '❄️', '', x, -20, rnd(12, 26));
    anim(f, [{ transform: tf(0, 0, 'rotate(0)'), opacity: 0 }, { transform: tf(-60, H * .1, 'rotate(60deg)'), opacity: 1, offset: .1 }, { transform: tf(-W * .5 - rnd(0, 120), H + 40, 'rotate(360deg)'), opacity: .8 }], rnd(800, 1400), rnd(0, 1900), 'linear', true);
  }
  anim(av, [{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], 90, 400, null, false, 22);
  say(st, '暴风雪！', c.x, c.y - c.r - 34, 500);
  return 3200;
}
function cmbPepper(st, av) {
  var c = centerOf(st, av), W = st.clientWidth, H = st.clientHeight;
  var fr = overlay(st, 'fx-fire');
  anim(fr, [{ opacity: 0 }, { opacity: 1, offset: .15 }, { opacity: .7, offset: .3 }, { opacity: 1, offset: .45 }, { opacity: .75, offset: .6 }, { opacity: 1, offset: .75 }, { opacity: 0 }], 3000, 0, 'ease-in-out');
  for (var i = 0; i < 30; i++) {
    var side = i % 3, x, y;
    if (side === 0) { x = (i / 3 + .5) / 10 * W; y = H - 10; } else if (side === 1) { x = 8; y = H * (1 - (i + 2) / 33); } else { x = W - 8; y = H * (1 - (i + 1) / 33); }
    var fl = part(st, '🔥', '', x, y, rnd(26, 40));
    anim(fl, [{ transform: tf(0, 6, 'scale(.3)'), opacity: 0 }, { transform: tf(0, -6, 'scale(1.1)'), opacity: 1, offset: .2 }, { transform: tf(0, -2, 'scale(.85)'), opacity: 1, offset: .4 }, { transform: tf(0, -8, 'scale(1.15)'), opacity: 1, offset: .6 }, { transform: tf(0, -4, 'scale(.9)'), opacity: 1, offset: .8 }, { transform: tf(0, -18, 'scale(.3)'), opacity: 0 }], 2500, 200 + rnd(0, 400), 'ease-in-out', true);
  }
  anim(av, [{ transform: 'translateX(0) rotate(0)' }, { transform: 'translateX(-3px) rotate(-2deg)' }, { transform: 'translateX(3px) rotate(2deg)' }, { transform: 'translateX(0) rotate(0)' }], 130, 300, null, false, 18);
  say(st, '火辣辣！', c.x, c.y - c.r - 34, 500);
  return 3200;
}
function cmbDryer(st, av) {
  var W = st.clientWidth, H = st.clientHeight, cx = W / 2, glyphs = ['🍃', '🌸', '💨', '🍂', '〰️'];
  var big = part(st, '🌪️', '', cx, H * .5, 170);
  anim(big, [{ transform: tf(0, 40, 'scale(.3)'), opacity: 0 }, { transform: tf(0, 0, 'scale(1)'), opacity: .9, offset: .25 }, { transform: tf(0, 0, 'scale(1.05)'), opacity: .9, offset: .75 }, { transform: tf(0, -30, 'scale(.8)'), opacity: 0 }], 3000, 0, 'ease-out');
  for (var i = 0; i < 36; i++) {
    var a0 = rnd(0, Math.PI * 2), turns = rnd(2.4, 3.6), fr = [], part_ = part(st, glyphs[i % 5], '', cx, H * .5, rnd(16, 28));
    for (var s = 0; s <= 18; s++) {
      var u = s / 18, an = a0 + u * Math.PI * 2 * turns, rad = 14 + u * W * .4;
      fr.push({ transform: tf(Math.cos(an) * rad, H * .26 - u * H * .52 + Math.sin(an) * rad * .22, 'rotate(' + (u * 720) + 'deg) scale(' + (.6 + u * .6) + ')'), opacity: u < .08 || u > .92 ? 0 : 1 });
    }
    anim(part_, fr, rnd(1700, 2300), rnd(0, 900), 'linear', true);
  }
  anim(av, [{ transform: 'rotate(0)' }, { transform: 'rotate(-12deg)' }, { transform: 'rotate(12deg)' }, { transform: 'rotate(0)' }], 400, 300, 'ease-in-out', false, 6);
  say(st, '龙卷风！', cx, H * .18, 500);
  return 3400;
}
function cmbFeed(st, av) {
  var c = centerOf(st, av), W = st.clientWidth, H = st.clientHeight;
  for (var i = 0; i < 40; i++) {
    var row = Math.floor(i / 8), x = W * ((i % 8) + .5) / 8 + rnd(-14, 14), yEnd = H - 34 - row * 26 - rnd(0, 8);
    var fd = part(st, FOODS[i % 7], '', x, -30, rnd(26, 36));
    anim(fd, [{ transform: tf(0, 0, 'rotate(0)'), opacity: 1 }, { transform: tf(0, yEnd + 30, 'rotate(' + rnd(-40, 40) + 'deg)'), opacity: 1, offset: .8 }, { transform: tf(0, yEnd + 20, 'rotate(' + rnd(-20, 20) + 'deg)'), opacity: 1, offset: .9 }, { transform: tf(0, yEnd + 30, 'rotate(' + rnd(-20, 20) + 'deg)'), opacity: 1 }], rnd(700, 950), 200 + i * 55, 'cubic-bezier(.5,0,.9,.6)');
  }
  anim(av, [{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }], 1800, 600, 'ease-out');
  say(st, '吃不完啦', c.x, c.y - c.r - 34, 1400);
  return 3500;
}
function cmbFlower(st, av) {
  var c = centerOf(st, av), W = st.clientWidth, H = st.clientHeight, gl = ['🌸', '🌸', '🌺', '🌼', '💮'];
  for (var i = 0; i < 70; i++) {
    var y0 = rnd(0, H), fr = [], f = part(st, gl[i % 5], '', 0, y0, rnd(14, 28));
    for (var s = 0; s <= 6; s++) fr.push({ transform: tf(-30 + s / 6 * (W + 60), Math.sin(s * 1.3 + i) * 60 + s * 10, 'rotate(' + (s * 120) + 'deg)'), opacity: s === 0 || s === 6 ? 0 : 1 });
    anim(f, fr, rnd(1400, 2200), rnd(0, 1500), 'ease-in-out', true);
  }
  var bq = part(st, '💐', '', c.x, c.y - c.r - 20, 64);
  anim(bq, [{ transform: tf(0, 0, 'scale(0)'), opacity: 0 }, { transform: tf(0, 0, 'scale(1.2)'), opacity: 1, offset: .5 }, { transform: tf(0, 0, 'scale(1)'), opacity: 1 }], 500, 200, 'cubic-bezier(0.22,1,0.36,1)');
  anim(bq, [{ transform: tf(0, 0), opacity: 1 }, { transform: tf(0, -20, 'scale(.6)'), opacity: 0 }], 400, 2900, 'ease-in');
  say(st, '花瓣风暴', c.x, c.y + c.r + 30, 900);
  return 3400;
}
function cmbPat(st, av) {
  var c = centerOf(st, av), W = st.clientWidth, H = st.clientHeight, chat = $('chat');
  var hand = part(st, '🫳', '', W / 2, H * .38, 260);
  anim(hand, [{ transform: tf(0, -H * .6), opacity: 0 }, { transform: tf(0, -H * .1), opacity: 1 }], 420, 0, 'ease-out');
  for (var i = 0; i < 3; i++) {
    var t = 460 + i * 620;
    anim(hand, [{ transform: tf(0, -H * .1), opacity: 1 }, { transform: tf(0, H * .06, 'scale(1.1)'), opacity: 1, offset: .4 }, { transform: tf(0, -H * .1), opacity: 1 }], 560, t, 'cubic-bezier(.6,0,.4,1)');
    anim(chat, [{ transform: 'none' }, { transform: 'translateY(10px) scaleY(.985)' }, { transform: 'none' }], 300, t + 200, 'cubic-bezier(0.22,1,0.36,1)');
    squash(av, t + 200, .22);
    var ring = part(st, '', 'fx-ring', W / 2, H * .5, 0);
    anim(ring, [{ transform: tf(0, 0, 'scale(.4)'), opacity: .9 }, { transform: tf(0, 0, 'scale(' + (W / 40) + ')'), opacity: 0 }], 700, t + 200, 'ease-out', true);
    say(st, '啪！', c.x + (i - 1) * 70, c.y - c.r - 20, t + 200);
  }
  anim(hand, [{ transform: tf(0, -H * .1), opacity: 1 }, { transform: tf(0, -H * .6), opacity: 0 }], 400, 2500, 'ease-in');
  return 3000;
}
function cmbNight(st, av) {
  var c = centerOf(st, av), W = st.clientWidth, H = st.clientHeight;
  var ov = overlay(st, 'fx-night', true);
  anim(ov, [{ opacity: 0 }, { opacity: 1, offset: .2 }, { opacity: 1, offset: .82 }, { opacity: 0 }], 3400, 0, 'ease-in-out');
  for (var i = 0; i < 70; i++) {
    var s = h('div', { class: 'fx-star', 'aria-hidden': 'true' });
    s.style.left = rnd(0, W) + 'px'; s.style.top = rnd(0, H * .85) + 'px';
    st.appendChild(s);
    var sc = rnd(.6, 1.8);
    anim(s, [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(' + sc + ')' }, { opacity: .25, transform: 'scale(' + sc * .6 + ')' }], rnd(700, 1300), rnd(300, 1500), 'ease-in-out', false, 3);
  }
  var sh = h('div', { class: 'fx-shoot', 'aria-hidden': 'true' });
  sh.style.left = W * .7 + 'px'; sh.style.top = H * .12 + 'px'; sh.style.transform = 'rotate(30deg)';
  st.appendChild(sh);
  anim(sh, [{ opacity: 0, transform: 'translate(0,0) rotate(30deg)' }, { opacity: 1, transform: 'translate(-60px,34px) rotate(30deg)', offset: .2 }, { opacity: 0, transform: 'translate(-300px,170px) rotate(30deg)' }], 900, 1500, 'ease-in');
  var moon = part(st, '🌙', '', W * .72, H * .2, 120);
  anim(moon, [{ transform: tf(0, -80, 'scale(.6)'), opacity: 0 }, { transform: tf(0, 0, 'scale(1)'), opacity: 1 }], 900, 300, 'cubic-bezier(0.22,1,0.36,1)');
  anim(av, [{ transform: 'rotate(0)' }, { transform: 'rotate(-4deg) translateY(4px)' }, { transform: 'rotate(4deg) translateY(4px)' }, { transform: 'rotate(0)' }], 1500, 700, 'ease-in-out', false, 2);
  for (var z = 0; z < 6; z++) {
    var zz = part(st, z % 2 ? 'z' : 'Z', 'fx-zz', c.x + c.r * .5, c.y - c.r * .6, 18 + z * 4);
    anim(zz, [{ transform: tf(0, 0, 'scale(.5)'), opacity: 0 }, { transform: tf(24 + z * 8, -40 - z * 12, 'scale(1)'), opacity: 1, offset: .35 }, { transform: tf(40 + z * 12, -90 - z * 18, 'scale(1.2)'), opacity: 0 }], 1500, 900 + z * 340, 'ease-out', true);
  }
  return 3600;
}
export var COMBO = {
  '[水枪]': { id: 'c_water', name: '水漫聊天框', play: cmbWater },
  '[飞吻]': { id: 'c_kiss', name: '爱心雨', play: cmbKiss },
  '[敲头]': { id: 'c_hammer', name: '群星环绕', play: cmbHammer },
  '[雪球]': { id: 'c_snow', name: '暴风雪', play: cmbSnow },
  '[辣椒]': { id: 'c_pepper', name: '烈焰边框', play: cmbPepper },
  '[吹风]': { id: 'c_dryer', name: '龙卷风', play: cmbDryer },
  '[投喂]': { id: 'c_feed', name: '美食堆', play: cmbFeed },
  '[送花]': { id: 'c_flower', name: '花瓣风暴', play: cmbFlower },
  '[拍拍]': { id: 'c_pat', name: '大手拍屏', play: cmbPat },
  '[晚安]': { id: 'c_night', name: '星空夜', play: cmbNight }
};
