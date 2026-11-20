# -*- coding: utf-8 -*-
"""衍天宗：星点闪烁，星点之间的星座连线一条条依次亮起再淡去。
参数：constellations = [{"pts":[[x,y]..],"edges":[[i,j]..],"start":0~1}]，line / dot / halo 颜色，stars 背景星数量与区域 region=[x0,y0,x1,y1]，
line_op 连线不透明度，glow 光点柔光。每个星座一个循环：前 45% 依次画线，随后停留，最后 30% 淡去。"""
import math
import numpy as np
from PIL import Image, ImageDraw

SS = 2


class Canvas:
    def __init__(self):
        self.im = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def poly(self, pts, fill, edge=None, ew=1.0):
        P = [(x * SS, y * SS) for x, y in pts]
        self.d.polygon(P, fill=fill)
        if edge:
            self.d.line(P + [P[0]], fill=edge, width=max(1, int(ew * SS)), joint='curve')

    def line(self, pts, fill, w=1.0):
        self.d.line([(x * SS, y * SS) for x, y in pts], fill=fill, width=max(1, int(w * SS)), joint='curve')

    def ell(self, cx, cy, rx, ry, fill=None, outline=None, w=1.0):
        self.d.ellipse([(cx - rx) * SS, (cy - ry) * SS, (cx + rx) * SS, (cy + ry) * SS], fill=fill,
                       outline=outline, width=max(1, int(w * SS)))

    def blit(self, out, opacity=1.0):
        sm = np.asarray(self.im.convert('RGBa').resize((W, H), Image.BOX).convert('RGBA'), np.float32)
        a = sm[..., 3:4] / 255.0 * opacity
        out += (sm[..., :3] - out) * a


def stamp(sc, out, cx, cy, rad, fn):
    pad = int(math.ceil(rad * 3)) + 2
    x0, x1 = max(0, int(cx) - pad), min(W, int(cx) + pad + 1)
    y0, y1 = max(0, int(cy) - pad), min(H, int(cy) + pad + 1)
    if x0 >= x1 or y0 >= y1:
        return
    dx = sc.xx[y0:y1, x0:x1] - cx; dy = sc.yy[y0:y1, x0:x1] - cy
    for alpha, col in fn(dx, dy):
        patch = out[y0:y1, x0:x1]
        patch += (col - patch) * alpha[:, :, None]


def chain_ys(y0, d, t, lo=-40, hi=None):
    """一列同相位的下落物：每个循环下落 d，间距 d，首尾无缝"""
    hi = H + 40 if hi is None else hi
    base = (y0 + d * t) % d
    ys = []; k = -2
    while base + k * d < hi:
        if base + k * d > lo: ys.append(base + k * d)
        k += 1
    return ys


def hx(s):
    return tuple(int(s[i:i + 2], 16) for i in (1, 3, 5))


class Stars:
    def __init__(self, cfg, scene, rng):
        self.cfg = cfg; self.sc = scene
        x0, y0, x1, y1 = cfg['region']
        self.bg = [dict(x=rng.uniform(x0, x1), y=rng.uniform(y0, y1), r=rng.uniform(.9, 1.9) * cfg.get('star_scale', 1), k=int(rng.integers(1, 4)),
                        a=rng.uniform(0, TAU)) for _ in range(int(cfg.get('stars', 30)))]

    def draw(self, out, t):
        c = self.cfg; sc = self.sc
        line = hx(c['line']); dot = np.array(hx(c['dot']), np.float32); edge = hx(c.get('edge', c['line']))
        lop = c.get('line_op', .85)
        cv = Canvas(); heads = []; lit = {}
        for ci, con in enumerate(c['constellations']):
            p = (t - con['start']) % 1.0
            pts, E = con['pts'], con['edges']
            if p < .45: env_all = 1.0
            elif p < .7: env_all = 1.0
            else: env_all = 1 - (p - .7) / .3
            n = len(E)
            for k, (i, j) in enumerate(E):
                s0 = .45 * k / n; s1 = .45 * (k + 1) / n
                f = min(1.0, max(0.0, (p - s0) / (s1 - s0))) if p < .7 else 1.0
                if f <= 0: continue
                (xa, ya), (xb, yb) = pts[i], pts[j]
                xe, ye = xa + (xb - xa) * f, ya + (yb - ya) * f
                al = int(255 * env_all * lop)
                cv.line([(xa, ya), (xe, ye)], edge + (int(al * .5),), c.get('line_w', 1.7) * 2.0)
                cv.line([(xa, ya), (xe, ye)], line + (al,), c.get('line_w', 1.7))
                lit[i] = max(lit.get(i, 0), env_all); 
                if f >= 1: lit[j] = max(lit.get(j, 0), env_all)
                if f < 1 and p < .7: heads.append((xe, ye))
            for i, q in enumerate(pts):
                lit.setdefault((ci, i) if False else ('d', ci, i), 0)
            con['_lit'] = lit
        cv.blit(out)
        # 星座节点：常亮的小星 + 连上线后更亮
        for ci, con in enumerate(c['constellations']):
            p = (t - con['start']) % 1.0
            env_all = 1.0 if p < .7 else 1 - (p - .7) / .3
            n = len(con['edges'])
            reach = {}
            for k, (i, j) in enumerate(con['edges']):
                s0 = .45 * k / n; s1 = .45 * (k + 1) / n
                if p >= s0 or p >= .7:
                    reach[i] = max(reach.get(i, 0), env_all)
                if p >= s1 or p >= .7:
                    reach[j] = max(reach.get(j, 0), env_all)
            for i, (x, y) in enumerate(con['pts']):
                b = reach.get(i, 0)
                tw = 1 - c.get('twinkle', .25) + c.get('twinkle', .25) * math.sin(TAU * 2 * t + i * 1.3 + ci)
                def fn(dx, dy, b=b, tw=tw):
                    d = np.hypot(dx, dy)
                    yield (c.get('glow', .5) * (.35 + .65 * b) * tw) * np.exp(-.5 * (d / (3.6 * c.get('node_scale', 1))) ** 2), dot
                    yield np.clip((.55 + .45 * b) * (1 - np.clip((d - 1.2 * c.get('node_scale', 1)) / 1.2, 0, 1)), 0, 1), np.minimum(dot + 40, 255)
                stamp(sc, out, x, y, 4 * c.get('node_scale', 1), fn)
        for hx_, hy_ in heads:
            def fn(dx, dy):
                yield .8 * np.exp(-.5 * (np.hypot(dx, dy) / 2.2) ** 2), np.array((255, 255, 255), np.float32)
            stamp(sc, out, hx_, hy_, 3, fn)
        # 背景星点
        for s in self.bg:
            fl = max(0.0, math.sin(TAU * s['k'] * t + s['a'])) ** 2
            r = s['r']
            def fn(dx, dy, r=r, fl=fl):
                cross = np.exp(-.5 * (dy / (r * .25)) ** 2) * np.exp(-.5 * (dx / (r * 3.2)) ** 2) + \
                        np.exp(-.5 * (dx / (r * .25)) ** 2) * np.exp(-.5 * (dy / (r * 3.2)) ** 2)
                d = np.hypot(dx, dy) / r
                yield np.clip((.3 + .7 * fl) * (np.clip(cross, 0, 1) * .9 + (1 - np.clip((d - .5) / .8, 0, 1))), 0, 1), dot
            stamp(sc, out, s['x'], s['y'], r * 3.2, fn)


def make(cfg, scene, rng):
    return Stars(cfg, scene, rng)
