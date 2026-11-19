// agent.ts 的本地测试：用假的数据库和假的 OpenAI（mock fetch），不访问网络
// 运行：deno test supabase/functions/agent-chat/agent_test.ts
import {
  buildHistoryBlock, buildMemoryBlock, buildUserInput, extractReply, HISTORY_AGENT_CHARS, HISTORY_BLOCK_CHARS, HISTORY_USER_CHARS, MAX_OUTPUT_TOKENS, MAX_REPLY, MAX_ROUNDS,
  MEMORY_BLOCK_CHARS, PINNED_MAX, runJob, SEARCH_CONTEXT_SIZE, systemInstructions, TOOL_SPECS, type Memory,
} from "./agent.ts";

const ASKER = "11111111-1111-1111-1111-111111111111";
const PEER = "22222222-2222-2222-2222-222222222222";

type Q = { table: string; action: string; payload?: unknown; filters: [string, unknown][]; single: boolean };

// 可链式调用的假查询：所有方法返回自己，await 时交给 handler 算结果
function fakeDb(handler: (q: Q) => { data?: unknown; error?: unknown }, rpc: (fn: string, args: Record<string, unknown>) => { data?: unknown; error?: unknown }) {
  const log: Q[] = [];
  const builder = (table: string) => {
    const q: Q = { table, action: "select", filters: [], single: false };
    // deno-lint-ignore no-explicit-any
    const b: any = {};
    for (const m of ["select", "insert", "update", "delete", "upsert"]) {
      b[m] = (payload?: unknown) => { if (m !== "select" || q.action === "select") { q.action = m; if (m !== "select") q.payload = payload; } return b; };
    }
    for (const m of ["eq", "in", "or", "order", "limit", "not", "lt"]) b[m] = (...a: unknown[]) => { if (m === "eq" || m === "in" || m === "lt") q.filters.push([String(a[0]), a[1]]); return b; };
    b.maybeSingle = () => { q.single = true; return Promise.resolve(run()); };
    b.single = () => { q.single = true; return Promise.resolve(run()); };
    // deno-lint-ignore no-explicit-any
    b.then = (res: any, rej: any) => Promise.resolve(run()).then(res, rej);
    const run = () => {
      log.push(q);
      const r = handler(q);
      return { data: r.data ?? null, error: r.error ?? null };
    };
    return b;
  };
  return { admin: { from: builder, rpc: (fn: string, args: Record<string, unknown>) => Promise.resolve({ data: null, error: null, ...rpc(fn, args) }) }, log };
}

type Mem = { title: string; content: string; pinned: boolean; updated_at: string };
const mem = (title: string, content: string, pinned = false, updated_at = "2026-11-10T00:00:00Z"): Mem => ({ title, content, pinned, updated_at });

function world(opts: { asker?: string; peer?: string; mems?: Mem[]; hist?: Record<string, unknown>[]; question?: string } = {}) {
  const asker = opts.asker ?? ASKER, peer = opts.peer ?? PEER;
  const question = opts.question ?? "@沈剑心 上次说的爬山是哪天？顺便查下明天天气";
  const state = {
    job: { id: 7, asker, peer, message_id: 100, status: "running" } as Record<string, unknown>,
    memories: opts.mems ?? [mem("小红·口味", "她不吃香菜")],
    messages: [] as Record<string, unknown>[],
    jobUpdates: [] as Record<string, unknown>[],
    searches: [] as Record<string, unknown>[],
    upserts: [] as Record<string, unknown>[],
    memFilters: [] as [string, unknown][][],
  };
  const handler = (q: Q) => {
    if (q.table === "agent_jobs" && q.action === "select") return { data: state.job };
    if (q.table === "agent_jobs" && q.action === "update") { state.jobUpdates.push(q.payload as Record<string, unknown>); Object.assign(state.job, q.payload); return {}; }
    if (q.table === "friendships") return { data: [{ id: 1 }] };
    if (q.table === "profiles") return { data: [{ id: asker, nickname: "小红" }, { id: peer, nickname: "小明" }] };
    if (q.table === "agent_memories" && q.action === "select") {
      state.memFilters.push(q.filters);
      const inT = q.filters.find((f) => f[0] === "title");
      return { data: inT ? state.memories.filter((m) => (inT[1] as string[]).includes(m.title)) : state.memories };
    }
    if (q.table === "agent_memories" && q.action === "upsert") {
      const p = q.payload as Record<string, unknown>;
      state.upserts.push(p);
      const old = state.memories.find((m) => m.title === p.title);
      if (p.pinned === true && state.memories.filter((m) => m.pinned && m.title !== p.title).length >= PINNED_MAX) return { error: { message: "pinned_full" } };
      if (old) { old.content = p.content as string; old.updated_at = p.updated_at as string; if (typeof p.pinned === "boolean") old.pinned = p.pinned; }
      else state.memories.push({ title: p.title as string, content: p.content as string, pinned: p.pinned === true, updated_at: p.updated_at as string });
      return {};
    }
    if (q.table === "agent_memories" && q.action === "delete") {
      state.memFilters.push(q.filters);
      const t = q.filters.find((f) => f[0] === "title")![1];
      const n = state.memories.length; state.memories = state.memories.filter((m) => m.title !== t);
      return { data: n === state.memories.length ? [] : [{ id: 1 }] };
    }
    if (q.table === "messages" && q.action === "select" && q.single) return { data: { sender_id: asker, body: question } };
    if (q.table === "messages" && q.action === "select") return { data: opts.hist ?? [{ id: 100, sender_id: asker, author: null, body: question, created_at: "2026-11-18T01:00:00Z" }] };
    if (q.table === "messages" && q.action === "insert") { const row = { id: 200, ...(q.payload as object) }; state.messages.push(row); return { data: { id: 200 } }; }
    return {};
  };
  const rpc = (fn: string, args: Record<string, unknown>) => {
    if (fn === "agent_search_messages") { state.searches.push(args); return { data: [{ id: 50, sender_id: peer, author: null, body: "周末去爬山", created_at: "2026-11-14T02:30:00Z" }] }; }
    return {};
  };
  return { state, ...fakeDb(handler, rpc) };
}

