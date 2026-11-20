---
name: chat-agent
description: 聊天里的 AI 角色（沈剑心 durian、叶英 ye_ying 这类可以被 @ 的 agent）的完整改动清单：人设文件、头像、前端 AGENTS 列表和 @ 识别、agent-chat Edge Function、数据库约束和 agent_ask 函数、群聊开关、测试和部署。新增一个 agent、改名、换头像、改人设、删掉一个 agent，或排查某个 agent @ 了不回、回错人设、群里开关不生效时，先读这个 skill。
---

# 聊天 agent（可以 @ 的 AI 角色）

agent 不是用户：没有 profile，不能加好友、不能入座小游戏。它的回复是 `messages` 里 `author = '<agent id>'` 的普通行（私聊 `sender_id` = 提问人、`receiver_id` = 对方；群聊 `group_id` = 群、`receiver_id` 为空），只有 Edge Function 用 service role 写。

流程：用户发一条带 `@名字` 的消息 → 前端 `askAgent` 对每个被 @ 的 agent 调 `agent_ask(p_message, p_agent_id)`（群里是 `agent_ask_group`）建任务 → 前端调 `agent-chat` 函数 `{ job }` → 函数读人设、记忆、聊天记录，调 OpenAI Responses API（带工具），把回复写成一条 `author = agent id` 的消息，推送。每个 agent 的任务、记忆、缓存键都互相隔离。

代码是唯一的真相来源，下面用来定位。动手前把 `chat/js/agent/info.js`、`supabase/functions/agent-chat/agent.ts` 的 `systemInstructions` / `ownReply` / `runJob`，和最新一次改 agent 相关约束的迁移读一遍。

## agent id 和名字

- **id**：小写 snake_case 英文，比如 `ye_ying`。它就是 `messages.author`、`agent_jobs.agent_id`、记忆表的 `agent_id`、`groups.agents` 里的值，**上线后不能改**（改了旧消息就认不出是谁写的）。`durian` 是沈剑心的 id（他以前叫榴莲），不要动。
- **slug**：文件名用的连字符写法，比如 `ye-ying`（`agent/ye-ying.md`、`ye-ying.gen.ts`、`ye-ying-avatar.png`）。
- **显示名**：聊天里 `@` 的中文名，比如 `叶英`。可以有别名（沈剑心的 `@榴莲`）。
- **名字不能互为前缀**：`@叶英` 和 `@叶英华` 会在正则里打架。新名字先在所有现有名字里检查一遍。
- `system` 也是 `messages.author` 的合法值（群聊系统提示行），不是 agent，所有约束改动都要保留它。

## 新增一个 agent：清单

每一处都要改，漏一处的症状写在后面。下面用 `<id>` / `<slug>` / `<名>` 代指。

### 1. 人设 `agent/<slug>.md`

- 照 `agent/ye-ying.md` 的结构写：`身份`、`性格`、`会话方式`、`如何接话`、`爱好与日常`、`常用语`、`对话示例`。用中文，写「你是谁、怎么说话」，不写技术规则（应用规则由 `agent.ts` 的 `systemInstructions` 统一追加，对所有 agent 一样）。
- 同人补充和游戏原设要能区分（叶英人设里有一段「有人询问游戏原设时，明确区分可确认的剧情与这些日常设定」）。
- 不要 emoji，不要破折号。
- 人设由用户提供或确认。用户给了完整人设就一字不改地保存（谢云流、李忘生就是这样）；只给了一句话时，先按上面的结构起草，给用户看过再接入。
- `agent/gen-persona.py` 的 `for name in (...)` 加上 `<slug>`，运行 `python3 agent/gen-persona.py` 生成 `supabase/functions/agent-chat/<slug>.gen.ts` 并提交。CI 会 `--check`，`backend.yml` 部署前也会重新生成。
  - 漏了：`deno check` 找不到 `<slug>.gen.ts`；或者改了 md 没重新生成，CI 报不一致。

### 2. 头像 `agent/<slug>-avatar.png`

- 256×256 PNG，不透明的满幅画面，圆形裁切显示（`.agent-av`），脸要完整落在中间的圆里，40px 时还认得出。按 `gpt-assets` skill 交给 Codex 生成，风格参考 `agent/ye-ying-avatar.png`（半写实古风插画；叶英、谢云流、李忘生是同一套）。用户自己给了图就用用户的。
- 文件名必须是 `<slug>-avatar.png`：`frontend.yml` 按 `agent/*-avatar.png` 发布，不用改 workflow。
- 沈剑心的头像是历史遗留的 `agent/avatar.png`（部署时注入带哈希的地址），别照它的做法。

### 3. 前端：只改 `chat/js/agent/info.js` 的 `AGENTS`

加一项 `{ id: '<id>', name: '<名>', names: ['<名>', ...别名], keys: ['<名>', '<拼音>', ...外号], avatar: '../agent/<slug>-avatar.png' }`。

