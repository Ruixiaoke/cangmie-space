---
name: fx-emoji
description: 聊天里「特效表情」（[水枪]、[雪球]、[送花] 这类全屏动画表情）的完整逻辑与改动清单。用于新增一个特效表情、改某个特效的动画、增加或调整气泡状态（湿透、冻住、发热、爱心、吃撑、花环、睡着）和它们之间的相互作用、新增三连大招或配方、排查特效不播 / 播错 / 两边看到的状态不一致。只要改动碰到 chat/js/fx/、chat/js/bubble/、chat/js/recipes.js 或 chat/css/effects.css，就先读这个 skill。
---

# 特效表情（fx）

特效表情是一条普通聊天消息，正文就是一个 token，比如 `[水枪]`。它会做两件事：

1. **全屏动画**：在 `#fxStage` 上演一段，打向对方（我发的打对方头像，对方发的打我）。
2. **气泡状态**：改变「被打的人」所有气泡的样子（湿透、冻住……），并按时间慢慢消退。

两件事都**完全由聊天记录推出**，不改数据库，不加字段。两台设备只要消息一样，看到的状态就一样。

代码是唯一的真相来源。下面的描述用来定位；动手前先读对应文件。

## 文件地图

| 文件 | 管什么 |
|---|---|
| `chat/js/fx/table.js` | `FX` 表（每个特效一项）、`fxParse` / `fxOf`、消息列表预览 `previewOf` |
| `chat/js/fx/effects.js` | 每个特效的单独全屏动画 `fxWater` / `fxHammer` …… |
| `chat/js/fx/combos.js` | 三连大招动画和 `COMBO` 表 |
| `chat/js/fx/battle.js` | 对战动画 `fxBattle`、状态变化在舞台上的补充粒子 `stageExtra`、名牌 `stageTag`、`overlay` |
| `chat/js/fx/prims.js` | 动画零件：`part` 放粒子、`anim` 包装 WAAPI、`tf` 坐标、`centerOf`、`squash`、`say` 气泡字、`rnd` |
| `chat/js/fx/engine.js` | 播放队列 `playFx` / `nextFx` / `runFx` / `stopFx` |
| `chat/js/bubble/state.js` | **纯函数**状态机：`bubbleStep`（一次命中）、`decayState`（时间衰减）、`bubbleFold`（走一遍整段聊天记录），夹在 `// @reducer-begin` 和 `// @reducer-end` 之间 |
| `chat/js/bubble/bev.js` | `BEV` 表：每种「变化事件」在气泡上的 CSS 动画类和小粒子 |
| `chat/js/bubble/view.js` | 显示状态与推出状态的同步 `syncShow`、`releaseBev`（全屏动画演到命中时才放出气泡变化）、每分钟衰减 `startDecay`、`reduced()` |
| `chat/js/chat/view.js` | `renderMsgs` 调 `bubbleFold`、排队变化事件；`stClasses` 把状态变成 `st-*` 类；`refreshCls` |
| `chat/js/chat/row.js` | 特效消息的气泡外观（`.bubble.fx`）、定向攻击的引用文字、状态装饰 `buildDeco`（水滴、爱心、花……） |
| `chat/js/recipes.js` | 配方图鉴 `RECIPES`（有名字的变化、三连、对战），第一次现场看到时 `unlockRecipe` 解锁 |
| `chat/js/composer.js` | 表情面板里的特效按钮行 `#fxRow`（遍历 `FX`） |
| `chat/js/menu.js` | 长按气泡的「定向攻击」选择器 `#fxPick`（遍历 `FX`，发 `token#消息id`） |
| `chat/js/send.js`、`chat/js/realtime.js` | 自己发出 / 收到新消息时调用 `playFx` |
| `chat/js/quote.js` | 引用一条特效消息时显示 `fx.name` |
| `chat/css/effects.css` | 舞台 `#fxStage` / `.fx-*`、气泡状态 `.row.st-*`、变化动画 `.ev-*`、状态颜色变量 `--wet-bg` 等 |
| `supabase/functions/send-push/index.ts` | 推送正文：定向的 `[雪球]#123`、`[雪球]@uuid` 去掉后面的 id 再推 |

## 榴莲（agent）的消息不参与特效

`messages.author = 'durian'` 的行是 AI 助手榴莲的回复，正文可能恰好是 `[水枪]` 这样的文字，但它**不是**特效：
`renderMsgs` 和 `tickDecay` 喂给 `bubbleFold` 之前过滤掉有 `author` 的消息，`row.js` 对它不解析 fx / 小游戏，
`realtime.js` 不对它 `playFx`，长按菜单不给「用表情打」。新增和 fx 有关的入口时，记得同样跳过 `m.author`。

## 消息格式

