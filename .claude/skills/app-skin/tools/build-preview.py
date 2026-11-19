# -*- coding: utf-8 -*-
"""把 shots.mjs 截的图做成一个给用户看的预览页（图片压成 JPEG 内嵌，单个 HTML 文件）。

  python3 build-preview.py <截图目录> <皮肤 id> <皮肤中文名> <输出的 html 路径> [一句话说明]

截图目录里要有 <id>-light-*.png、<id>-dark-*.png，以及对比用的 default-light-{02-chats,06-dm,04-me}.png。
页面配色用中性的冷灰加一点主色；发布用 Artifact 工具（见 SKILL.md 第 6 步）。
"""
import base64, glob, io, os, sys
from PIL import Image

src, sid, name, out = sys.argv[1:5]
blurb = sys.argv[5] if len(sys.argv) > 5 else f"{name}皮肤的整套界面，白天和晚上各一套。聊天页的底色保持原样。"
SCREENS = [('01-auth', '登录'), ('02-chats', '消息列表'), ('03-friends', '好友'), ('04-me', '我的'), ('05-me-skin', '皮肤设置'),
           ('06-dm', '私聊'), ('07-menu', '长按菜单'), ('08-emoji', '表情面板'), ('09-plus', '小程序面板'), ('10-rank', '排行榜'),
           ('11-miniapp', '小程序（飞行棋大厅）'), ('12-group', '群聊'), ('13-group-info', '群资料')]

imgs = {}
for f in glob.glob(os.path.join(src, '*.png')):
    im = Image.open(f).convert('RGB').resize((390, 844), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=80, optimize=True, progressive=True)
    imgs[os.path.basename(f)[:-4]] = 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()

def fig(key, cap):
    return f'<figure class="shot"><img loading="lazy" alt="{cap}" src="{imgs[key]}"><figcaption>{cap}</figcaption></figure>' if key in imgs else ''

cmp = ''.join(f'<div class="pair"><div class="pair-h">{cap}</div><div class="pair-row">{fig("default-light-" + k, "默认")}{fig(sid + "-light-" + k, name)}</div></div>'
              for k, cap in [('02-chats', '消息列表'), ('06-dm', '私聊'), ('04-me', '我的')] if 'default-light-' + k in imgs)
light = ''.join(fig(f'{sid}-light-{k}', c) for k, c in SCREENS)
dark = ''.join(fig(f'{sid}-dark-{k}', c) for k, c in SCREENS)
cmp_sec = f'<section><div class="sec-h"><h2>和默认外观对比</h2><p>白天</p></div><div class="cmp">{cmp}</div></section>' if cmp else ''

html = f'''<title>{name}皮肤预览</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600;700&family=Noto+Sans+SC:wght@400;500&display=swap">
<style>
/* 布局：一段说明 + 手机截图网格 */
:root{{--bg:#eef1f5;--panel:#f8fafc;--ink:#1f2a37;--ink2:#4a596c;--line:#cfd8e3;--accent:#335f8d;--frame:#d9e1ea;
  --serif:"Noto Serif SC","Songti SC","STSong",serif;--sans:"Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{--bg:#0d1420;--panel:#141e2e;--ink:#e6edf6;--ink2:#a9b8ca;--line:#2a3850;--accent:#9cc0e8;--frame:#22304a;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#0d1420;--panel:#141e2e;--ink:#e6edf6;--ink2:#a9b8ca;--line:#2a3850;--accent:#9cc0e8;--frame:#22304a;color-scheme:dark}}
body{{background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.7}}
.wrap{{max-width:1180px;margin:0 auto;padding-block:32px 56px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:40px}}
header{{display:flex;flex-direction:column;gap:10px;max-width:640px}}
h1{{font-family:var(--serif);font-size:clamp(28px,5vw,40px);line-height:1.2;letter-spacing:.06em;margin:0;text-wrap:balance}}
h2{{font-family:var(--serif);font-size:22px;letter-spacing:.06em;margin:0}}
p{{margin:0;color:var(--ink2)}}
section{{display:flex;flex-direction:column;gap:16px}}
.sec-h{{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding-bottom:10px}}
.cmp{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}}
.pair{{display:flex;flex-direction:column;gap:8px;min-width:0}}
.pair-h{{font-family:var(--serif);font-weight:600;color:var(--ink2)}}
.pair-row{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:20px 16px}}
.shot{{margin:0;display:flex;flex-direction:column;gap:6px;min-width:0}}
.shot img{{display:block;width:100%;max-width:100%;aspect-ratio:390/844;object-fit:cover;border-radius:18px;border:4px solid var(--frame);background:var(--frame)}}
.shot figcaption{{font-size:13px;color:var(--ink2);text-align:center}}
.tog{{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}}
.tog button{{font:inherit;font-size:14px;padding:6px 16px;border:0;background:transparent;color:var(--ink2);cursor:pointer}}
.tog button[aria-pressed="true"]{{background:var(--accent);color:var(--bg)}}
.tog button:focus-visible{{outline:2px solid var(--accent);outline-offset:-2px}}
</style>
<div class="wrap">
<header><h1>藏咩空间 · {name}皮肤</h1><p>{blurb}</p></header>
{cmp_sec}
<section>
  <div class="sec-h"><h2>全部页面</h2>
    <div class="tog" role="group" aria-label="切换白天和晚上"><button type="button" id="bDay" aria-pressed="true">白天</button><button type="button" id="bNight" aria-pressed="false">晚上</button></div>
  </div>
  <div class="grid" id="gDay">{light}</div>
  <div class="grid" id="gNight" hidden>{dark}</div>
</section>
<footer><p>截图来自本地浏览器加假数据，手机宽度 390。确认没问题后再开 PR。</p></footer>
</div>
<script>
(function(){{var d=document.getElementById('bDay'),n=document.getElementById('bNight'),gd=document.getElementById('gDay'),gn=document.getElementById('gNight');
function set(night){{gd.hidden=night;gn.hidden=!night;d.setAttribute('aria-pressed',String(!night));n.setAttribute('aria-pressed',String(night));}}
d.addEventListener('click',function(){{set(false)}});n.addEventListener('click',function(){{set(true)}});}})();
</script>
'''
open(out, 'w', encoding='utf-8').write(html)
print(out, len(html) // 1024, 'KB,', len(imgs), 'images')
