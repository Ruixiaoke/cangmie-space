"""唐门：竹海里一层流动的薄雾（只有唐门用雾）。每条雾带横向缓缓流过，周期是整数倍。"""
import math
import numpy as np


class Fx:
    def __init__(self, cfg, scene, rng):
        self.scene = scene
        self.bands = []
        for b in cfg['bands']:
            k = int(b.get('repeat', 2))
            P = W / k
            sc_, npf = float(cfg.get('scale', 1)), int(cfg.get('puffs', 6))
            puffs = [(float((j + rng.uniform(-.3, .3)) * P / npf), float(rng.uniform(-14, 14)) * sc_, float(rng.uniform(22, 48)) * sc_, float(rng.uniform(.5, 1.1))) for j in range(npf)]
            self.bands.append((b, P, puffs))

    def draw(self, out, t):
        sc = self.scene
        for b, P, puffs in self.bands:
            cy, sp = b['y'], b.get('spread', 24)
            y0, y1 = int(max(0, cy - sp * 4 - 20)), int(min(H, cy + sp * 4 + 20))
            X, Y = sc.xx[y0:y1], sc.yy[y0:y1]
            cloud = np.zeros_like(X)
            for px, dy, sx, w in puffs:
                for off in (-P, 0, P):
                    dx = ((X - b.get('dir', 1) * t * P - px - off + P / 2) % P) - P / 2 + off * 0
                    cloud += w * np.exp(-.5 * ((dx / sx) ** 2 + ((Y - cy - dy) / sp) ** 2)) * (1 if off == 0 else 0)
            a = (b.get('opacity', .3) * (1 - np.exp(-1.4 * cloud)))[:, :, None]
            col = np.array(b['color'], np.float32)
            patch = out[y0:y1]
            patch += (col - patch) * a


def make(cfg, scene, rng):
    return Fx(cfg, scene, rng)
