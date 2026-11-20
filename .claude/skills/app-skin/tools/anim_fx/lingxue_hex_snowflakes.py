# -*- coding: utf-8 -*-
"""凌雪阁：大片的六角雪花晶体，缓慢旋转着飘落（每个循环转 1/6 圈，六角对称所以首尾无缝）。
参数：count 列数，d 每个循环下落距离，size [最小,最大] 半径，color / edge 颜色，opacity，glow（夜里的柔光 0~1）。"""
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


def flake_segments(R):
    segs = []
    for k in range(6):
        a = k * math.pi / 3
        ax = (math.cos(a), math.sin(a))
        segs.append(((0, 0), (ax[0] * R, ax[1] * R)))
        for pos, ln in ((.42, .36), (.68, .26)):
            bx, by = ax[0] * R * pos, ax[1] * R * pos
            for sg in (-1, 1):
                b = a + sg * math.radians(58)
                segs.append(((bx, by), (bx + math.cos(b) * R * ln, by + math.sin(b) * R * ln)))
    return segs


class Flakes:
    def __init__(self, cfg, scene, rng):
        self.cfg = cfg; self.sc = scene
        self.items = [dict(x0=rng.uniform(6, W - 6), y0=rng.uniform(0, 1), R=rng.uniform(*cfg.get('size', [9, 18])),
                           a=rng.uniform(0, TAU), A=rng.uniform(*cfg.get('sway', [14, 30])), b=rng.uniform(0, TAU), sp=int(rng.choice([-1, 1])))
                      for _ in range(int(cfg.get('count', 14)))]

    def draw(self, out, t):
        c = self.cfg; d = float(c.get('d', 400))
        col = hx(c.get('color', '#ffffff')) + (255,); edge = hx(c.get('edge', '#7d93b8')) + (255,)
        cv = Canvas()
        for it in self.items:
            R = it['R']; segs = flake_segments(R)
            w = max(.9, R * .085)
            for y in chain_ys(it['y0'] * d, d, t, lo=-30):
                x = it['x0'] + it['A'] * math.sin(TAU * t + it['a'])
                rot = it['a'] + it['sp'] * (TAU / 6) * t
                ca, sa = math.cos(rot), math.sin(rot)
                T = lambda p: (x + p[0] * ca - p[1] * sa, y + p[0] * sa + p[1] * ca)
                if c.get('glow'):
                    def g(dx, dy, R=R):
                        yield c['glow'] * .22 * np.exp(-.5 * (np.hypot(dx, dy) / (R * 1.1)) ** 2), np.array((200, 220, 255), np.float32)
                    stamp(self.sc, out, x, y, R * 1.3, g)
                for (p, q) in segs:
                    cv.line([T(p), T(q)], edge, w + 1.1)
                hexr = R * .2
                cv.poly([T((hexr * math.cos(k * math.pi / 3), hexr * math.sin(k * math.pi / 3))) for k in range(6)], edge)
                for (p, q) in segs:
                    cv.line([T(p), T(q)], col, w)
                cv.poly([T((hexr * .8 * math.cos(k * math.pi / 3), hexr * .8 * math.sin(k * math.pi / 3))) for k in range(6)], col)
        cv.blit(out, c.get('opacity', .95))


def make(cfg, scene, rng):
    return Flakes(cfg, scene, rng)
