# -*- coding: utf-8 -*-
"""天策：一条条斜向卷过画面的风沙带（半透明、有颗粒感，从左到右流动）。"""
import math
import numpy as np


class Fx:
    def __init__(s, cfg, scene, rng):
        s.step = int(cfg.get('step', 6)); s.P = 44 * s.step
        P = s.P
        g = rng.random((H, P)).astype(np.float32)
        acc = g.copy()
        nb = int(cfg.get('grain_len', 7))  # 颗粒沿风向的拉伸长度（横屏大画面要更长）
        for k in range(1, nb): acc += np.roll(g, k, axis=1)
        acc /= nb
        acc = (acc - acc.mean()) / (acc.std() + 1e-6)
        s.grain = np.clip(0.55 + float(cfg.get('contrast', 0.22)) * acc + 0.0, 0, 1.4).astype(np.float32)
        s.xi = np.arange(W)[None, :].repeat(H, 0)
        s.yi = np.arange(H)[:, None].repeat(W, 1)
        s.lanes = []
        n = int(cfg.get('lanes', 7))
        cols = [hexrgb(c) for c in cfg.get('colors', ['#b98a52', '#a97a46'])]
        ys = cfg.get('y_range', [200, 760])
        slope = cfg.get('slope', [0.22, 0.4])
        wr = cfg.get('width', [8, 14])
        curl = cfg.get('curl', [4, 10])
        for j in range(n):
            yc = ys[0] + (ys[1] - ys[0]) * (j + rng.uniform(0.1, 0.9)) / n
            sl = float(rng.uniform(*slope))
            harm = [(int(h), float(rng.uniform(0.3, 1)), float(rng.uniform(0, TAU))) for h in rng.choice([1, 2], 2, replace=False)]
            s.lanes.append(dict(y0=yc - sl * W / 2, sl=sl, w=float(rng.uniform(*wr)), k=int(1),
                                amp=float(cfg.get('opacity', 0.4)) * float(rng.uniform(0.7, 1.0)),
                                harm=harm, curl=float(rng.uniform(*curl)), cph=float(rng.uniform(0, TAU)),
                                off=int(rng.integers(0, P)), gy=int(rng.integers(0, H)), col=cols[j % len(cols)]))

    def draw(s, out, t):
        i = int(round(t * 44))
        P = s.P
        xf = s.xi.astype(np.float32)
        for L in s.lanes:
            shift = (i * s.step * L['k'] + L['off'])
            ph = ((s.xi - shift) % P).astype(np.int32)
            # 沿带方向的疏密（周期正好是 P）
            dens = np.zeros(W, np.float32)
            xs = (np.arange(W) - shift) % P
            for h, a, f in L['harm']:
                dens += a * np.sin(TAU * xs * h / P + f)
            dens = np.clip(0.7 + 0.55 * dens / 1.3, 0.12, 1)
            curl = L['curl'] * np.sin(TAU * 2 * xs / P + L['cph'])
            n = s.yi - L['sl'] * xf - L['y0'] - curl[None, :]
            n = (n + H / 2) % H - H / 2
            prof = np.exp(-0.5 * (n / L['w']) ** 2)
            gi = ((s.yi - L['sl'] * xf + L['gy']) % H).astype(np.int32)
            g = s.grain[gi, ph]
            a = L['amp'] * prof * dens[None, :] * (0.3 + 1.0 * g)
            a = np.clip(a, 0, 0.85)[:, :, None]
            out += (L['col'] - out) * a


def make(cfg, scene, rng):
    return Fx(cfg, scene, rng)
