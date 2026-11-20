# -*- coding: utf-8 -*-
"""七秀：粉色绸带，长长的正弦曲线、宽窄明暗变化，在湖面上方舞动飘过。"""
import math
import numpy as np


class Fx:
    def __init__(s, cfg, scene, rng):
        n = int(cfg.get('count', 3))
        s.L = float(cfg.get('length', 400))
        s.op = float(cfg.get('opacity', 0.85))
        s.dark = hexrgb(cfg.get('dark', '#e0527f'))
        s.light = hexrgb(cfg.get('light', '#ffc2d6'))
        s.edge = hexrgb(cfg.get('edge', '#b02f5c'))
        ys = cfg.get('y', [170, 255, 340])
        s.rb = []
        for j in range(n):
            s.rb.append(dict(ph=(j + 0.0) / n, y0=float(ys[j % len(ys)]), A=float(rng.uniform(26, 42)), k=float(rng.choice([1.5, 2.0, 2.5])),
                             m=int(rng.choice([1, 2])), f=float(rng.uniform(0, TAU)), A2=float(rng.uniform(8, 16)), k2=float(rng.choice([3.5, 4.5])),
                             m2=int(rng.choice([1, 2])), f2=float(rng.uniform(0, TAU)), hmax=float(rng.uniform(15, 22)),
                             kt=float(rng.choice([2.0, 3.0])), mt=int(rng.choice([1, 2])), ft=float(rng.uniform(0, TAU))))
        s.xs = np.arange(W, dtype=np.float32)
        s.ys = scene.yy[:, :1]

    def draw(s, out, t):
        for r in s.rb:
            xs0 = -s.L + (W + s.L) * ((t + r['ph']) % 1.0)
            u = (s.xs - xs0) / s.L
            inside = (u > 0) & (u < 1)
            if not inside.any(): continue
            uu = np.clip(u, 0, 1)
            env = np.clip(np.sin(np.pi * uu), 0, 1) ** 0.7
            yc = r['y0'] + r['A'] * env * np.sin(TAU * (r['k'] * uu - r['m'] * t) + r['f']) + r['A2'] * np.sin(TAU * (r['k2'] * uu + r['m2'] * t) + r['f2']) * env
            tw = np.sin(TAU * (r['kt'] * uu - r['mt'] * t) + r['ft'])
            h = r['hmax'] * env ** 0.8 * (0.28 + 0.72 * np.abs(tw)) + 0.8
            br = 0.5 + 0.5 * tw
            d = (h / 2 - np.abs(s.ys - yc[None, :]))
            a = np.clip(d + 0.5, 0, 1) * inside[None, :] * s.op * np.clip(env * 3, 0, 1)[None, :]
            sheen = np.clip(1 - np.abs(s.ys - yc[None, :] + h[None, :] * 0.18) / np.maximum(h[None, :] * 0.22, 0.8), 0, 1)
            bb = np.clip(br[None, :] * 0.8 + 0.3 * sheen, 0, 1)[:, :, None]
            col = s.dark + (s.light - s.dark) * bb
            rim = np.clip(1 - d / 1.6, 0, 1)[:, :, None] * 0.45
            col = col * (1 - rim) + s.edge * rim
            out += (col - out) * a[:, :, None]


def make(cfg, scene, rng):
    return Fx(cfg, scene, rng)
