# -*- coding: utf-8 -*-
"""七秀：桃花瓣（单片、水滴形、顶端微凹）缓缓飘落。只有七秀用桃花瓣。"""
import math
import numpy as np


class Fx:
    def __init__(s, cfg, scene, rng):
        s.scene = scene
        n = int(cfg.get('count', 14))
        s.op = float(cfg.get('opacity', 0.95))
        s.sway = float(cfg.get('sway', 18))
        s.base = hexrgb(cfg.get('base', '#f08aa8'))
        s.tip = hexrgb(cfg.get('tip', '#fcd0dc'))
        s.edge = hexrgb(cfg.get('edge', '#c8567a'))
        size = cfg.get('size', [9, 14])
        s.pad = float(cfg.get('pad', 20))  # 横屏：花瓣大，出入画面的余量要加大
        ph = (np.arange(n) + rng.uniform(0.2, 0.8, n)) / n
        rng.shuffle(ph)
        s.items = [dict(ph=float(p), speed=int(rng.choice([1, 1, 2])), x0=float(W * rng.beta(1.2, 1.5)), L=float(rng.uniform(*size)),
                        a0=float(rng.uniform(0, TAU)), spin=int(rng.choice([-2, -1, 1, 2])), fx=int(rng.integers(1, 3)),
                        b=float(rng.uniform(0, TAU)), m2=int(rng.integers(1, 3))) for p in ph]

    def petal(s, it, rot, tumble):
        L, op = it['L'], s.op
        ca, sa = math.cos(rot), math.sin(rot)

        def fn(dx, dy):
            uu = (dx * ca + dy * sa) / L + 0.5
            vv = (-dx * sa + dy * ca) / (L * tumble)
            uc = np.clip(uu, 0, 1)
            w = 0.5 * np.clip(np.sin(np.pi * uc ** 0.7), 0, 1) ** 0.85
            notch = 0.05 * np.exp(-(vv / 0.07) ** 2) * (uc > 0.8)
            sdf = np.minimum((w - np.abs(vv)) * L * tumble, np.minimum(uu, 1 - uu - notch) * L)
            a = np.clip(sdf + 0.5, 0, 1)
            k = np.clip(uc, 0, 1)[:, :, None]
            col = s.base + (s.tip - s.base) * k
            rim = np.clip(1 - sdf / 1.5, 0, 1)[:, :, None] * 0.5
            col = col * (1 - rim) + s.edge * rim
            yield a * op, col
        return fn

    def draw(s, out, t):
        pad = s.pad
        for it in s.items:
            u = (it['speed'] * t + it['ph']) % 1.0
            y = -pad + u * (H + 2 * pad)
            x = (it['x0'] + s.sway * math.sin(TAU * it['fx'] * t + it['b'])) % W
            rot = it['a0'] + it['spin'] * TAU * t
            tumble = 0.45 + 0.55 * abs(math.cos(TAU * it['m2'] * t + it['b']))
            s.scene.stamp(out, x, y, it['L'] * 1.1, s.petal(it, rot, tumble))


def make(cfg, scene, rng):
    return Fx(cfg, scene, rng)
