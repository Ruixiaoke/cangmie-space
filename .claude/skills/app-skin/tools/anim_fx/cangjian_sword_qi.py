"""藏剑：斜扫过画面的金色剑气。细长的金色光弧，从一端亮起扫到另一端后消散。"""
import math
import numpy as np


class Fx:
    def __init__(self, cfg, scene, rng):
        self.scene, self.cfg = scene, cfg
        self.qis = []
        for q in cfg['arcs']:   # {"p0":[x,y],"p1":[x,y],"bow":px,"start":0-1,"dur":0-1}
            p0, p1 = np.array(q['p0'], float), np.array(q['p1'], float)
            c = np.linalg.norm(p1 - p0)
            h = float(q.get('bow', 40))
            R = (c * c / 4 + h * h) / (2 * h)
            m = (p0 + p1) / 2
            d = (p1 - p0) / c
            n = np.array([d[1], -d[0]])
            C = m + n * (h - R)
            a0 = math.atan2(p0[1] - C[1], p0[0] - C[0])
            a1 = math.atan2(p1[1] - C[1], p1[0] - C[0])
            da = (a1 - a0 + math.pi) % math.tau - math.pi
            self.qis.append(dict(C=C, R=R, a0=a0, da=da, start=q['start'], dur=q.get('dur', .3), w=q.get('w', 1.5), tail=q.get('tail', .4)))

    def draw(self, out, t):
        sc = self.scene
        gold = np.array(self.cfg.get('color', [255, 214, 110]), np.float32)
        amber = np.array(self.cfg.get('edge', [196, 128, 30]), np.float32)
        hot = np.array([255, 246, 214], np.float32)
        gain = float(self.cfg.get('gain', 1.0))
        for q in self.qis:
            life = ((t - q['start']) % 1.0) / q['dur']
            if life >= 1: continue
            sweep = q.get('sweep', .17)
            head = min(life / sweep, 1.0)                       # 扫出去：约 0.3 秒
            tailp = max(0.0, (life - sweep * 1.4) / (1 - sweep * 1.4))   # 之后从尾端开始消
            C, R = q['C'], q['R']
            span = abs(q['da']) * R
            pts = [C + R * np.array([math.cos(q['a0'] + q['da'] * f), math.sin(q['a0'] + q['da'] * f)]) for f in np.linspace(0, 1, 9)]
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            x0, x1 = int(max(0, min(xs) - 40)), int(min(512, max(xs) + 40))
            y0, y1 = int(max(0, min(ys) - 40)), int(min(768, max(ys) + 40))
            if x0 >= x1 or y0 >= y1: continue
            X, Y = sc.xx[y0:y1, x0:x1], sc.yy[y0:y1, x0:x1]
            dist = np.abs(np.hypot(X - C[0], Y - C[1]) - R)
            rel = (np.arctan2(Y - C[1], X - C[0]) - q['a0'] + math.pi) % math.tau - math.pi
            p = rel / q['da']
            ok = (p > 0) & (p < 1)
            pc = np.clip(p, 0, 1)
            prof = np.sin(math.pi * pc) ** .9                    # 两头尖、中间最宽的月牙
            soft = .035
            vis = np.clip((head - p) / soft, 0, 1) * np.clip((p - tailp) / (soft + .12 * tailp), 0, 1) * ok
            vis = vis * (1 - .0 * tailp)
            w = np.maximum(q['w'] * prof, .15)
            core = np.exp(-.5 * (dist / (w * .45)) ** 2) * vis
            body = np.exp(-.5 * (dist / w) ** 2) * vis
            edge = np.exp(-.5 * (dist / (w * 2.4)) ** 2) * vis * prof
            patch = out[y0:y1, x0:x1]
            for a_, col in ((.22 * edge * gain, gold), (.6 * edge * gain, amber), (np.clip(body * 1.1, 0, 1) * gain, gold), (np.clip(core * 1.2, 0, 1) * gain, hot)):
                patch += (col - patch) * np.clip(a_, 0, 1)[:, :, None]


def sc_smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def make(cfg, scene, rng):
    return Fx(cfg, scene, rng)
