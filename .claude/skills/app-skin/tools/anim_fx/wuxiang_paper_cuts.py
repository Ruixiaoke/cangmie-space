# -*- coding: utf-8 -*-
"""无相楼：飘落的红色剪纸碎屑。小块红色纸片翻转飘落。
cfg: count, size, colors, speed, sway, opacity"""
import math
import numpy as np


class Cuts:
    def __init__(self, cfg, scene, rng):
        self.sc = scene
        n = int(cfg.get('count', 34))
        self.speed = int(cfg.get('speed', 1))
        self.sway = float(cfg.get('sway', 18))
        self.op = float(cfg.get('opacity', .95))
        self.edge = hexrgb(cfg.get('edge', '#ffd9c8'))
        cols = cfg.get('colors', ['#c8281e', '#dd3b2a', '#a81e1a'])
        sz = cfg.get('size', [3.5, 6.0])
        self.p = []
        for i in range(n):
            self.p.append(dict(ph=(i + float(rng.uniform(.1, .9))) / n, x0=float(rng.uniform(0, W)), r=float(rng.uniform(*sz)),
                               a=float(rng.uniform(0, math.tau)), spin=int(rng.choice([-2, -1, 1, 2])),
                               flip=int(rng.integers(1, 4)), shape=int(rng.integers(0, 3)),
                               col=hexrgb(cols[int(rng.integers(0, len(cols)))]), sp=int(rng.integers(1, 3)) if self.speed > 1 else 1,
                               ar=float(rng.uniform(.55, 1.0))))

    def draw(self, out, t):
        for q in self.p:
            u = (q['sp'] * t + q['ph']) % 1.0
            y = -8 + (H + 16) * u
            x = (q['x0'] + self.sway * math.sin(math.tau * t * q['sp'] + q['a']) + .3 * self.sway * math.sin(math.tau * 2 * t + q['a'])) % W
            ang = q['a'] + q['spin'] * math.tau * t
            ca, sa = math.cos(ang), math.sin(ang)
            fl = math.cos(math.tau * q['flip'] * t + q['a'])
            sq = max(.18, abs(fl))
            r, shape, ar = q['r'], q['shape'], q['ar']
            col = q['col'] * (.82 + .3 * (1 if fl > 0 else 0)) if False else q['col'] + (self.edge - q['col']) * (.22 if fl > 0 else 0)
            def fn(dx, dy, r=r, ca=ca, sa=sa, sq=sq, shape=shape, col=col, ar=ar):
                u_ = (dx * ca + dy * sa) / r
                v_ = (-dx * sa + dy * ca) / (r * sq)
                if shape == 0:      # 长方纸片
                    d = np.maximum(np.abs(u_) / 1.0, np.abs(v_) / ar)
                elif shape == 1:    # 菱形
                    d = (np.abs(u_) + np.abs(v_)) / 1.1
                else:               # 小圆片（剪纸圆花）
                    d = np.hypot(u_, v_ / ar)
                yield .22 * (1 - smooth((d - 1.0) / .6)), np.array((40, 20, 30), np.float32)
                yield self.op * (1 - smooth((d - .85) / .3)), col
            self.sc.stamp(out, x, y, r * 1.6, fn)


def make(cfg, scene, rng):
    return Cuts(cfg, scene, rng)
