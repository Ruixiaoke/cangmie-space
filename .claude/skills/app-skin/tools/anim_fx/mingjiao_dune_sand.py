"""明教（白天）：被风吹过沙丘的细沙流。贴着地面、成片的沙粒流线，一阵一阵地涌。"""
import math
import numpy as np


class Fx:
    def __init__(self, cfg, scene, rng):
        self.scene, self.cfg = scene, cfg
        if cfg.get('lines'):
            self.init_ribbons(cfg, rng)
            self.draw = self.draw_ribbons
            return
        y0, y1 = cfg.get('y_range', [300, 760])
        ns, ng = int(cfg.get('streams', 18)), int(cfg.get('grains', 16))
        self.streams = []
        for i in range(ns):
            yb = float(y0 + (y1 - y0) * rng.uniform(0, 1) ** .85)
            gr = []
            for j in range(ng):
                gr.append((float((j + rng.uniform(.1, .9)) / ng), float(rng.uniform(*cfg.get('len', [8, 20]))), float(rng.uniform(.6, 1.0)), float(rng.uniform(0, 1)), float(rng.uniform(-1.6, 1.6))))
            self.streams.append(dict(y=yb, amp=float(rng.uniform(*cfg.get('amp', [3, 10]))), f=int(rng.choice([1, 2])), ph=float(rng.uniform(0, math.tau)),
                                     sp=int(rng.choice([1, 1, 1, 2])), gph=float(rng.uniform(0, math.tau)), grains=gr))

    def draw(self, out, t):
        cfg = self.cfg
        op = float(cfg.get('opacity', .85))
        lite = np.array(cfg.get('light', [255, 238, 205]), np.float32)
        dark = np.array(cfg.get('dark', [205, 150, 90]), np.float32)
        k, gc, jyk = float(cfg.get('thick', 1)), int(cfg.get('gust_cycles', 2)), float(cfg.get('jitter', 1))
        for s in self.streams:
            for pos, ln, br, tone, jy in s['grains']:
                x = (pos * W + W * s['sp'] * t) % W
                y = s['y'] + s['amp'] * math.sin(math.tau * s['f'] * x / W + s['ph']) + jy * jyk * math.sin(math.tau * 2 * t + pos * 20)
                gust = .05 + .95 * (.5 + .5 * math.sin(math.tau * (gc * x / W - t * 1) + s['gph'])) ** 2.5
                a = op * br * gust * (.8 if tone <= .45 else 1.0)
                if a < .04: continue
                col = lite if tone > .45 else dark
                L = ln * (1 + .5 * (s['sp'] - 1))

                def fn(dx, dy, L=L, a=a, col=col, k=k):
                    al = np.clip(-dx / L, 0, 1)            # 头在右，尾向左拖
                    body = np.exp(-.5 * (dy / (.9 * k)) ** 2) * (1 - al) ** 1.3 * np.exp(-.5 * (np.maximum(dx, 0) / (.9 * k)) ** 2) * (dx > -L)
                    wl = np.clip(-dx / (L * 3.2), 0, 1)
                    yield a * .16 * np.exp(-.5 * (dy / (1.8 * k)) ** 2) * (1 - wl) ** 1.5 * np.exp(-.5 * (np.maximum(dx, 0) / (.9 * k)) ** 2) * (dx > -L * 3.2), col
                    yield a * .35 * np.exp(-.5 * (dy / (2.2 * k)) ** 2) * (1 - al) * np.exp(-.5 * (np.maximum(dx, 0) / (.9 * k)) ** 2) * (dx > -L), col
                    yield a * body, col
                self.scene.stamp(out, x, y, L * 1.2 + 4 * k, fn)


    # ---- 柔和流沙（横屏）：设定里写 "lines"（沙丘脊线折线，横屏像素坐标）才启用，竖屏默认行为不受影响 ----
    def init_ribbons(self, cfg, rng):
        self.lines = [(np.array([p[0] for p in ln['pts']], np.float32), np.array([p[1] for p in ln['pts']], np.float32), float(ln.get('weight', 1))) for ln in cfg['lines']]
        wts = np.array([l[2] for l in self.lines]); wts = wts / wts.sum()
        nr, ng, nh = int(cfg.get('ribbons', 40)), int(cfg.get('flow_grains', 3)), int(cfg.get('hazes', 10))
        Lr, Wr = cfg.get('ribbon_len', [180, 420]), cfg.get('ribbon_width', [1.6, 3.4])
        self.rib = []
        for i in range(nr):
            self.rib.append(dict(li=int(rng.choice(len(self.lines), p=wts)), off=float(rng.uniform(*cfg.get('offset', [-6, 26]))),
                                 x0=float(rng.uniform(0, W)), sp=int(rng.choice([1, 1, 2])), L=float(rng.uniform(*Lr)), w=float(rng.uniform(*Wr)),
                                 amp=float(rng.uniform(2, 7)), f=int(rng.choice([2, 3, 4])), ph=float(rng.uniform(0, math.tau)), gph=float(rng.uniform(0, math.tau)),
                                 br=float(rng.uniform(.55, 1)), tone=float(rng.uniform(0, 1)),
                                 gr=[(float(rng.uniform(-.45, .45)), float(rng.uniform(-3, 3)), int(rng.choice([2, 3]))) for _ in range(ng)]))
        self.haze = []
        for i in range(nh):
            self.haze.append(dict(li=int(rng.choice(len(self.lines), p=wts)), x0=float(rng.uniform(0, W)), sp=int(rng.choice([1, 1, 2])), sx=float(rng.uniform(*cfg.get('haze_sx', [120, 260]))),
                                  sy=float(rng.uniform(*cfg.get('haze_sy', [14, 30]))), up=float(rng.uniform(6, 26)), k=int(rng.choice([1, 2])), ph=float(rng.uniform(0, 1))))

    def line_y(self, li, x):
        xs, ys, _ = self.lines[li]
        return np.interp(x, xs, ys)

    def draw_ribbons(self, out, t):
        cfg = self.cfg
        op = float(cfg.get('opacity', .3))
        lite = np.array(cfg.get('light', [252, 228, 196]), np.float32)
        dark = np.array(cfg.get('dark', [206, 152, 108]), np.float32)
        edge = float(cfg.get('edge', 90)); gf = float(cfg.get('gust_floor', .1))
        for hz in self.haze:
            pulse = math.sin(math.pi * ((hz['k'] * t + hz['ph']) % 1.0)) ** 2
            cx = (hz['x0'] + W * hz['sp'] * t) % W
            cy = float(self.line_y(hz['li'], cx)) + 10 - hz['up'] * pulse
            a0 = float(cfg.get('haze_opacity', .14)) * pulse
            if a0 < .01: continue
            sx, sy = hz['sx'], hz['sy']
            def fn(dx, dy, a0=a0, sx=sx, sy=sy):
                yield a0 * np.exp(-.5 * ((dx / sx) ** 2 + (dy / sy) ** 2)), lite
            self.scene.stamp(out, cx, cy, max(sx, sy) * 1.3, fn)
        rows_cache = {}
        for r in self.rib:
            xc = (r['x0'] + W * r['sp'] * t) % W
            L, w = r['L'], r['w']
            R = int(math.ceil(w * 3.5 + 2))
            col = lite if r['tone'] > .4 else dark
            kk = np.arange(-R, R + 1, dtype=np.float32)[:, None]
            for off in (-W, 0, W):
                xa, xb = int(math.ceil(xc + off - L / 2)), int(math.floor(xc + off + L / 2))
                xa, xb = max(xa, 0), min(xb, W - 1)
                if xb <= xa: continue
                xs = np.arange(xa, xb + 1, dtype=np.float32)
                u = (xs - (xc + off)) / (L / 2)                           # -1..1 沿沙带
                env = np.clip(1 - np.abs(u), 0, 1); env = env * env * (3 - 2 * env)   # 两端渐隐
                xm = xs % W
                gust = gf + (1 - gf) * (.5 + .5 * np.sin(math.tau * (2 * xm / W - t) + r['gph'])) ** 2
                ed = np.clip(np.minimum(xs, W - xs) / edge, 0, 1)
                al = op * r['br'] * env * gust * ed
                cy = self.line_y(r['li'], xm) + r['off'] + r['amp'] * np.sin(math.tau * r['f'] * xm / W + r['ph'] + math.tau * t)
                wv = w * (.55 + .45 * env)
                rows = np.rint(cy)[None, :] + kk
                dy = rows - cy[None, :]
                prof = np.exp(-.5 * (dy / wv[None, :]) ** 2) * al[None, :]
                ri = np.clip(rows, 0, H - 1).astype(np.int64)
                ci = np.broadcast_to(xs.astype(np.int64)[None, :], ri.shape)
                cur = out[ri, ci]
                out[ri, ci] = cur + (col - cur) * prof[:, :, None]
            # 细沙粒：沿沙带更快地往右跑
            for gu, gy, gs in r['gr']:
                gx = xc + gu * L + .3 * L * math.sin(math.tau * gs * t + gu * 9)
                gxm = gx % W
                gyy = float(self.line_y(r['li'], gxm)) + r['off'] + gy + r['amp'] * math.sin(math.tau * r['f'] * gxm / W + r['ph'] + math.tau * t)
                gg = float(np.clip(1 - abs(gu) / .5, 0, 1)) * (.1 + .9 * (.5 + .5 * math.sin(math.tau * (2 * gxm / W - t) + r['gph'])) ** 2) * min(1.0, min(gxm, W - gxm) / edge)
                a1 = op * 1.3 * gg
                if a1 < .02: continue
                def fn(dx, dy, a1=a1):
                    yield a1 * np.exp(-.5 * ((np.minimum(dx, 0) / 5.0) ** 2 + (dy / 1.1) ** 2)) * (dx > -16) * np.exp(-.5 * (np.maximum(dx, 0) / 1.2) ** 2), lite
                self.scene.stamp(out, gxm, gyy, 18, fn)


def make(cfg, scene, rng):
    return Fx(cfg, scene, rng)
