# -*- coding: utf-8 -*-
"""无相楼：从画面顶部垂下的提线木偶悬丝。细线，下端有小十字提线板的影子，随风轻轻摆动。
cfg: strings [[x, length, phase]], color, plate_color, opacity, sway, lamps [[x,y]] (夜里被灯光照成淡金色)"""
import math
import numpy as np


def splat(mask, x, y, v=1.0):
    x0, y0 = int(math.floor(x)), int(math.floor(y)); fx, fy = x - x0, y - y0
    for ox, oy, w in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
        xi, yi = x0 + ox, y0 + oy
        if 0 <= xi < W and 0 <= yi < H:
            mask[yi, xi] = min(1.0, mask[yi, xi] + w * v)


def line(mask, ax, ay, bx, by, v=1.0, wd=1):
    n = int(max(abs(bx - ax), abs(by - ay)) * 1.6) + 2
    for i in range(n + 1):
        s = i / n
        for k in range(wd):
            splat(mask, ax + (bx - ax) * s + k * .7, ay + (by - ay) * s, v)


class Strings:
    def __init__(self, cfg, scene, rng):
        self.sc = scene
        self.items = cfg['strings']
        self.col = hexrgb(cfg.get('color', '#4a3836'))
        self.hi = hexrgb(cfg.get('highlight', '#fff6e6'))
        self.op = float(cfg.get('opacity', .8))
        self.sway = float(cfg.get('sway', 7))
        self.lamps = cfg.get('lamps')
        self.lit = hexrgb(cfg.get('lit_color', '#ffd98a'))

    def draw(self, out, t):
        mask = np.zeros((H, W), np.float32)
        glowm = np.zeros((H, W), np.float32)
        for x, length, ph in self.items:
            sw = self.sway * (.7 + .3 * math.sin(math.tau * 2 * t + ph * 1.9))
            bx_off = sw * math.sin(math.tau * t + ph)
            # 弯曲的悬丝：摆动幅度从上到下按 s^1.6 增大
            pts = []
            n = int(length // 3)
            for i in range(n + 1):
                s = i / n
                pts.append((x + bx_off * s ** 1.6, s * length))
            for (ax, ay), (bx, by) in zip(pts, pts[1:]):
                line(mask, ax, ay, bx, by, 1.0)
            ex, ey = pts[-1]
            ang = .22 * math.sin(math.tau * t + ph + .6)
            ca, sa = math.cos(ang), math.sin(ang)
            # 十字提线板：横杆 + 竖杆
            for (ux, uy, hl) in ((ca, sa, 10), (-sa, ca, 5)):
                line(mask, ex - ux * hl, ey - uy * hl + 3, ex + ux * hl, ey + uy * hl + 3, 1.0, 2)
            # 板下垂的几根细线
            for dxk in (-8, 8):
                px, py = ex + dxk * ca, ey + dxk * sa + 3
                line(mask, px, py, px + dxk * .25 + 1.5 * math.sin(math.tau * t + ph + dxk), py + 16, .35, 1)
        if self.lamps:
            lit = np.zeros((H, W), np.float32)
            for lx, ly in self.lamps:
                lit += np.exp(-.5 * (((self.sc.xx - lx) / 150) ** 2 + ((self.sc.yy - ly) / 190) ** 2))
            lit = np.clip(.35 + lit, 0, 1)[:, :, None]
            colr = self.col + (self.lit - self.col) * lit
        else:
            colr = self.col
        a = np.clip(self.op * mask, 0, 1)[:, :, None]
        out += (colr - out) * a


def make(cfg, scene, rng):
    return Strings(cfg, scene, rng)