const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
const noPush = () => Promise.resolve();

Deno.test("each agent receives both speakers' history and replies under its own identity", async () => {
  for (const [id, name] of [["durian", "沈剑心"], ["ye_ying", "叶英"], ["xie_yunliu", "谢云流"], ["li_wangsheng", "李忘生"]]) {
    const w = world({ question: "@" + name + " 你们刚才说了什么？", hist: [
      { id: 99, sender_id: ASKER, author: "ye_ying", body: "茶还温着。", created_at: "2026-11-18T01:00:00Z" },
      { id: 98, sender_id: PEER, author: "durian", body: "我来尝尝。", created_at: "2026-11-18T00:59:00Z" },
    ] });
    w.state.job.agent_id = id;
    const requests: Record<string, unknown>[] = [];
    const titles: string[] = [];
    await runJob({
      admin: w.admin, apiKey: "test-key", model: "gpt-6-luna",
      fetchFn: (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        const other = id === "durian" ? "叶英" : id === "xie_yunliu" ? "李忘生" : "沈剑心";
        const text = `${name}：茶还温着。\n\n**${other}：** 多谢。\n我先坐下了。`;
        return Promise.resolve(json({ output: [{ type: "message", content: [{ type: "output_text", text }] }] }));
      },
      push: (_user, payload) => { titles.push(payload.title); return Promise.resolve(); },
    }, 7);
    const request = requests[0];
    if (request?.instructions !== systemInstructions(id)) throw new Error("wrong persona for " + name);
    if (request.previous_response_id || !String(request.prompt_cache_key).startsWith(id + ":")) throw new Error("shared model state");
    if (!w.state.memFilters.some((f) => new Map(f).get("agent_id") === id)) throw new Error("shared agent memory");
    if (!w.log.some((q) => q.table === "messages" && new Map(q.filters).get("id") === 100 && !q.single)) throw new Error("history is not bounded to the prompt");
    const history = JSON.stringify(request.input);
    if (!history.includes("叶英：茶还温着。") || !history.includes("沈剑心：我来尝尝。")) throw new Error("missing agent history");
    if (w.state.messages[0]?.author !== id || w.state.messages[0]?.body !== "茶还温着。" || titles.some((title) => title !== name) || titles.length !== 2) {
      throw new Error("wrong reply or push identity for " + name);
    }
  }
});

