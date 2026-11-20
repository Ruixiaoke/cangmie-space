# -*- coding: utf-8 -*-
"""刀宗：海浪拍在礁石上溅起的白色浪沫。一簇簇白点沿抛物线溅起再落下，有节奏地一阵一阵。
cfg: spots [[x,y,height,bursts,phase,width]], color, opacity"""
import math
import numpy as np


class Spray:
    def __init__(self, cfg, scene, rng):
        self.sc = scene
        self.col = hexrgb(cfg.get('color', '#ffffff'))
        self.core = hexrgb(cfg.get('core', '#ffffff'))
        self.op = float(cfg.get('opacity', .95))
        self.dur = float(cfg.get('dur', .42))
        self.spots = []
        for x, y, h, bursts, ph, wd in cfg['spots']:
            drops = []
            for _ in range(int(cfg.get('drops', 16))):
                drops.append(dict(vx=float(rng.normal(0, .6)) * wd, hh=float(h * rng.uniform(.3, 1.1)),
                                  r=float(rng.uniform(1.6, 3.2)), lag=float(rng.uniform(0, .5))))
            self.spots.append(dict(x=x, y=y, h=h, b=int(bursts), ph=ph, wd=wd, drops=drops))

    def draw(self, out, t):
        for sp in self.spots:
            tb = (sp['b'] * t + sp['ph']) % 1.0
            if tb > self.dur: continue
            s0 = tb / self.dur
            # foam cap at the base
            cap = math.sin(math.pi * min(1, s0 * 1.15)) ** 1.5
            if cap > .02:
                rw, rh = 12 * sp['wd'] * (.5 + .8 * s0), 2.0
                def fnc(dx, dy, rw=rw, rh=rh, cap=cap):
                    d2 = (dx / rw) ** 2 + (dy / rh) ** 2
                    yield np.clip(self.op * .45 * cap * np.exp(-.5 * d2 * 2.2), 0, 1), self.col
                self.sc.stamp(out, sp['x'], sp['y'] - 1, rw, fnc)
            for d in sp['drops']:
                s = (s0 - d['lag']) / (1 - d['lag'])
                if s <= 0 or s >= 1: continue
                for trail, ta in ((0, 1.0), (.04, .4)):
                    ss = s - trail
                    if ss <= 0: continue
                    x = sp['x'] + d['vx'] * 70 * ss
                    y = sp['y'] - 4 * d['hh'] * ss * (1 - ss)
                    al = self.op * ta * (1 - s ** 3) * min(1.0, s * 9)
                    r = d['r'] * (1 - .3 * s)
                    def fn(dx, dy, r=r, al=al):
                        dd = np.hypot(dx, dy) / r
                        yield np.clip(al * .3 * np.exp(-.5 * (dd / 1.8) ** 2), 0, 1), self.col
                        yield np.clip(al * (1 - np.clip((dd - .5) / .6, 0, 1) ** 1.5 * 1.0), 0, 1) * (dd < 1.2), self.core
                    self.sc.stamp(out, x, y, r, fn)


def make(cfg, scene, rng):
    return Spray(cfg, scene, rng)
