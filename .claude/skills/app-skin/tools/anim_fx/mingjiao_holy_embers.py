"""明教（夜）：圣火上方往上飘散的火星，圣火自己也在闪。"""
import math
import numpy as np


class Fx:
    def __init__(self, cfg, scene, rng):
        self.scene, self.cfg = scene, cfg
        self.fx, self.fy = cfg['fire']
        n = int(cfg.get('count', 46))
        K = float(cfg.get('scale', 1))
        self.K = K
        self.items = []
        for i in range(n):
            self.items.append(dict(
                ph=float((i + rng.uniform(.1, .9)) / n), x0=float(rng.uniform(-7, 7)) * K, rise=float(rng.uniform(*cfg.get('rise', [110, 330]))),
                drift=float(rng.uniform(*cfg.get('drift', [10, 70]))), sway=float(rng.uniform(3, 12)) * K, a=float(rng.uniform(0, math.tau)),
                r=float(rng.uniform(1.5, 2.8)) * K, blink=int(rng.integers(2, 6))))
        rng.shuffle(self.items)

    def draw(self, out, t):
        sc, T = self.scene, math.tau
        fx, fy = self.fx, self.fy
        K = self.K
        warm = np.array((255, 150, 55), np.float32)
        fl = 1 + .3 * math.sin(T * 3 * t) + .15 * math.sin(T * 5 * t + 1.1) + .06 * math.sin(T * 9 * t)

        def glow(dx, dy):
            d = np.hypot(dx, dy * 1.1)
            yield .5 * fl * np.exp(-.5 * (d / (18 * K)) ** 2), warm
            yield .26 * fl * np.exp(-.5 * (d / (60 * K)) ** 2), warm
        sc.stamp(out, fx, fy - 8 * K, 190 * K, glow)
        for it in self.items:
            u = (t + it['ph']) % 1.0
            y = fy - 14 * K - it['rise'] * u ** .9
            x = fx + it['x0'] + it['drift'] * u ** 1.3 + it['sway'] * u * math.sin(T * 2 * t + it['a'])
            env = min(1.0, u / .06) * (1 - u) ** .9
            tw = .6 + .4 * math.sin(T * it['blink'] * t + it['a'])
            r = it['r'] * (1 - .45 * u)
            col = np.array((255, 225, 130), np.float32) * (1 - u) + np.array((232, 78, 28), np.float32) * u

            def fn(dx, dy, r=r, col=col, a=env * tw):
                d = np.hypot(dx, dy) / r
                yield .5 * a * np.exp(-.5 * (d / 2.0) ** 2), col
                yield a * (1 - np.clip((d - .55) / .6, 0, 1)), np.minimum(col + 60, 255)
            sc.stamp(out, x, y, r * 2, fn)


def make(cfg, scene, rng):
    return Fx(cfg, scene, rng)
