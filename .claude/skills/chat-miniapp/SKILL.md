---
name: chat-miniapp
description: 聊天页里「小程序」（井字棋、弹弓大战、9球/8球台球这类双人回合制小游戏）的架构与开发清单：宿主 host.js、注册表、+ 面板、聊天里的邀请卡片、Supabase 表和 RPC、实时同步、推送、排行榜、测试和 PR 流程。新做一个小程序、给已有小程序加模式 / 功能、改小程序的布局或同步逻辑、排查卡片不刷新 / 回合不同步 / 推送不对时，先读这个 skill。
---

# 聊天小程序

小程序是聊天页里的一整层（`#appLayer`），垫在消息下面。消息变成一条半透明的「带子」漂在上面，同一时间只开一个。
现有三个，都是**好友之间的双人回合制游戏**：`chat/js/miniapps/ttt.js`（最简单，先读它）、`sling.js`（Matter.js 物理）、`pool.js`（自写的确定性物理）。

代码是唯一的真相来源，下面用来定位。动手前把 `ttt.js` 和 `host.js` 完整读一遍。

## 文件地图

| 位置 | 管什么 |
|---|---|
| `chat/js/miniapps/registry.js` | `listMiniApps()`：注册表。用函数而不是顶层数组，避免循环导入时 TDZ |
| `chat/js/miniapps/host.js` | 宿主：`openApp(id, params)` / `closeApp()` / `layoutApp()`、消息带子、`APP.cur` |
| `chat/js/plus.js` | 「+」面板：遍历注册表生成按钮，外加排行榜入口 |
| `chat/js/miniapps/<名字>.js` | 小程序本体：界面、本地缓存、和后端同步、聊天卡片 |
| `chat/js/miniapps/sling.js` 的 `gameKind(body)` | 把邀请消息识别成 `{ k, id }`，聊天行据此显示成卡片 |
| `chat/js/chat/row.js` | 卡片行：`el._gcid` / `el._gkind`，不当文字气泡，不加特效状态 |
| `chat/js/realtime.js` | 订阅各游戏表的 `postgres_changes`，回调 `onXxxGame` |
| `chat/js/session.js` | 退出登录时调用各小程序的 `xxxReset()` |
| `chat/js/fx/table.js` `previewOf`、`chat/js/quote.js` `quoteText`、`chat/js/menu.js` | 会话列表预览、引用文字、长按菜单（卡片不显示「复制」「定向特效」） |
| `chat/js/notify.js` `firePush(type, id)` | 让对方收到推送 |
| `supabase/functions/send-push/index.ts` | 推送正文：邀请消息 `pushText`、每种 `xxx_turn` 事件 |
| `chat/js/miniapps/leaderboard.js` + `supabase/migrations/*_leaderboard.sql` | 胜场排行榜（我 + 好友），每个游戏一个 tab |
| `supabase/functions/agent-chat/games.ts` | 榴莲（聊天里的 AI）看小游戏：`game_status` 工具、`game_leaderboard` 工具、user input 里「进行中的小游戏」一行。只读，按「这一对好友」过滤 |
| `supabase/migrations/*_agent_game_record.sql` | `game_win_events`（胜负计数规则的唯一来源，排行榜和榴莲共用）、`agent_game_record`（只给 service role：这两个人的总胜负 + 交手） |
| `chat/css/plus-miniapps.css` | 宿主层、带子、卡片 `.gcard` / `.gc-*` 的通用样式 |
| `chat/css/<名字>.css`、`chat/<名字>/` | 小程序自己的样式和素材 |
| `supabase/migrations/<日期>_<名字>.sql`、`supabase/tests/<名字>_test.sql` | 表、RLS、RPC、实时发布；SQL 测试 |

## 小程序接口

