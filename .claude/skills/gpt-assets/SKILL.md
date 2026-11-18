---
name: gpt-assets
description: 本项目所有图片素材（游戏 / 小程序的图标、道具、背景、贴图、特效表情的图案、按钮插画等位图）都用 GPT 生成：由 Claude 交给 Codex（codex:codex-rescue 代理），Codex 用内置 imagegen（GPT 图像模型）出图、后处理、放进仓库，Claude 再验收和接入代码。只要任务里需要一张新的或改版的图片，或者想用 emoji / 手画 canvas / CSS 图形代替一张图片，就先读这个 skill。
---

# 用 GPT 生成素材

**规则**：这个项目需要的图片素材一律用 GPT 生成。不用 emoji 当图案，不自己写 Pillow / SVG 去「画」一张插画，也不随手找网图。
例外只有真正的几何 UI：线条、圆点、进度条、球台上的球这类需要精确坐标或每帧重画的东西，继续用 CSS / canvas。拿不准时问用户。

分工：

- **Claude（主会话）**：决定要哪些图、写规格、交给 Codex、验收截图、写接入代码、开 PR。
- **Codex**（`Agent` 工具，`subagent_type: "codex:codex-rescue"`，后台运行）：用内置 `imagegen` 技能（GPT 图像模型，不需要 API key）生成或编辑图片，后处理成规格，写进指定目录。
- 和功能开发并行：Codex 出图的同时，Sonnet 开发代理可以先写代码，引用最终文件名，并给图片加加载失败的兜底。

## 1. 先定规格

每张图写清楚：

| 项 | 说明 |
|---|---|
| 文件路径 | 放在功能自己的素材目录，如 `chat/pool/`、`chat/sling/`、`chat/rank/`。新功能新建 `chat/<功能>/`。 |
| 用途 | 在界面上显示多大（CSS 像素），在什么背景上（浅色、深色都要看）。 |
| 尺寸 | 按显示大小的 2 倍左右取整：小图标 128×128，入口 / 模式图标 256×256，贴图纹理 512×512，竖屏背景 1024×1536，横屏背景 1536×768。参考下表。 |
| 透明 | 图标、道具、贴纸要透明背景（RGBA PNG，四角全透明）；背景图和纹理用 JPG。 |
| 体积 | 透明 PNG 小图 ≤ 25KB，256 图标 ≤ 75KB，背景 JPG ≤ 200KB。超了就量化 / 降质量。 |
| 内容 | 主体是什么、朝向、留白（主体约占画布 80%，居中）。图里**不要文字**，除非是球号这类必须的数字。 |
| 参考图 | 列 1 到 2 张已有素材当风格参考（见第 2 节）。 |
| 不覆盖 | 已有文件不覆盖；改版用新名字（`xxx-v2.png`），接入后再删旧的。 |

现有素材尺寸，照着取值：

```
chat/pool/icon-pool.png 256×256   chat/pool/mode-8.png 256×256   chat/pool/felt.jpg 512×512
chat/pool/bg-day.jpg 1024×1536    chat/pool/cue.png 1600×64       chat/pool/wood.jpg 512×128
chat/sling/icon-slingshot.png 128×128  chat/sling/ammo-*.png 128×128  chat/sling/block-*.png 160×160 / 192×96
chat/sling/fx-boom.png 256×256    chat/sling/bg-day.jpg 1536×768   chat/rank/medal-1.png 128×128
```

## 2. 风格

全站统一的风格：**柔和的手绘水粉 / 水彩感，暖色粉彩，轻微笔触纹理，细的暖色描边，柔和高光和很淡的投影，圆润可爱**。和聊天里的藏剑、纯阳 Q 版吉祥物（chat/zangjian.png、chat/chunyang.png）以及粉色主色调搭配。

参考图（按主题挑 1 到 2 张传给 Codex）：

- 物件 / 图标：`chat/pool/icon-pool.png`、`chat/sling/icon-slingshot.png`、`chat/pool/mode-9.png`
- 小道具：`chat/sling/ammo-carrot.png`、`chat/sling/ammo-chili.png`
- 爆炸 / 特效：`chat/sling/fx-boom.png`、`chat/sling/fx-ice.png`
- 背景：`chat/sling/bg-day.jpg`（白天）、`chat/sling/bg-night.jpg`（夜间）
- 奖牌 / 排行：`chat/rank/medal-1.png`

