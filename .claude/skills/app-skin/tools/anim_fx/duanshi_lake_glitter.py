# -*- coding: utf-8 -*-
"""段氏：洱海湖面上的碎金波光。湖面区域里一片片闪动的光斑，像阳光 / 月光在水上的倒影碎片。
cfg: count, region [x0,y0,x1,y1], hot [cx, spread] (光斑更集中的竖带，可选), color, core, opacity
横屏可调：scale 光斑尺寸和摆幅倍数 (1，默认按 512 宽设计)"""
import math
import numpy as np


class Glitter:
    def __init__(self, cfg, scene, rng):
        self.sc = scene
        n = int(cfg.get('count', 150))
        x0, y0, x1, y1 = cfg.get('region', [0, 215, 512, 600])
        hot = cfg.get('hot')
        self.col = hexrgb(cfg.get('color', '#ffcf5a'))
        self.core = hexrgb(cfg.get('core', '#fff3c0'))
        self.op = float(cfg.get('opacity', .9))
        self.f = []
        k = float(cfg.get('scale', 1))
        for _ in range(n):
            y = y0 + (y1 - y0) * float(rng.random()) ** 1.5
            if hot and rng.random() < float(cfg.get('hot_share', .6)):
                x = float(rng.normal(hot[0], hot[1]))
            else:
                x = float(rng.uniform(x0, x1))
            persp = .6 + 1.2 * (y - y0) / max(1, y1 - y0)
            self.f.append(dict(x=x, y=y, rx=float(rng.uniform(3, 9)) * persp * k, ry=float(rng.uniform(.8, 1.5)) * k,
                               bl=int(rng.integers(1, 4)), ph=float(rng.uniform(0, math.tau)),
                               dx=float(rng.uniform(2, 7)) * k, pw=float(rng.uniform(2.5, 5))))

    def draw(self, out, t):
        for f in self.f:
            fl = max(0.0, math.sin(math.tau * f['bl'] * t + f['ph'])) ** f['pw']
            if fl < .04: continue
            x = f['x'] + f['dx'] * math.sin(math.tau * t + f['ph'])
            al = self.op * fl
            rx, ry = f['rx'], f['ry']
            def fn(dx, dy, rx=rx, ry=ry, al=al):
                d2 = (dx / rx) ** 2 + (dy / ry) ** 2
                yield np.clip(al * .5 * np.exp(-.5 * ((dx / (rx * 1.5)) ** 2 + (dy / (ry * 2.6)) ** 2)), 0, 1), self.col
                yield np.clip(al * np.exp(-.5 * d2 * 1.5), 0, 1), self.core
            self.sc.stamp(out, x, f['y'], max(rx * 1.5, ry * 3), fn)


def make(cfg, scene, rng):
    return Glitter(cfg, scene, rng)