```js
export var xxxV = {
  id: 'xxx',            // 唯一 id，也是 APP.cur.id
  scope: 'dm',          // 'dm' = 只在私聊里出现（双人游戏）；'group' = 只在群聊里出现；'any' = 私聊和群聊都有（斗地主）。+ 面板和 openApp 都按它过滤，没有一个匹配的工具时 + 按钮会藏起来
  label: '名字',         // + 面板上的字
  icon: 'i-grid',       // SVG 符号 id；或用 img: 'xxx/icon.png'（+ 面板优先用 img）
  run: function () {},  // 点 + 面板按钮：一般是调 RPC 开局，成功后 openApp('xxx', { id })
  mount: function (box, params) {},  // 在 box 里建界面；params 通常是 { id: 对局 id }
  unmount: function () {},           // 清计时器、requestAnimationFrame、监听；置空模块级状态
  same: function (a, b) { return a.id === b.id; }, // 同一局已开着就不重开
  update: function (g) {},           // 自定义：新的对局状态到了（不是宿主调用的，是本模块 putGame 调的）
  strip: 'hidden',      // 可选：消息带子默认完全收起，顶栏出现「消息」按钮和未读数（大画面游戏用）
  flush: true           // 可选：去掉宿主内边距，内容贴边
};
```

- 新增：写 `miniapps/xxx.js`，在 `registry.js` 的 `listMiniApps()` 加一行。+ 面板和宿主自动读到。
- 宿主只负责层和布局。尺寸从 CSS 变量 `--app-top` / `--app-bot` / `--app-h` 拿；画布类游戏要监听尺寸变化自己重算（参考 `pool.js` 的布局函数）。
- `unmount` 里任何异常都被宿主吞掉，所以清理要写对，不能靠报错发现。

## 群聊（groups）

群聊复用同一个聊天页：`S.chat = { peer: null, gid }`（私聊是 `{ peer, gid: null }`），`rowInChat(c, row)` / `convKey(c)`（`state.js`）判断一条消息或异步结果属不属于当前会话，别再直接比 `S.chat.peer`。
表和函数在 `supabase/migrations/20261202000000_group_chat.sql`：`groups`、`group_members`、`messages.group_id`（群消息 `receiver_id` 为空）、`send_group_message(p_group, p_body, p_reply_to)`、`list_groups()` 等；`author = 'system'` 是系统提示行。
做群里的多人游戏：`scope: 'group'`，成员和权限看 `group_members`（RLS 里用 `my_group_ids()`），邀请消息用 `send_group_message` 发，群里 `gameKind` 不解析（`row.js` 对群聊一律当普通文字），要显示卡片得单独接。

## 一局游戏的数据流（以井字棋为例）

```
+ 面板 run() → sb.rpc('xxx_start', { p_peer })
   服务器：校验好友 → 已有进行中的对局就直接返回它 → 否则建表行，并以发起者身份插入一条消息 "[名字]#对局id"
   → 前端 putGame(g) → openApp('xxx', { id })
聊天里那条消息 → gameKind() 识别 → 显示成卡片（xxxFillCard 用缓存画缩略状态；缓存没有就批量 fetch）
每一步 → sb.rpc('xxx_move', …)（服务器校验回合、合法性，for update 锁行，更新 updated_at）
   → 返回新状态 → putGame；对方通过 realtime 收到 UPDATE → onXxxGame → putGame
putGame：updated_at 更旧的不覆盖新的 → 刷新所有卡片 → 如果正开着这一局就 xxxV.update(g)
对方不在这一局里、页面可见、轮到他：toast('轮到你了（名字）')；页面不可见时靠推送
```

关键约定：

- **邀请消息格式** `[名字]#数字`，前端用 `xxxOf(body)` 正则识别，返回对局 id。不能和特效表情的 token 冲突（特效是方括号里 1 到 4 个字，并且必须在 `FX` 表里）。
- **一个对局缓存**：`{ games: {}, want: [], pend: {}, tm }`，`games[id] === null` 表示查过但没有（卡片显示「对局不可用」）。`xxxResync()` 在重连后重新拉；`xxxReset()` 在退出登录时清空。
- **服务器是唯一的裁判**：所有落子、出手都走 security definer RPC，表上只给 `select`。前端只做乐观显示，服务器返回为准。
- **物理类游戏**（弹弓、台球）：出手方本地模拟并上传结果快照，对方拿 `(出手前状态, 输入)` 重放再对齐快照。台球的模拟只用加减乘除和 `Math.sqrt`，保证两台设备结果一致；改模拟时必须保持这一点。重放期间别提前显示结果（比分等到重放演到那一刻再变，见 `pool.js` 的 `plShownScores`）。

