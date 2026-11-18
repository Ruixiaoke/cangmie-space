// 沙子皮肤

import { reduced, rowState } from '../bubble/view.js';
import { refreshCls } from '../chat/view.js';
import { rnd } from '../fx/prims.js';
import { S } from '../state.js';
import { $, h } from '../utils.js';

// ===== 沙子皮肤：把气泡画到离屏画布，按像素取样成粒子，画在 #msgs 上方一张共用的画布上 =====
// 行的 _sd 状态：0 正常；'build' 粒子正在聚拢（DOM 气泡先隐藏）；'gone' 已化成沙子（整行隐藏）
var SAND_MAX = 2500;
export var sand = { hold: 0, on: false, rm: false, io: null, cv: null, ctx: null, c1: null, c2: null, groups: [], raf: 0, w: 0, h: 0, dpr: 1 };

export function sandEnable() {
  sandDisable();
  var box = $('msgs');
  sand.on = true; sand.rm = reduced();
  box.classList.add('sand');
  box.classList.toggle('sand-rm', sand.rm);
  if (!sand.rm) {
    if (!sand.cv) {
      sand.cv = h('canvas', { id: 'sandCv', 'aria-hidden': 'true' });
      box.parentNode.insertBefore(sand.cv, box.nextSibling);
      sand.ctx = sand.cv.getContext('2d');
    }
    sand.cv.hidden = false;
  }
  if (window.IntersectionObserver) {
    // 以滚动区为 root：行的顶边被上沿裁掉时（比例小于 1 且顶部被裁）就是“顶边碰到上沿”
    sand.io = new IntersectionObserver(sandIO, { root: box, threshold: [0, 0.2, 0.5, 0.9, 0.99, 1] });
    if (S.chat) S.chat.nodes.forEach(function (el) { sand.io.observe(el); });
  }
}
export function sandDisable() {
  sand.on = false;
  sand.groups = [];
  if (sand.raf) { cancelAnimationFrame(sand.raf); sand.raf = 0; }
  if (sand.io) { sand.io.disconnect(); sand.io = null; }
  if (sand.cv) {
    sand.cv.hidden = true;
    if (sand.ctx) sand.ctx.clearRect(0, 0, sand.cv.width, sand.cv.height);
  }
  var box = $('msgs');
  box.classList.remove('sand'); box.classList.remove('sand-rm');
  if (S.chat) S.chat.nodes.forEach(function (el) { el._armed = false; if (el._sd) { el._sd = 0; refreshCls(el); } });
}
function sandFit() {
  var box = $('msgs'), cv = sand.cv, w = box.clientWidth, hh = box.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (w !== sand.w || hh !== sand.h || dpr !== sand.dpr) {
    sand.w = w; sand.h = hh; sand.dpr = dpr;
    cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
    cv.style.width = w + 'px'; cv.style.height = hh + 'px';
  }
  cv.style.left = box.offsetLeft + 'px'; cv.style.top = box.offsetTop + 'px';
}
function sandAlive() {
  var n = 0;
  for (var i = 0; i < sand.groups.length; i++) n += sand.groups[i].n;
  return n;
}
export function sandKill(el) {
  if (!sand.groups.length) return;
  sand.groups = sand.groups.filter(function (g) { return g.el !== el; });
}
function fullyIn(el) {
  var mr = $('msgs').getBoundingClientRect(), r = el.getBoundingClientRect();
  return r.top >= mr.top - 0.5 && r.bottom <= mr.bottom + 0.5;
}
function rrect(ctx, x, y, w, hh, r) {
  ctx.beginPath();
  ctx.moveTo(x + r[0], y);
  ctx.arcTo(x + w, y, x + w, y + hh, r[1]);
  ctx.arcTo(x + w, y + hh, x, y + hh, r[2]);
  ctx.arcTo(x, y + hh, x, y, r[3]);
  ctx.arcTo(x, y, x + w, y, r[0]);
  ctx.closePath();
}
function scratch(key, W, H) {
  var cv = sand[key];
  if (!cv) { cv = sand[key] = document.createElement('canvas'); }
  cv.width = W; cv.height = H; // 重设尺寸同时清空
  return cv.getContext('2d', { willReadFrequently: true });
}
// 取样：把不透明像素按网格（格内随机抽一个）变成粒子，颜色量化到 5 位以便按颜色批量绘制
function sandSample(ctx, W, H, target, sc, size) {
  var d;
  try { d = ctx.getImageData(0, 0, W, H).data; } catch (e) { return null; }
  var n = 0, i, out = [];
  for (i = 3; i < d.length; i += 4) if (d[i] >= 128) n++;
  if (!n || target < 1) return out;
  var k = Math.max(2, Math.ceil(Math.sqrt(n / target)));
  for (var y = 0; y < H; y += k) {
    for (var x = 0; x < W; x += k) {
      var px = Math.min(W - 1, x + ((Math.random() * k) | 0)), py = Math.min(H - 1, y + ((Math.random() * k) | 0));
      var o = (py * W + px) * 4;
      if (d[o + 3] < 128) continue;
      out.push({ x: px / sc, y: py / sc, key: ((d[o] >> 3) << 10) | ((d[o + 1] >> 3) << 5) | (d[o + 2] >> 3), s: Math.max(1.4, k / sc * size) });
    }
  }
  return out;
}
// 为一行的气泡造一组粒子；失败（太大、预算不够、画布被污染）返回 null，调用方直接显示/隐藏
function sandMake(el, mode) {
  var b = el._bubble, r = b.getBoundingClientRect();
  var w = Math.ceil(r.width), hh = Math.ceil(r.height);
  if (w < 8 || hh < 8 || w > 700 || hh > 1400) return null;
  var budget = SAND_MAX - sandAlive();
  if (budget < 150) return null;
  var dens = Math.min(1, Math.max(0.5, window.innerWidth / 420)) * ((navigator.hardwareConcurrency || 8) <= 4 ? 0.7 : 1);
  var bt = 340 * dens, it = 640 * dens;
  if (bt + it > budget) { var f = budget / (bt + it); bt *= f; it *= f; }
  var sc = hh > 500 ? 1 : 2, W = w * sc, H = hh * sc;
  var cs = getComputedStyle(b);
  // 底：圆角气泡 + 边框
  var x1 = scratch('c1', W, H);
  var rad = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(function (v) {
    return Math.min(Math.max(parseFloat(v) || 0, 0) * sc, W / 2, H / 2);
  });
  var bwid = (parseFloat(cs.borderTopWidth) || 0) * sc;
  x1.fillStyle = cs.backgroundColor;
  rrect(x1, 0, 0, W, H, rad);
  x1.fill();
  if (bwid) {
    rrect(x1, bwid / 2, bwid / 2, W - bwid, H - bwid, rad.map(function (v) { return Math.max(0, v - bwid / 2); }));
    x1.lineWidth = bwid; x1.strokeStyle = cs.borderTopColor; x1.stroke();
  }
  // 字：逐字取浏览器排好的位置，用同样的字体画上去，换行和 emoji 都和真实文字一致
  var x2 = scratch('c2', W, H);
  x2.textBaseline = 'middle';
  var walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, null, false), tn, cnt = 0, rg = document.createRange();
  while (cnt < 700 && (tn = walker.nextNode())) {
    var tcs = getComputedStyle(tn.parentNode), tx = tn.nodeValue;
    x2.font = tcs.fontStyle + ' ' + tcs.fontWeight + ' ' + (parseFloat(tcs.fontSize) * sc) + 'px ' + tcs.fontFamily;
    x2.fillStyle = tcs.color;
    for (var i = 0; i < tx.length && cnt < 700; i++) {
      var ch = tx.charAt(i);
      if (/\s/.test(ch)) continue;
      var cc = tx.charCodeAt(i);
      if (cc >= 0xD800 && cc < 0xDC00 && i + 1 < tx.length) ch += tx.charAt(++i);
      while (i + 1 < tx.length && tx.charCodeAt(i + 1) === 0xFE0F) ch += tx.charAt(++i);
      rg.setStart(tn, i - ch.length + 1); rg.setEnd(tn, i + 1);
      var rc = rg.getBoundingClientRect();
      if (!rc.width) continue;
      x2.fillText(ch, (rc.left - r.left) * sc, (rc.top - r.top + rc.height / 2) * sc);
      cnt++;
    }
  }
  var s1 = sandSample(x1, W, H, bt, sc, 1.15), s2 = sandSample(x2, W, H, it, sc, 1.25);
  if (!s1 || !s2) return null;
  var byKey = function (a, c) { return a.key - c.key; };
  s1.sort(byKey); s2.sort(byKey);
  var pts = s1.concat(s2), n = pts.length;
  if (n < 20) return null;
  var kind = sandKind(el), ns1 = s1.length;
  var g = {
    el: el, mode: mode, n: n, kind: kind, t0: performance.now(), end: 0, ox: 0, oy: 0, gv: 150, ez: 0, shard: kind === 'frozen', fl: kind === 'hot',
    x: new Float32Array(n), y: new Float32Array(n), sz: new Float32Array(n), ci: new Uint16Array(n), rt: new Float32Array(n),
    pa: new Float32Array(n), pb: new Float32Array(n), dl: new Float32Array(n), du: new Float32Array(n), pal: []
  };
  // 状态联动：湿的成团直直落下；爱心 / 热恋是粉色粒子飘起；冰冻是尖尖的浅蓝碎片炸开；发热是橙色火星往上飘
  if (kind === 'wet') { g.gv = 520; g.ez = mode === 'in' ? 1 : 0; } else if (kind === 'hot') g.gv = -70; else if (kind === 'love') g.gv = -25; else if (kind === 'frozen') g.gv = 240;
  var palIdx = {};
  for (var j = 0; j < n; j++) {
    var p = pts[j];
    var col = kind ? tintColor(kind, p.key) : null, pk = col || p.key;
    if (palIdx[pk] == null) {
      palIdx[pk] = g.pal.length;
      g.pal.push(col || ('rgb(' + (((p.key >> 10) << 3) | 4) + ',' + ((((p.key >> 5) & 31) << 3) | 4) + ',' + (((p.key & 31) << 3) | 4) + ')'));
    }
    g.ci[j] = palIdx[pk]; g.x[j] = p.x; g.y[j] = p.y; g.sz[j] = p.s * (kind === 'frozen' ? 1.7 : 1); g.rt[j] = rnd(0, 6.28);
    var cl = Math.floor(p.x / Math.max(1, w / 5)), ccx = w / 2, ccy = hh / 2;
    if (kind === 'wet') {
      g.pa[j] = rnd(-6, 6); g.pb[j] = mode === 'in' ? -rnd(70, 150) : rnd(0, 12);
      g.dl[j] = cl * 70 + rnd(0, 60); g.du[j] = rnd(600, 850);
    } else if (kind === 'love') {
      g.pa[j] = rnd(-34, 34); g.pb[j] = mode === 'in' ? rnd(40, 100) : -rnd(45, 120);
      g.dl[j] = rnd(0, 260) + (mode === 'in' ? 0 : (p.x / w) * 160); g.du[j] = mode === 'in' ? rnd(700, 1000) : rnd(900, 1250);
    } else if (kind === 'frozen') {
      var kf = mode === 'in' ? rnd(.8, 1.6) : rnd(.7, 1.5);
      g.pa[j] = (p.x - ccx) * kf + (mode === 'in' ? 0 : rnd(-20, 20)); g.pb[j] = (p.y - ccy) * kf + (mode === 'in' ? -20 : rnd(-50, -10));
      g.dl[j] = mode === 'in' ? rnd(0, 220) : rnd(0, 80); g.du[j] = mode === 'in' ? rnd(600, 900) : rnd(550, 850);
    } else if (kind === 'hot') {
      g.pa[j] = rnd(-20, 20); g.pb[j] = mode === 'in' ? rnd(40, 110) : -rnd(40, 110);
      g.dl[j] = rnd(0, 320); g.du[j] = mode === 'in' ? rnd(700, 1000) : rnd(800, 1200);
    } else if (mode === 'in') {
      // 从四周飘来：起点在目标点附近随机方向
      var ang = rnd(0, Math.PI * 2), dist = rnd(30, 130);
      g.pa[j] = Math.cos(ang) * dist * 1.3; g.pb[j] = Math.sin(ang) * dist * 0.7 + 18;
      g.dl[j] = rnd(0, 260); g.du[j] = rnd(600, 900);
    } else {
      // 被风吹散：从左往右依次剥落，带点向上的初速度，再受重力落下
      g.pa[j] = rnd(30, 210); g.pb[j] = rnd(-70, 40);
      g.dl[j] = (p.x / w) * 380 + rnd(0, 140); g.du[j] = rnd(700, 1000);
    }
    if (g.dl[j] + g.du[j] > g.end) g.end = g.dl[j] + g.du[j];
  }
  return g;
}
// 当前这一行的状态决定粒子的样子
function sandKind(el) {
  var c = S.chat; if (!c || !el._m || el._fxb) return '';
  var k = rowState(c, el._m).k;
  return k === 'passion' ? 'love' : (k === 'wet' || k === 'love' || k === 'frozen' || k === 'hot') ? k : '';
}
var TINT = {
  love: [['#ffd1e1', '#ffb3cf', '#ff9cc0'], ['#c2275f', '#a81f50', '#d6376f']],
  frozen: [['#f2faff', '#d6ecfc', '#bfe0f8'], ['#4f8fc4', '#6aa9d8', '#3f7bb0']],
  hot: [['#ffd9a8', '#ffc07a', '#ffe9b8'], ['#e2461a', '#ff6a1f', '#c9360f']]
};
// 按原来像素的明暗，换成这个状态的配色（亮的像素用浅色，暗的用深色，文字和气泡底仍然分得开）
function tintColor(kind, key) {
  var t = TINT[kind]; if (!t) return null;
  var lum = ((key >> 10) & 31) * 8 * .3 + ((key >> 5) & 31) * 8 * .59 + (key & 31) * 8 * .11;
  var list = t[lum > 140 ? 0 : 1];
  return list[(Math.random() * list.length) | 0];
}
function sandStart(g) {
  sandFit();
  var mr = $('msgs').getBoundingClientRect(), br = g.el._bubble.getBoundingClientRect();
  g.ox = br.left - mr.left; g.oy = br.top - mr.top;
  g.t0 = performance.now();
  sand.groups.push(g);
  if (!sand.raf) sand.raf = requestAnimationFrame(sandFrame);
}
function sandDone(g) {
  if (g.mode !== 'in') return;
  g.el._sd = 0;
  refreshCls(g.el);
  g.el._armed = fullyIn(g.el);
}
function sandFrame(now) {
  sand.raf = 0;
  if (!sand.on || !sand.cv) return;
  sandFit();
  var ctx = sand.ctx, dpr = sand.dpr, mr = $('msgs').getBoundingClientRect(), live = [], gi, i;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, sand.w, sand.h);
  for (gi = 0; gi < sand.groups.length; gi++) {
    var g = sand.groups[gi], t = now - g.t0, ox = g.ox, oy = g.oy;
    if (g.mode === 'in') {
      if (!g.el.parentNode) continue; // 这一行已经没了
      var rr = g.el._bubble.getBoundingClientRect(); // 聚拢时跟着行走（比如键盘弹出、列表滚动）
      ox = rr.left - mr.left; oy = rr.top - mr.top;
    }
    if (t >= g.end) { sandDone(g); continue; }
    live.push(g);
    var lastC = -1, lastA = 1, inPath = false, sh = g.shard;
    ctx.globalAlpha = 1;
    for (i = 0; i < g.n; i++) {
      var p = t - g.dl[i], x, y, a = 1;
      if (g.mode === 'in') {
        if (p <= 0) continue;
        var u = p / g.du[i]; if (u > 1) u = 1;
        var e = g.ez ? u * u : 1 - (1 - u) * (1 - u) * (1 - u);
        x = ox + g.x[i] + g.pa[i] * (1 - e); y = oy + g.y[i] + g.pb[i] * (1 - e);
        if (u < 0.3) a = u / 0.3;
      } else if (p <= 0) {
        x = ox + g.x[i]; y = oy + g.y[i];
      } else {
        var s = p / 1000, u2 = p / g.du[i];
        if (u2 >= 1) continue;
        x = ox + g.x[i] + g.pa[i] * s; y = oy + g.y[i] + g.pb[i] * s + g.gv * s * s;
        a = 1 - u2 * u2;
      }
      if (g.fl) a *= 0.65 + 0.35 * Math.sin(now * 0.02 + i);
      if (sh) {
        if (g.ci[i] !== lastC || a !== lastA) {
          if (inPath) ctx.fill();
          lastC = g.ci[i]; lastA = a; ctx.fillStyle = g.pal[lastC]; ctx.globalAlpha = a; ctx.beginPath(); inPath = true;
        }
        var sz = g.sz[i], an = g.rt[i] + t * 0.004, cx = x + sz / 2, cy = y + sz / 2;
        ctx.moveTo(cx + Math.cos(an) * sz, cy + Math.sin(an) * sz);
        ctx.lineTo(cx + Math.cos(an + 2.1) * sz * .75, cy + Math.sin(an + 2.1) * sz * .75);
        ctx.lineTo(cx + Math.cos(an + 4.0) * sz * .9, cy + Math.sin(an + 4.0) * sz * .9);
        ctx.closePath();
        continue;
      }
      if (g.ci[i] !== lastC) { lastC = g.ci[i]; ctx.fillStyle = g.pal[lastC]; }
      if (a !== lastA) { lastA = a; ctx.globalAlpha = a; }
      ctx.fillRect(x, y, g.sz[i], g.sz[i]);
    }
    if (inPath) ctx.fill();
  }
  ctx.globalAlpha = 1;
  sand.groups = live;
  if (live.length) sand.raf = requestAnimationFrame(sandFrame);
}
// 化成沙子
function sandOut(el, instant) {
  sandKill(el);
  var g = (instant || sand.rm || !sand.cv) ? null : sandMake(el, 'out');
  el._sd = 'gone'; el._armed = false;
  refreshCls(el);
  if (g) sandStart(g);
}
// 重新聚拢（新消息出现和滚回来都走这里）
function sandIn(el) {
  sandKill(el);
  el._sd = 'build';
  refreshCls(el); // 先把 DOM 气泡藏起来，这一帧还没绘制
  var g = sand.rm ? null : sandMake(el, 'in');
  if (g) return sandStart(g);
  if (sand.rm) setTimeout(function () { if (el._sd === 'build') { el._sd = 0; refreshCls(el); el._armed = fullyIn(el); } }, 30);
  else { el._sd = 0; refreshCls(el); el._armed = fullyIn(el); }
}
export function sandNew(els) {
  var mr = $('msgs').getBoundingClientRect();
  els.forEach(function (el) {
    var r = el.getBoundingClientRect();
    if (r.bottom > mr.top && r.top < mr.bottom && r.height) sandIn(el); // 看不见的行不用演
  });
}
function sandIO(entries) {
  if (!sand.on) return;
  entries.forEach(function (e) {
    var el = e.target, rb = e.rootBounds;
    if (!rb || !el._m || el._sd === 'build') return;
    var ratio = e.intersectionRatio, clipped = e.boundingClientRect.top < rb.top - 0.5;
    if (el._sd === 'gone') {
      if (e.isIntersecting && ratio > 0.15) sandIn(el);
    } else if (ratio >= 0.985 && !clipped) {
      el._armed = true; // 完整出现过一次才会被“顶边碰到上沿”消散，避免刚滚回来又散掉
    } else if (el._armed && clipped && Date.now() >= sand.hold) {
      sandOut(el, ratio === 0);
    }
  });
}
