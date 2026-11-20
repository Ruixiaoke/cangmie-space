# -*- coding: utf-8 -*-
"""少林：菩提叶（心形叶身、叶基小凹口、细长的滴水尖、一条主脉）翻转着缓缓飘落。"""
import math
import numpy as np


class Fx:
    def __init__(s, cfg, scene, rng):
        s.scene = scene
        n = int(cfg.get('count', 16))
        s.op = float(cfg.get('opacity', 0.92))
        s.size = cfg.get('size', [10, 16])  # 叶身长度的一半（像素）
        s.sway = float(cfg.get('sway', 18))
        s.cols = [(hexrgb(a), hexrgb(b), hexrgb(c)) for a, b, c in cfg.get('colors', [['#8fa83e', '#c9c45a', '#4f5e1e']])]
        ph = (np.arange(n) + rng.uniform(0.2, 0.8, n)) / n
        rng.shuffle(ph)
        s.items = []
        for p in ph:
            s.items.append(dict(
                ph=float(p), speed=int(rng.choice([1, 1, 2])), x0=float(W * rng.beta(1.5, 1.5)), R=float(rng.uniform(*s.size)),
                a0=float(rng.uniform(0, TAU)), swing=float(rng.uniform(0.6, 1.2)), m=int(rng.integers(1, 3)),
                b=float(rng.uniform(0, TAU)), fx=int(rng.integers(1, 3)), m2=int(rng.integers(1, 3)),
                c=float(rng.uniform(0, TAU)), col=s.cols[int(rng.integers(len(s.cols)))]))

    def leaf(s, it, rot, tumble):
        R, op = it['R'], s.op
        base, tip, edge = it['col']
        ca, sa = math.cos(rot), math.sin(rot)

        def fn(dx, dy):
            # 叶片坐标：u 沿主脉（叶基在 u=-R，叶尖在 u=+R，滴水尖再伸出 0.9R），v 是横向；tumble 压扁模拟翻面
            u = dx * ca + dy * sa
            v = (-dx * sa + dy * ca) / tumble
            # 心形叶身：以 u=-0.1R 为中心的椭圆，越靠叶尖越窄
            un = (u + 0.1 * R) / R
            half_w = 0.78 * R * np.sqrt(np.clip(1 - un * un, 0, 1)) * (1 - 0.35 * np.clip(un, 0, 1))
            body = np.where(np.abs(un) <= 1, half_w - np.abs(v), -9)  # 叶身范围外截断，否则沿主脉会拖出一条细线
            # 滴水尖：从 u=0.6R 到 u=1.9R 逐渐收细的长尖
            tt = (u - 0.6 * R) / (1.3 * R)
            tip_w = 0.2 * R * (1 - np.clip(tt, 0, 1)) ** 1.6
            tail = np.where((tt >= 0) & (tt <= 1), tip_w - np.abs(v), -9)
            sdf = np.maximum(body, tail)
            # 叶基的心形凹口
            notch = np.hypot(u + 1.15 * R, v) - 0.32 * R
            sdf = np.minimum(sdf, notch)
            a = np.clip(sdf + 0.6, 0, 1)
            # 叶柄
            stem = np.clip(0.6 - np.abs(v * tumble), 0, 1) * ((u < -0.95 * R) & (u > -1.55 * R))
            a = np.maximum(a, stem * 0.9)
            k = np.clip((u + R) / (2.9 * R), 0, 1)[:, :, None]
            col = base + (tip - base) * k
            mid = np.clip(1 - np.abs(v) / 0.7, 0, 1)[:, :, None] * 0.45 * (u > -R)[:, :, None]
            col = col * (1 - mid) + edge * mid
            rim = np.clip(1 - sdf / 1.4, 0, 1)[:, :, None] * 0.5
            col = col * (1 - rim) + edge * rim
            yield a * op, col
        return fn

    def draw(s, out, t):
        pad = 30
        for it in s.items:
            u = (it['speed'] * t + it['ph']) % 1.0
            y = -pad + u * (H + 2 * pad)
            x = (it['x0'] + s.sway * math.sin(TAU * it['fx'] * t + it['b']) + 0.3 * s.sway * math.sin(TAU * 2 * t + it['c'])) % W
            rot = it['a0'] + it['swing'] * math.sin(TAU * it['m'] * t + it['b']) + math.pi / 2
            tumble = 0.35 + 0.65 * abs(math.cos(TAU * it['m2'] * t + it['c'] + 0.7))
            s.scene.stamp(out, x, y, it['R'] * 2.1, s.leaf(it, rot, tumble))


def make(cfg, scene, rng):
    return Fx(cfg, scene, rng)
