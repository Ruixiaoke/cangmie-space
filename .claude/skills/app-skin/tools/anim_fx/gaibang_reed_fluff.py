"""丐帮：芦花絮。蓬松的白色种絮带细丝，被风横着吹过湖面，轻轻上下浮动。"""
import math
import numpy as np


class Fx:
    def __init__(self, cfg, scene, rng):
        self.scene, self.cfg = scene, cfg
        n = int(cfg.get('count', 22))
        y0, y1 = cfg.get('y_range', [150, 560])
        self.items = []
        for i in range(n):
            self.items.append(dict(
                x0=float(rng.uniform(-60, 512)),
                y=float(rng.uniform(y0, y1)), ph=float((i + rng.uniform(.1, .9)) / n),
                r=float(rng.uniform(*cfg.get('size', [2.0, 3.2]))), a=float(rng.uniform(0, math.tau)),
                bob=float(rng.uniform(4, 9)), k=int(rng.choice([1, 2])),
                dist=float(rng.uniform(.45, .8)) * 512, rot=float(rng.uniform(-.5, .5)),
                strands=[(float(rng.uniform(-1.6, 1.6)), float(rng.uniform(2.6, 4.2))) for _ in range(11)]))
        rng.shuffle(self.items)

    def draw(self, out, t):
        cfg = self.cfg
        op = float(cfg.get('opacity', .9))
        col = np.array(cfg.get('color', [248, 248, 240]), np.float32)
        shade = np.array(cfg.get('shade', [95, 112, 100]), np.float32)
        for it in self.items:
            u = (t + it['ph']) % 1.0
            env = math.sin(math.pi * u) ** .6
            x = it['x0'] + it['dist'] * u
            y = it['y'] + it['bob'] * math.sin(math.tau * it['k'] * t + it['a'])
            wob = it['rot'] + .35 * math.sin(math.tau * t + it['a'])
            r = it['r']

            def shape(dx, dy, r=r, wob=wob, fib=it['strands'], tt=t, ph=it['a']):
                c, s_ = math.cos(wob), math.sin(wob)
                u = -(dx * c + dy * s_)           # 向后（风来的方向，左）为正
                v = -dx * s_ + dy * c
                # 种子：小而长的椭圆，略斜
                seed = 1 - smooth_(((u / (r * 1.35)) ** 2 + (v / (r * .5)) ** 2 - .7) / .5)
                a = seed
                flut = math.sin(math.tau * tt + ph)
                for k, (ang, ln) in enumerate(fib):
                    L = ln * r * 1.9
                    uu = u - r * .9
                    curv = (.5 + .35 * flut) * (1 if ang > 0 else -1) * .8 + .15 * flut
                    vc = ang * .22 * uu + curv * uu * uu / L * .45
                    s = np.exp(-.5 * ((v - vc) / np.maximum(.5 + .02 * uu, .3)) ** 2) * np.clip(uu / 1.5, 0, 1) * np.clip(1 - uu / L, 0, 1) ** 1.3
                    a = np.maximum(a, .8 * s)
                cone = np.exp(-.5 * (v / (.9 * r + .18 * np.maximum(u, 0))) ** 2) * np.clip(u / (r * 1.2), 0, 1) * np.clip(1 - u / (r * 6.5), 0, 1)
                return np.maximum(a, .24 * cone)

            def fn(dx, dy, shape=shape, env=env):
                yield .22 * op * env * shape(dx, dy - 1.4), shade
                yield op * env * shape(dx, dy), col
            self.scene.stamp(out, x, y, r * 9, fn)


def smooth_(x):
    x = np.clip(x, 0, 1)
    return 1 - x * x * (3 - 2 * x) if False else x * x * (3 - 2 * x)


def self_smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def make(cfg, scene, rng):
    return Fx(cfg, scene, rng)