Deno.test("tool loop: search_chats -> remember -> final text with web citation; reply stored, job done", async () => {
  const w = world();
  const requests: Record<string, unknown>[] = [];
  const script = [
    { id: "resp_1", output: [{ type: "web_search_call", id: "ws_1", status: "completed" }, { type: "function_call", call_id: "call_a", name: "search_chats", arguments: JSON.stringify({ query: "爬山", limit: 5 }) }] },
    { id: "resp_2", output: [{ type: "function_call", call_id: "call_b", name: "remember", arguments: JSON.stringify({ title: "周末计划", content: "他们周末去爬山" }) }, { type: "function_call", call_id: "call_c", name: "forget", arguments: JSON.stringify({ title: "小红·口味" }) }] },
    { id: "resp_3", output: [{ type: "message", content: [{ type: "output_text", text: "周六。明天多云，带件外套。", annotations: [{ type: "url_citation", url: "https://weather.example/cn", title: "天气", start_index: 0, end_index: 3 }] }] }] },
  ];
  let i = 0;
  const pushes: unknown[] = [];
  await runJob({
    admin: w.admin, apiKey: "test-key", model: "gpt-6-luna",
    fetchFn: ((_u: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      if (new Headers(init.headers).get("Authorization") !== "Bearer test-key") throw new Error("auth header");
      return Promise.resolve(json(script[i++]));
    }) as unknown as typeof fetch,
    push: (to, p) => { pushes.push([to, p]); return Promise.resolve(); },
  }, 7);

  // 请求形状
  if (requests.length !== 3) throw new Error("expected 3 requests, got " + requests.length);
  const r0 = requests[0] as { model: string; instructions: string; tools: { type: string; name?: string }[]; input: { content: string }[]; previous_response_id?: string };
  if (r0.model !== "gpt-6-luna") throw new Error("model");
  if (!r0.tools.some((t) => t.type === "web_search")) throw new Error("web_search tool missing");
  for (const n of ["search_chats", "remember", "forget", "recall"]) if (!r0.tools.some((t) => t.name === n)) throw new Error("tool " + n);
  if (!r0.instructions.includes("你是沈剑心") || r0.instructions.includes("小红") || !r0.instructions.includes("不要使用 emoji")) throw new Error("instructions");
  if (r0.previous_response_id) throw new Error("first request must not chain");
  const text0 = r0.input[0].content;
  if (!text0.includes("【小红·口味】她不吃香菜") || !text0.includes("「小红」和「小明」") || !text0.includes("@沈剑心 上次说的爬山是哪天") || text0.includes("小红：@沈剑心")) throw new Error("input context: " + text0);
  const r1 = requests[1] as { previous_response_id: string; input: { type: string; call_id: string; output: string }[] };
  if (r1.previous_response_id !== "resp_1" || r1.input[0].type !== "function_call_output" || r1.input[0].call_id !== "call_a") throw new Error("chaining 1");
  if (!r1.input[0].output.includes("周末去爬山") || !r1.input[0].output.includes("2026-11-14 10:30") || !r1.input[0].output.includes("小明")) throw new Error("search output: " + r1.input[0].output);
  const r2 = requests[2] as { previous_response_id: string; input: { call_id: string; output: string }[] };
  if (r2.previous_response_id !== "resp_2" || r2.input.length !== 2 || r2.input[1].call_id !== "call_c") throw new Error("chaining 2");
  if (!r2.input[1].output.includes('"deleted":1')) throw new Error("forget output " + r2.input[1].output);

  // 工具副作用：只搜这一对；记忆写入/删除
  if (w.state.searches[0].p_a !== ASKER || w.state.searches[0].p_b !== PEER || w.state.searches[0].p_limit !== 5 || w.state.searches[0].p_before !== 100) throw new Error("search args");
  if (w.state.memories.map((m) => m.title + "=" + m.content).join() !== "周末计划=他们周末去爬山") throw new Error("memories: " + JSON.stringify(w.state.memories));

  // 回复
  const msg = w.state.messages[0] as { sender_id: string; receiver_id: string; author: string; body: string };
  if (msg.author !== "durian" || msg.sender_id !== ASKER || msg.receiver_id !== PEER) throw new Error("reply row");
  if (!msg.body.startsWith("周六。明天多云") || !msg.body.includes("https://weather.example/cn")) throw new Error("reply body (citation appended): " + msg.body);
  if (w.state.job.status !== "done" || w.state.job.reply_id !== 200) throw new Error("job not done: " + JSON.stringify(w.state.job));
  // 推送给双方，标题沈剑心
  if (pushes.length !== 2) throw new Error("expected 2 pushes");
  const [p0, p1] = pushes as [string, { title: string; peer: string }][];
  if (p0[1].title !== "沈剑心" || p0[0] !== ASKER || p0[1].peer !== PEER || p1[0] !== PEER || p1[1].peer !== ASKER) throw new Error("push targets");
});

Deno.test("missing OPENAI_API_KEY -> failed agent_unconfigured, no network", async () => {
  const w = world();
  let called = 0;
  await runJob({ admin: w.admin, apiKey: undefined, model: "m", fetchFn: (() => { called++; return Promise.resolve(json({})); }) as unknown as typeof fetch, push: noPush }, 7);
  if (called) throw new Error("must not call OpenAI");
  if (w.state.job.status !== "failed" || w.state.job.error !== "agent_unconfigured" || w.state.messages.length) throw new Error(JSON.stringify(w.state.job));
});

Deno.test("OpenAI http error -> failed openai_http, raw error never stored", async () => {
  const w = world();
  await runJob({ admin: w.admin, apiKey: "k", model: "m", fetchFn: (() => Promise.resolve(new Response('{"error":{"message":"sk-secret leaked"}}', { status: 500 }))) as unknown as typeof fetch, push: noPush }, 7);
  if (w.state.job.status !== "failed" || w.state.job.error !== "openai_http") throw new Error(JSON.stringify(w.state.job));
  if (JSON.stringify(w.state.jobUpdates).includes("secret")) throw new Error("leak");
});

Deno.test("timeout -> failed timeout", async () => {
  const w = world();
  await runJob({
    admin: w.admin, apiKey: "k", model: "m", timeoutMs: 30, push: noPush,
    fetchFn: ((_u: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    })) as unknown as typeof fetch,
  }, 7);
  if (w.state.job.status !== "failed" || w.state.job.error !== "timeout") throw new Error(JSON.stringify(w.state.job));
});

