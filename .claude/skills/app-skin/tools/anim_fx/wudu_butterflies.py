# -*- coding: utf-8 -*-
"""五毒：蝴蝶（蓝紫、银色），翅膀明显扇动，飞行路线是平滑的曲线。夜里发淡淡荧光。"""
import math
import numpy as np


class Fx:
    def __init__(s, cfg, scene, rng):
        s.scene = scene
        n = int(cfg.get('count', 12))
        s.op = float(cfg.get('opacity', 0.95))
        s.glow = float(cfg.get('glow', 0.0))
        s.glow_col = hexrgb(cfg.get('glow_color', '#9fe9ff'))
        s.pal = [tuple(hexrgb(c) for c in p) for p in cfg.get('palettes', [['#3d4fc4', '#8f7ff0', '#1f2470'], ['#8f9cc4', '#dbe3f6', '#464e7a']])]
        size = cfg.get('size', [13, 18])
        ys = cfg.get('y', [60, 620])
        s.items = []
        for i in range(n):
            s.items.append(dict(
                k=int(rng.choice([-1, 1, 1])), x0=float(rng.uniform(0, W)), y0=float(rng.uniform(*ys)),
                A=float(rng.uniform(25, 60)), fa=int(rng.choice([2, 3, 4])), pa=float(rng.uniform(0, TAU)),
                A2=float(rng.uniform(8, 18)), fb=int(rng.choice([5, 7])), pb=float(rng.uniform(0, TAU)),
                S=float(rng.uniform(*size)), flaps=int(rng.choice([5, 6, 7])), pf=float(rng.uniform(0, 3)),
                pal=s.pal[i % len(s.pal)]))

    def pos(s, it, t):
        x = it['x0'] + it['k'] * W * t
        y = it['y0'] + it['A'] * math.sin(TAU * it['fa'] * t + it['pa']) + it['A2'] * math.sin(TAU * it['fb'] * t + it['pb'])
        return x, y

    def draw(s, out, t):
        for it in s.items:
            x, y = s.pos(it, t)
            x2, y2 = s.pos(it, t + 0.004)
            hd = math.atan2(y2 - y, (x2 - x) if abs(x2 - x) > 1e-6 else it['k'])
            flap = 0.18 + 0.82 * abs(math.cos(math.pi * (it['flaps'] * t + it['pf'])))
            s.scene.stamp(out, x % W, y, it['S'] * 1.8, s.fly(it, hd, flap))

    def fly(s, it, hd, flap):
        S = it['S']
        body, wing_a, wing_b = it['pal'][0], it['pal'][1], it['pal'][2]
        ca, sa = math.cos(hd), math.sin(hd)
        op, G = s.op, s.glow
        night = G > 0

        def ell(U, V, cu, cv, au, av, rot):
            c, sn = math.cos(rot), math.sin(rot)
            a = (U - cu) * c + (V - cv) * sn
            b = -(U - cu) * sn + (V - cv) * c
            return (1 - np.hypot(a / au, b / av))  # >0 inside (approx), scaled later

        def fn(dx, dy):
            u = (dx * ca + dy * sa) / S
            v = (-dx * sa + dy * ca)
            V = np.abs(v) / (S * flap)
            fw = ell(u, V, 0.2, 0.62, 0.62, 0.68, -0.6)      # 前翅：长而尖
            hw = ell(u, V, -0.42, 0.44, 0.38, 0.42, 0.35)    # 后翅：圆
            m = np.maximum(fw, hw)
            ink = m * S * 0.55 * (0.35 + flap)               # 到翅缘的大致像素距离
            a = np.clip(ink + 0.5, 0, 1)
            r = np.hypot(u, V)
            col = body + (wing_a - body) * np.clip(r * 1.2, 0, 1)[:, :, None]
            if night:
                col = np.minimum(col * 0.62 + s.glow_col * 0.28, 255)
            veins = (0.5 + 0.5 * np.cos(np.arctan2(V, u + 0.1) * 14))[:, :, None] * 0.16
            col = col * (1 - veins) + wing_b * veins
            band = np.clip(1 - ink / 2.6, 0, 1)[:, :, None] * 0.75       # 深色翅缘
            edge_c = wing_b if not night else s.glow_col * 0.85 + 25
            col = col * (1 - band) + edge_c * band
            spot = (np.exp(-((u - 0.4) ** 2 + (V - 0.72) ** 2) / 0.01) + np.exp(-((u + 0.38) ** 2 + (V - 0.62) ** 2) / 0.008))[:, :, None] * 0.6
            col = col * (1 - np.clip(spot, 0, 1)) + np.array((245, 248, 255), np.float32) * np.clip(spot, 0, 1)
            if night:
                halo = np.exp(-0.5 * (np.hypot(dx, dy) / (S * 1.0)) ** 2) * G * 0.4
                yield halo, s.glow_col
            yield a * op, col
            body_a = np.clip(1.1 - np.abs(v) / 0.9 - np.clip(np.abs(u) - 0.5, 0, 9) * S * 0.9, 0, 1) * (np.abs(u) < 0.62)
            yield body_a * 0.95, (wing_b if not night else s.glow_col * 0.9)
            ant = np.clip(0.7 - np.abs(np.abs(v) - np.clip((u - 0.55) * S * 0.9, 0, 9)), 0, 1) * ((u > 0.55) & (u < 1.1))
            yield ant * 0.8, (wing_b if not night else s.glow_col)
        return fn


def make(cfg, scene, rng):
    return Fx(cfg, scene, rng)
