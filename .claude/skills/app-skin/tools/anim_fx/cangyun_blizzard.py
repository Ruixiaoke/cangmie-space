"""苍云：横扫的暴风雪。斜向的短白线，风很大；和纯阳圆点雪花不同。"""
import math
import numpy as np


class Fx:
    def __init__(self, cfg, scene, rng):
        self.scene, self.cfg = scene, cfg
        n = int(cfg.get('count', 150))
        self.items = []
        for i in range(n):
            km = (2, 1) if rng.uniform() < .8 else (3, 1)
            # 位移 (W*k, H*m) 每循环，保证无缝
            far = rng.uniform() < .5
            self.items.append(dict(x0=float(rng.uniform(0, 512)), y0=float(rng.uniform(0, 768)), ph=float(rng.uniform(0, 1)),
                                   k=km[0], L=float(rng.uniform(*(cfg.get('far_len', [12, 22]) if far else cfg.get('near_len', [22, 44])))),
                                   w=float(rng.uniform(.5, .8) if far else rng.uniform(.8, 1.3)), a=float(rng.uniform(.45, .7) if far else rng.uniform(.7, 1.0)),
                                   jit=float(rng.uniform(0, math.tau))))

    def draw(self, out, t):
        cfg = self.cfg
        op = float(cfg.get('opacity', .85))
        col = np.array(cfg.get('color', [250, 252, 255]), np.float32)
        shade = np.array(cfg.get('shade', [100, 112, 135]), np.float32)
        sh_a = float(cfg.get('shade_alpha', .3))
        for it in self.items:
            u = (t + it['ph']) % 1.0
            D = np.array((512 * it['k'], 768.0))
            x = (it['x0'] + D[0] * u) % 512
            y = (it['y0'] + D[1] * u + 2.5 * math.sin(math.tau * 3 * t + it['jit'])) % 768
            n = D / np.hypot(*D)
            ca, sa = n[0], n[1]
            L, w, a = it['L'], it['w'], it['a'] * op

            def shape(dx, dy, L=L, w=w):
                al = dx * ca + dy * sa
                pe = -dx * sa + dy * ca
                ph = (al + L / 2) / L                       # 0 尾 -> 1 头
                m = (ph > 0) & (ph < 1)
                return np.exp(-.5 * (pe / w) ** 2) * np.clip(ph, 0, 1) ** 1.2 * m * np.clip((1 - ph) / .08, 0, 1)

            def fn(dx, dy, shape=shape, a=a):
                yield sh_a * a * shape(dx, dy - 1.6), shade
                yield a * shape(dx, dy), col
            self.scene.stamp(out, x, y, L * .5 + 3, fn)


def make(cfg, scene, rng):
    return Fx(cfg, scene, rng)