## 新做一个小程序：清单

1. **后端** `supabase/migrations/<下一个日期>_<名字>.sql`（CI 会把所有迁移**跑两遍**，必须可重复执行：`create table if not exists`、`create or replace function`、`drop policy if exists` 再建、`add column if not exists`）：
   - 表 `xxx_games`：两个玩家列、`status`、`next_player`、`winner`、`updated_at`、`message_id` 等，索引，`enable row level security`，`revoke all` 后只 `grant select to authenticated`，select 策略只让两个玩家看。
   - RPC `xxx_start(p_peer uuid)`、`xxx_move(...)`、`xxx_resign(p_game)`，需要的话 `xxx_rematch`：`language plpgsql security definer set search_path = ''`，表名全写 `public.` 前缀；`auth.uid()` 为空抛 `not_authenticated`；校验好友关系（`public.friendships` 里 `status = 'accepted'`）；改状态前 `select … for update`；出错用短英文错误码（`not_your_turn`、`game_over` …），前端 `errors.js` 的 `errText` 翻成中文（新错误码要加进去）。
   - `revoke execute … from public, anon` + `grant execute … to authenticated`。
   - 把表加进 `supabase_realtime` publication（照抄 `20261119000000_tictactoe.sql` 末尾的 `do $$ … $$`，publication 不存在时跳过）。
   - 测试 `supabase/tests/<名字>_test.sql`：照现有测试的写法模拟两个用户，覆盖开局、非好友、轮次、非法操作、认输、结束后不能再动、RLS 看不到别人的对局。
2. **前端模块** `chat/js/miniapps/<名字>.js`：照 `ttt.js` 的结构写 `xxxOf`、`xxxReset`、`xxxResync`、`xxxFillCard`、缓存和批量拉取、`putGame`、`onXxxGame`、`xxxStartHere`、`xxxV`。
3. **接入点**（每一处都要加，漏一处就有地方把邀请消息当成普通文字）：
   - `registry.js` 注册；
   - `sling.js` 的 `gameKind` 加一支；`chat/row.js` 里按 `el._gkind` 分派 `slFillCard` / `poolFillCard` / `tttFillCard` 的那一行加上新的 `xxxFillCard`；
   - `realtime.js` 订阅新表（每个玩家列一个 filter），并在重连补数据的那一行（和 `tttResync(); slResync(); poolResync();` 一起）调 `xxxResync()`；
   - `session.js` 退出时 `xxxReset()`；
   - `fx/table.js` 的 `previewOf`、`quote.js` 的 `quoteText`、`menu.js` 的「复制」和「定向特效」两处排除；
   - `send-push` 的 `pushText` 加邀请文案；需要回合推送就加新的事件类型（`PushEvent` 类型、白名单数组、处理分支：校验记录是调用者刚创建的 `isFresh`，只推给对手），前端在对应时机 `firePush('xxx_turn', id)`。
