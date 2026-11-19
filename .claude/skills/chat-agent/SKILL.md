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
- 人设由用户提供或确认。用户只给了一句话时，先按上面的结构起草，给用户看过再接入。
- `agent/gen-persona.py` 的 `for name in (...)` 加上 `<slug>`，运行 `python3 agent/gen-persona.py` 生成 `supabase/functions/agent-chat/<slug>.gen.ts` 并提交。CI 会 `--check`，`backend.yml` 部署前也会重新生成。
  - 漏了：`deno check` 找不到 `<slug>.gen.ts`；或者改了 md 没重新生成，CI 报不一致。

### 2. 头像 `agent/<slug>-avatar.png`

- 256×256 RGBA PNG，圆形裁切显示（`.agent-av`），主体居中。按 `gpt-assets` skill 交给 Codex 生成，参考 `agent/ye-ying-avatar.png` 的画风；用户自己给了图就用用户的。
- `.github/workflows/frontend.yml`：`on.push.paths` 加 `agent/<slug>-avatar.png`，构建步骤里加 `cp agent/<slug>-avatar.png _site/agent/`（`agent/` 目录只发布头像，人设不上线）。
  - 漏了：线上头像 404，退回成名字第一个字的画出来的头像。
- `chat/js/agent/info.js` 的 `makeAgentAvatar` 里按 id 给出图片路径 `'../agent/<slug>-avatar.png'`。

### 3. 前端

- `chat/js/agent/info.js`
  - `AGENTS` 加一项 `{ id: '<id>', name: '<名>', mention: '@<名>', keys: ['<名>', '<拼音>', ...别名] }`。`keys` 给 @ 选择器做前缀匹配（拼音、外号）。群资料页的助手开关、@ 选择器、群里「打开的助手」都直接读 `AGENTS`，不用另外改。
  - `mentionedAgents` 的正则和「匹配到的名字 → id」映射加上 `<名>`。
  - 漏了：@ 了没反应（前端根本没调 `agent_ask`）。
- `chat/js/send.js`：全角 `＠` 转半角的正则 `/＠(沈剑心|榴莲|叶英)/g` 加上 `<名>`。
  - 漏了：中文输入法打出的 `＠<名>` 叫不到。
- 文案里别写死某个 agent 的名字（`errors.js` 里统一叫「助手」）。

### 4. Edge Function `supabase/functions/agent-chat/agent.ts`

- `import { PERSONA as <X>_PERSONA } from "./<slug>.gen.ts";`
- `agentName(id)`：加 `<id>` → `<名>`。它用在聊天记录里的说话人、推送标题、搜索结果里。
- `systemInstructions(id)`：按 id 选人设。
- `ownReply` 的说话人正则 `(沈剑心|叶英|榴莲)` 加上 `<名>`：模型有时会替别的 agent 写台词，这里把不是自己说的段落切掉。
- 应用规则里「两位助手」这类写死数量的话，改成不依赖数量的说法。
- `ERROR_CODES`、工具列表不用改。**工具列表和应用规则必须对所有 agent、所有人完全一致**（提示词缓存），人设只放在最前面。
- `agent_test.ts`：照叶英的用例加一个 `<id>`：用自己的人设、回复写成 `author = <id>`、`ownReply` 切掉别人的台词。

### 5. 数据库：新迁移 `supabase/migrations/<下一个日期>_<slug>_agent.sql`

CI 会把所有迁移**跑两遍**，必须可重复执行。这几处写死了 agent 列表，全部要改：

