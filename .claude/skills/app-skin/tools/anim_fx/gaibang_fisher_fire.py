"""丐帮（夜）：湖上渔船的渔火，火光闪动，水面的倒影轻轻晃。"""
import math
import numpy as np


class Fx:
    def __init__(self, cfg, scene, rng):
        self.scene, self.cfg = scene, cfg
        self.boats = cfg['boats']          # [{"x":,"y":,"s":,"hull":true/false}]

    def draw(self, out, t):
        sc = self.scene
        T = math.tau
        for k, b in enumerate(self.boats):
            x, y, s = b['x'], b['y'], b.get('s', 1.0)
            fl = 1 + .16 * math.sin(T * 3 * t + k) + .09 * math.sin(T * 5 * t + 1.7 * k) + .05 * math.sin(T * 8 * t + k)
            if b.get('hull'):
                def hull(dx, dy, s=s):
                    a = np.clip(1 - (np.abs(dx) / (9 * s)) ** 2.2 - (np.abs(dy - 3 * s) / (1.8 * s)) ** 2, 0, 1)
                    yield np.clip(a * 3, 0, 1) * .9, np.array((22, 26, 24), np.float32)
                sc.stamp(out, x, y + 3 * s, 12 * s, hull)
            orange, gold = np.array((255, 140, 45), np.float32), np.array((255, 228, 150), np.float32)

            def fire(dx, dy, s=s, fl=fl):
                d = np.hypot(dx, dy * 1.05)
                yield .36 * fl * np.exp(-.5 * (d / (7 * s)) ** 2), orange
                yield .2 * fl * np.exp(-.5 * (d / (22 * s)) ** 2), orange
                yield np.clip(fl * (1 - (np.clip(d / (2.2 * s) - .3, 0, 1) ** 2)), 0, 1) * .95 * (d < 3.2 * s), gold
            sc.stamp(out, x, y, 30 * s, fire)
            # 倒影：一串变窄变淡的横条，左右轻晃
            w0 = self.cfg.get('reflect', 11)
            for i in range(w0):
                yy = y + 8 * s + i * 5.5 * s
                sway = 2.6 * s * math.sin(T * 2 * t + i * .8 + k) * (.4 + i / w0)
                wid = (3.2 + .45 * i) * s
                alpha = .55 * (1 - i / (w0 + 1)) * fl * (.7 + .3 * math.sin(T * 3 * t + i * 1.3))

                def refl(dx, dy, wid=wid, alpha=alpha, sway=sway, yy=yy, y=y):
                    yield alpha * np.exp(-.5 * ((dx - sway) / wid) ** 2) * np.exp(-.5 * ((dy) / 1.0) ** 2), orange
                sc.stamp(out, x, yy, wid * 3.2 + 4, refl)


def make(cfg, scene, rng):
    return Fx(cfg, scene, rng)
