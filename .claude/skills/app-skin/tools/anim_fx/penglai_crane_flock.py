# -*- coding: utf-8 -*-
"""蓬莱：飞过天空的白鹤剪影，翅膀上下扇动，三只一组成行从右向左飞过。
参数：y 飞行带中心，S 一个循环飞过的距离（组与组的间距），unit 鹤的大小，flaps 每个循环扇翅次数，
body/edge/tip 颜色，opacity，birds = [{"o":横向偏移,"dy":纵向偏移,"s":缩放,"ph":扇翅相位}]。
横屏可调（默认值是 512 宽竖屏的数字）：bob 上下起伏像素 (2.0)，blur 边缘柔化 (0.55)。"""
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

    def blit(self, out, opacity=1.0, blur=0.0):
        im = self.im.convert('RGBa').resize((W, H), Image.BOX)
        if blur:
            from PIL import ImageFilter
            im = im.filter(ImageFilter.GaussianBlur(blur))
        sm = np.asarray(im.convert('RGBA'), np.float32)
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


def hx(s, a=255):
    return tuple(int(s[i:i + 2], 16) for i in (1, 3, 5)) + (a,)


def bez(P0, P1, P2, q):
    return ((1 - q) ** 2 * P0[0] + 2 * q * (1 - q) * P1[0] + q * q * P2[0],
            (1 - q) ** 2 * P0[1] + 2 * q * (1 - q) * P1[1] + q * q * P2[1])


def stroke(cv, P0, P1, P2, w0, w1, col, q0=0.0, q1=1.0, n=12):
    """毛笔笔触：沿二次曲线、粗细从 w0 渐变到 w1 的尖头笔画（没有描边）"""
    L, R = [], []
    for k in range(n + 1):
        q = q0 + (q1 - q0) * k / n
        x, y = bez(P0, P1, P2, q)
        xa, ya = bez(P0, P1, P2, min(1, q + .02)); xb, yb = bez(P0, P1, P2, max(0, q - .02))
        dx, dy = xa - xb, ya - yb; l = math.hypot(dx, dy) or 1
        w = (w0 + (w1 - w0) * (k / n)) * .5
        L.append((x - dy / l * w, y + dx / l * w)); R.append((x + dy / l * w, y - dx / l * w))
    cv.poly(L + R[::-1], col)


def wing(cv, sx, sy, u, p1, p2, z, body, grey, tip, al):
    def seg(phi):
        return (-.22 * math.cos(phi), -(math.sin(phi) + z * math.cos(phi)))
    v1, v2 = seg(p1), seg(p2)
    L1, L2 = .50, .62
    S = (sx, sy)
    E = (S[0] + L1 * v1[0] * u, S[1] + L1 * v1[1] * u)
    T = (E[0] + L2 * v2[0] * u, E[1] + L2 * v2[1] * u)
    # 后缘的灰色次级羽（几笔），先画
    for k, (bx, by, f) in enumerate(((.30, .06, .88), (.50, .10, .78), (.68, .13, .66))):
        Sb = (S[0] + bx * u * .5, S[1] + by * u * .4)
        Eb = (E[0] * 0 + S[0] + (E[0] - S[0]) * f + bx * u * .8, S[1] + (E[1] - S[1]) * f + by * u)
        Tb = (S[0] + (T[0] - S[0]) * f + bx * u * 1.0, S[1] + (T[1] - S[1]) * f + by * u * 1.2)
        stroke(cv, Sb, Eb, Tb, .20 * u, 0, grey[:3] + (int(grey[3] * al),))
    # 前缘主笔：白色，渐细
    stroke(cv, S, E, T, .30 * u, 0, body[:3] + (int(body[3] * al),))
    # 翼尖：黑色飞白
    stroke(cv, S, E, T, .17 * u, 0, tip[:3] + (int(tip[3] * al),), q0=.68, q1=1.0, n=6)


def crane(cv, cx, cy, u, flap, body, grey, tip, al):
    P = lambda x, y: (cx + x * u, cy + y * u)
    a1 = math.radians(42) * math.sin(flap) + math.radians(8)
    a2 = math.radians(54) * math.sin(flap - .9) + math.radians(8)
    wing(cv, cx - .10 * u, cy - .10 * u, u, a1, a2, -.22, body, grey, tip, al * .8)   # 远侧翅
    # 腿：两根细线向后拖
    cv.line([P(.5, .06), P(1.35, .14)], grey[:3] + (int(150 * al),), max(.7, .06 * u))
    cv.line([P(.5, .09), P(1.3, .24)], grey[:3] + (int(150 * al),), max(.7, .06 * u))
    # 身体：细长水滴，灰色腹部 + 白色背
    stroke(cv, P(-.55, 0), P(0, .12), P(.75, .04), .07 * u, .02 * u, grey[:3] + (int(grey[3] * al),))
    stroke(cv, P(-.5, -.02), P(.05, -.04), P(.78, .02), .36 * u, .04 * u, body[:3] + (int(body[3] * al),))
    # 颈：细长，向前伸，略弯
    stroke(cv, P(-.45, -.03), P(-.9, -.16), P(-1.2, -.07), .12 * u, .06 * u, body[:3] + (int(body[3] * al),))
    cv.ell(cx - 1.22 * u, cy - .07 * u, .06 * u, .055 * u, fill=body[:3] + (int(255 * al),))
    cv.poly([P(-1.26, -.10), P(-1.55, -.05), P(-1.26, -.03)], (110, 100, 90, int(200 * al)))
    wing(cv, cx - .10 * u, cy - .06 * u, u, a1 * .95, a2, .30, body, grey, tip, al)  # 近侧翅


class Cranes:
    def __init__(self, cfg, scene, rng):
        self.cfg = cfg

    def draw(self, out, t):
        c = self.cfg
        S = float(c['S']); n = int(c.get('flaps', 5))
        body, grey, tip = hx(c['body']), hx(c['grey'], 235), hx(c['tip'], 235)
        base = (c.get('x0', 0) - S * t) % S
        cv = Canvas()
        for b in c['birds']:
            k = -2
            while True:
                x = base + b['o'] + k * S
                k += 1
                if x > W + 100: break
                if x < -100: continue
                flap = TAU * n * t + b['ph'] + TAU * x / S
                y = c['y'] + b['dy'] + (x - W / 2) * 0.04 - c.get('bob', 2.0) * math.sin(flap + 1.0)
                crane(cv, x, y, c['unit'] * b['s'], flap, body, grey, tip, b.get('a', 1.0) * c.get('opacity', .85))
        cv.blit(out, 1.0, blur=c.get('blur', 0.55))


def make(cfg, scene, rng):
    return Cranes(cfg, scene, rng)