| 位置 | 现在的定义在哪 | 怎么改 |
|---|---|---|
| `messages_author_valid` | `20261202000000_group_chat.sql` | `drop constraint if exists` 再加，列表里保留 `'system'` |
| `agent_jobs.agent_id` 的 check | `20261130000000_ye_ying_agent.sql`（列上的匿名约束，自动名 `agent_jobs_agent_id_check`） | 先用 `pg_constraint` 查出真实名字再删，或直接 `drop constraint if exists agent_jobs_agent_id_check`，然后加一个**有名字的**新约束，比如 `agent_jobs_agent_id_valid` |
| `agent_memories.agent_id` 的 check | `20261201000000_isolate_agents.sql`（自动名 `agent_memories_agent_id_check`） | 同上 |
| `agent_group_memories.agent_id` 的 check | `20261202000000_group_chat.sql`（自动名 `agent_group_memories_agent_id_check`） | 同上 |
| `groups_agents_valid` | `20261202000000_group_chat.sql` | `agents <@ array[...]` 加上 `<id>` |
| `agent_ask(bigint, text)` | 最新版在 `20261201000000_isolate_agents.sql` | `create or replace`，同签名：`(p_agent_id = '<id>' and v_msg.body ~ '[@＠]<名>')` |
| `agent_ask_group(bigint, text)` | `20261202000000_group_chat.sql` | 同上 |
| `set_group_agents` | `20261202000000_group_chat.sql` | 两处 `array['durian', 'ye_ying']`（校验和系统提示行循环） |
| `group_agent_name` | `20261202000000_group_chat.sql` | `case` 加 `<id>` → `<名>`（群里「A 打开了<名>」） |

- 改函数前先 `grep -rn "create or replace function public.agent_ask" supabase/migrations` 找到**最新**的那个版本再复制，别改到旧版本上。
- 不改任何函数的签名和返回类型（第二遍迁移会失败）。
- 漏了对应的症状：
  - 约束没改：函数写回复时报约束错误，任务以 `reply_failed` 失败（前端显示「<名>走神了」）。
  - `agent_ask` 没改：`agent_not_mentioned`。
  - `groups_agents_valid` 或 `set_group_agents` 没改：群资料页打不开这个 agent 的开关（`invalid_argument`）。
- 测试：`supabase/tests/agent_test.sql` 加一个 @ 新 agent 建任务、写记忆的用例；`group_chat_test.sql` 加打开新 agent 的开关、`agent_ask_group` 能建任务的用例。

### 6. 别的地方

- 每人每天 50 次的提问限额是所有 agent 共用的（`agent_ask` 里按提问人算），新 agent 不单独计数。要改限额是另一件事。
- 群里新 agent 默认是关着的，在群资料页打开才能 @。私聊里所有 agent 都能 @。
- 小游戏：agent 永远不能入座斗地主（`ddz_sit` 只接受群成员 / 好友的真人 uid），不用改。
- 部署需要的 secret（`OPENAI_API_KEY` 等）所有 agent 共用，不用加。

## 检查

1. `python3 agent/gen-persona.py --check`；`node --check` 改过的 JS；仓库根目录 `npx -y eslint@9 chat` 0 错误。
2. `deno check supabase/functions/agent-chat/index.ts`；`deno test supabase/functions/agent-chat/agent_test.ts` 和 `jx3_test.ts`。
3. SQL：Docker 起 Postgres 16，按 `.github/workflows/ci.yml` 的 Backend checks 顺序：`supabase/ci/stubs.sql` → 所有迁移跑两遍 → 授权 → `supabase/tests/*.sql`。
4. 全文搜一遍旧 agent 的名字和 id，确认每个写死列表的地方都加上了新的：
   `grep -rnE "ye_ying|叶英" chat supabase/functions agent/gen-persona.py .github supabase/migrations | grep -vE "_test|\.gen\.ts"`
   旧迁移里的命中是历史版本，不用改；要确认的是**新迁移**覆盖了表里的每一项。
5. 浏览器（假 Supabase，见 `chat-miniapp` skill）：私聊 @ 选择器里有新 agent、头像正常、思考中显示新名字；群资料页有新开关，打开后群里能 @。截图 390×844，浅色和深色。

## 汇报

写清楚：新 agent 的 id、显示名、别名、人设来源（用户提供 / 起草后用户确认）、头像来源，以及没测到的部分（真实模型的回复效果、真实推送）。上线后请用户在私聊和群里各 @ 一次。
