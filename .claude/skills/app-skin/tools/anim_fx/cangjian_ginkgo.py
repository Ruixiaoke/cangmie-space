# -*- coding: utf-8 -*-
"""藏剑：金黄的扇形银杏叶（有叶柄、中间有缺口、放射叶脉）缓缓旋落，西湖边山庄的秋色。"""
import math
import numpy as np


class Fx:
    def __init__(s, cfg, scene, rng):
        s.scene = scene
        n = int(cfg.get('count', 22))
        s.op = float(cfg.get('opacity', 0.95))
        s.size = cfg.get('size', [9, 15])
        s.sway = float(cfg.get('sway', 16))
        s.cols = [(hexrgb(a), hexrgb(b), hexrgb(c)) for a, b, c in cfg.get('colors', [['#c9861a', '#f2c230', '#8d5a0c']])]
        ph = (np.arange(n) + rng.uniform(0.2, 0.8, n)) / n
        rng.shuffle(ph)
        s.items = []
        for p in ph:
            s.items.append(dict(
                ph=float(p), speed=int(rng.choice([1, 1, 2]) if cfg.get('fast', True) else 1),
                x0=float(W * rng.beta(1.4, 1.8)), R=float(rng.uniform(*s.size)),
                a0=float(rng.uniform(0, TAU)), swing=float(rng.uniform(0.5, 1.1)), m=int(rng.integers(1, 3)),
                b=float(rng.uniform(0, TAU)), spin=int(rng.choice([-1, 1])), fx=int(rng.integers(1, 3)),
                m2=int(rng.integers(1, 3)), c=float(rng.uniform(0, TAU)), col=s.cols[int(rng.integers(len(s.cols)))]))

    def leaf(s, it, rot, tumble):
        R, op = it['R'], s.op
        base, tip, edge = it['col']
        ca, sa = math.cos(rot), math.sin(rot)
        A = math.radians(70)

        def fn(dx, dy):
            pu = dx * ca + dy * sa
            pv = (-dx * sa + dy * ca) / tumble
            r = np.hypot(pu, pv)
            ang = np.arctan2(pv, pu)
            er = R * (1 - 0.16 * np.exp(-(ang / 0.13) ** 2) + 0.045 * np.cos(ang * 9))
            sdf = np.minimum(er - r, (A - np.abs(ang)) * r)
            a = np.clip(sdf + 0.5, 0, 1)
            a = np.where(r < 0.5, 0, a)
            # 叶柄
            stem = np.clip(0.55 - np.abs(pv * tumble), 0, 1) * ((pu < 1.2) & (pu > -R * 0.6))
            a = np.maximum(a, stem * 0.9)
            k = np.clip(r / R, 0, 1)[:, :, None]
            vein = (0.5 + 0.5 * np.cos(ang * 13))[:, :, None] * 0.18
            col = base + (tip - base) * k
            col = col * (1 - vein) + edge * vein
            rim = np.clip(1 - sdf / 1.6, 0, 1)[:, :, None] * 0.55
            col = col * (1 - rim) + edge * rim
            col = np.where(((pu < 0.8) & (a > 0))[:, :, None] & (r < R * 0.2)[:, :, None] | (r > R * 2)[:, :, None], edge, col)
            yield a * op, col
        return fn

    def draw(s, out, t):
        pad = 22
        for it in s.items:
            u = (it['speed'] * t + it['ph']) % 1.0
            y = -pad + u * (H + 2 * pad)
            x = (it['x0'] + s.sway * math.sin(TAU * it['fx'] * t + it['b']) + 0.3 * s.sway * math.sin(TAU * 2 * t + it['c'])) % W
            rot = it['a0'] + it['swing'] * math.sin(TAU * it['m'] * t + it['b']) + it['spin'] * TAU * t
            tumble = 0.4 + 0.6 * abs(math.cos(TAU * it['m2'] * t + it['c'] + 0.7))
            s.scene.stamp(out, x, y, it['R'] * 1.7, s.leaf(it, rot, tumble))


def make(cfg, scene, rng):
    return Fx(cfg, scene, rng)