4. **排行榜**（游戏要算胜场时）：`game_leaderboard` 的参数白名单和 `game_win_events`（计数规则的唯一来源，新迁移里 `create or replace`）加这个游戏，`leaderboard_test.sql` 加断言；`leaderboard.js` 的 `GAMES` 加一项（`note` 写清楚怎么算一胜）；小程序里 `box.appendChild(rankButton('xxx', 'rk-fab'))`。
5. **榴莲看得到它**（聊天里的 AI 助手，`supabase/functions/agent-chat/games.ts`）：新游戏必须接进去，否则榴莲对它一无所知。
   - `TABLE` / `KINDS` / `KIND_NAME` 加一项（玩家列、要取的列），`gameHint` 会自动给出「进行中的小游戏」一行；
   - 写一个 `xxxDetail(g, asker, names)`，在 `gameStatus` 里分派：返回紧凑的 JSON（昵称而不是 uuid，提问人标 `(提问人)`），给出规则相关的预计算（合法着法、必胜 / 必堵、粗略建议），整体不超过 `STATUS_MAX_CHARS`；规则和尺寸是客户端代码的精简移植，改规则时两边一起改；
   - `game_status` 工具的 `game` enum 和描述（`agent.ts` 的 `TOOLS`）加上新游戏；工具列表必须对所有人完全一致（提示词缓存）；
   - 要算胜场：把计数规则加进 `game_win_events`（新迁移里 `create or replace`），`BOARD_GAMES` 加游戏名，`agent_game_record_test.sql` 补断言；
   - `games_test.ts` 补测试：详情形状、跨好友对的 id 被拒、提示行。
   榴莲只读：工具里绝不能出现落子、出杆、认输、开局。
6. **样式** `chat/css/<名字>.css`，在 `chat/index.html` 里 `plus-miniapps.css` 后面引入（井字棋的样式在 `plus-miniapps.css` 里，是早期写法，新游戏用单独文件）。颜色用 `tokens.css` 的变量，浅色 / 深色都要好看。触控目标至少 44×44。
7. **素材**：一律用 GPT 生成，按 `gpt-assets` skill 交给 Codex。界面里**不用 emoji**（按钮、标签、提示、推送文字都不用）。每张图都要有加载失败的兜底。
8. **文案**：中文、简短、口语，和现有的「轮到你了」「等 Ta 下」一个语气。UI 文字里不用破折号。

## 已有的约定，别破坏

- 同一时间只开一个小程序；`openApp` 遇到同一局（`same` 为真）直接保留。
- 开着小程序时，`#msgs` 里的游戏卡片行整行隐藏（`.row-game`），消息带子只显示最新几条，点击穿透到游戏层。
- `strip: 'hidden'` 的游戏：带子默认 0 高，顶栏「消息」按钮带未读数（只算对方发的），展开后约 30% 高。
- 页面可见且用户正看着这一局时，不弹 toast、不推送（`push_active` 机制在服务端抑制活跃用户的推送）。
- 弹弓、台球的画布动画在 `document.hidden` 时暂停；`requestAnimationFrame` 在 `unmount` 里取消。
- 现有三个游戏的行为改动必须是有意的：改共享代码（`host.js`、`plus-miniapps.css`、`leaderboard.js`）后，三个游戏都要截图对比。

## 开发流程（这个仓库的习惯）

1. 从 `origin/main` 开 git worktree（放在 scratchpad），主目录可能有别的会话在用。
2. 功能交给 Sonnet 子代理（`Agent`，`model: "sonnet"`），在 worktree 里写代码、跑测试、本地 commit；同时用 Codex 生成素材（`gpt-assets`）。主会话负责定规格、审代码和截图。
3. 本地检查：
   - `node --check` 改过的 JS；仓库根目录 `npx -y eslint@9 chat` 0 错误。
   - SQL：Docker 起 Postgres 16，按 CI 的顺序跑：`supabase/ci/stubs.sql` → 所有迁移跑两遍 → 授权 → `supabase/tests/*.sql`（命令见 `.github/workflows/ci.yml` 的 Backend checks）。
   - 浏览器：`python3 -m http.server` 起本地服务，Playwright 把 `**/supabase.js` 路由成一个假的 Supabase 客户端（假 `from().select()`、`rpc()`、`channel()`，返回预设的对局和消息），在 localStorage 写 `chat.devSupabaseUrl` / `chat.devSupabaseAnonKey`，打开 `/chat/?peer=<id>`，用 `import('/chat/js/miniapps/host.js')` 的 `openApp` 打开小程序。截图：390×844 和 375×667，浅色和深色；覆盖开局、对方回合、赢 / 输 / 认输、再来一局、卡片。
   - 物理类游戏的确定性：同一输入在两次独立模拟里结果逐位相同。
