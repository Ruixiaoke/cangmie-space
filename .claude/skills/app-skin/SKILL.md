---
name: app-skin
description: 聊天应用的整套外观皮肤（纯阳 chunyang 这类：换场景、配色、标题字体、按钮、面板、气泡、角标、时间线和吉祥物，白天和晚上各一套）的做法和改动清单：设计变量覆盖、组件细节、GPT 生成的场景和纹样、皮肤注册、截图和给用户看的预览页。新做一个皮肤（比如按某个门派、节日、颜色主题）、改已有皮肤的样子、排查皮肤下某个组件颜色不对或深色模式看不清时，先读这个 skill。
---

# 整套外观皮肤

「皮肤」在「我的 → 皮肤」里选，只影响自己看到的样子，存在本机（`localStorage` 的 `chat.skin`），和「外观」（白天 / 晚上 / 自动）互相独立。
皮肤有两种：

- **动效皮肤**（`沙子`）：只改气泡的动画，代码在 `chat/js/skins/sand.js`。
- **整套外观皮肤**（`纯阳`）：在 `<html data-skin="<id>">` 上生效，换掉整套界面的样子。本 skill 讲的是这一种。

几个皮肤是单选的（同一时间只有一个）。范例就是纯阳：`chat/css/skin-chunyang.css`，新皮肤从它复制起步。

代码是唯一的真相来源，下面用来定位。动手前把 `chat/css/tokens.css`、`chat/css/skin-chunyang.css`、`chat/js/skins/index.js` 读一遍。

## 文件地图

| 位置 | 管什么 |
|---|---|
| `chat/css/tokens.css` | 默认的设计变量（白天 `:root`、晚上 `[data-theme="dark"]` 和 `prefers-color-scheme` 两处）。所有组件的颜色、阴影、圆角都从这里取 |
| `chat/css/skin-<id>.css` | 皮肤本体：覆盖设计变量 + 组件细节。在 `index.html` 里 `group.css` 之后、`fallback.css` 之前引入 |
| `chat/skins/<id>/` | 皮肤的图片：场景（白天 / 晚上）、纹样、徽记 |
| `chat/js/skins/index.js` | `SKINS` 表（`look: true` 是整套外观皮肤）、`applySkinLook()` 写 `data-skin` |
| `chat/index.html` 开头的 `theme-init` 脚本 | 首屏之前就设好 `data-skin` 和浏览器顶栏颜色，避免先闪一下默认样式。里面的 `C` 表：皮肤 id → [白天顶栏色, 晚上顶栏色] |
| `chat/js/theme.js` 的 `SKIN_COLOR` | 同一组顶栏颜色（切换皮肤或外观之后用）。和 `C` 表写同样的值 |
| `chat/js/mascot.js` 的 `SKIN_MASCOT` | 可选：皮肤 id → 固定用哪个吉祥物（`CHARS` 的下标；纯阳是 1）。不写就照常随机 |
| `chat/js/views/me.js` | 皮肤选择器，读 `SKINS` 自动生成，不用改 |
| `.claude/skills/app-skin/tools/` | 截图脚本 `shots.mjs`、假数据 `fake-sb.js`、预览页生成 `build-preview.py` |

## 规则

- **聊天页的底色不动**：`--chat-bg`（聊天壁纸）默认不覆盖，除非用户明确要求。纯阳就是这样：外层场景换了，聊天页还是原来的纯色。
- **白天和晚上都要做**：设计变量写三份（白天、`[data-theme="dark"]`、`prefers-color-scheme: dark` 下的自动），晚上那两份完全一样。只写白天的话，晚上会变成「皮肤的白天配色 + 默认的晚上配色」混在一起。
- **不改的东西**：特效表情的状态色（`--wet-*`、`--love-*`、`--frozen-*`、`--hot-*`、`--plump-*`、`--bloom-*`、`--steam-rgb`、`--glow-warm`）、小游戏内部画面、助手气泡（`agent.css`）。这些有自己的意思，不跟皮肤走。
- **组件规则一律加 `[data-skin="<id>"]` 前缀**，不改任何组件自己的 CSS 文件。关掉皮肤就完全回到默认。
- 素材一律用 GPT 生成（`gpt-assets` skill，交给 Codex）；纯几何的线和点可以用 CSS 或内联 SVG 画（纯阳的剑形时间线就是内联 SVG）。
- 文案（皮肤名、说明）用中文，不用 emoji，不用破折号。
- 做完**先给用户看预览**（第 6 步），用户点头再开 PR。

## 做一个新皮肤：步骤

下面用 `<id>` 代指皮肤 id（小写英文，如 `zangjian`），`<名>` 代指中文名（如 `藏剑`）。

### 1. 定方向

从主题本身找材料：门派的颜色、场景、器物、纹样。写下来：

