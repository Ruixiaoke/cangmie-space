# -*- coding: utf-8 -*-
"""蓬莱：飘落的白色羽毛。参数：count 列数，d 每个循环下落距离，size 羽毛长度范围，opacity，edge 边缘色（让白羽毛在浅色天空上看得见）。
横屏可调（默认值是 512 宽竖屏的数字）：amp 左右摆幅范围 [24, 48]，lw 描边和羽脉粗细倍数 (1)。"""
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


class Feathers:
    def __init__(self, cfg, scene, rng):
        self.cfg = cfg
        self.items = [dict(x0=rng.uniform(10, W - 10), y0=rng.uniform(0, 1), L=rng.uniform(*cfg.get('size', [14, 22])),
                           a=rng.uniform(0, TAU), A=rng.uniform(*cfg.get('amp', [24, 48])), b=rng.uniform(0, TAU),
                           f=int(rng.choice([1, 1, 2])), sg=int(rng.choice([-1, 1]))) for _ in range(int(cfg.get('count', 10)))]

    def draw(self, out, t):
        cfg = self.cfg; d = float(cfg.get('d', 400))
        hx = lambda s: tuple(int(s[i:i + 2], 16) for i in (1, 3, 5))
        edge = hx(cfg.get('edge', '#7d9bb8')) + (255,); body = hx(cfg.get('color', '#ffffff')) + (255,)
        lw = float(cfg.get('lw', 1))
        cv = Canvas()
        for it in self.items:
            for y in chain_ys(it['y0'] * d, d, t):
                x = it['x0'] + it['A'] * math.sin(TAU * t + it['a'])
                # 羽毛左右摆荡，一边下落一边倾斜
                ang = .9 * math.sin(TAU * t + it['a']) * it['sg'] + 1.57 + 0.25 * math.sin(2 * TAU * t + it['b'])
                v = .55 + .45 * abs(math.cos(TAU * it['f'] * t + it['b']))
                ca, sa = math.cos(ang), math.sin(ang)
                L = it['L']
                def T(u, w):
                    # 羽轴沿 u（-L/2..L/2），略微弯曲
                    w = w + 0.12 * L * (u / L) ** 2 * 2
                    return (x + u * ca - w * v * sa, y + u * sa + w * v * ca)
                top, bot = [], []
                for k in range(13):
                    s = k / 12; u = (s - .5) * L
                    hw = .17 * L * (math.sin(math.pi * s ** .8) ** .9)
                    top.append(T(u, -hw)); bot.append(T(u, hw))
                pts = top + bot[::-1]
                cv.poly(pts, body, edge, 0.9 * lw)
                cv.line([T(-L * .62, 0), T(L * .5, 0)], edge, 0.9 * lw)
                for s in (.3, .5, .7):
                    u = (s - .5) * L
                    cv.line([T(u, 0), T(u + .12 * L, -.14 * L * math.sin(math.pi * s))], edge, .6 * lw)
                    cv.line([T(u, 0), T(u + .12 * L, .14 * L * math.sin(math.pi * s))], edge, .6 * lw)
        cv.blit(out, cfg.get('opacity', .95))


def make(cfg, scene, rng):
    return Feathers(cfg, scene, rng)