一组相关的图（比如几种道具、一套白天 / 夜间背景）在同一个任务里生成，要求光源方向、描边粗细、饱和度一致。

## 3. 交给 Codex 的提示模板

用 `Agent`（`subagent_type: "codex:codex-rescue"`，`run_in_background: true`），提示以 `--write` 开头。照下面的结构填，用英文写给 Codex 更稳：

```
--write Generate <N> raster assets for a mobile web chat mini-game and write them into <绝对路径的目标目录>.
Use your built-in imagegen skill (built-in image_gen tool, GPT image model). Do not draw them programmatically.

Assets:
1. <file>.png: <subject, pose/orientation, what it is used for>. <W>x<H>, transparent background (RGBA, all four corners fully transparent).
2. ...

Style: match the reference art. Load these with view_image first and pass them as style references only (do not copy their objects):
- <repo-absolute path to reference 1>
- <repo-absolute path to reference 2>
Soft hand-painted gouache look, warm pastel palette, subtle brush texture, thin warm outline, gentle highlight, faint soft drop shadow, cute rounded shapes. No text or letters in the image<, except ...>. No emoji style, no photorealism, no 3D render look.
Keep all assets in this set consistent in light direction, outline weight and saturation.

Post-process with Python/Pillow after generating:
- crop to the subject with even padding, subject ~80% of the canvas, centered; resize to the exact size with LANCZOS;
- PNG: keep the generated alpha, verify all four corners have alpha 0, quantize if needed to stay under <KB> KB;
- JPG: quality 82-88, under <KB> KB.
Do not overwrite existing files; do not modify any other file in the repo.
Verify each output (size, mode, corner alpha, file size), view each final image once, and report the final paths, sizes, byte counts, and the prompts you used.
```

要点：

- 一张图一个独立的 imagegen 调用，不要用一张拼图再裁。
- 颜色不对、细节不对，让 Codex 在同一任务里用「edit」改那一张（例如「把球体改成真正的黑色」），不要整张重来。
- 生成结果默认落在 `~/.codex/generated_images/…`，Codex 必须复制到仓库目录；仓库里引用的图不能只留在那里。
- Codex 的 imagegen 不可用时，它会说需要 `OPENAI_API_KEY` 的 CLI 方式。这时停下来告诉用户，不要改用 Pillow 手画顶替。

## 4. 验收（Claude 自己做，不能只信 Codex 的报告）

1. `file <路径>` 看尺寸和 RGBA；`ls -l` 看体积。
2. 用 Read 工具**亲眼看每一张图**：主体对不对、有没有多余文字 / 水印、边缘有没有白边或残留背景、风格是否和参考一致。
3. 在真实页面里截图：浅色、深色两种主题，手机宽度 390 和 375。透明图在深色背景上最容易露出白边。
4. 不合格就用 `SendMessage` 继续同一个 Codex 任务，只提一个具体修改。

## 5. 接入代码

- 路径写相对路径（如 `'pool/mode-8.png'`），和现有素材一样。CI 的「Chat images exist」会检查 `chat/` 下所有被 HTML / JS / CSS 引用的图片文件是否存在，缺一个就失败。
- `<img>` 加 `alt=""`（装饰图）或有意义的 alt，`draggable="false"`。
- 每张图都要有加载失败的兜底：`img.addEventListener('error', …)` 换成文字或简单的 CSS / canvas 形状（参考 `chat/js/miniapps/leaderboard.js` 的 `rankButton`、pool / sling 的 `PL_IMG_SRC` 预加载），canvas 里画图前检查图片已加载。
- 新素材和使用它的代码在同一个 PR 里提交。
- 素材 PR 的说明里写上：用的是 GPT 生成（Codex imagegen）、文件列表、尺寸和体积。

## 6. 和特效表情的关系

新特效表情的图案（舞台上的道具、粒子）也按本 skill 生成成 PNG，用 `<img>` 或 canvas 画，不再用 emoji 字形。现有特效的 emoji 暂时保留，用户要求改版时再按本 skill 替换。详见 `fx-emoji` skill。
