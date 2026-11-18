// 群信息面板：成员、添加成员、修改群名、助手开关、退出群聊

import { AGENTS, makeAgentAvatar } from '../agent/info.js';
import { loadAll } from '../data.js';
import { errText } from '../errors.js';
import { S, makeAvatar, nameOf, profileOf, sb } from '../state.js';
import { $, clear, h, toast } from '../utils.js';
import { renderChats } from '../views/chats.js';
import { renderChatHeader } from '../chat/view.js';
import { svgIcon } from '../menu.js';
import { dropGroup, groupOf, isOwner, memberIds } from './data.js';
import { confirmSheet, makeGroupAvatar, openSheet, pickFriends } from './ui.js';

// ===== 群信息面板 =====
var panel = null;

function ensurePanel() {
  if (panel) return panel;
  var back = h('button', { type: 'button', class: 'back', 'aria-label': '返回聊天' }, svgIcon('i-chevron-left'));
  back.addEventListener('click', closeGroupInfo);
  var body = h('div', { class: 'gi-body' });
  panel = h('section', { id: 'ginfo', class: 'gi', 'aria-label': '群信息' },
    h('div', { class: 'top' }, back, h('h2', { text: '群信息' })), body);
  panel._body = body;
  $('chat').appendChild(panel);
  return panel;
}
export function openGroupInfo() {
  var c = S.chat;
  if (!c || c.gid == null || !groupOf(c.gid)) return;
  ensurePanel().hidden = false;
  renderGroupInfo();
}
export function closeGroupInfo() {
  if (panel) panel.hidden = true;
}
export function groupInfoOpen() { return !!(panel && !panel.hidden); }
// 群数据变了（实时 / 重新加载）：面板开着就重画；顺手刷新标题
export function refreshGroupUi() {
  if (groupInfoOpen()) renderGroupInfo();
}

async function call(fn, args) {
  var r;
  try { r = await sb.rpc(fn, args); } catch (e) { r = { error: e }; }
  if (r.error) {
    toast(errText(r.error));
    if (r.error.message === 'not_group_member' && S.chat && args.p_group === S.chat.gid) { await loadAll(); if (!groupOf(args.p_group)) dropGroup(args.p_group, false); }
    return null;
  }
  return r;
}
function applyGroupRow(row) {
  var g = groupOf(row.id);
  if (!g || !row) return;
  g.name = row.name; g.owner_id = row.owner_id; g.agents = row.agents; g.updated_at = row.updated_at;
  renderChatHeader(); renderChats(); refreshGroupUi();
}

function memberRow(g, id) {
  var p = profileOf(id) || { id: id, nickname: nameOf(id) };
  var me = S.me && id === S.me.id;
  var row = h('li', { class: 'gi-member' }, makeAvatar(p, 40),
    h('span', { class: 'gi-nick', text: p.nickname + (me ? '（我）' : '') }));
  if (id === g.owner_id) row.appendChild(h('span', { class: 'gi-tag', text: '群主' }));
  else if (isOwner(g) && !me) {
    row.appendChild(h('button', { type: 'button', class: 'btn small ghost gi-rm', text: '移出', 'aria-label': '把 ' + p.nickname + ' 移出群聊', onclick: function () {
      confirmSheet('移出成员', '把「' + p.nickname + '」移出群聊？', '移出', async function () {
        var r = await call('remove_group_member', { p_group: g.id, p_user: id });
        if (!r) return false;
        await loadAll();
        return true;
      }, true);
    } }));
  }
  return row;
}

function agentRow(g, a) {
  var on = (g.agents || []).indexOf(a.id) >= 0;
  var sw = h('button', { type: 'button', class: 'gi-switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': a.name }, h('span', { class: 'knob' }));
  sw.addEventListener('click', async function () {
    sw.disabled = true;
    var next = on ? g.agents.filter(function (x) { return x !== a.id; }) : g.agents.concat([a.id]);
    var r = await call('set_group_agents', { p_group: g.id, p_agents: next });
    if (r && r.data) applyGroupRow(r.data); else renderGroupInfo();
  });
  return h('li', { class: 'gi-agent' }, makeAgentAvatar(40, a.id),
    h('span', { class: 'gi-nick', text: a.name }), sw);
}