4. 审过后直接 push 并 `gh pr create`（不用问），多个 PR 有依赖时写明合并顺序。合并由用户来做。合并后看部署工作流（前端 Pages、后端迁移和 Edge Function）是否成功，再清理 worktree 和本地分支。
5. 汇报里写清楚没测到的部分：真机、真实实时同步、推送、两台设备对打。

## 斗地主（群聊和私聊里的三人 / 四人游戏，`scope: 'any'`）

- 前端 `miniapps/ddz.js`（缓存、卡片、实时、开桌）+ `ddz-view.js`（牌桌界面和日志回放）+ `ddz-token.js`（`[斗地主]#id` 识别，群聊和私聊里都是卡片；其他三个游戏的邀请消息在群里还是普通文字）+ `ddz-rules.js`（规则引擎，浏览器和服务器共用，`supabase/functions/ddz/gen-rules.py` 复制成 `rules.gen.js`）。
- 座位：一桌 4 个座位槽。开始时服务器数一下坐了几个（真人 + 机器人）：不够 3 个就往空位补机器人补到 3 个；3 个是三人局，4 个是四人局（`pub.players`）。座位按顺序压紧（0..n-1 就是出牌顺序），之后引擎座位 = 座位槽；再来一局保持座位和人数。开始按钮的文案要写清楚：「开始（三人局，补 N 个机器人）」「开始（三人局）」「开始（四人局）」。
- 四人局规则（两副牌 108 张，牌编码 0..107，`base = c % 54`，每人 25 张 + 8 张底牌；没有三带一 / 飞机带单 / 四带二；炸弹 4 到 8 张，张数多的大；天王炸 = 四张王）写在 `ddz-rules.js` 顶部的注释里。`classify / beats / hints` 的可选最后一个参数 `rules`（4 或带 `players` 的状态）决定变体，不传就是三人局。
- 桌子属于一个群（`group_id`）或一对好友（`dm_lo < dm_hi`，二选一）。私聊桌：`ddz_open_dm(p_peer)` 开桌并给对方发 `[斗地主]#id` 普通私聊消息；权限是这两个人且还是 accepted 好友（`ddz_pair_access`，RLS 和 Edge Function 都按这个）；好友关系结束时触发器关桌。累计积分群里按 `(group_id, user_id)`，私聊按 `(dm_lo, dm_hi, user_id)`（两个部分唯一索引）。私聊里对局结束不写系统提示行（私聊里没有系统作者）。
- 实时：`ddz_games` 订阅用 `id=gt.0`（私聊桌的 `group_id` 是空的），`ddz_scores` 群用 `group_id=gt.0`、私聊用 `dm_lo` / `dm_hi` 各一条。
- 后端：大厅在 SQL（`ddz_open / ddz_open_dm / ddz_sit / ddz_stand / ddz_set_bot`），开始（补机器人、压座位）/ 叫分 / 出牌 / 超时托管 / 结算在 Edge Function `ddz`（`game.ts` 可测，`ddz_commit` 原子写，patch 里可选的 `seats / bots` 只在开始时带）。手牌在 `ddz_state`（无任何用户权限）里，每个真人只能读 `ddz_hands` 里自己的那行；`ddz_games.pub` 里别人的手牌只有张数。
- 测试：`supabase/tests/doudizhu_test.sql`、`supabase/tests/ddz_4p_dm_test.sql`、`supabase/functions/ddz/{rules_test,game_test}.ts`；Playwright 的假 Supabase 可以把 `game.ts` 用 `deno bundle -o x.js game.ts` 打包后在页面里跑真实的服务器逻辑（私聊里的另一个真人用 `__ddzAs(uid, body)` 和机器人动作替他操作；沙箱里不能起 http 服务时，用 `page.route('http://localhost:8765/**')` 直接从工作树读文件）。
- 排行榜：斗地主有自己的一张榜（`leaderboard.js` 的 `ddz` tab，按积分排，后端 `ddz_leaderboard(p_group)`，迁移 `20261205000000_ddz_leaderboard.sql`，测试 `ddz_leaderboard_test.sql`）。「好友」= 我 + 好友在所有群和私聊的积分加总，「本群」= 只算这个群的行，只在群里打开时出现并作为默认。+ 面板的「排行榜」在私聊和群聊里都有；牌桌右上角关闭钮下方有 `rankButton('ddz', 'ddz-rk')`，结算面板有「排行榜」按钮。缓存键是 游戏|范围|群。

