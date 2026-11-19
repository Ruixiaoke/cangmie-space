// 每位助手分别跟踪最近的任务、实时状态和回复。
import { fetchLatest, nearBottom, scrollToBottom } from '../chat/view.js';
import { errText } from '../errors.js';
import { S, rowInChat, sb } from '../state.js';
import { enabledAgents, groupOf } from '../groups/data.js';
import { $, clear, h, toast } from '../utils.js';
import { AGENTS, agentName, makeAgentAvatar, mentionedAgents } from './info.js';

var STALE_MS = 3 * 60 * 1000;
var NOTE_MAX_MS = 30 * 60 * 1000;
var REPLY_WAIT_MS = 4000;
var timer = 0;

function agentId(job) { return job.agent_id || 'durian'; }
function active(job) { return job.status === 'pending' || job.status === 'running'; }
function startedAt(job) { return Date.parse(job.created_at || '') || job.localAt || Date.now(); }
function replied(c, job) {
  if (job.reply_id != null) return c.ids.has(job.reply_id);
  return c.msgs.some(function (m) {
    return m.id != null && m.id > job.message_id && m.author === agentId(job);
  });
}

function liveView(c, job) {
  var age = Date.now() - startedAt(job);
  if (active(job)) return replied(c, job) ? null : age > STALE_MS ? 'note' : 'think';
  if (job.status === 'done') return job.reply_id != null && !replied(c, job) && job.waitUntil > Date.now() ? 'think' : null;
  if (job.status === 'failed') {
    var movedOn = c.msgs.some(function (m) { return m.id > job.message_id && !m.author; });
    return age > NOTE_MAX_MS || movedOn ? null : 'note';
  }
  return null;
}

function noteText(job) {
  return agentName(agentId(job)) + (job.error === 'agent_unconfigured' ? '还没接通' : '走神了，再问一次吧');
}

export function renderLive() {
  var c = S.chat, box = $('agentLive');
  if (!box) return;
  clearTimeout(timer); timer = 0;
  var entries = c ? Object.values(c.agentJobs).map(function (job) {
    return { job: job, view: liveView(c, job) };
  }).filter(function (entry) { return entry.view; }) : [];
  var sig = entries.map(function (entry) {
    return agentId(entry.job) + '|' + entry.view + '|' + (entry.view === 'note' ? noteText(entry.job) : '');
  }).join(';');
  var stick = entries.length && nearBottom();
  if (box._v !== sig) {
    box._v = sig;
    clear(box);
    entries.forEach(function (entry) {
      var job = entry.job, name = agentName(agentId(job));
      if (entry.view === 'note') {
        box.appendChild(h('div', { class: 'agent-note', role: 'status', text: noteText(job) }));
        return;
      }
      box.appendChild(h('div', { class: 'agent-think', role: 'status', 'aria-label': name + '思考中' },
        h('div', { class: 'av-slot' }, makeAgentAvatar(40, agentId(job))),
        h('div', { class: 'agent-think-body' },
          h('span', { class: 'agent-name', text: name }),
          h('span', { class: 'agent-think-txt' }, '思考中', h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))))));
    });
  }
  box.hidden = !entries.length;
  if (stick) scrollToBottom();

  var deadlines = entries.filter(function (entry) { return entry.view === 'think'; }).map(function (entry) {
    return active(entry.job) ? startedAt(entry.job) + STALE_MS : entry.job.waitUntil;
  });
  if (deadlines.length) {
    timer = setTimeout(async function () {
      if (S.chat !== c) return;
      var needsRefresh = Object.values(c.agentJobs).some(function (job) {
        return job.waitUntil && job.waitUntil <= Date.now() && !replied(c, job);
      });
      if (needsRefresh) {
        Object.values(c.agentJobs).forEach(function (job) {
          if (job.waitUntil <= Date.now()) job.waitUntil = 0;
        });
        try { await fetchLatest(false); } catch (e) { /* Realtime can still deliver the reply. */ }
      }
      if (S.chat === c) renderLive();
    }, Math.max(50, Math.min.apply(null, deadlines) - Date.now() + 25));
  }
}