export function renderGroupInfo() {
  var c = S.chat, g = c && c.gid != null ? groupOf(c.gid) : null;
  if (!panel) return;
  if (!g) { closeGroupInfo(); return; }
  var ids = memberIds(g);
  var body = clear(panel._body);
  body.appendChild(h('div', { class: 'gi-head' }, makeGroupAvatar(g, 64),
    h('div', { class: 'gi-title' }, h('b', { text: g.name }), h('span', { text: ids.length + ' 位成员' }))));

  body.appendChild(h('div', { class: 'section-title' }, '成员', h('span', { class: 'count', text: String(ids.length) })));
  var list = h('ul', { class: 'gi-list' });
  ids.forEach(function (id) { list.appendChild(memberRow(g, id)); });
  body.appendChild(list);
  body.appendChild(h('button', { type: 'button', class: 'btn ghost gi-wide', text: '添加成员', onclick: function () { addMembers(g); } }));

  body.appendChild(h('div', { class: 'section-title' }, '群设置'));
  body.appendChild(h('button', { type: 'button', class: 'gi-line', onclick: function () { renameGroup(g); } },
    h('span', { text: '修改群名' }), h('span', { class: 'gi-val', text: g.name })));

  body.appendChild(h('div', { class: 'section-title' }, '群里的助手'));
  body.appendChild(h('p', { class: 'gi-hint', text: '打开后，群里的人就能 @ 它' }));
  var al = h('ul', { class: 'gi-list' });
  AGENTS.forEach(function (a) { al.appendChild(agentRow(g, a)); });
  body.appendChild(al);

  body.appendChild(h('button', { type: 'button', class: 'btn danger gi-wide gi-leave', text: '退出群聊', onclick: function () { leaveGroup(g); } }));
}

function addMembers(g) {
  var have = new Set(memberIds(g));
  pickFriends({
    title: '添加成员', confirm: '添加', exclude: have, max: Math.max(0, 50 - have.size),
    onDone: async function (picked) {
      var r = await call('add_group_members', { p_group: g.id, p_members: picked });
      if (!r) return false;
      await loadAll();
      return true;
    }
  });
}

function renameGroup(g) {
  var input = h('input', { class: 'field', type: 'text', maxlength: '20', value: g.name, 'aria-label': '群名', autocomplete: 'off' });
  var sh = openSheet({
    title: '修改群名',
    body: h('div', { class: 'gs-pick' }, input),
    actions: [
      { text: '取消', kind: 'ghost', onclick: function (b, c) { c.close(); } },
      { text: '保存', kind: 'primary', onclick: async function (b, c) {
        var name = input.value.replace(/^\s+|\s+$/g, '');
        if (!name) return toast('群名不能是空的');
        if (name === g.name) return c.close();
        c.setBusy(true);
        var r = await call('rename_group', { p_group: g.id, p_name: name });
        c.setBusy(false);
        if (r && r.data) { applyGroupRow(r.data); c.close(); }
      } }
    ]
  });
  setTimeout(function () { try { input.focus(); input.select(); } catch (e) { /* 忽略 */ } }, 50);
  return sh;
}

function leaveGroup(g) {
  var text = isOwner(g) && memberIds(g).length > 1 ? '退出后群主会转给最早加入的成员，你不会再收到这个群的消息。' : '退出后你不会再收到这个群的消息。';
  confirmSheet('退出群聊', text, '退出', async function () {
    var r = await call('leave_group', { p_group: g.id });
    if (!r) return false;
    closeGroupInfo();
    dropGroup(g.id, true);
    toast('已退出群聊');
    return true;
  }, true);
}
