"""唐门：细长竹叶，窄长尖叶，打着旋飘落。"""
import math
import numpy as np


class Fx:
    def __init__(self, cfg, scene, rng):
        self.scene, self.cfg = scene, cfg
        n = int(cfg.get('count', 18))
        sx = cfg.get('spawn_x', [0, 230]); sy = cfg.get('spawn_y', [0, 120])
        self.items = []
        for i in range(n):
            self.items.append(dict(
                x0=float(rng.uniform(*sx)), y0=float(rng.uniform(*sy)), ph=float((i + rng.uniform(.1, .9)) / n),
                dx=float(rng.uniform(*cfg.get('drift', [160, 420]))), dy=float(rng.uniform(*cfg.get('fall', [520, 720]))),
                r=float(rng.uniform(*cfg.get('size', [7, 12]))), a=float(rng.uniform(0, math.tau)),
                spin=int(rng.choice([-2, -1, 1, 2])), sway=float(rng.uniform(10, 26)), tone=float(rng.uniform(0, 1))))
        rng.shuffle(self.items)

    def draw(self, out, t):
        cfg = self.cfg
        op = float(cfg.get('opacity', .92))
        c1, c2 = np.array(cfg['colors'][0], np.float32), np.array(cfg['colors'][1], np.float32)
        edge = np.array(cfg.get('edge', [34, 62, 40]), np.float32)
        rib = np.array(cfg.get('rib', [200, 225, 170]), np.float32)
        for it in self.items:
            u = (t + it['ph']) % 1.0
            env = math.sin(math.pi * u) ** .5
            x = it['x0'] + it['dx'] * u + it['sway'] * math.sin(math.tau * 2 * t + it['a'])
            y = it['y0'] + it['dy'] * u + 5 * math.sin(math.tau * 3 * t + it['a'] * 1.3)
            ang = it['a'] + it['spin'] * math.tau * t + .6 * math.sin(math.tau * t + it['a'])
            ca, sa = math.cos(ang), math.sin(ang)
            tumble = .35 + .65 * abs(math.cos(math.tau * it['spin'] * t * .5 + it['a']))
            r = it['r']
            col = c1 + (c2 - c1) * it['tone']

            def shape(dx, dy, r=r, ca=ca, sa=sa, tumble=tumble):
                u_ = (dx * ca + dy * sa) / r
                v_ = (-dx * sa + dy * ca) / r
                wmax = .2 * tumble
                half = wmax * np.clip(1 - np.abs(u_) ** 1.5, 0, 1)
                # 叶面向一边微弯
                v_ = v_ - .12 * u_ * u_ * tumble
                inside = 1 - np.clip((np.abs(v_) - half) / (.075) + 0, 0, 1)
                return inside * (np.abs(u_) < 1), u_, v_, half

            def fn(dx, dy, shape=shape, col=col, env=env):
                m, u_, v_, half = shape(dx, dy)
                m = m.astype(np.float32)
                big = 1 - np.clip((np.abs(v_) - half - .07) / .09, 0, 1)   # 比叶面略宽一圈的描边
                big = big * (np.abs(u_) < 1.07)
                yield .5 * op * env * big, edge
                yield op * env * m, col
                yield .55 * op * env * m * np.exp(-.5 * (v_ / .035) ** 2), rib
            self.scene.stamp(out, x, y, r * 1.4, fn)


def make(cfg, scene, rng):
    return Fx(cfg, scene, rng)
