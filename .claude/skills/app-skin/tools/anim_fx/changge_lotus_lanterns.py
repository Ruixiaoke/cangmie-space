# -*- coding: utf-8 -*-
"""长歌：湖面上缓缓漂流的荷花灯。白天粉白莲花灯，夜里中间有暖色烛光、水面有倒影光晕。
参数：mode "day"|"night"，rows = [{"y":..,"s":缩放,"S":一个循环漂过的距离(也是同一行灯的间距),"x0":..}]
灯从右向左漂（direction 默认 -1），每个循环正好漂过一个间距，首尾无缝。"""
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

    def ell(self, cx, cy, rx, ry, fill=None, outline=None, w=1.0):
        self.d.ellipse([(cx - rx) * SS, (cy - ry) * SS, (cx + rx) * SS, (cy + ry) * SS], fill=fill,
                       outline=outline, width=max(1, int(w * SS)))

    def blit(self, out, opacity=1.0):
        sm = np.asarray(self.im.convert('RGBa').resize((W, H), Image.BOX).convert('RGBA'), np.float32)
        a = sm[..., 3:4] / 255.0 * opacity
        out += (sm[..., :3] - out) * a


def stamp(sc, out, cx, cy, rad, fn):
    """和 scene.stamp 一样，但不做画面边缘的环绕（灯漂出画面时影子也一起出去）"""
    pad = int(math.ceil(rad * 3)) + 2
    x0, x1 = max(0, int(cx) - pad), min(W, int(cx) + pad + 1)
    y0, y1 = max(0, int(cy) - pad), min(H, int(cy) + pad + 1)
    if x0 >= x1 or y0 >= y1:
        return
    dx = sc.xx[y0:y1, x0:x1] - cx; dy = sc.yy[y0:y1, x0:x1] - cy
    for alpha, col in fn(dx, dy):
        patch = out[y0:y1, x0:x1]
        patch += (col - patch) * alpha[:, :, None]


def petal(base, ang, length, width, s, rot):
    a = math.radians(ang) + rot
    ax = (math.sin(a), -math.cos(a)); pp = (math.cos(a), math.sin(a))
    L, R = [], []
    for k in range(11):
        t = k / 10
        hw = width * (math.sin(math.pi * t ** 0.72) ** 0.85)
        bx, by = base[0] + ax[0] * t * length, base[1] + ax[1] * t * length
        L.append((bx - pp[0] * hw, by - pp[1] * hw)); R.append((bx + pp[0] * hw, by + pp[1] * hw))
    return [(base[0] * 0 + p[0] * s, p[1] * s) for p in L + R[::-1]]


class Lanterns:
    def __init__(self, cfg, scene, rng):
        self.cfg = cfg
        self.night = cfg.get('mode') == 'night'
        self.rows = cfg['rows']
        self.dir = cfg.get('direction', -1)
        self.sc = scene

    def lantern(self, cv, cx, cy, s, rot, fl):
        night = self.night
        P = lambda pts: [(cx + x, cy + y) for x, y in pts]
        # 荷叶底盘
        cv.ell(cx, cy + 0.12 * s, 1.18 * s, 0.30 * s, fill=(70, 120, 92, 235) if not night else (28, 70, 60, 235))
        order = [(-66, .78, .30), (66, .78, .30), (-36, .95, .32), (36, .95, .32), (0, 1.12, .34)]
        for i, (ang, ln, wd) in enumerate(order):
            pts = P(petal((0, 0.06), ang, ln, wd, s, rot))
            back = i < 4
            if not night:
                fill = (244, 214, 226, 255) if back else (253, 236, 241, 255)
                edge = (214, 112, 146, 255)
            else:
                g = fl
                fill = (int(222 + 25 * g), int(150 + 55 * g), int(88 + 50 * g), 255) if back else \
                      (int(246 + 9 * g), int(200 + 40 * g), int(130 + 60 * g), 255)
                edge = (150, 82, 48, 255)
            cv.poly(pts, fill, edge, 1.0)
        # 花心
        if night:
            cv.ell(cx, cy - 0.35 * s, 0.17 * s, 0.24 * s, fill=(255, 244, 205, 255))
        else:
            cv.ell(cx, cy - 0.2 * s, 0.10 * s, 0.10 * s, fill=(246, 196, 90, 255))

    def draw(self, out, t):
        sc = self.sc
        night = self.night
        rows = sorted(self.rows, key=lambda r: r['y'])
        for r in rows:
            S = float(r['S']); s = float(r['s']) * 25
            xs = []
            base = ((r.get('x0', 0) + self.dir * S * t) % S)
            k = -1
            while base + k * S < W + 50:
                xs.append(base + k * S); k += 1
            for x in xs:
                ph = x / S
                bob = 1.3 * s / 21 * math.sin(TAU * (t * 2 + ph * 0) + ph * TAU)
                cy = r['y'] + bob
                rot = 0.07 * math.sin(TAU * t + ph * TAU + 1.1)
                fl = 0.5 + 0.5 * math.sin(TAU * (3 * t) + ph * TAU * 3)
                # 水面：影子 / 倒影
                if night:
                    def refl(dx, dy, s=s, fl=fl):
                        gx = np.exp(-.5 * (dx / (s * 1.3)) ** 2)
                        yield (0.20 + 0.06 * fl) * gx * np.exp(-.5 * ((dy - s * 0.7) / (s * 2.3)) ** 2) * (dy > -s * .1), np.array((255, 176, 92), np.float32)
                        yield .45 * np.exp(-.5 * ((dx / (s * 2.2)) ** 2 + ((dy + s * .3) / (s * .85)) ** 2)) * (0.3 + 0.12 * fl), np.array((255, 190, 110), np.float32)
                    stamp(sc, out, x, cy, s * 3, refl)
                else:
                    def shadow(dx, dy, s=s):
                        yield .30 * np.exp(-.5 * ((dx / (s * 1.55)) ** 2 + ((dy - s * .35) / (s * .55)) ** 2)), np.array((42, 98, 104), np.float32)
                    stamp(sc, out, x, cy, s * 3, shadow)
                # 涟漪
                cv0 = Canvas()
                for j in range(2):
                    u = (t * 2 + ph * 2 + j * 0.5) % 1.0
                    rx = s * (1.35 + 1.5 * u); ry = rx * 0.26
                    al = int(255 * (1 - u) ** 1.5 * (0.5 if night else 0.75))
                    col = (255, 205, 140, al) if night else (255, 255, 255, al)
                    cv0.ell(x, cy + 0.35 * s, rx, ry, outline=col, w=1.0)
                cv0.blit(out)
                if night:
                    def halo(dx, dy, s=s, fl=fl):
                        d = np.hypot(dx, dy * 1.05)
                        yield (0.32 + 0.08 * fl) * np.exp(-.5 * (d / (s * 1.1)) ** 2), np.array((255, 170, 80), np.float32)
                    stamp(sc, out, x, cy - 0.35 * s, s * 2.6, halo)
                cv = Canvas()
                self.lantern(cv, x, cy, s, rot, fl)
                cv.blit(out)
                if night:
                    def core(dx, dy, s=s, fl=fl):
                        d = np.hypot(dx, dy)
                        yield (0.5 + 0.25 * fl) * np.exp(-.5 * (d / (s * .38)) ** 2), np.array((255, 240, 190), np.float32)
                    stamp(sc, out, x, cy - 0.4 * s, s * 1.2, core)


def make(cfg, scene, rng):
    return Lanterns(cfg, scene, rng)