- 场景：外层背景画什么（白天、晚上各一张，构图一样）。
- 主色（替换默认的粉色 `--pink`）、辅色、印章色（角标），各自在白天和晚上的值。
- 标题字体：系统自带的宋体（纯阳）或保持默认黑体。不加载中文 webfont（太大）。
- 2 到 4 个细节：页名前的徽记、面板角的纹样、时间分隔线、标签栏选中样式等。

方向拿不准就先问用户（比如「藏剑是金黄配西湖绿，还是偏山庄的暖棕」）。

### 2. 设计变量 `chat/css/skin-<id>.css`

复制 `skin-chunyang.css`，三个块都改：

```css
:root[data-skin="<id>"]{ …白天… }
:root[data-skin="<id>"][data-theme="dark"]{ …晚上… }
@media (prefers-color-scheme: dark){ :root[data-skin="<id>"]:not([data-theme="light"]){ …晚上（和上面一样）… } }
```

优先级：`skin-<id>.css` 在 `tokens.css` 之后引入，选择器也更具体（晚上的两块是 0,3,0），所以能盖过默认值。新增变量用 `--<缩写>-` 前缀（纯阳是 `--cy-`）。

要覆盖的变量（意思见 `tokens.css`）：

| 组 | 变量 |
|---|---|
| 文字 | `--t1` `--t2` `--t3` |
| 主色 | `--pink`（按钮、选中、开关）`--on-pink`（主色上的字）`--pink-text`（主色文字、焦点框）`--red-text` `--ok` `--badge` |
| 玻璃 | `--hair` `--rim` `--hi` `--lo` `--side` `--g-bar` `--g-card` `--g-chip` `--g-solid` `--field-bg` |
| 阴影 | `--sh-0` `--sh-1` `--sh-2`（阴影色跟着主题冷暖走） |
| 场景 | `--page` `--stage-bg` `--scene-img` `--scene-bg` |
| 浮层 | `--toast-bg` `--toast-fg`（提示、长按菜单） |
| 吉祥物 | `--mascot-bg` `--mascot-bg-av` |
| 气泡 | `--bub-peer` `--bub-own` `--bub-fx` `--bub-fail` `--bub-bd` `--bub-hi` `--bub-lo` `--bub-sheen` `--chat-bub-peer` `--chat-bub-bd` |
| 形状（可选） | `--r-card` `--r-panel` 等 |

`--scene-bg` 是多层背景：最上面一层半透明渐变压一压亮度（保证玻璃面板上的字看得清），然后是 `var(--scene-img)`，最后是图片没加载出来时的纯色兜底。同时给 `#shell` 写对应层数的 `background-size`。

### 3. 组件细节（同一个 CSS 文件的后半段）

纯阳里用到的挂点，照着换成新皮肤的样子：

| 挂点 | 纯阳做了什么 |
|---|---|
| `.top h2` `#auth h1` `.me-head .name` `.panel h3` `.section-title` `#chat .who b` | 宋体加字距 |
| `.view>.top h2::before` | 页名前的徽记（`taiji.png`） |
| `.top::after` | 顶栏下沿一道渐隐的银线 |
| `.panel::after` | 面板右上角的纹样，用 `mask` 取形、`background` 上色，颜色跟着主题变 |
| `.btn:not(.ghost):not(.danger)` `.seg button.on` `.toggle[aria-checked="true"]` | 主按钮渐变 |
| `.field:focus` | 焦点光圈颜色（默认写死了粉色，必须覆盖） |
| `#tabbar button.on` | 选中的标签 |
| `.badge` | 角标（朱砂印，方一点） |
| `.stamp::after` | 聊天里的时间分隔线（默认是饼干棒；纯阳是内联 SVG 的剑，白天晚上各一份放在变量里） |
| `#auth .sub::after` | 登录页副标题下的纹样 |
| `::selection` | 选中文字的颜色 |

做纹样时注意：

- 用 `mask` 的地方加 `@supports not` 兜底，不支持时直接不画，不能出现色块。
- 纹样别压在可点的控件上（纯阳一开始在登录卡片右上角也放了祥云，深色下叠到了「登录 / 注册」上，后来去掉了）。`.panel>*` 要 `position:relative;z-index:1`，纹样才在内容下面。
- 深色模式里吉祥物头像有浅色底（`--mascot-bg`），这是默认就有的，保持。

### 4. 素材（交给 Codex，按 `gpt-assets` skill）

放在 `chat/skins/<id>/`，纯阳的规格可以照抄：

| 文件 | 规格 |
|---|---|
| `scene-day.jpg` / `scene-night.jpg` | 1024×1536 竖图，每张 ≤ 220KB。一对，构图和视角相同。**下半部分 55% 要平静、低对比**（玻璃面板压在上面），没有人物和文字 |
| 纹样（纯阳的 `cloud.png`） | 768×128 透明 PNG，纯白线条、无填充、无阴影（只当 `mask` 用，只看 alpha），四角 alpha 为 0，≤ 40KB |
| 徽记（纯阳的 `taiji.png`） | 256×256 透明 PNG，主体约 80%，四角 alpha 为 0，≤ 60KB；要在 22px 下认得出 |

