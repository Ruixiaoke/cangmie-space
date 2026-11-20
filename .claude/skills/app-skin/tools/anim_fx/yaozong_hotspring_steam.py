# -*- coding: utf-8 -*-
"""药宗：温泉 / 药谷升起的蒸汽。白色柔和的气团往上升腾、扩散、变淡，一团接一团。
cfg: sources [[x,y,scale,count,cycles]], color, shade, opacity, rise, lamp [x,y] (夜里灯火旁的蒸汽被染暖), lamp_color"""
import math
import numpy as np


class Steam:
    def __init__(self, cfg, scene, rng):
        self.sc = scene
        self.op = float(cfg.get('opacity', .5))
        self.col = hexrgb(cfg.get('color', '#ffffff'))
        self.shade = hexrgb(cfg.get('shade', '#8fa39a'))
        self.shade_a = float(cfg.get('shade_opacity', .5))
        self.rise = float(cfg.get('rise', 150))
        self.lamp = cfg.get('lamp')
        self.lamp_col = hexrgb(cfg.get('lamp_color', '#ffd89a'))
        self.puffs = []
        for src in cfg['sources']:
            sx, sy, scl, cnt, cyc = src[:5]
            for k in range(int(cnt)):
                ph = (k + rng.uniform(.1, .9)) / cnt
                subs = [(float(rng.uniform(-1.0, 1.0)), float(rng.uniform(-.8, .8)), float(rng.uniform(.4, .75))) for _ in range(5)]
                self.puffs.append(dict(sx=sx + rng.uniform(-14, 14) * scl, sy=sy + rng.uniform(-4, 4), s=scl, ph=ph, cyc=int(cyc),
                                       a=float(rng.uniform(0, math.tau)), drift=float(rng.uniform(-18, 26) + cfg.get('wind', 0)) * scl if len(src) < 6 else float(rng.uniform(-14, 10) + src[5]) * scl, subs=subs,
                                       r0=float(rng.uniform(6, 9)) * scl, r1=float(rng.uniform(20, 28)) * scl))

    def draw(self, out, t):
        for p in self.puffs:
            u = (p['cyc'] * t + p['ph']) % 1.0
            x = p['sx'] + p['drift'] * u + 8 * p['s'] * math.sin(math.tau * u + p['a'])
            y = p['sy'] - self.rise * p['s'] ** .5 * (u ** .85)
            r = p['r0'] + (p['r1'] - p['r0']) * u ** .7
            fade = math.sin(math.pi * u) ** 1.3
            fade *= min(1.0, u * 7) if False else 1
            a0 = self.op * fade
            if a0 < .01: continue
            tint = 0.0
            if self.lamp:
                d = math.hypot(x - self.lamp[0], y - self.lamp[1])
                tint = math.exp(-d / 75.0)
            col = self.col + (self.lamp_col - self.col) * tint * .75
            a0 = a0 * (1 + .2 * tint)
            for ox, oy, w in p['subs']:
                cx, cy, rr = x + ox * r * .8, y + oy * r * .6, r * w
                def fn(dx, dy, rr=rr, a0=a0, col=col):
                    d2 = (dx * dx + dy * dy) / (rr * rr)
                    g = .5 * np.exp(-.5 * d2 * 2.2) * (d2 < 4)
                    yield self.shade_a * a0 * .35 * np.exp(-.5 * ((dx - rr * .12) ** 2 + (dy - rr * .22) ** 2) / (rr * rr) * 1.4), self.shade
                    yield np.clip(a0 * g, 0, 1), col
                self.sc.stamp(out, cx, cy, rr, fn)


def make(cfg, scene, rng):
    return Steam(cfg, scene, rng)
