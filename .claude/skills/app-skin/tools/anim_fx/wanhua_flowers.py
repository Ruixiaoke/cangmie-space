# -*- coding: utf-8 -*-
"""万花：整朵五瓣小紫花（有花心）旋转着飘落。"""
import math
import numpy as np


class Fx:
    def __init__(s, cfg, scene, rng):
        s.scene = scene
        n = int(cfg.get('count', 16))
        s.op = float(cfg.get('opacity', 0.95))
        s.sway = float(cfg.get('sway', 14))
        s.cols = [(hexrgb(a), hexrgb(b), hexrgb(c)) for a, b, c in cfg.get('colors', [['#7a45c4', '#c9a6f2', '#3f2278']])]
        s.heart = hexrgb(cfg.get('heart', '#ffe58a'))
        size = cfg.get('size', [8.5, 13])
        ph = (np.arange(n) + rng.uniform(0.2, 0.8, n)) / n
        rng.shuffle(ph)
        s.items = [dict(ph=float(p), speed=int(rng.choice([1, 1, 2])), x0=float(rng.uniform(0, W)), R=float(rng.uniform(*size)),
                        a0=float(rng.uniform(0, TAU)), spin=int(rng.choice([-2, -1, 1, 2])), fx=int(rng.integers(1, 3)),
                        b=float(rng.uniform(0, TAU)), m2=int(rng.integers(1, 3)), col=s.cols[int(rng.integers(len(s.cols)))])
                  for p in ph]
        # 墨滴
        s.ink = []
        k = int(cfg.get('ink', 5))
        s.ink_col = hexrgb(cfg.get('ink_color', '#4b3a78'))
        s.ink_op = float(cfg.get('ink_opacity', 0.55))
        s.ink_r = float(cfg.get('ink_radius', 26))
        s.ink_life = float(cfg.get('ink_life', 0.42))
        s.ink_soft = bool(cfg.get('ink_glow', False))
        ink_x = cfg.get('ink_x', [70, W - 70])  # 墨滴落点范围（横屏时改到湖面上）
        ink_y = cfg.get('ink_y', [230, 560])
        s.ink_fall = float(cfg.get('ink_fall', 42))
        s.ink_drop = float(cfg.get('ink_drop', 1.0))  # 墨滴本身的放大倍数
        s.ink_flat = float(cfg.get('ink_flat', 1.0))  # 涟漪纵向压扁（水面透视）
        for j in range(k):
            s.ink.append(dict(ph=(j + rng.uniform(0.0, 0.4)) / k, x=float(rng.uniform(*ink_x)), y=float(rng.uniform(*ink_y)),
                              r=float(s.ink_r * rng.uniform(0.75, 1.15)), lob=float(rng.uniform(0, TAU))))

    def flower(s, it, rot, tumble):
        R, op = it['R'], s.op
        deep, tip, rim = it['col']
        ca, sa = math.cos(rot), math.sin(rot)

        def fn(dx, dy):
            pu = dx * ca + dy * sa
            pv = (-dx * sa + dy * ca) / tumble
            r = np.hypot(pu, pv)
            ang = np.arctan2(pv, pu)
            lobe = (0.5 + 0.5 * np.cos(5 * ang)) ** 0.65
            er = R * (0.42 + 0.58 * lobe)
            sdf = er - r
            a = np.clip(sdf + 0.5, 0, 1)
            k = np.clip(r / R, 0, 1)[:, :, None]
            col = deep + (tip - deep) * k
            line = (np.abs(np.cos(5 * ang)) < 0.05)[:, :, None] * 0.0
            vein = (0.5 + 0.5 * np.cos(10 * ang))[:, :, None] * 0.12
            col = col * (1 - vein) + rim * vein
            edge = np.clip(1 - sdf / 1.5, 0, 1)[:, :, None] * 0.5
            col = col * (1 - edge) + rim * edge
            hc = np.clip((R * 0.26 - r) + 0.5, 0, 1)[:, :, None]
            col = col * (1 - hc) + s.heart * hc
            ring = np.clip(1 - np.abs(r - R * 0.3) / 1.0, 0, 1)[:, :, None] * 0.35
            col = col * (1 - ring) + rim * ring
            yield a * op, col
        return fn

    def draw_ink(s, out, t):
        for e in s.ink:
            age = ((t - e['ph']) % 1.0) / s.ink_life
            if age >= 1: continue
            fall = 0.22
            if age < fall:
                a = age / fall
                y = e['y'] - s.ink_fall * (1 - a * a)
                al = smooth(age * 12) * 0.95
                if s.ink_soft:
                    def fn(dx, dy):
                        d = np.hypot(dx, dy) / s.ink_drop
                        yield al * 0.6 * np.exp(-0.5 * (d / 2.4) ** 2), s.ink_col
                else:
                    def fn(dx, dy):
                        dx = dx / s.ink_drop; dy = dy / s.ink_drop
                        tail = np.exp(-0.5 * ((dx / 1.2) ** 2 + (np.clip(-(dy + 3), 0, 9) / 3.0) ** 2)) * (dy < 0)
                        d = np.hypot(dx, (dy - 1) / 1.2)
                        yield np.clip((1 - smooth((d - 1.8) / 1.0)) + 0.5 * tail, 0, 1) * al, s.ink_col
                s.scene.stamp(out, e['x'], y, 6 * s.ink_drop, fn)
            else:
                a = (age - fall) / (1 - fall)
                rad = 3 + (e['r'] - 3) * (1 - (1 - a) ** 2.4)
                fade = (1 - a) ** 1.3 * smooth(a * 10)

                def fn(dx, dy, rad=rad, fade=fade, lob=e['lob']):
                    dy = dy / s.ink_flat
                    d = np.hypot(dx, dy)
                    ang = np.arctan2(dy, dx)
                    er = rad * (1 + 0.025 * np.sin(2 * ang + lob) + 0.02 * np.sin(3 * ang + 2 * lob))
                    if s.ink_soft:
                        wash = np.exp(-0.5 * (d / (er * 0.62 + 1)) ** 2)
                        ring = np.exp(-0.5 * ((d - er * 0.75) / (1.4 + er * 0.06)) ** 2)
                        yield np.clip((0.5 * wash + 0.5 * ring) * fade * s.ink_op * 1.4, 0, 0.8), s.ink_col
                    else:
                        wash = (1 - smooth((d - er) / 2.5)) * 0.45
                        ring = np.exp(-0.5 * ((d - er) / 1.5) ** 2)
                        yield np.clip((wash + ring) * fade * s.ink_op, 0, 0.8), s.ink_col
                s.scene.stamp(out, e['x'], e['y'], s.ink_r * 1.3 * max(1.0, 1 / s.ink_flat), fn)

    def draw(s, out, t):
        pad = 20
        for it in s.items:
            u = (it['speed'] * t + it['ph']) % 1.0
            y = -pad + u * (H + 2 * pad)
            x = (it['x0'] + s.sway * math.sin(TAU * it['fx'] * t + it['b'])) % W
            rot = it['a0'] + it['spin'] * TAU * t
            tumble = 0.55 + 0.45 * abs(math.cos(TAU * it['m2'] * t + it['b']))
            s.scene.stamp(out, x, y, it['R'] * 1.5, s.flower(it, rot, tumble))
        s.draw_ink(out, t)


def make(cfg, scene, rng):
    return Fx(cfg, scene, rng)
