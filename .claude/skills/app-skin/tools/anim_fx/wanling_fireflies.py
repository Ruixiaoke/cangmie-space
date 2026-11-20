# -*- coding: utf-8 -*-
"""万灵：林间的萤火虫。黄绿色光点，忽明忽暗，慢慢飘。
cfg: count, region [x0,y0,x1,y1], color, size, opacity, drift
横屏可调：halo_pad 光晕裁切范围是 size 的几倍（默认 1.4，是竖屏的数字；光点大了要加到 2.6，不然光晕被裁成方块）"""
import math
import numpy as np


class Flies:
    def __init__(self, cfg, scene, rng):
        self.sc = scene
        n = int(cfg.get('count', 30))
        x0, y0, x1, y1 = cfg.get('region', [0, 90, 512, 340])
        self.col = hexrgb(cfg.get('color', '#d6f45a'))
        self.core = hexrgb(cfg.get('core', '#f6ffb0'))
        self.op = float(cfg.get('opacity', .95))
        self.dr = float(cfg.get('drift', 26))
        self.pad = float(cfg.get('halo_pad', 1.4))
        sz = cfg.get('size', [1.6, 2.8])
        self.f = [dict(x=float(rng.uniform(x0, x1)), y=float(rng.uniform(y0, y1)), r=float(rng.uniform(*sz)),
                       a=float(rng.uniform(0, math.tau)), b=float(rng.uniform(0, math.tau)),
                       fx=int(rng.integers(1, 3)), fy=int(rng.integers(1, 3)), bl=int(rng.integers(1, 4)),
                       ph=float(rng.uniform(0, math.tau)), amp=float(rng.uniform(.6, 1.2))) for _ in range(n)]

    def draw(self, out, t):
        for f in self.f:
            x = f['x'] + self.dr * f['amp'] * math.sin(math.tau * f['fx'] * t + f['a']) + .3 * self.dr * math.sin(math.tau * 2 * t + f['b'])
            y = f['y'] + .7 * self.dr * f['amp'] * math.sin(math.tau * f['fy'] * t + f['b'])
            fl = max(0.0, math.sin(math.tau * f['bl'] * t + f['ph'])) ** 1.4
            if fl < .03: continue
            r, al = f['r'], self.op * fl
            def fn(dx, dy, r=r, al=al):
                d = np.hypot(dx, dy) / r
                yield np.clip(al * .45 * np.exp(-.5 * (d / 2.6) ** 2), 0, 1), self.col
                yield np.clip(al * .8 * np.exp(-.5 * (d / 1.0) ** 2), 0, 1), self.col
                yield np.clip(al * (1 - np.clip((d - .25) / .45, 0, 1)), 0, 1), self.core
            self.sc.stamp(out, x, y, r * self.pad, fn)


def make(cfg, scene, rng):
    return Flies(cfg, scene, rng)
