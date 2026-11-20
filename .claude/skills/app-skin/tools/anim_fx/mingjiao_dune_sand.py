"""明教（白天）：被风吹过沙丘的细沙流。贴着地面、成片的沙粒流线，一阵一阵地涌。"""
import math
import numpy as np


class Fx:
    def __init__(self, cfg, scene, rng):
        self.scene, self.cfg = scene, cfg
        y0, y1 = cfg.get('y_range', [300, 760])
        ns, ng = int(cfg.get('streams', 18)), int(cfg.get('grains', 16))
        self.streams = []
        for i in range(ns):
            yb = float(y0 + (y1 - y0) * rng.uniform(0, 1) ** .85)
            gr = []
            for j in range(ng):
                gr.append((float((j + rng.uniform(.1, .9)) / ng), float(rng.uniform(8, 20)), float(rng.uniform(.6, 1.0)), float(rng.uniform(0, 1)), float(rng.uniform(-1.6, 1.6))))
            self.streams.append(dict(y=yb, amp=float(rng.uniform(3, 10)), f=int(rng.choice([1, 2])), ph=float(rng.uniform(0, math.tau)),
                                     sp=int(rng.choice([1, 1, 1, 2])), gph=float(rng.uniform(0, math.tau)), grains=gr))

    def draw(self, out, t):
        cfg = self.cfg
        op = float(cfg.get('opacity', .85))
        lite = np.array(cfg.get('light', [255, 238, 205]), np.float32)
        dark = np.array(cfg.get('dark', [205, 150, 90]), np.float32)
        for s in self.streams:
            for pos, ln, br, tone, jy in s['grains']:
                x = (pos * 512 + 512 * s['sp'] * t) % 512
                y = s['y'] + s['amp'] * math.sin(math.tau * s['f'] * x / 512 + s['ph']) + jy * math.sin(math.tau * 2 * t + pos * 20)
                gust = .05 + .95 * (.5 + .5 * math.sin(math.tau * (2 * x / 512 - t * 1) + s['gph'])) ** 2.5
                a = op * br * gust * (.8 if tone <= .45 else 1.0)
                if a < .04: continue
                col = lite if tone > .45 else dark
                L = ln * (1 + .5 * (s['sp'] - 1))

                def fn(dx, dy, L=L, a=a, col=col):
                    al = np.clip(-dx / L, 0, 1)            # 头在右，尾向左拖
                    body = np.exp(-.5 * (dy / .9) ** 2) * (1 - al) ** 1.3 * np.exp(-.5 * (np.maximum(dx, 0) / .9) ** 2) * (dx > -L)
                    wl = np.clip(-dx / (L * 3.2), 0, 1)
                    yield a * .16 * np.exp(-.5 * (dy / 1.8) ** 2) * (1 - wl) ** 1.5 * np.exp(-.5 * (np.maximum(dx, 0) / .9) ** 2) * (dx > -L * 3.2), col
                    yield a * .35 * np.exp(-.5 * (dy / 2.2) ** 2) * (1 - al) * np.exp(-.5 * (np.maximum(dx, 0) / .9) ** 2) * (dx > -L), col
                    yield a * body, col
                self.scene.stamp(out, x, y, L * 1.2 + 4, fn)


def make(cfg, scene, rng):
    return Fx(cfg, scene, rng)
