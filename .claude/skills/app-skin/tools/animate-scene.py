# -*- coding: utf-8 -*-
"""把皮肤的静态场景图（GPT 生成的 scene-day.jpg / scene-night.jpg）做成无缝循环的 GIF 背景。

  python3 animate-scene.py <皮肤目录 chat/skins/<id>> <动画设定 json> <id> [day|night ...]

底图一个像素都不改，只在上面叠加：
  - 粒子（雪、花瓣、落叶、火星、萤火虫、星光、尘沙），按设定分几层远近；
  - 横向漂移的雾带；
  - 晚上自动找出图里暖色的亮点（窗灯、灯笼、火把），让它们微微明暗起伏。
所有运动都是循环周期的整数倍，最后一帧接回第一帧没有跳动。
输出 512x768、44 帧 x 90 ms、无限循环；不限体积。最后打印验收数据：
相邻帧平均变化（整幅 / 上半幅）和首尾接缝，接缝应和相邻帧差不多。

插件动效：设定里 "effects": [ {"fx": "<名字>", ...参数} ] 会加载 tools/anim_fx/<名字>.py。
  插件文件里写 make(cfg, scene, rng) -> 对象，对象有 draw(out, t) 方法：
    out 是当前帧 H x W x 3 的 float32 数组（直接在上面画），t 是 0 到 1 的循环进度（t=1 必须和 t=0 一样）。
  可用的工具：scene.base（底图）、scene.xx / scene.yy（像素坐标网格）、scene.stamp(out, cx, cy, rad, fn)
  （在一个点附近画一个小图形，fn(dx, dy) 逐个 yield (alpha, colour)，自动处理画面边缘的环绕），
  以及本模块的 W、H、TAU、smooth()、hexrgb()。门派专属的动效都写成插件，内置的粒子种类留给简单场合。

动画设定 json：{ "<id>": { "day": {...}, "night": {...} } }，每个场景：
  "particles": [ { "kind": "snow|petal|leaf|ember|firefly|sparkle|dust",
                   "count": 60, "size": [1.0, 2.0], "opacity": 0.8,
                   "speed": 1,            # 一个循环里穿过画面几次（整数；ember 往上走，dust 往旁边走）
                   "sway": 8,             # 左右摆动像素
                   "colors": ["#ffffff"], # 随机取
                   "top_bias": 0.2 } ],   # 0 到 0.4：越大越集中在上半幅
  "mist": [ { "y": 0.42, "spread": 0.04, "opacity": 0.22, "dir": 1, "color": "#c8d4e6" } ],
  "glow": 0.15,                           # 晚上暖色亮点的起伏幅度，0 = 不做
  "quant": "maxcoverage"                  # 可选：强制减色算法（大片同色渐变断层时用）
"""
import importlib.util, json, math, sys, zlib
from pathlib import Path
import numpy as np
from PIL import Image

W, H, FRAMES, DELAY = 512, 768, 44, 90
TAU = 2 * math.pi


