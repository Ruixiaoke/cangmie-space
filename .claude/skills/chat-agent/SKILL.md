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
