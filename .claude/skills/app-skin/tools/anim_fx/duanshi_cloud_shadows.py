# -*- coding: utf-8 -*-
"""段氏：天空和山上缓缓飘过的云影（半透明的深色云影在画面上方移动）。
cfg: clouds [[y, x0, size, strength]], dir, color, opacity, ymax"""
import math
import numpy as np


class Shadows:
    def __init__(self, cfg, scene, rng):
        self.sc = scene
        self.col = hexrgb(cfg.get('color', '#4a5670'))
        self.op = float(cfg.get('opacity', .3))
        self.dir = int(cfg.get('dir', 1))
        self.clouds = []
        for y, x0, size, st in cfg['clouds']:
            blobs = [(float(rng.uniform(-1.1, 1.1)) * size, float(rng.uniform(-.35, .35)) * size * .6,
                      float(rng.uniform(.45, .85)) * size, float(rng.uniform(.6, 1))) for _ in range(6)]
            self.clouds.append((y, x0, size, st, blobs))
        self.fade = (1 - smooth((scene.yy - cfg.get('ymax', 330)) / 90)).astype(np.float32)

    def draw(self, out, t):
        sc = self.sc
        acc = np.zeros((H, W), np.float32)
        for y, x0, size, st, blobs in self.clouds:
            cx = x0 + self.dir * t * W
            dxb = ((sc.xx - cx + W / 2) % W) - W / 2
            for bx, by, br, bw in blobs:
                acc += st * bw * np.exp(-.5 * (((dxb - bx) / br) ** 2 + ((sc.yy - y - by) / (br * .55)) ** 2))
        a = (self.op * (1 - np.exp(-1.4 * acc)) * self.fade)[:, :, None]
        out += (self.col - out) * a


def make(cfg, scene, rng):
    return Shadows(cfg, scene, rng)