- 普通特效：`[水枪]`。打中对方这个人的**所有**气泡。
- 定向特效：`[水枪]#123`，`123` 是对方某条普通消息的 id。只改那一条气泡（`tstates`）。
- 群里 @ 某人：`[水枪]@<用户uuid>`。只打那一个人的所有气泡。在输入框里 @ 了群成员再点特效按钮就会发这种（`send.js` 的 `sendFx`，发完把那个 @ 从输入框拿掉）。
- 群里什么都不指定：`[水枪]` 打**所有人**（`bubbleFold` 的第三个参数 `members` + 聊天记录里出现过的人，发的人自己除外）。舞台上不放发的人，而是 `groups/ui.js` 的 `makeCrowdAvatar` 把其他人的小头像排进一个圆里。
- 群里的对战只算互相 @ 对方的回敬；只有我是其中一方时才演对战，旁观的人看普通动画。
- 正则 `FX_RE = /^(\[[^\[\]#@]{1,4}\])(?:#(\d{1,15})|@(uuid))?$/i`：**token 方括号里最多 4 个字**。token 必须是 `FX` 表的键，否则当普通文字显示。
- 因为是纯文字，旧版本客户端、推送通知里也能看懂。别给 token 加别的语法。

## 数据流

```
发送（composer / menu）── sendBody(token) ──> messages 表
                                             │
自己：send.js playFx(m)          对方：realtime.js 收到 → isVisible() 时 playFx(m)
                                             │
renderMsgs（chat/view.js）
  bubbleFold(c.msgs, now) → states / tstates / evs / info
  c.finfo = info（每条特效消息：combo? counter? ev x tid）
  新出现的 ev → 排进 c.bev（还不显示，等全屏动画）
                                             │
engine.js runFx：按 info 选模式
  replay（点旧气泡重播）→ plain，不改状态、不触发三连 / 对战
  info.combo  → COMBO[tok].play + 名牌
  info.counter → fxBattle（两个头像对战）
  否则        → fx.play(st, av, info)，再叠 stageExtra（有名字的变化在舞台上补粒子和名牌，时间对准 fx.at）
  演完 → releaseBev(key)：把这条消息的气泡变化放出来（改 st-* 类 + BEV 动画 + 解锁配方）
```

要点：

- **队列**：最多排 3 个，多的直接 `releaseBev`（状态照常变，只是不演）。页面不可见时不演。
- **三连**：同一个人 8 秒内连发 3 个同款（`COMBO_MS`）。第三个直接演大招，并丢掉队列里还没开演的同款；正在演的同款被 `curAbort` 打断。
- **对战**：对方刚发过同款，10 秒内回敬（`COUNTER_MS`）。
- **减少动态效果**（`prefers-reduced-motion`）：全屏只显示头像 + 说明文字，不跑动画；气泡变化也不播（状态类照常变）。
- **衰减**：`decayState` 只看时间。每分钟 `tickDecay` 重算一次，只改类不播动画。时间全部来自消息的 `created_at`，所以两边一致。

## 状态机（`bubbleStep`）

状态 `{ k, lv, as, t, ta }`：`k` 主状态，`lv` 等级（love / plump 1 到 3），`as` 睡着（可以和主状态叠加），`t` / `ta` 计时起点。

主状态：`normal`、`wet`、`frozen`、`hot`、`love`、`passion`、`plump`、`bloom`。消退时长在 `DECAY` 里（比如冻住 1 小时后变湿，湿 12 小时后恢复）。

每个 `case '[token]'` 按「当前状态」返回 `r(新状态, 等级, 变化事件名, 是否重置计时)`。变化事件名（`ev`，如 `steambath`、`shatter`）同时是：

- `BEV` 表的键（气泡动画），
- 可选：`RECIPES` 里的配方 id（有名字的变化才进图鉴），
- `stageExtra` 用它在全屏舞台上补粒子和名牌。

`x` 是额外动作：`wake`（睡着的人被叫醒）、`gentle`（轻拍睡着的人）。被打的人自己发普通消息也会醒。

## 新增一个特效表情：清单

假设新增 `[泡泡]`（名字示例）。

1. **`fx/table.js`**：`FX` 里加一项：
   ```js
   '[泡泡]': { icon: '…', name: '泡泡', own: '你朝 {n} 吹了泡泡', peer: '{n} 朝你吹了泡泡', hit: '泡住了「{q}」', at: 800, play: fxBubble },
   ```
   - `own` / `peer` 是舞台说明，`{n}` 换成对方昵称；`hit` 是定向攻击的说明，`{q}` 是被打那条消息的摘要。
   - `at`：全屏动画里「命中」那一刻（毫秒），`stageExtra` 的粒子和名牌从这里开始。
   - token 方括号里不超过 4 个字，不能含 `[` `]` `#`。
   - `FX` 的顺序就是表情面板和定向选择器里的顺序。