- `names`：能 @ 到它的名字（第一个是正式名），要和数据库 `agent_mentioned()` 里的正则一致。
- `keys`：@ 选择器里按前缀匹配的词。
- 其他全部从 `AGENTS` 推出来：@ 识别（`MENTION_RE_SRC` / `mentionedAgents`）、全角 `＠` 转半角（`send.js`）、头像、@ 选择器、群资料页的助手开关、群里「打开的助手」、思考中提示、推送标题。
- 漏了：@ 了没反应（前端根本没调 `agent_ask`），头像退回成名字的第一个字。

### 4. Edge Function：只改 `supabase/functions/agent-chat/agent.ts` 的 `AGENTS`

- `import { PERSONA as <X>_PERSONA } from "./<slug>.gen.ts";`
- `AGENTS` 加 `<id>: { name: "<名>", names: [...], persona: <X>_PERSONA }`。`agentName`、`systemInstructions`、`ownReply` 的说话人正则（切掉模型替别的 agent 写的台词）都读它。
- **工具列表和应用规则必须对所有 agent、所有人完全一致**（提示词缓存），不同的只有最前面的人设。应用规则里不要写死 agent 的数量或名字。
- `agent_test.ts`：把 `<id>` 加进「每个 agent 用自己的人设、回复写成自己的 author」那个用例的列表，和 `every agent has its own persona` 用例的 id 列表。

### 5. 数据库：新迁移里 `create or replace` 三个函数

迁移 `20261207000000_xie_yunliu_li_wangsheng_agents.sql` 起，agent 名单集中在三个函数里，所有约束和 `agent_ask` / `agent_ask_group` / `set_group_agents` 都读它们：

| 函数 | 改什么 |
|---|---|
| `agent_ids()` | 数组里加 `'<id>'`（顺序就是群开关里系统提示行的顺序） |
| `agent_mentioned(p_agent, p_body)` | `case` 加 `when '<id>' then p_body ~ '[@＠](<名>\|<别名>)'` |
| `group_agent_name(p_agent)` | `case` 加 `when '<id>' then '<名>'`（群里「A 打开了<名>」） |

- 新迁移 `supabase/migrations/<下一个日期>_<slug>_agent.sql` 里把这三个函数**整段复制最新版本**再加一行（`grep -rn "function public.agent_ids" supabase/migrations` 找最新的）。签名和返回类型不变。
- 约束（`messages_author_valid`、`agent_jobs_agent_valid`、`agent_memories_agent_valid`、`agent_group_memories_agent_valid`、`groups_agents_valid`）用的是 `agent_ids()`，不用改。注意：函数改了，已经存在的行不会重新校验，这正是我们要的（只会加 agent，不会删）。
- **删掉一个 agent** 不能只从 `agent_ids()` 里去掉：已有的消息、任务、记忆还带着这个 id，下次有人改这些行就会撞约束。真要删，先和用户确认怎么处理历史消息。
- 测试：照 `supabase/tests/new_agents_test.sql` 加断言：`agent_ids()` 的内容、`agent_mentioned` 认 / 不认、私聊 `agent_ask`、群里默认关着、打开后 `agent_ask_group`、回复和记忆能写。
- 漏了的症状：`agent_ids()` 没加，函数写回复时撞约束，任务以 `reply_failed` 失败（前端显示「<名>走神了」）；`agent_mentioned` 没加，`agent_not_mentioned`。

### 6. 别的地方

- 问助手不限次数（`20261210000000_agent_no_rate_limit.sql` 取消了原来每人每天 50 次的限额）。
- 群里新 agent 默认是关着的，在群资料页打开才能 @。私聊里所有 agent 都能 @。
- 小游戏：agent 永远不能入座斗地主（`ddz_sit` 只接受群成员 / 好友的真人 uid），不用改。
- 部署需要的 secret（`OPENAI_API_KEY` 等）所有 agent 共用，不用加。
- 人设里提到别的 agent 时（谢云流和李忘生互相提起），他们在同一个聊天里会被分别叫到，各自只说自己的话（应用规则和 `ownReply` 保证）。

### 剑三数据工具 jx3_info（`supabase/functions/agent-chat/jx3.ts`）

工具定义和系统提示里的规则对所有 agent 一模一样（改了会动提示缓存，只改一处）。kind：calendar / server / news / celebs / saohua 走 JX3API（免费、不要 token）；下面四个是后加的物价、万宝楼和金价，都是免费、不用登录、没有官方文档的接口，随时可能改，出错一律返回 `{ error }`，聊天不受影响。

