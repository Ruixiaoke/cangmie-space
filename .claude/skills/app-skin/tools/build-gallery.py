# -*- coding: utf-8 -*-
"""多个皮肤的预览页：一页里点名字切换，每个皮肤看登录、消息、我的、私聊的白天和晚上。

  python3 build-gallery.py <截图目录> <输出 html> <标题> <id:名字> [<id:名字> ...]

截图目录里是 shots.mjs 截的 <id>-<light|dark>-<01-auth|02-chats|04-me|06-dm>.png
（截的时候用 ONLY=01-auth,02-chats,04-me,06-dm 就够）。图片压成 300px 宽的 JPEG 内嵌。
"""
import base64, html, io, os, sys
from PIL import Image

src, out, title = sys.argv[1:4]
skins = [a.split(':', 1) for a in sys.argv[4:]]
SCREENS = [('01-auth', '登录'), ('02-chats', '消息'), ('04-me', '我的'), ('06-dm', '私聊')]

def data(p):
    im = Image.open(p).convert('RGB').resize((300, 649), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=74, optimize=True, progressive=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()

tabs, panels = [], []
for n, (sid, name) in enumerate(skins):
    figs = []
    for th, thn in [('light', '白天'), ('dark', '晚上')]:
        for key, cap in SCREENS:
            p = os.path.join(src, f'{sid}-{th}-{key}.png')
            if os.path.exists(p):
                figs.append(f'<figure class="shot"><img loading="lazy" alt="{name}{thn}{cap}" src="{data(p)}"><figcaption>{thn} · {cap}</figcaption></figure>')
    sel = 'true' if n == 0 else 'false'
    tabs.append(f'<button type="button" role="tab" id="t-{sid}" aria-selected="{sel}" aria-controls="p-{sid}" data-id="{sid}">{html.escape(name)}</button>')
    panels.append(f'<section role="tabpanel" id="p-{sid}" aria-labelledby="t-{sid}"{"" if n == 0 else " hidden"}><div class="grid">{"".join(figs)}</div></section>')

page = f'''<title>{html.escape(title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600;700&family=Noto+Sans+SC:wght@400;500&display=swap">
<style>
/* 布局：标题 + 横向可滚的门派标签 + 当前门派 8 张截图的网格 */
:root{{--bg:#eef1f5;--panel:#f8fafc;--ink:#1f2a37;--ink2:#4a596c;--line:#cfd8e3;--accent:#335f8d;--on:#fff;--frame:#d9e1ea;
  --serif:"Noto Serif SC","Songti SC","STSong",serif;--sans:"Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{--bg:#0d1420;--panel:#141e2e;--ink:#e6edf6;--ink2:#a9b8ca;--line:#2a3850;--accent:#9cc0e8;--on:#0d1420;--frame:#22304a;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#0d1420;--panel:#141e2e;--ink:#e6edf6;--ink2:#a9b8ca;--line:#2a3850;--accent:#9cc0e8;--on:#0d1420;--frame:#22304a;color-scheme:dark}}
body{{background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.7}}
.wrap{{max-width:1240px;margin:0 auto;padding-block:28px 56px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:20px}}
h1{{font-family:var(--serif);font-size:clamp(26px,5vw,38px);line-height:1.2;letter-spacing:.06em;margin:0;text-wrap:balance}}
p{{margin:0;color:var(--ink2);max-width:680px}}
.tabs{{display:flex;gap:6px;overflow-x:auto;padding:4px;border:1px solid var(--line);border-radius:10px;background:var(--panel);scrollbar-width:thin}}
.tabs button{{flex:none;font:inherit;font-family:var(--serif);font-size:15px;letter-spacing:.06em;padding:6px 14px;border:0;border-radius:7px;background:transparent;color:var(--ink2);cursor:pointer;white-space:nowrap}}
.tabs button[aria-selected="true"]{{background:var(--accent);color:var(--on)}}
.tabs button:focus-visible{{outline:2px solid var(--accent);outline-offset:1px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:18px 14px}}
.shot{{margin:0;display:flex;flex-direction:column;gap:6px;min-width:0}}
.shot img{{display:block;width:100%;max-width:100%;aspect-ratio:300/649;object-fit:cover;border-radius:16px;border:4px solid var(--frame);background:var(--frame)}}
.shot figcaption{{font-size:13px;color:var(--ink2);text-align:center}}
</style>
<div class="wrap">
<h1>{html.escape(title)}</h1>
<p>点门派名切换。每个门派看登录、消息、我的、私聊四个页面，前四张是白天，后四张是晚上。聊天页的底色保持原样。截图来自本地浏览器加假数据，手机宽度 390。</p>
<div class="tabs" role="tablist" aria-label="选择皮肤">{"".join(tabs)}</div>
{"".join(panels)}
</div>
<script>
(function(){{var bs=document.querySelectorAll('.tabs button');
function pick(id){{bs.forEach(function(b){{var on=b.getAttribute('data-id')===id;b.setAttribute('aria-selected',String(on));document.getElementById('p-'+b.getAttribute('data-id')).hidden=!on;}});}}
bs.forEach(function(b){{b.addEventListener('click',function(){{pick(b.getAttribute('data-id'));}});}});}})();
</script>
'''
open(out, 'w', encoding='utf-8').write(page)
print(out, len(page) // 1024, 'KB')