Deno.test("endless tool calls: last round forces tool_choice none, then fails cleanly if still no text", async () => {
  const w = world();
  const bodies: Record<string, unknown>[] = [];
  let n = 0;
  await runJob({
    admin: w.admin, apiKey: "k", model: "m", push: noPush,
    fetchFn: ((_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Promise.resolve(json({ id: "r" + n, output: [{ type: "function_call", call_id: "c" + n++, name: "search_chats", arguments: '{"query":"x"}' }] }));
    }) as unknown as typeof fetch,
  }, 7);
  // 第 4 轮之后不会再有第 5 次请求；最后一次带 tool_choice none
  if (MAX_ROUNDS !== 4 || bodies.length !== 4 || bodies[3].tool_choice !== "none" || bodies[0].tool_choice) throw new Error("rounds " + bodies.length);
});

Deno.test("empty model text -> failed empty_reply", async () => {
  const w = world();
  await runJob({ admin: w.admin, apiKey: "k", model: "m", push: noPush, fetchFn: (() => Promise.resolve(json({ id: "r", output: [{ type: "message", content: [{ type: "output_text", text: "  " }] }] }))) as unknown as typeof fetch }, 7);
  if (w.state.job.error !== "empty_reply") throw new Error(JSON.stringify(w.state.job));
});

Deno.test("extractReply caps at 4000 chars", () => {
  const out = extractReply([{ type: "message", content: [{ type: "output_text", text: "长".repeat(5000) }] }]);
  if (Array.from(out).length !== MAX_REPLY) throw new Error("length " + Array.from(out).length);
});

// ---- 记忆、提示词、省 token ----

const lines = (s: string) => s.split("\n");

Deno.test("memory block (a): small memory goes in full, no index", () => {
  const block = buildMemoryBlock([mem("小明·口味", "不吃香菜"), mem("纪念日", "3 月 5 日在一起", true)]);
  if (!block.includes("【小明·口味】不吃香菜") || !block.includes("【纪念日】3 月 5 日在一起")) throw new Error(block);
  if (block.includes("recall") || block.includes("目录")) throw new Error("no index expected: " + block);
  if (buildMemoryBlock([]).includes("【") && !buildMemoryBlock([]).includes("还没有")) throw new Error("empty");
});

Deno.test("memory block (b): large memory -> pinned in full + index of titles with dates, under the hard cap", () => {
  const mems: Memory[] = [mem("称呼", "叫他阿明，叫她小红", true, "2026-11-01T00:00:00Z"), mem("过敏", "小红对花生过敏", true, "2026-11-02T00:00:00Z")];
  for (let i = 0; i < 12; i++) mems.push(mem("话题" + i, "很长的内容".repeat(40), false, `2026-11-${String(i + 3).padStart(2, "0")}T00:00:00Z`));
  const block = buildMemoryBlock(mems);
  if (Array.from(block).length > MEMORY_BLOCK_CHARS) throw new Error("over cap: " + block.length);
  if (!block.includes("【称呼】叫他阿明，叫她小红") || !block.includes("【过敏】小红对花生过敏")) throw new Error("pinned full missing: " + block);
  if (!block.includes("- 话题11 2026-11-14") || !block.includes("- 话题0 2026-11-03")) throw new Error("index missing: " + block);
  if (block.includes("很长的内容")) throw new Error("non-pinned content must not be inlined");
  if (!block.includes("recall")) throw new Error("must tell the model to use recall");
  // 新的在前
  if (block.indexOf("话题11") > block.indexOf("话题0")) throw new Error("index order");
});

