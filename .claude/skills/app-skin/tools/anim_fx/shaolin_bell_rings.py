# -*- coding: utf-8 -*-
"""少林：钟声。从画中钟亭的位置周期性荡开的细线圆环，逐渐扩大、变淡。"""
import math
import numpy as np


class Fx:
    def __init__(s, cfg, scene, rng):
        s.cx, s.cy = cfg['x'], cfg['y']
        s.rmax = float(cfg.get('radius', 230))
        s.tolls = int(cfg.get('tolls', 2))
        s.rings = int(cfg.get('rings', 3))
        s.gap = float(cfg.get('gap', 0.055))
        s.life = float(cfg.get('life', 0.42))
        s.op = float(cfg.get('opacity', 0.7))
        s.col = hexrgb(cfg.get('color', '#d9a21e'))
        s.flat = float(cfg.get('flat', 0.82))
        s.w = float(cfg.get('width', 1.1))
        yy, xx = scene.yy, scene.xx
        s.dist = np.hypot(xx - s.cx, (yy - s.cy) / s.flat).astype(np.float32)
        s.ang = np.arctan2(yy - s.cy, xx - s.cx).astype(np.float32)

    def draw(s, out, t):
        alpha = np.zeros((H, W), np.float32)
        for k in range(s.tolls):
            for j in range(s.rings):
                age = ((t * 1.0 - k / s.tolls - j * s.gap) % 1.0) / s.life
                if age >= 1: continue
                e = 1 - (1 - age) ** 2.2
                r = 6 + (s.rmax - 6) * e
                fade = (1 - age) ** 1.4 * smooth(age * 14) * (1 - 0.3 * j)
                # 圆环略有断续的质感
                wob = 1 + 0.18 * np.sin(s.ang * 5 + k * 2 + j)
                ring = np.exp(-0.5 * ((s.dist - r) / s.w) ** 2)
                alpha += ring * fade * wob
        # 钟本身在敲响时微微一亮
        for k in range(s.tolls):
            age = ((t - k / s.tolls) % 1.0) / 0.12
            if age < 1:
                g = np.exp(-0.5 * ((s.dist / 1.0) / 9.0) ** 2) * (1 - age) * 0.55
                alpha += g
        alpha = np.clip(alpha * s.op, 0, 0.9)[:, :, None]
        out += (s.col - out) * alpha


def make(cfg, scene, rng):
    return Fx(cfg, scene, rng)