function setJob(c, job) {
  var key = agentId(job), old = c.agentJobs[key];
  if (old && job.message_id < old.message_id && (old.local || job.local)) return;
  if (old && !old.local && !job.local) {
    if (job.id < old.id || (job.id === old.id && Date.parse(job.updated_at) < Date.parse(old.updated_at))) return;
    if (job.id === old.id && !active(old) && active(job) && old.error !== 'invoke_failed') return;
  }
  if (job.status === 'done' && job.reply_id != null && !replied(c, job)) {
    job.waitUntil = old && old.id === job.id && old.status === 'done' ? old.waitUntil : Date.now() + REPLY_WAIT_MS;
  }
  c.agentJobs[key] = job;
  renderLive();
}

export function onAgentJob(event) {
  var job = event && event.new, c = S.chat;
  if (!job || !job.id || !S.me || !c) return;
  // 群里的任务按群归属（整个群的人都看得到「思考中」）；私聊的任务按对方
  if (job.group_id != null) { if (c.gid === job.group_id) setJob(c, job); return; }
  var peer = job.asker === S.me.id ? job.peer : job.asker;
  if (c.gid == null && c.peer === peer) setJob(c, job);
}

export async function agentResync() {
  var c = S.chat;
  if (!c || !S.me) return;
  var me = S.me.id, peer = c.peer;
  await Promise.allSettled(AGENTS.map(async function (agent) {
    var q = sb.from('agent_jobs').select('*').eq('agent_id', agent.id);
    q = c.gid != null ? q.eq('group_id', c.gid)
      : q.or('and(asker.eq.' + me + ',peer.eq.' + peer + '),and(asker.eq.' + peer + ',peer.eq.' + me + ')');
    var r = await q.order('id', { ascending: false }).limit(1);
    if (S.chat === c && !r.error && r.data && r.data[0]) setJob(c, r.data[0]);
  }));
}

export function resetLive() {
  clearTimeout(timer); timer = 0;
  var box = $('agentLive');
  if (box) { box.hidden = true; clear(box); box._v = null; }
}

async function askOne(row, agent, c) {
  var pending = { local: true, status: 'pending', message_id: row.id, agent_id: agent.id, localAt: Date.now() };
  if (c) setJob(c, pending);
  var r;
  try { r = await sb.rpc(row.group_id != null ? 'agent_ask_group' : 'agent_ask', { p_message: row.id, p_agent_id: agent.id }); } catch (e) { r = { error: e }; }
  if (r.error || !r.data) {
    if (S.chat === c && c && c.agentJobs[agent.id] === pending) {
      delete c.agentJobs[agent.id];
      renderLive();
      void agentResync();
    }
    toast(agent.name + '：' + errText(r.error));
    return;
  }
  var job = r.data;
  if (S.chat && rowInChat(S.chat, row)) setJob(S.chat, job);
  var inv;
  try { inv = await sb.functions.invoke('agent-chat', { body: { job: job.id } }); } catch (e) { inv = { error: e }; }
  if (inv && inv.error) {
    var current = S.chat && rowInChat(S.chat, row) && S.chat.agentJobs[agent.id];
    if (current && current.id === job.id && current.status === 'pending') {
      setJob(S.chat, Object.assign({}, current, { status: 'failed', error: 'invoke_failed' }));
    }
    toast('没能联系上' + agent.name + '，再问一次吧');
  }
}

export async function askAgent(row) {
  if (!S.me || row.sender_id !== S.me.id) return;
  var c = S.chat && rowInChat(S.chat, row) ? S.chat : null;
  var agents = mentionedAgents(row.body);
  if (row.group_id != null) {
    // 群里：助手要先在群设置里打开；没打开的只提示，不去叫（不调用后端）
    var on = enabledAgents(groupOf(row.group_id));
    agents.filter(function (a) { return !on.some(function (x) { return x.id === a.id; }); }).forEach(function (a) { toast('先在群设置里打开' + a.name); });
    agents = agents.filter(function (a) { return on.some(function (x) { return x.id === a.id; }); });
  }
  await Promise.all(agents.map(function (agent) { return askOne(row, agent, c); }));
}
