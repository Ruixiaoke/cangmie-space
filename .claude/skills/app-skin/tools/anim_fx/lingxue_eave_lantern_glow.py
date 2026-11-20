# -*- coding: utf-8 -*-
"""凌雪阁（夜）：屋檐下红灯笼的柔和红橙光晕，缓慢起伏。参数：lanterns = [[x,y],...]，r 光晕半径，strength（0~1）。
用「向暖红色靠拢」的混合而不是叠加，光晕很淡，不会在 GIF 调色板里色阶分层。"""
import math
import numpy as np


class Glow:
    def __init__(self, cfg, scene, rng):
        self.cfg = cfg; self.sc = scene

    def draw(self, out, t):
        c = self.cfg; sc = self.sc; r = c.get('r', 22); st = c.get('strength', 1.0)
        warm = np.array((255, 96, 52), np.float32)
        for k, (x, y) in enumerate(c['lanterns']):
            br = .85 + .15 * math.sin(TAU * t + k * 1.9)
            pad = int(r * 3.2)
            x0, x1, y0, y1 = max(0, int(x) - pad), min(W, int(x) + pad), max(0, int(y) - pad), min(H, int(y) + pad)
            d = np.hypot(sc.xx[y0:y1, x0:x1] - x, sc.yy[y0:y1, x0:x1] - y)
            a = (0.20 * np.exp(-.5 * (d / r) ** 2) + 0.07 * np.exp(-.5 * (d / (r * 2.1)) ** 2)) * st * br
            out[y0:y1, x0:x1] += (warm - out[y0:y1, x0:x1]) * a[:, :, None]


def make(cfg, scene, rng):
    return Glow(cfg, scene, rng)
