// 沈剑心的任务状态：提问、实时同步、底部的「沈剑心 思考中…」行和失败提示

import { fetchLatest, nearBottom, scrollToBottom } from '../chat/view.js';
import { errText } from '../errors.js';
import { S, sb } from '../state.js';
import { $, clear, h, toast } from '../utils.js';
import { agentName, makeAgentAvatar, mentionedAgent } from './info.js';

// ===== 任务状态 =====
// c.job：当前会话里最近一个任务（agent_jobs 的一行；刚提问、还没拿到行时是 {local:true, status:'pending'}）
var STALE_MS = 3 * 60 * 1000;     // 超过 3 分钟还没结果：算失败（服务器那边也会在下次提问时清掉）
var NOTE_MAX_MS = 30 * 60 * 1000; // 重新打开聊天时，失败提示只在 30 分钟内显示
var timer = 0, doneTimer = 0;

function otherOf(job) { return job.asker === S.me.id ? job.peer : job.asker; }
function active(job) { return job.status === 'pending' || job.status === 'running'; }
function startedAt(job) { var t = Date.parse(job.created_at || ''); return isNaN(t) ? (job.localAt || Date.now()) : t; }
// 之后有没有沈剑心的回复（job.message_id 之后出现的沈剑心消息）
function replied(c, job) {
  var mid = job.message_id == null ? -1 : job.message_id;
  return c.msgs.some(function (m) { return m.id != null && m.id > mid && m.author === (job.agent_id || "durian"); });
}
function sawAnyAfter(c, job) {
  var mid = job.message_id == null ? -1 : job.message_id;
  return c.msgs.some(function (m) { return m.id != null && m.id > mid; });
}
// 当前该显示什么：'think' | 'note' | null
export function liveView(c) {
  var job = c && c.job;
  if (!job) return null;
  var age = Date.now() - startedAt(job);
  if (active(job)) {
    if (replied(c, job)) return null;
    return age > STALE_MS ? 'note' : 'think';
  }
  if (job.status === 'done') {
    // 任务完成的通知可能比回复消息先到：等回复出现再收起（最多等几秒，见 setJob）
    return job.reply_id != null && !c.ids.has(job.reply_id) && !replied(c, job) && c.doneWait ? 'think' : null;
  }
  if (job.status === 'failed') {
    if (age > NOTE_MAX_MS || sawAnyAfter(c, job)) return null;
    return 'note';
  }
  return null;
}
function noteText(job) {
  return agentName(job.agent_id) + (job.error === 'agent_unconfigured' ? '还没接通' : '走神了，再问一次吧');
}

export function renderLive() {
  var c = S.chat, box = $('agentLive');
  if (!box) return;
  var v = c ? liveView(c) : null;
  clearTimeout(timer); timer = 0;
  if (!v) { box.hidden = true; clear(box); box._v = null; return; }
  var stick = nearBottom();
  var name = agentName(c.job.agent_id);
  var sig = v + '|' + name + '|' + (v === 'note' ? noteText(c.job) : '');
  if (box._v !== sig) {
    box._v = sig;
    clear(box);
    if (v === 'think') {
      box.appendChild(h('div', { class: 'agent-think', role: 'status', 'aria-label': name + '思考中' },
        h('div', { class: 'av-slot' }, makeAgentAvatar(40, c.job.agent_id)),
        h('div', { class: 'agent-think-body' },
          h('span', { class: 'agent-name', text: name }),
          h('span', { class: 'agent-think-txt' }, '思考中', h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))))));
    } else {
      box.appendChild(h('div', { class: 'agent-note', role: 'status', text: noteText(c.job) }));
    }
  }
  box.hidden = false;
  if (stick) scrollToBottom();
  // 到了「走神」的时间点自动换成提示
  if (v === 'think' && active(c.job)) {
    var left = STALE_MS - (Date.now() - startedAt(c.job)) + 50;
    timer = setTimeout(renderLive, Math.max(50, left));
  }
}

function setJob(c, job) {
  var old = c.job;
  if (old && !old.local && job.id != null && old.id != null && job.id < old.id) return; // 过期的事件
  c.job = job;
  clearTimeout(doneTimer); c.doneWait = false;
  if (job.status === 'done' && job.reply_id != null && !c.ids.has(job.reply_id) && !replied(c, job)) {
    // 回复消息还没到：继续显示思考中；4 秒后还没到就主动拉一次
    c.doneWait = true;
    doneTimer = setTimeout(async function () {
      if (S.chat !== c) return;
      try { await fetchLatest(false); } catch (e) { /* 忽略 */ }
      if (S.chat === c) { c.doneWait = false; renderLive(); }
    }, 4000);
  }
  renderLive();
}

// 实时：agent_jobs 的变化
export function onAgentJob(p) {
  var job = p && p.new;
  var c = S.chat;
  if (!job || !job.id || !S.me || !c) return;
  if (otherOf(job) !== c.peer) return;
  setJob(c, job);
}
// 打开聊天 / 重连后：取这一对好友最近的任务
export async function agentResync() {
  var c = S.chat; if (!c || !S.me) return;
  var me = S.me.id, peer = c.peer;
  var r;
  try {
    r = await sb.from('agent_jobs').select('*')
      .or('and(asker.eq.' + me + ',peer.eq.' + peer + '),and(asker.eq.' + peer + ',peer.eq.' + me + ')')
      .order('id', { ascending: false }).limit(1);
  } catch (e) { return; }
  if (S.chat !== c || r.error) return;
  var job = (r.data || [])[0];
  if (!job) return;
  if (c.job && c.job.local) { if (job.id != null) setJob(c, job); return; }
  setJob(c, job);
}
export function resetLive() {
  clearTimeout(timer); clearTimeout(doneTimer); timer = 0; doneTimer = 0;
  var box = $('agentLive');
  if (box) { box.hidden = true; clear(box); box._v = null; }
}

// ===== 提问 =====
// 消息已经存好（有 id）之后调用：建任务 -> 叫醒 agent-chat 函数；两步都失败了用 toast 说原因
export async function askAgent(row) {
  var agent = mentionedAgent(row.body);
  if (!agent || !S.me || row.sender_id !== S.me.id) return;
  var peer = row.receiver_id;
  var c = S.chat && S.chat.peer === peer ? S.chat : null;
  if (c) setJob(c, { local: true, status: 'pending', message_id: row.id, agent_id: agent.id, localAt: Date.now() });
  var r;
  try { r = await sb.rpc('agent_ask', { p_message: row.id }); } catch (e) { r = { error: e }; }
  if (r.error) {
    if (c && c.job && c.job.local && S.chat === c) { c.job = null; renderLive(); }
    toast(errText(r.error));
    return;
  }
  var job = r.data;
  if (S.chat && S.chat.peer === peer && job) setJob(S.chat, job);
  var inv;
  try { inv = await sb.functions.invoke('agent-chat', { body: { job: job.id } }); } catch (e) { inv = { error: e }; }
  if (inv && inv.error) {
    // 没能叫醒函数：任务留在 pending，由 3 分钟超时兜底；先让提问的人看到失败提示
    if (S.chat && S.chat.peer === peer && S.chat.job && S.chat.job.id === job.id) setJob(S.chat, Object.assign({}, S.chat.job, { status: 'failed', error: 'invoke_failed' }));
    toast('没能联系上' + agent.name + '，再问一次吧');
  }
}
