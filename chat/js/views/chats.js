// 渲染：消息列表

import { agentName } from '../agent/info.js';
import { openChat, openGroup } from '../chat/view.js';
import { previewOf } from '../fx/table.js';
import { groupPreview } from '../groups/data.js';
import { makeGroupAvatar } from '../groups/ui.js';
import { S, makeAvatar } from '../state.js';
import { emptyState } from '../mascot.js';
import { $, clear, fmtTime, h } from '../utils.js';

// ===== 渲染：消息列表 =====
export function convOf(peerId) {
  for (var i = 0; i < S.convs.length; i++) if (S.convs[i].peer_id === peerId) return S.convs[i];
  return null;
}
export function peerFromConv(c) {
  return { id: c.peer_id, username: c.peer_username, nickname: c.peer_nickname, avatar_path: c.peer_avatar_path };
}
export function totalUnread() {
  var n = S.convs.reduce(function (n, c) { return n + (Number(c.unread_count) || 0); }, 0);
  return S.groups.reduce(function (n, g) { return n + (Number(g.unread_count) || 0); }, n);
}
export function incomingRequests() {
  return S.friendships.filter(function (f) { return f.status === 'pending' && S.me && f.addressee_id === S.me.id; });
}
export function outgoingRequests() {
  return S.friendships.filter(function (f) { return f.status === 'pending' && S.me && f.requester_id === S.me.id; });
}

function card(avatar, name, line, at, unread, onclick, label) {
  var side = h('div', { class: 'side' }, h('span', { class: 'time', text: fmtTime(at) }));
  if (unread > 0) side.appendChild(h('span', { class: 'badge', text: unread > 99 ? '99+' : String(unread) }));
  return h('button', { type: 'button', class: 'card', 'aria-label': label || null, onclick: onclick },
    avatar,
    h('div', { class: 'info' }, h('div', { class: 'name', text: name }), h('div', { class: 'line2', text: line })),
    side);
}
export function renderChats() {
  var box = clear($('chatList'));
  // 私聊和群聊混在一起，按最后活动时间排
  var items = [];
  S.convs.forEach(function (c) { if (c.last_id != null) items.push({ at: c.last_at, conv: c }); });
  S.groups.forEach(function (g) { items.push({ at: g.last_at || g.created_at, group: g }); });
  items.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
  if (!items.length) {
    box.appendChild(emptyState('还没有聊天呢，去「好友」里找朋友打个招呼吧'));
    return;
  }
  items.forEach(function (it) {
    if (it.group) {
      var g = it.group;
      box.appendChild(card(makeGroupAvatar(g, 48), g.name, groupPreview(g), it.at, Number(g.unread_count) || 0, function () { openGroup(g.id); }, '群聊 ' + g.name));
      return;
    }
    var c = it.conv;
    var own = S.me && c.last_sender_id === S.me.id && !c.last_author;
    box.appendChild(card(makeAvatar(peerFromConv(c)), c.peer_nickname,
      c.last_author ? agentName(c.last_author) + '：' + String(c.last_body).replace(/\s+/g, ' ') : (own ? '你: ' : '') + previewOf(c.last_body),
      c.last_at, Number(c.unread_count) || 0, function () { openChat(c.peer_id); }));
  });
}
