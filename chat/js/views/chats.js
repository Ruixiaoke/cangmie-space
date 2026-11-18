// 渲染：消息列表

import { openChat } from '../chat/view.js';
import { previewOf } from '../fx/table.js';
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
  return S.convs.reduce(function (n, c) { return n + (Number(c.unread_count) || 0); }, 0);
}
export function incomingRequests() {
  return S.friendships.filter(function (f) { return f.status === 'pending' && S.me && f.addressee_id === S.me.id; });
}
export function outgoingRequests() {
  return S.friendships.filter(function (f) { return f.status === 'pending' && S.me && f.requester_id === S.me.id; });
}

export function renderChats() {
  var box = clear($('chatList'));
  var list = S.convs.filter(function (c) { return c.last_id != null; });
  if (!list.length) {
    box.appendChild(emptyState('还没有聊天呢，去「好友」里找朋友打个招呼吧'));
    return;
  }
  list.forEach(function (c) {
    var own = S.me && c.last_sender_id === S.me.id && !c.last_author;
    var unread = Number(c.unread_count) || 0;
    var side = h('div', { class: 'side' }, h('span', { class: 'time', text: fmtTime(c.last_at) }));
    if (unread > 0) side.appendChild(h('span', { class: 'badge', text: unread > 99 ? '99+' : String(unread) }));
    box.appendChild(h('button', { type: 'button', class: 'card', onclick: function () { openChat(c.peer_id); } },
      makeAvatar(peerFromConv(c)),
      h('div', { class: 'info' },
        h('div', { class: 'name', text: c.peer_nickname }),
        h('div', { class: 'line2', text: c.last_author ? '沈剑心：' + String(c.last_body).replace(/\s+/g, ' ') : (own ? '你: ' : '') + previewOf(c.last_body) })),
      side));
  });
}