## 麻将（推倒胡，`scope: 'any'`，群聊和私聊的四人桌）

- 前端 `miniapps/mahjong.js`（缓存、卡片、实时、开桌）+ `mahjong-view.js`（牌桌、大厅、结算；牌面用 CSS 画）+ `mahjong-token.js`（`[麻将]#id`）+ `mahjong-rules.js`（规则引擎，顶部注释写了番数和计分；`supabase/functions/mahjong/gen-rules.py` 复制成 `rules.gen.js`，CI 检查）。样式 `css/mahjong.css`，所有类名都带 `mj-` 前缀（别的样式表里有 `.top` `.me` `.pl` `.back` 这类全局类名，不加前缀会被串味）。素材 `mahjong/icon-mahjong.png`、`mahjong/felt.jpg`。
- 后端：迁移 `20261211000000_mahjong.sql`（`mj_games / mj_hands / mj_state / mj_scores`、`mj_open / mj_open_dm / mj_sit / mj_stand / mj_set_bot`、`mj_commit`、`mj_leaderboard`），Edge Function `mahjong`（开始补机器人、出牌、吃碰杠胡、超时、结算、轮到你的推送），测试 `supabase/tests/mahjong_test.sql`、`supabase/functions/mahjong/{rules_test,game_test}.ts`。
- 手牌秘密：`mj_hands` 每个真人一行（手牌、刚摸的牌、现在能做的事 opts），只有本人能读；`mj_games.pub` 只有张数、牌河、亮出的组、牌墙剩余、吃碰窗口。榴莲（`agent-chat/games.ts` 的 `mjStatus / mjHint / mjRecord`）只读 pub 和 mj_scores，私聊和群聊都能看，绝不给任何手牌。

## 飞行棋（群聊和私聊里的 2 到 4 人游戏，`scope: 'any'`）

- 前端 `miniapps/fxq.js`（缓存、卡片、实时、开桌）+ `fxq-view.js`（SVG 棋盘、骰子、逐格回放动画、大厅、结算）+ `fxq-token.js`（`[飞行棋]#id`）+ `fxq-rules.js`（规则引擎，规则写在文件顶部注释里；`supabase/functions/fxq/gen-rules.py` 复制成 `rules.gen.js`，CI 用 `--check`）。
- 座位号 = 颜色（0 红 1 黄 2 蓝 3 绿），不压紧；至少坐 2 个（真人 + 机器人）才能开始，不自动补机器人。没有秘密信息：整局状态在 `fxq_games.pub`（含最近 60 条事件 `log`，客户端按 `seq` 回放，缺一段就直接跳到最终状态）。
- 后端：迁移 `20261212000000_feixingqi.sql`（表、大厅 RPC、触发器、`fxq_commit`、`fxq_leaderboard`），Edge Function `fxq`（`game.ts` 可测：骰子在服务器掷、超时 15 秒托管、机器人、结算、推送开局 / 轮到你了 / 结束），测试 `supabase/tests/feixingqi_test.sql`、`supabase/functions/fxq/{rules_test,game_test}.ts`。
- 榴莲：`games.ts` 的 `fxqStatus`（`game_status` 带 `game=fxq`，私聊和群聊都能用）、`fxqRecord`（`game_leaderboard` 带 `game=fxq`）、`fxqHintPart` / `groupGameHint`（「进行中的小游戏」一行，群里也有）。只读。
- 排行榜：`fxq` tab（胜场，「好友」「本群」两个范围）。