Deno.test("memory block: hard cap truncates the index from the oldest and says how many were omitted", () => {
  const mems: Memory[] = [];
  for (let i = 0; i < 200; i++) mems.push(mem("很长很长的标题" + i, "内容".repeat(300), false, new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString()));
  const block = buildMemoryBlock(mems);
  if (Array.from(block).length > MEMORY_BLOCK_CHARS) throw new Error("over cap: " + block.length);
  const m = block.match(/还有 (\d+) 条更早的没列出/);
  if (!m || Number(m[1]) <= 0) throw new Error("omitted note missing: " + block.slice(-120));
  if (!block.includes("很长很长的标题199") || block.includes("很长很长的标题0 ")) throw new Error("must keep newest, drop oldest");
  // 全是 500 字的常驻：放不下的降级进目录，整块仍不超上限
  const pinned = Array.from({ length: 10 }, (_, i) => mem("常驻" + i, "字".repeat(500), true, `2026-11-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
  const b2 = buildMemoryBlock(pinned);
  if (Array.from(b2).length > MEMORY_BLOCK_CHARS) throw new Error("pinned over cap: " + b2.length);
  if (!b2.includes("- 常驻")) throw new Error("demoted pinned must appear in the index");
});

Deno.test("history (c): per-message truncation, agent rows longer, whole block capped at 3000 dropping the oldest", () => {
  const names = { [ASKER]: "小红", [PEER]: "小明" };
  const row = (id: number, sender: string, author: string | null, body: string) => ({ id, sender_id: sender, author, body, created_at: "2026-11-18T01:00:00Z" });
  const one = buildHistoryBlock([row(1, ASKER, null, "甲".repeat(500)), row(2, ASKER, "durian", "乙".repeat(500))], names);
  const [l1, l2] = lines(one);
  if (!l1.endsWith("甲".repeat(HISTORY_USER_CHARS) + "…") || l1.includes("甲".repeat(HISTORY_USER_CHARS + 1))) throw new Error("user truncation");
  if (!l2.includes("沈剑心：") || !l2.endsWith("乙".repeat(HISTORY_AGENT_CHARS) + "…") || l2.includes("乙".repeat(HISTORY_AGENT_CHARS + 1))) throw new Error("agent truncation");
  const short = buildHistoryBlock([row(1, PEER, null, "短")], names);
  if (short.includes("…")) throw new Error("short must not get an ellipsis");
  const many = Array.from({ length: 20 }, (_, i) => row(i + 1, i % 2 ? ASKER : PEER, null, String(i).padStart(2, "0") + "丙".repeat(199)));
  const block = buildHistoryBlock(many, names);
  if (block.length > HISTORY_BLOCK_CHARS) throw new Error("block over cap " + block.length);
  const ls = lines(block);
  if (ls.length >= 20 || !ls[ls.length - 1].includes("19丙") || block.includes("00丙")) throw new Error("must drop oldest first, kept " + ls.length);
});

Deno.test("instructions are static: byte-identical across pairs and askers, no names or dates", async () => {
  const ASKER2 = "33333333-3333-3333-3333-333333333333", PEER2 = "44444444-4444-4444-4444-444444444444";
  const reqs: Record<string, unknown>[][] = [];
  for (const [a, p] of [[ASKER, PEER], [PEER, ASKER], [ASKER2, PEER2]]) {
    const w = world({ asker: a, peer: p });
    const got: Record<string, unknown>[] = [];
    await runJob({
      admin: w.admin, apiKey: "k", model: "gpt-6-luna", push: noPush,
      fetchFn: ((_u: string, init: RequestInit) => { got.push(JSON.parse(String(init.body))); return Promise.resolve(json({ id: "r", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "好" }] }] })); }) as unknown as typeof fetch,
    }, 7);
    reqs.push(got);
  }
  const [x, y, z] = reqs.map((r) => r[0]);
  if (x.instructions !== systemInstructions() || x.instructions !== y.instructions || x.instructions !== z.instructions) throw new Error("instructions differ");
  if (JSON.stringify(x.tools) !== JSON.stringify(z.tools)) throw new Error("tools must be static too");
  if (/小红|\d{4}-\d{2}-\d{2}/.test(x.instructions as string)) throw new Error("instructions must not carry names or dates");
  // 缓存键：每对好友稳定（和谁问无关），不同好友不同，不含原始 id
  if (x.prompt_cache_key !== y.prompt_cache_key) throw new Error("cache key must be stable per pair");
  if (x.prompt_cache_key === z.prompt_cache_key) throw new Error("cache key must differ per pair");
  if (!/^durian:[0-9a-f]{16}$/.test(x.prompt_cache_key as string) || String(x.prompt_cache_key).includes("1111")) throw new Error("cache key format");
  // 名字和提问人在 user input 里，随提问人变化
  const inX = (x.input as { content: string }[])[0].content, inY = (y.input as { content: string }[])[0].content;
  if (!inX.includes("「小红」在叫你") || !inY.includes("「小红」在叫你")) throw new Error(inX);
});

Deno.test("request body carries the token-saving fields", async () => {
  const w = world();
  const bodies: Record<string, unknown>[] = [];
  await runJob({
    admin: w.admin, apiKey: "k", model: "gpt-6-luna", push: noPush,
    fetchFn: ((_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return Promise.resolve(json({ id: "r", output: [{ type: "message", content: [{ type: "output_text", text: "好" }] }] })); }) as unknown as typeof fetch,
  }, 7);
  const b = bodies[0] as { max_output_tokens: number; reasoning: { effort: string }; prompt_cache_key: string; tools: { type: string; search_context_size?: string }[] };
  if (b.max_output_tokens !== 1500 || MAX_OUTPUT_TOKENS !== 1500) throw new Error("max_output_tokens");
  if (b.reasoning?.effort !== "low") throw new Error("reasoning");
  if (!b.prompt_cache_key) throw new Error("prompt_cache_key");
  if (b.tools.find((t) => t.type === "web_search")?.search_context_size !== "low" || SEARCH_CONTEXT_SIZE !== "low") throw new Error("search_context_size");
});

Deno.test("incomplete response (max_output_tokens) still uses the text produced", async () => {
  const w = world();
  await runJob({
    admin: w.admin, apiKey: "k", model: "m", push: noPush,
    fetchFn: (() => Promise.resolve(json({ id: "r", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "message", content: [{ type: "output_text", text: "说到一半" }] }] }))) as unknown as typeof fetch,
  }, 7);
  if (w.state.job.status !== "done" || (w.state.messages[0] as { body: string }).body !== "说到一半") throw new Error(JSON.stringify(w.state.job));
});

Deno.test("user input: history excludes the current question, mentions nothing from other pairs", async () => {
  const hist = [
    { id: 100, sender_id: ASKER, author: null, body: "@沈剑心 现在这个问题", created_at: "2026-11-18T01:00:00Z" },
    { id: 99, sender_id: PEER, author: null, body: "前一句话", created_at: "2026-11-18T00:59:00Z" },
  ];
  const w = world({ hist, question: "@沈剑心 现在这个问题" });
  let text = "";
  await runJob({
    admin: w.admin, apiKey: "k", model: "m", push: noPush,
    fetchFn: ((_u: string, init: RequestInit) => { text = (JSON.parse(String(init.body)).input[0].content as string); return Promise.resolve(json({ id: "r", output: [{ type: "message", content: [{ type: "output_text", text: "好" }] }] })); }) as unknown as typeof fetch,
  }, 7);
  if (!text.includes("小明：前一句话") || text.split("@沈剑心 现在这个问题").length !== 2) throw new Error(text);
  const direct = buildUserInput({ askerName: "甲", peerName: "乙", now: new Date("2026-11-18T01:00:00Z"), mems: [], history: [], names: {}, question: "q" });
  if (!direct.includes("2026-11-18 09:00") || !direct.includes("（还没有）") || !direct.includes("（没有）")) throw new Error(direct);
});

Deno.test("rules and tool descriptions: memory is the agent's own judgment, no 'only when asked' condition", () => {
  const all = systemInstructions() + JSON.stringify(TOOL_SPECS);
  if (all.includes("对方明确要你记") || all.includes("明确要你记") || all.includes("要你记的")) throw new Error("old explicit-ask wording still present");
  if (!systemInstructions().includes("记忆由你自己做主") || !systemInstructions().includes("没有人会叫你记")) throw new Error("rules must state self-directed memory");
  const rem = (TOOL_SPECS as { name?: string; description?: string }[]).find((t) => t.name === "remember")!.description!;
  if (!rem.includes("你自己判断") || !rem.includes("不需要有人叫你记") || !rem.includes("小明·口味")) throw new Error(rem);
  if (all.includes("—")) throw new Error("no em dash");
  if (/\p{Extended_Pictographic}/u.test(all.replace(/[⚠]/g, ""))) throw new Error("no emoji");
});

// 一次响应里发出全部工具调用，再收一个最终回答；返回每个调用的输出
async function useTools(w: ReturnType<typeof world>, calls: [string, unknown][]): Promise<Record<string, unknown>[]> {
  const outputs: string[] = [];
  let n = 0;
  await runJob({
    admin: w.admin, apiKey: "k", model: "m", push: noPush,
    fetchFn: ((_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (n++ === 0) return Promise.resolve(json({ id: "r0", output: calls.map(([name, a], i) => ({ type: "function_call", call_id: "c" + i, name, arguments: JSON.stringify(a) })) }));
      for (const o of body.input) outputs.push(o.output);
      return Promise.resolve(json({ id: "end", output: [{ type: "message", content: [{ type: "output_text", text: "好" }] }] }));
    }) as unknown as typeof fetch,
  }, 7);
  return outputs.map((o) => JSON.parse(o));
}

Deno.test("tools: remember upserts by title (replace) and keeps pinned when omitted; recall; forget by title", async () => {
  const w = world({ mems: [mem("小明·口味", "不吃香菜", true)] });
  const out = await useTools(w, [
    ["remember", { title: "小明·口味", content: "不吃香菜，也不吃葱" }],
    ["remember", { title: "周末计划", content: "爬山" }],
    ["recall", { titles: ["小明·口味", "不存在", "周末计划"] }],
    ["forget", { title: "周末计划" }],
    ["forget", { title: "周末计划" }],
  ]);
  if (out[0].ok !== true || out[1].ok !== true) throw new Error(JSON.stringify(out));
  // 第一次 upsert 不带 pinned（保持原值）；表里只有一条同标题
  if ("pinned" in w.state.upserts[0] || w.state.upserts[0].title !== "小明·口味") throw new Error(JSON.stringify(w.state.upserts[0]));
  const rec = out[2] as { entries: { title: string; content: string; pinned: boolean }[]; missing: string[] };
  if (rec.entries.length !== 2 || rec.entries[0].content !== "不吃香菜，也不吃葱" || rec.entries[0].pinned !== true || rec.missing.join() !== "不存在") throw new Error(JSON.stringify(rec));
  if (out[3].deleted !== 1 || out[4].deleted !== 0) throw new Error("forget " + JSON.stringify(out.slice(3)));
  if (w.state.memories.map((m) => m.title).join() !== "小明·口味") throw new Error(JSON.stringify(w.state.memories));
  // 所有记忆读写都限定在这一对好友
  for (const f of w.state.memFilters) {
    const m = new Map(f.map(([k, v]) => [k, v]));
    if (m.get("user_lo") !== ASKER || m.get("user_hi") !== PEER) throw new Error("not pair-scoped: " + JSON.stringify(f));
  }
  if (w.state.upserts.some((u) => u.user_lo !== ASKER || u.user_hi !== PEER)) throw new Error("upsert pair");
});

Deno.test("tools: validation (title 1-20, content max 500, recall needs titles) and pinned cap error is clear", async () => {
  const pinned = Array.from({ length: PINNED_MAX }, (_, i) => mem("常驻" + i, "x", true));
  const w = world({ mems: pinned });
  const out = await useTools(w, [
    ["remember", { title: "  ", content: "x" }],
    ["remember", { title: "题".repeat(21), content: "x" }],
    ["remember", { title: "长", content: "字".repeat(501) }],
    ["remember", { title: "刚好", content: "字".repeat(500) }],
    ["remember", { title: "新常驻", content: "x", pinned: true }],
    ["remember", { title: "常驻0", content: "改", pinned: true }],
    ["remember", { title: "常驻1", content: "x", pinned: false }],
    ["recall", { titles: [] }],
    ["recall", { titles: ["a", "b", "c", "d", "e", "f"] }],
  ]);
  const e = out.map((o) => o.error ?? (o.ok ? "ok" : "other"));
  if (e.join() !== "bad_title,bad_title,too_long,ok,pinned_full,ok,ok,no_titles,other") throw new Error(e.join() + " " + JSON.stringify(out));
  if (out[4].max !== PINNED_MAX || !String(out[4].hint).includes("pinned:false")) throw new Error("pinned_full must explain how to proceed");
  if (w.state.memories.find((m) => m.title === "常驻1")!.pinned !== false) throw new Error("unpin");
});

// ---- 群聊任务 ----

const THIRD = "33333333-3333-3333-3333-333333333333";
const GID = 9;

function groupWorld(opts: { agents?: string[]; members?: string[]; agent_id?: string } = {}) {
  const members = opts.members ?? [ASKER, PEER, THIRD];
  const state = {
    job: { id: 7, asker: ASKER, peer: null, group_id: GID, message_id: 100, status: "running", agent_id: opts.agent_id ?? "durian" } as Record<string, unknown>,
    memories: [{ title: "群·约定", content: "周五聚餐", pinned: true, updated_at: "2026-11-10T00:00:00Z" }] as Mem[],
    messages: [] as Record<string, unknown>[],
    searches: [] as Record<string, unknown>[],
    upserts: [] as Record<string, unknown>[],
    tables: new Set<string>(),
    msgFilters: [] as [string, unknown][][],
  };
  const handler = (q: Q) => {
    state.tables.add(q.table + ":" + q.action);
    if (q.table === "agent_jobs" && q.action === "select") return { data: state.job };
    if (q.table === "agent_jobs" && q.action === "update") { Object.assign(state.job, q.payload); return {}; }
    if (q.table === "groups") return { data: { id: GID, name: "周末小分队", agents: opts.agents ?? ["durian", "ye_ying"] } };
    if (q.table === "group_members") return { data: members.map((user_id) => ({ user_id })) };
    if (q.table === "profiles") return { data: [{ id: ASKER, nickname: "小红" }, { id: PEER, nickname: "小明" }, { id: THIRD, nickname: "小刚" }] };
    if (q.table === "agent_group_memories" && q.action === "select") return { data: state.memories };
    if (q.table === "agent_group_memories" && q.action === "upsert") { state.upserts.push(q.payload as Record<string, unknown>); return {}; }
    if (q.table === "messages" && q.action === "select" && q.single) return { data: { sender_id: ASKER, body: "@沈剑心 周五去哪吃？" } };
    if (q.table === "messages" && q.action === "select") {
      state.msgFilters.push(q.filters);
      return { data: [
        { id: 100, sender_id: ASKER, author: null, body: "@沈剑心 周五去哪吃？", created_at: "2026-11-18T01:00:00Z" },
        { id: 99, sender_id: THIRD, author: "system", body: "小刚 邀请 小明 加入了群聊", created_at: "2026-11-18T00:59:00Z" },
        { id: 98, sender_id: THIRD, author: null, body: "我想吃火锅", created_at: "2026-11-18T00:58:00Z" },
      ] };
    }
    if (q.table === "messages" && q.action === "insert") { state.messages.push(q.payload as Record<string, unknown>); return { data: { id: 300 } }; }
    return {};
  };
  const rpc = (fn: string, args: Record<string, unknown>) => {
    if (fn === "agent_search_group_messages") { state.searches.push(args); return { data: [{ id: 50, sender_id: THIRD, author: null, body: "火锅", created_at: "2026-11-14T02:30:00Z" }] }; }
    return {};
  };
  return { state, ...fakeDb(handler, rpc) };
}

Deno.test("group job: group history without system lines, group memories, group search, reply row and pushes to every member", async () => {
  const w = groupWorld();
  const requests: Record<string, unknown>[] = [];
  const outputs: string[] = [];
  const pushes: [string, { title: string; body: string; tag: string; group?: number; peer?: string }][] = [];
  const script = [
    { id: "r1", output: [
      { type: "function_call", call_id: "a", name: "search_chats", arguments: JSON.stringify({ query: "火锅" }) },
      { type: "function_call", call_id: "b", name: "remember", arguments: JSON.stringify({ title: "聚餐", content: "想吃火锅" }) },
      { type: "function_call", call_id: "c", name: "game_status", arguments: "{}" },
    ] },
    { id: "r2", output: [{ type: "message", content: [{ type: "output_text", text: "沈剑心：火锅吧。" }] }] },
  ];
  let i = 0;
  await runJob({
    admin: w.admin, apiKey: "k", model: "m",
    fetchFn: ((_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      requests.push(b);
      if (i > 0) for (const o of b.input) outputs.push(o.output);
      return Promise.resolve(json(script[i++]));
    }) as unknown as typeof fetch,
    push: (to, p) => { pushes.push([to, p]); return Promise.resolve(); },
  }, 7);
  const text = (requests[0].input as { content: string }[])[0].content;
  if (!text.includes("这是群聊「周末小分队」") || !text.includes("「小红」、「小明」、「小刚」") || !text.includes("「小红」在叫你")) throw new Error(text);
  if (!text.includes("小刚：我想吃火锅") || text.includes("邀请 小明 加入了群聊")) throw new Error("history: " + text);
  if (!text.includes("【群·约定】周五聚餐") || !text.includes("这个群共用")) throw new Error("group memory missing");
  if (text.includes("进行中的小游戏")) throw new Error("no game hint in groups");
  if (requests[0].instructions !== systemInstructions("durian")) throw new Error("instructions must stay static");
  if (!/^durian:[0-9a-f]{16}$/.test(String(requests[0].prompt_cache_key))) throw new Error("cache key");
  if (w.state.searches[0].p_group !== GID || w.state.searches[0].p_before !== 100 || "p_a" in w.state.searches[0]) throw new Error("search args");
  if (w.state.upserts[0].group_id !== GID || w.state.upserts[0].agent_id !== "durian" || "user_lo" in w.state.upserts[0]) throw new Error("group memory upsert");
  if (JSON.parse(outputs[2]).error !== "not_available_in_group") throw new Error("game tool: " + outputs[2]);
  if (w.state.tables.has("agent_memories:select") || w.state.tables.has("friendships:select")) throw new Error("must not touch DM tables");
  const row = w.state.messages[0];
  if (row.group_id !== GID || row.sender_id !== ASKER || row.author !== "durian" || "receiver_id" in row || row.body !== "火锅吧。") throw new Error("reply row " + JSON.stringify(row));
  if (w.state.job.status !== "done" || w.state.job.reply_id !== 300) throw new Error(JSON.stringify(w.state.job));
  if (pushes.map((p) => p[0]).sort().join() !== [ASKER, PEER, THIRD].sort().join()) throw new Error("push targets");
  if (pushes.some((p) => p[1].title !== "周末小分队" || p[1].body !== "沈剑心：火锅吧。" || p[1].group !== GID || p[1].tag !== "agent-7")) throw new Error(JSON.stringify(pushes));
});

Deno.test("group job: agent switched off or asker removed -> failed, no network", async () => {
  for (const [opts, code] of [[{ agents: ["ye_ying"] }, "agent_not_enabled"], [{ members: [PEER, THIRD] }, "not_group_member"]] as [{ agents?: string[]; members?: string[] }, string][]) {
    const w = groupWorld(opts);
    let called = 0;
    await runJob({ admin: w.admin, apiKey: "k", model: "m", push: noPush, fetchFn: (() => { called++; return Promise.resolve(json({})); }) as unknown as typeof fetch }, 7);
    if (called || w.state.job.status !== "failed" || w.state.job.error !== code || w.state.messages.length) throw new Error(code + " " + JSON.stringify(w.state.job));
  }
});

Deno.test("every agent has its own persona and the shared rules; personas are distinct", () => {
  const ids = ["durian", "ye_ying", "xie_yunliu", "li_wangsheng"];
  const ins = ids.map((id) => systemInstructions(id));
  if (new Set(ins).size !== ids.length) throw new Error("personas must differ");
  if (!ins[2].startsWith("# 谢云流") || !ins[3].startsWith("# 李忘生")) throw new Error("wrong persona heading");
  const rules = (t: string) => t.slice(t.indexOf("## 应用规则"));
  if (rules(ins[2]).replace("谢云流", "X") !== rules(ins[3]).replace("李忘生", "X")) throw new Error("shared rules must be identical apart from the name");
});