def hexrgb(s):
    s = s.lstrip('#'); return np.array([int(s[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def smooth(x):
    x = np.clip(x, 0, 1); return x * x * (3 - 2 * x)


class Scene:
    def __init__(self, path, cfg, seed):
        im = Image.open(path).convert('RGB').resize((W, H), Image.Resampling.LANCZOS)
        self.base = np.asarray(im, dtype=np.float32)
        self.yy, self.xx = np.mgrid[0:H, 0:W].astype(np.float32)
        self.cfg = cfg
        rng = np.random.default_rng(seed)
        self.layers = []
        for p in cfg.get('particles', []):
            n = int(p.get('count', 60))
            bias = float(p.get('top_bias', 0.2))
            items = []
            phases = (np.arange(n) + rng.uniform(0.15, 0.85, n)) / n
            rng.shuffle(phases)
            for ph in phases:
                items.append(dict(
                    x0=float(rng.uniform(0, W)), y0=float(rng.uniform(0, H)), ph=float(ph),
                    r=float(rng.uniform(*p.get('size', [1.0, 2.0]))), a=float(rng.uniform(0, TAU)),
                    spin=int(rng.choice([-2, -1, 1, 2])), col=hexrgb(rng.choice(p.get('colors', ['#ffffff']))),
                    fx=int(rng.integers(1, 3)), fy=int(rng.integers(1, 3)), blink=int(rng.integers(1, 4))))
            ys = np.linspace(0, 1, 4097)
            self.layers.append((p, items, ys, ys + bias * np.sin(np.pi * ys)))
        self.effects = []
        for k, e in enumerate(cfg.get('effects', [])):
            self.effects.append(load_fx(e['fx']).make(e, self, np.random.default_rng(seed + 101 + k)))
        self.mist = []
        for k, m in enumerate(cfg.get('mist', [])):
            r = np.random.default_rng(seed + 7 + k)
            puffs = [(float((j + r.uniform(-.3, .3)) * W / 11), float(r.uniform(-16, 16)), float(r.uniform(14, 31)), float(r.uniform(.6, 1.1))) for j in range(11)]
            self.mist.append((m, puffs))
        self.glows = []
        if cfg.get('glow'):
            self.glows = self.find_glows()

    def find_glows(self, maxn=10):
        b = self.base
        warm = (b[:, :, 0] - b[:, :, 2])
        lum = b.mean(axis=2)
        score = np.where((warm > 35) & (lum > 95), warm + lum * 0.3, 0).astype(np.float32)
        score[:20] = 0
        out = []
        s = score.copy()
        for _ in range(maxn):
            i = int(np.argmax(s))
            if s.flat[i] <= 0: break
            cy, cx = divmod(i, W)
            out.append((float(cx), float(cy)))
            y0, y1, x0, x1 = max(0, cy - 14), min(H, cy + 15), max(0, cx - 14), min(W, cx + 15)
            s[y0:y1, x0:x1] = 0
        gate = smooth((warm + 1) / 30)
        masks = []
        for cx, cy in out:
            m = np.exp(-0.5 * (((self.xx - cx) / 6) ** 2 + ((self.yy - cy) / 6) ** 2)) * gate
            masks.append(m.astype(np.float32))
        return masks

    def stamp(self, out, cx, cy, rad, fn):
        """fn(dx, dy) -> (alpha HxW, colour) ; 处理画面边缘的环绕"""
        pad = int(math.ceil(rad * 3)) + 2
        for ox in [0] + ([-W] if cx + pad >= W else []) + ([W] if cx - pad < 0 else []):
            for oy in [0] + ([-H] if cy + pad >= H else []) + ([H] if cy - pad < 0 else []):
                x, y = cx + ox, cy + oy
                x0, x1 = max(0, int(x) - pad), min(W, int(x) + pad + 1)
                y0, y1 = max(0, int(y) - pad), min(H, int(y) + pad + 1)
                if x0 >= x1 or y0 >= y1: continue
                dx = self.xx[y0:y1, x0:x1] - x; dy = self.yy[y0:y1, x0:x1] - y
                for alpha, col in fn(dx, dy):
                    patch = out[y0:y1, x0:x1]
                    patch += (col - patch) * alpha[:, :, None]

    def render(self, t):
        out = self.base.copy()
        cfg = self.cfg
        for k, m in enumerate(self.glows):
            pulse = cfg['glow'] * math.sin(TAU * (1 + k % 2) * t + k * 0.9)
            out += self.base * m[:, :, None] * pulse
        for m, puffs in self.mist:
            cy, spread = m['y'] * H, m.get('spread', .04) * H
            cloud = np.zeros((H, W), np.float32)
            for px, dy, sx, wgt in puffs:
                dx = ((self.xx - m.get('dir', 1) * t * W - px + W / 2) % W) - W / 2
                cloud += wgt * np.exp(-0.5 * ((dx / sx) ** 2 + ((self.yy - cy - dy) / spread) ** 2))
            a = (m.get('opacity', .22) * (1 - np.exp(-1.3 * cloud)))[:, :, None]
            out += (hexrgb(m.get('color', '#d0d8e4')) - out) * a
        slate = np.array((60, 70, 86), np.float32)
        for p, items, ys, cdf in self.layers:
            kind, op, speed, sway = p['kind'], float(p.get('opacity', .8)), int(p.get('speed', 1)), float(p.get('sway', 8))
            for it in items:
                r, col = it['r'], it['col']
                if kind in ('snow', 'petal', 'leaf'):
                    u = (speed * t + it['ph']) % 1.0
                    y = H * float(np.interp(u, cdf, ys))
                    x = (it['x0'] + sway * math.sin(TAU * t + it['a']) + .25 * sway * math.sin(2 * TAU * t + it['a'] * .7)) % W
                elif kind == 'ember':
                    u = (speed * t + it['ph']) % 1.0
                    y = H * (1 - u)
                    x = (it['x0'] + sway * math.sin(TAU * 2 * t + it['a'])) % W
                elif kind == 'dust':
                    u = (speed * t + it['ph']) % 1.0
                    x = W * u
                    y = (it['y0'] + sway * math.sin(TAU * t + it['a'])) % H
                else:  # firefly, sparkle: 原地附近
                    x = (it['x0'] + (sway * math.sin(TAU * it['fx'] * t + it['a']) if kind == 'firefly' else 0)) % W
                    y = (it['y0'] * (1 - .35 * float(p.get('top_bias', .2))) + (sway * math.sin(TAU * it['fy'] * t + it['a'] * 1.3) if kind == 'firefly' else 0)) % H
                if kind == 'snow':
                    def fn(dx, dy, r=r, col=col):
                        d = np.hypot(dx, dy) / r
                        yield .15 * np.exp(-.5 * (d / 1.15) ** 2) * (1 - smooth((d - 1.5) / .5)), slate
                        yield op * (1 - smooth((d - .42) / .65)), col
                elif kind in ('petal', 'leaf'):
                    ang = it['a'] + it['spin'] * TAU * t
                    ca, sa = math.cos(ang), math.sin(ang)
                    flat = .55 if kind == 'petal' else .38
                    tumble = .55 + .45 * abs(math.cos(TAU * t * it['spin'] + it['a']))
                    def fn(dx, dy, r=r, col=col, ca=ca, sa=sa, flat=flat, tumble=tumble):
                        u = (dx * ca + dy * sa) / r; v = (-dx * sa + dy * ca) / (r * flat * tumble)
                        d = np.sqrt(u * u + v * v)
                        yield .12 * (1 - smooth((d - 1.0) / .6)), slate
                        yield op * (1 - smooth((d - .7) / .45)), col
                elif kind == 'ember':
                    fl = .65 + .35 * math.sin(TAU * it['blink'] * t + it['a'])
                    def fn(dx, dy, r=r, col=col, fl=fl):
                        d = np.hypot(dx, dy) / r
                        yield op * fl * .45 * np.exp(-.5 * (d / 1.6) ** 2), col
                        yield op * fl * (1 - smooth((d - .35) / .5)), np.minimum(col + 70, 255)
                elif kind == 'firefly':
                    fl = max(0.0, math.sin(TAU * it['blink'] * t + it['a'])) ** 1.5
                    def fn(dx, dy, r=r, col=col, fl=fl):
                        d = np.hypot(dx, dy) / r
                        yield op * fl * .55 * np.exp(-.5 * (d / 2.2) ** 2), col
                        yield op * fl * (1 - smooth((d - .3) / .45)), np.minimum(col + 60, 255)
                elif kind == 'sparkle':
                    fl = max(0.0, math.sin(TAU * it['blink'] * t + it['a'])) ** 4
                    def fn(dx, dy, r=r, col=col, fl=fl):
                        cross = np.exp(-.5 * (dy / (r * .18)) ** 2) * np.exp(-.5 * (dx / (r * 1.6)) ** 2) + np.exp(-.5 * (dx / (r * .18)) ** 2) * np.exp(-.5 * (dy / (r * 1.6)) ** 2)
                        yield np.clip(op * fl * cross, 0, 1), col
                else:  # dust
                    def fn(dx, dy, r=r, col=col):
                        d = np.hypot(dx, dy) / r
                        yield op * (1 - smooth((d - .3) / .6)), col
                self.stamp(out, x, y, r, fn)
        for e in self.effects:
            e.draw(out, t)
        return np.rint(out).clip(0, 255).astype(np.uint8)


FX_DIR = Path(__file__).resolve().parent / 'anim_fx'
_fx_cache = {}


def load_fx(name):
    if name not in _fx_cache:
        spec = importlib.util.spec_from_file_location('anim_fx_' + name, FX_DIR / f'{name}.py')
        mod = importlib.util.module_from_spec(spec)
        mod.W, mod.H, mod.TAU, mod.smooth, mod.hexrgb = W, H, TAU, smooth, hexrgb
        spec.loader.exec_module(mod)
        _fx_cache[name] = mod
    return _fx_cache[name]


def encode(frames, path, quant=None):
    """全局调色板（254 色 + 1 个透明色）。第 2 帧起，和上一帧颜色相同的像素记成透明：
    GIF 只存变化的像素，体积小很多，解码出来的画面和整帧存储完全一样。"""
    mont = Image.new('RGB', (W * 4, H * 2))
    for i, f in enumerate(frames[::max(1, len(frames) // 8)][:8]):
        mont.paste(Image.fromarray(f), ((i % 4) * W, (i // 4) * H))
    # 减色算法：默认两种都试、挑整幅平均误差小的；场景设定里写 "quant": "maxcoverage" 可以强制
    # （大片同色渐变，比如凌雪阁夜里的红墙，用 MEDIANCUT 会断成一层层色块，整幅误差却不一定更大）
    ref = np.asarray(mont, np.int16)
    best = None
    methods = {'mediancut': [Image.Quantize.MEDIANCUT], 'maxcoverage': [Image.Quantize.MAXCOVERAGE]}.get(quant, [Image.Quantize.MEDIANCUT, Image.Quantize.MAXCOVERAGE])
    for method in methods:
        cand = mont.quantize(colors=254, method=method, dither=Image.Dither.NONE)
        err = float(np.abs(np.asarray(mont.quantize(palette=cand, dither=Image.Dither.NONE).convert('RGB'), np.int16) - ref).mean())
        if best is None or err < best[0]:
            best = (err, cand)
    pal = best[1]
    raw = pal.getpalette()[:254 * 3]
    pal.putpalette(raw + [0, 0, 0] * (256 - 254))
    idx = [np.asarray(Image.fromarray(f).quantize(palette=pal, dither=Image.Dither.NONE)) for f in frames]
    TR = 255
    ims = []
    for i, a in enumerate(idx):
        b = a.copy()
        if i > 0:
            b[a == idx[i - 1]] = TR
        im = Image.fromarray(b); im.putpalette(raw + [0, 0, 0] * 2)
        ims.append(im)
    ims[0].save(path, save_all=True, append_images=ims[1:], duration=DELAY, loop=0, optimize=False,
                disposal=1, transparency=TR)


def measure(path):
    im = Image.open(path); fr = []
    try:
        while True:
            fr.append(np.asarray(im.convert('RGB'), np.int16)); im.seek(im.tell() + 1)
    except EOFError:
        pass
    d = [np.abs(fr[i + 1] - fr[i]).mean() for i in range(len(fr) - 1)]
    top = [np.abs(fr[i + 1][:H // 2] - fr[i][:H // 2]).mean() for i in range(len(fr) - 1)]
    return len(fr), float(np.mean(d)), float(np.mean(top)), float(np.abs(fr[0] - fr[-1]).mean())


def main():
    folder, cfgp, sid = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    which = sys.argv[4:] or ['day', 'night']
    conf = json.load(open(cfgp, encoding='utf-8'))[sid]
    for kind in which:
        sc = Scene(folder / f'scene-{kind}.jpg', conf[kind], seed=zlib.crc32(f'{sid}-{kind}'.encode()) % 100000)
        frames = [sc.render(i / FRAMES) for i in range(FRAMES)]
        out = folder / f'scene-{kind}.gif'
        encode(frames, out, conf[kind].get('quant'))
        n, d, top, seam = measure(out)
        print(f'{sid} {kind}: {n} frames, diff {d:.2f} (top {top:.2f}), seam {seam:.2f}, glows {len(sc.glows)}, {out.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