- `auction`（物价，带 item + server）：先 `GET https://node.jx3box.com/item_merged/name/{名字}?client=std&per=10` 搜物品（同名会有绑定 / 不绑定两个 id，绑定的排后面），再 `POST https://next2.jx3box.com/api/auction/`，**JSON** body `{"item_ids":[...],"server":"梦江南","aggregate_type":"hourly"}`（表单不行；aggregate_type 只有 hourly / daily，两个返回一样，只有最新一个价，没有走势）。价格单位是铜（1金 = 10000铜，1银 = 100铜），输出换算成「548金72银」。服务器名不对或没成交返回 `[]`。
- `wbl_role`（万宝楼在售角色，带 server，可选 sect / shape）：`GET https://trade-api.seasunwbl.com/api/buyer/goods/list?goods_type=2&size=8&zone_id=&server_id=&sort[price]=1&filter[role_sect]=&filter[role_shape]=`。`sort[price]=1` 是价格升序（0 降序）；筛选要写 `filter[role_sect]`（门派 id，1 凌雪阁 … 21 段氏，见 `SECTS`）、`filter[role_shape]`（1 成男 2 成女 3 正太 4 萝莉）、`filter[role_camp]`（1 浩气 2 恶人 3 中立，工具没用）；裸的 `role_sect=` 之类被忽略。门派 / 体型 id 来自 `GET /api/platform/setting/goods_filter_config?goods_type=2`。价格单位是分，输出「¥1099」。size 最大 10 左右，再大报「每页数量格式不正确」。
- `wbl_look`（万宝楼在售外观，带 item，server 可选）：`goods_type=3&keyword=外观名`（子串匹配 `info`，比如「何意味」「头顶表情」），同样 `sort[price]=1`。**这个接口不认服务器筛选**（server_id / zone_id / filter 都被忽略），指定服务器时在本地翻最便宜的 3 页（每页 10 条）按 `server_name` 筛，回复里会写明这一点。`goods_type=1` 会报错，不用。
- `gold`（金价，带 server）：万宝楼在售金币 `goods_type=1&zone_id=&server_id=`（这个类型**必须**带大区和服务器，否则报「大区标识格式不正确」）。每条是「¥10 买 N 金」，`attrs.gold_price` 就是「1 元买多少金」。`sort[gold_price]=0` 从最划算（比例最高）排起，`=1` 反过来；`sort[price]` 是按单笔金额排，没用。输出「1元 = 902金」「1万金 ≈ ¥11.09」和区间。2026-11 实测所有服都在 739 到 902 之间、最划算的一页全挂在 902，这是万宝楼的比例上限，工具会标 `capped` 让 agent 说明。用户说「金价」「金币」时模型容易拿去 `auction` 查物品「金」，`auction` 遇到这几个词会返回 `bad_argument` 提示改用 `gold`。JX3BOX 的金价走势接口 `spider2.jx3box.com/api/spider/gold/trend` 2026-05 之后不更新，别用；JX3API 的金价要 token。
- 服务器名 -> `server_id` / `zone_id`：`GET /api/platform/setting/gateways`，缓存一小时（电信区 z05、双线区 z21、无界区 z51）。
- 不输出 consignment_id、卖家名（接口里本来就打了码）、门派之外的个人信息；请求里只带物品名 / 服务器 / 门派，不带任何用户数据。系统提示要求 agent 只报数字和出处，不劝买劝卖，没说服务器先问。
- 请求量要克制：每个查询缓存 3 到 5 分钟（auction 5 分钟，wbl 3 分钟），10 秒超时、网络失败重试一次；不要加轮询、不要批量爬。接口改了就改 `jx3.ts` 和 `jx3_test.ts`（假 fetch）。

## 检查

1. `python3 agent/gen-persona.py --check`；`node --check` 改过的 JS；仓库根目录 `npx -y eslint@9 chat` 0 错误。
2. `deno check supabase/functions/agent-chat/index.ts`；`deno test supabase/functions/agent-chat/agent_test.ts` 和 `jx3_test.ts`。
3. SQL：Docker 起 Postgres 16，按 `.github/workflows/ci.yml` 的 Backend checks 顺序：`supabase/ci/stubs.sql` → 所有迁移跑两遍 → 授权 → `supabase/tests/*.sql`。
4. 全文搜一遍一个现有 agent 的 id 和名字，确认新 agent 在同样的地方都有：
   `grep -rnE "li_wangsheng|李忘生" chat supabase/functions agent/gen-persona.py supabase/migrations | grep -vE "_test|\.gen\.ts"`
   应该只命中：`info.js` 的 `AGENTS`、`agent.ts` 的 import 和 `AGENTS`、`gen-persona.py`、迁移里的三个函数。
5. 浏览器（假 Supabase，见 `chat-miniapp` skill）：私聊 @ 选择器里有新 agent、头像正常、思考中显示新名字；群资料页有新开关，打开后群里能 @。截图 390×844，浅色和深色。

## 汇报

写清楚：新 agent 的 id、显示名、别名、人设来源（用户提供 / 起草后用户确认）、头像来源，以及没测到的部分（真实模型的回复效果、真实推送）。上线后请用户在私聊和群里各 @ 一次。
