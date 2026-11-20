# -*- coding: utf-8 -*-
"""霸刀：真正的五尖枫叶（红、橙两色），翻滚着飘落。
参数：count 列数，d 每个循环下落距离（也是同一列叶子的间距），size [最小,最大] 半径，palette 颜色列表，opacity。
横屏可调（默认值是 512 宽竖屏的数字）：amp 左右摆幅范围 [22, 44]，lw 描边和叶脉粗细倍数 (1)。"""
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


def maple_outline():
    nodes = [(-150, .36, 's'), (-112, .64, 'p'), (-88, .30, 's'), (-58, .96, 'p'), (-30, .42, 's'), (0, 1.0, 'p'),
             (30, .42, 's'), (58, .96, 'p'), (88, .30, 's'), (112, .64, 'p'), (150, .36, 's')]
    def xy(a, r):
        a = math.radians(a); return (r * math.sin(a), -r * math.cos(a) + 0.08)
    pts = [xy(180, .34)]
    P = [xy(a, r) for a, r, _ in nodes]
    kinds = [k for _, _, k in nodes]
    pts.append(xy(-165, .32))
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]
        pts.append(a)
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy)
        # 锯齿：沿叶缘垂直向外的小齿
        nx, ny = dy / L, -dx / L
        ca = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        out = 1 if (nx * (ca[0]) + ny * (ca[1] - .08)) > 0 else -1
        for s_ in (.30, .62):
            px, py = a[0] + dx * s_, a[1] + dy * s_
            pts.append((px + nx * out * .07, py + ny * out * .07))
            pts.append((a[0] + dx * (s_ + .1), a[1] + dy * (s_ + .1)))
    pts.append(P[-1]); pts.append(xy(165, .32))
    return pts


OUTLINE = maple_outline()
VEINS = [(0, 0.08, 0.0, -0.92), (0, 0.1, -0.68, -0.4), (0, 0.1, 0.68, -0.4), (0, 0.1, -0.42, 0.42), (0, 0.1, 0.42, 0.42)]


class Maple:
    def __init__(self, cfg, scene, rng):
        self.cfg = cfg
        n = int(cfg.get('count', 12))
        self.items = []
        pal = [tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for c in cfg['palette']]
        for i in range(n):
            self.items.append(dict(x0=rng.uniform(10, W - 10), y0=rng.uniform(0, 1),
                                   r=rng.uniform(*cfg.get('size', [8, 13])), a=rng.uniform(0, TAU),
                                   spin=int(rng.choice([-1, 1])), f=int(rng.choice([1, 2])), b=rng.uniform(0, TAU),
                                   A=rng.uniform(*cfg.get('amp', [22, 44])), col=pal[int(rng.integers(len(pal)))]))

    def draw(self, out, t):
        cfg = self.cfg; d = float(cfg.get('d', 400)); op = cfg.get('opacity', .95)
        lw = float(cfg.get('lw', 1))
        cv = Canvas()
        for it in self.items:
            for y in chain_ys(it['y0'] * d, d, t):
                x = it['x0'] + it['A'] * math.sin(TAU * t + it['a']) + .3 * it['A'] * math.sin(2 * TAU * t + it['b'])
                ang = it['a'] + it['spin'] * TAU * t + .5 * math.sin(TAU * t + it['b'])
                flip = math.cos(TAU * it['f'] * t + it['b'])
                v = max(.28, abs(flip)); back = flip < 0
                ca, sa = math.cos(ang), math.sin(ang)
                r = it['r']
                def T(p):
                    u, w = p[0] * r, p[1] * r * v
                    return (x + u * ca - w * sa, y + u * sa + w * ca)
                col = np.array(it['col'], np.float32) * (0.78 if back else 1.0)
                fill = tuple(int(c) for c in col) + (255,)
                edge = (int(col[0] * .55), int(col[1] * .4), int(col[2] * .35), 255)
                pts = [T(p) for p in OUTLINE]
                cv.poly(pts, fill, edge, 1.0 * lw)
                vc = (int(col[0] * .62), int(col[1] * .5), int(col[2] * .45), 255)
                for _, _, ex, ey in VEINS:
                    cv.line([T((0, .12)), T((ex, ey))], vc, 0.8 * lw)
                cv.line([T((0, .38)), T((0, 1.22))], vc, 1.1 * lw)
        cv.blit(out, op)


def make(cfg, scene, rng):
    return Maple(cfg, scene, rng)