提示里写清：这是哪个门派 / 主题、配色、风格（纯阳是「水墨加水粉、清雅、不卡通」），参考 `chat/sling/bg-day.jpg`、`bg-night.jpg` 的柔和程度，但不要照抄它们的暖色。生成后自己看每一张（`gpt-assets` 第 4 节），纹样要放在深色底上看线条是否干净。

### 5. 注册

1. `chat/js/skins/index.js` 的 `SKINS` 加一项：`{ id: '<id>', name: '<名>', look: true, hint: '<一句话说明，最后写「只影响你自己看到的样子。」>' }`。
2. `chat/index.html`：`<link rel="stylesheet" href="css/skin-<id>.css">` 放在 `skin-chunyang.css` 旁边；`theme-init` 脚本里的 `C` 表加 `<id>:['<白天顶栏色>','<晚上顶栏色>']`（顶栏色取场景最上面的颜色）。
3. `chat/js/theme.js` 的 `SKIN_COLOR` 加同样的两个颜色。
4. 要固定吉祥物的话，`chat/js/mascot.js` 的 `SKIN_MASCOT` 加 `<id>: <CHARS 下标>`。

`me.js` 的皮肤选择器、`applySkinLook()`、`main.js` 启动时的调用都不用改。

### 6. 截图和预览（给用户看，再开 PR）

在 scratchpad 里准备 Playwright（只要一次）：

```bash
P=<scratchpad>/pwskin && mkdir -p $P && cp .claude/skills/app-skin/tools/{shots.mjs,fake-sb.js} $P/ && cd $P && npm init -y >/dev/null && npm i playwright@1 >/dev/null
```

`shots.mjs` 用本机的 Chrome（`/Applications/Google Chrome.app/...`），起一个本地静态服务（端口 8079）读工作树，把页面里的 `supabase.js` 换成 `fake-sb.js`，在 `localStorage` 写好 `chat.skin`。截 13 个页面：登录、消息、好友、我的、皮肤设置、私聊、长按菜单、表情、+ 面板、排行榜、小程序大厅、群聊、群资料。

```bash
# 新皮肤：白天 + 晚上
WT=<工作树> OUT=<scratchpad>/shots/<id> SKIN=<id> node shots.mjs
# 默认外观的对比图（预览页的「和默认外观对比」用）
WT=<工作树> OUT=<scratchpad>/shots/<id> SKIN=default SCHEMES=light ONLY=02-chats,06-dm,04-me node shots.mjs
```

最后一行打印 `ERRORS`：应该是 `none`。出现皮肤图片的 404 说明路径写错了；页面报错要先修好再截图。

**自己先看**：每张都用 Read 看一遍，白天和晚上都看。重点：玻璃面板上的字看不看得清、纹样有没有压到控件、深色下有没有残留默认的暖色、按钮和选中态是否统一。

然后生成预览页并发布给用户看：

```bash
python3 .claude/skills/app-skin/tools/build-preview.py <scratchpad>/shots/<id> <id> <名> <scratchpad>/preview/<id>-skin.html "<一句话说明>"
```

用 Artifact 工具发布这个 html（首次发布带 `icon: "palette"` 和一句 `description`），把链接给用户。用户要改就改完重新截图、用同一个文件路径重新发布（链接不变）。

### 7. 检查和 PR

1. `node --check` 改过的 JS；仓库根目录 `npx -y eslint@9 chat` 0 错误。
2. `theme-init` 是内联脚本，`node --check` 管不到：把它抠出来单独 `node --check` 一次。
3. CI 的「Chat images exist」会检查 CSS 里引用的图片是否存在：`url(../skins/<id>/...)` 的文件都要提交。
4. 默认皮肤和沙子皮肤各截一张私聊，确认没被新皮肤影响（所有规则都带 `[data-skin]` 前缀就不会）。
5. PR 说明写：皮肤名、改了哪些、没改哪些（聊天页底色等）、素材由 GPT 生成（Codex imagegen）的文件列表、预览页链接、没测到的部分（真机、各种安卓自带字体下宋体的样子）。

## 排查

| 症状 | 原因 |
|---|---|
| 晚上某处还是默认的暖棕色 | 那个颜色在组件 CSS 里写死了（`rgba(24,14,6,…)` 一类），或者是 `--chat-bg`（聊天页底色，按规则不改）。前者在皮肤 CSS 里加带前缀的覆盖 |
| 自动模式下是皮肤白天 + 默认晚上的混合 | 漏了 `prefers-color-scheme` 那一块 |
| 刷新时先闪一下默认样式 | `theme-init` 的 `C` 表没加这个皮肤 |
| 浏览器顶栏颜色不对 | `C` 表或 `SKIN_COLOR` 的颜色没写 / 两边不一致 |
| 输入框聚焦时还是粉色光圈 | 没覆盖 `.field:focus`（默认写死了粉色） |
| 纹样变成一块色块 | 图片不是透明底，或者浏览器不支持 `mask` 而又没有 `@supports` 兜底 |
