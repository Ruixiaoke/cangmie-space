# -*- coding: utf-8 -*-
"""万灵：从树冠斜照下来的光束，缓慢扫动（白天暖白，夜里淡月光）。
cfg: beams [[x_at_top, width, strength]], slant (每向下 1px 往右偏多少px), length, color, opacity, sweep,
横屏可调：fade_in (顶部淡入高度，默认 40)，widen (光束每下行 widen px 变宽一倍，默认 500)"""
import math
import numpy as np


class Shafts:
    def __init__(self, cfg, scene, rng):
        self.sc = scene
        self.beams = cfg['beams']
        self.slant = float(cfg.get('slant', .32))
        self.length = float(cfg.get('length', 480))
        self.col = hexrgb(cfg.get('color', '#fff2cc'))
        self.op = float(cfg.get('opacity', .3))
        self.sweep = float(cfg.get('sweep', 26))
        self.fall = np.clip(1 - (scene.yy / self.length), 0, 1) ** 1.3 * smooth(scene.yy / float(cfg.get('fade_in', 40)))
        self.widen = float(cfg.get('widen', 500))
        self.ph = [float(rng.uniform(0, math.tau)) for _ in self.beams]

    def draw(self, out, t):
        sc = self.sc
        acc = np.zeros((H, W), np.float32)
        for (x0, wd, st), ph in zip(self.beams, self.ph):
            x = x0 + self.sweep * math.sin(math.tau * t + ph)
            w = wd * (1 + .25 * math.sin(math.tau * t + ph * 1.7))
            d = sc.xx - x - self.slant * sc.yy
            w2 = w * (1 + sc.yy / self.widen)  # 越往下越宽
            acc += st * (.75 + .25 * math.sin(math.tau * 2 * t + ph * 2.3)) * np.exp(-.5 * (d / w2) ** 2)
        a = np.clip(self.op * acc * self.fall, 0, .85)[:, :, None]
        out += (self.col - out) * a


def make(cfg, scene, rng):
    return Shafts(cfg, scene, rng)
