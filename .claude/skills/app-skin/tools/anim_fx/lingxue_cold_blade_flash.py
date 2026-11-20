# -*- coding: utf-8 -*-
"""凌雪阁：偶尔一道一闪而过的冷白寒光（刀光的细斜线，很快）。
参数：flashes = [{"t0":开始(0~1),"dur":持续,"from":[x,y],"to":[x,y],"len":光的长度,"w":粗细}]，edge 冷蓝边（浅底上也看得见）。"""
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


class Flash:
    def __init__(self, cfg, scene, rng):
        self.cfg = cfg; self.sc = scene

    def draw(self, out, t):
        c = self.cfg
        cv = Canvas()
        any_ = False
        for f in c['flashes']:
            u = (t - f['t0']) / f['dur']
            if not (0 <= u <= 1): continue
            any_ = True
            e = math.sin(math.pi * u) ** 1.5 * c.get('strength', 1)
            (x0, y0), (x1, y1) = f['from'], f['to']
            hx_, hy_ = x0 + (x1 - x0) * u, y0 + (y1 - y0) * u
            dl = math.hypot(x1 - x0, y1 - y0); dx, dy = (x1 - x0) / dl, (y1 - y0) / dl
            L = f['len'] * (0.35 + .65 * min(1, u * 2.2)); w = f.get('w', 2.4)
            tx, ty = hx_ - dx * L, hy_ - dy * L
            nx, ny = -dy, dx
            def quad(k, col):
                return cv.poly([(tx, ty), (hx_ - dx * L * .5 + nx * w * k, hy_ - dy * L * .5 + ny * w * k), (hx_ + dx * 6, hy_ + dy * 6),
                                (hx_ - dx * L * .5 - nx * w * k, hy_ - dy * L * .5 - ny * w * k)], col)
            a = lambda v: int(255 * e * v)
            quad(2.0, tuple(int(v) for v in (150, 180, 230)) + (a(.55),))
            quad(1.0, (235, 246, 255, a(1)))
            # 光点
            cv.ell(hx_, hy_, w * 1.4, w * 1.4, fill=(255, 255, 255, a(1)))
        if any_:
            cv.blit(out)
            for f in c['flashes']:
                u = (t - f['t0']) / f['dur']
                if 0 <= u <= 1:
                    e = math.sin(math.pi * u) ** 1.5 * c.get('strength', 1)
                    (x0, y0), (x1, y1) = f['from'], f['to']
                    hx_, hy_ = x0 + (x1 - x0) * u, y0 + (y1 - y0) * u
                    def g(dx, dy, e=e):
                        yield .7 * e * np.exp(-.5 * (np.hypot(dx, dy) / 14) ** 2), np.array((215, 235, 255), np.float32)
                    stamp(self.sc, out, hx_, hy_, 14, g)


def make(cfg, scene, rng):
    return Flash(cfg, scene, rng)