2. **`fx/effects.js`**：写 `export function fxBubble(st, av)`，**返回动画总时长（毫秒）**。只用 `prims.js` 的零件；粒子用 `part(..)` 放、`anim(.., true)` 演完自动删除。头像 `av` 可以用 `anim` 抖、用 `squash` 压扁。坐标从 `centerOf(st, av)` 取，宽高从 `st.clientWidth / clientHeight` 取，别写死像素位置。
3. **`bubble/state.js`**：在 `bubbleStep` 的 `switch` 里加 `case '[泡泡]'`，**每个已有状态都要想一遍**会变成什么，落到哪个事件名。没有特别变化就返回一个通用事件（像 `bonk`、`bounce`、`wobble`）。如果引入新的主状态：
   - 在 `DECAY` 加时长，在 `decayState` 加消退规则；
   - 其他所有特效的 `case` 也要决定遇到这个新状态怎么办；
   - `chat/view.js` 的 `stClasses` 加 `st-新状态` 类，`chat/row.js` 的 `buildDeco` 加装饰，`bubble/bev.js` 的 `FROM_VARS` 加颜色变量，`effects.css` 加 `.row.st-新状态` 和 `--新状态-bg/-bd/-fg`（浅色、深色两套都要）。
4. **`bubble/bev.js`**：每个新事件名在 `BEV` 里加一项：`{ a: [粒子, 个数, 运动方式], b: 可选第二种粒子, cls: 'ev-…' }`。运动方式只能用已有的：`spray`、`up`、`burst`、`steam`、`fling`、`fall`、`spit`、`orbit`、`star`（两处实现：`bevPart` 用于气泡，`battle.js` 的 `stageOne` 用于舞台，新增方式两处都要加）。新的 `ev-*` 动画写在 `effects.css`。
5. **`fx/combos.js`**（可选）：写 `cmbBubble(st, av)` 返回时长，`COMBO` 里加 `'[泡泡]': { id: 'c_bubble', name: '…', play: cmbBubble }`。
6. **`recipes.js`**（可选）：有名字的变化、三连大招要进图鉴就在 `RECIPES` 加 `{ id, name, icon, hint }`，`id` 等于事件名或 `COMBO` 的 id。没进 `RECIPES` 的事件只播动画，不解锁。
7. **推送**：`send-push` 的正则 `^(\[[^\[\]]{1,6}\])#\d+$` 已经通用，一般不用改。
8. 不需要改：`composer.js`、`menu.js`、`quote.js`、`engine.js`（都遍历 `FX` 或只看 `fxParse`）。

## 只改某个特效的动画

只动 `effects.js` 里那一个函数（或 `combos.js` 的大招）。注意：

- 返回值是总时长，`runFx` 用它决定何时淡出舞台。动画变长要同步改返回值；命中时间变了要同步改 `FX` 里的 `at`。
- 动画开始前 `runFx` 已经放好头像（116px）和说明文字，别再自己加。
- 所有可选能力（`navigator.vibrate` 等）包在 `try/catch` 里；`runFx` 本身也会吞掉动画异常，退回静态展示，所以出错时**表面上看不出来**，要看控制台。

## 不能破坏的约束

- **状态必须是聊天记录的纯函数**：`@reducer-begin` 到 `@reducer-end` 之间不能读 DOM、`Date.now()`、`Math.random()`、localStorage 或任何设备相关的东西。时间只用消息的 `created_at`（`meta.ts`）。否则两台设备会看到不同状态。随机只能出现在动画里。
- 只有「被打的人收到的普通消息」能被定向攻击；特效消息本身、自己的消息不行（`bubbleFold` 里已有检查）。
- 特效气泡本身（`el._fxb`）不加状态装饰。
- 新增粒子要 `aria-hidden`（`part` 已处理）；说明文字是唯一给读屏的内容。
- 深色模式：所有颜色走 `effects.css` 的变量，浅色、深色都要检查。
- **素材一律用 GPT 生成**（见 `gpt-assets` skill）。新特效的图标、道具、粒子图案做成 PNG（放 `chat/fx/`），用 `<img>` 或 canvas 显示，不再用 emoji 字形；`part()` 现在只放文字，放图片时给它一个 `<img>` 子元素或新写一个零件函数，并在图片加载失败时退回简单形状。现有特效里的 emoji 暂时保留，用户要求改版时再替换。

## 验证

1. `node --check` 改过的 JS；仓库根目录 `npx -y eslint@9 chat` 必须 0 错误（CI 会跑）。
2. 状态机：在本地起 `python3 -m http.server`，打开 `/chat/` 后在浏览器控制台（或 Playwright 的 `page.evaluate`）里
   ```js
   const { bubbleFold } = await import('/chat/js/bubble/state.js');
   bubbleFold([{ key: 1, id: 1, sender_id: 'A', receiver_id: 'B', body: '[雪球]', created_at: '2026-01-01T00:00:00Z' },
               { key: 2, id: 2, sender_id: 'A', receiver_id: 'B', body: '[泡泡]', created_at: '2026-01-01T00:00:05Z' }], Date.parse('2026-01-01T00:00:10Z'));
   ```
   检查 `states.B`、`evs[i].ev`、`info[key].combo / counter`。新特效对每个已有主状态都跑一遍，再测：三连（8 秒内 3 次）、对战（10 秒内回敬）、定向（`[泡泡]#id`）、衰减（`now` 推后超过 `DECAY`）。
3. 动画：真页面里发一次、三连一次、定向一次，各截图；浅色、深色；再开一次「减少动态效果」确认只显示静态说明。手机宽度 390 和 375 都看。
4. 点旧的特效气泡会重播（replay），重播不能改状态、不能解锁配方。
