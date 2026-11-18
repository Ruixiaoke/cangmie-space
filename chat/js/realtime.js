// 实时

import { agentResync, onAgentJob } from './agent/live.js';
import { agentName } from './agent/info.js';
import { fetchLatest, msgFromRow, nearBottom, renderMsgs, sortMsgs } from './chat/view.js';
import { loadAll } from './data.js';
import { playFx } from './fx/engine.js';
import { previewOf } from './fx/table.js';
import { onPoolGame, poolResync } from './miniapps/pool.js';
import { onSlingGame, slResync } from './miniapps/sling.js';
import { onTttGame, tttResync } from './miniapps/ttt.js';
import { notify, notifyMessage } from './notify.js';
import { markReplyGone, replyPrefix } from './quote.js';
import { markReadIfNeeded } from './read.js';
import { S, avatarUrl, nameOf, profileOf, sb } from './state.js';
import { popCheer } from './mascot.js';
import { cut, isVisible, toast } from './utils.js';
import { convOf, renderChats } from './views/chats.js';
import { updateBadges } from './views/tabs.js';

// ===== 实时 =====
export function applyOwnToConv(row) {
  var conv = convOf(row.receiver_id);
  if (!conv) return;
  if (conv.last_id != null && Number(conv.last_id) > row.id) return;
  conv.last_id = row.id; conv.last_body = row.body; conv.last_sender_id = row.sender_id; conv.last_at = row.created_at; conv.last_read_at = row.read_at; conv.last_author = row.author || null;
  S.convs.sort(function (a, b) { return new Date(b.last_at || b.friends_since) - new Date(a.last_at || a.friends_since); });
  renderChats(); updateBadges();
}
// 我刚发出、还在等 RPC 返回的同一条消息：实时推送先到时别再加一行（doSend 会处理）
function hasPendingTwin(c, row) {
  return c.msgs.some(function (m) { return m.id == null && m.status === 'sending' && m.sender_id === row.sender_id && m.body === row.body; });
}
async function onMessageInsert(row) {
  var me = S.me.id;
  if (row.sender_id === me) {
    // 自己在别处（另一个标签页 / 设备）发的
    if (S.chat && S.chat.peer === row.receiver_id && !S.chat.ids.has(row.id) && !hasPendingTwin(S.chat, row)) {
      S.chat.ids.add(row.id); S.chat.msgs.push(msgFromRow(row)); sortMsgs(); renderMsgs({ stick: nearBottom() });
    }
    applyOwnToConv(row);
    if (row.author && !(S.chat && S.chat.peer === row.receiver_id) && isVisible()) toast(agentName(row.author) + '回复了你：' + cut(row.body, 24)); // 提问的人不在这个聊天里
    return;
  }
  var open = S.chat && S.chat.peer === row.sender_id;
  var conv = convOf(row.sender_id);
  if (!conv || !profileOf(row.sender_id)) {
    await loadAll(); // 新好友的第一条消息：先把资料取回来
    conv = convOf(row.sender_id);
    if (!conv) return;
  } else {
    if (conv.last_id == null || Number(conv.last_id) < row.id) {
      conv.last_id = row.id; conv.last_body = row.body; conv.last_sender_id = row.sender_id; conv.last_at = row.created_at; conv.last_read_at = row.read_at; conv.last_author = row.author || null;
    }
    if (!(open && isVisible())) conv.unread_count = (Number(conv.unread_count) || 0) + 1;
    S.convs.sort(function (a, b) { return new Date(b.last_at || b.friends_since) - new Date(a.last_at || a.friends_since); });
  }
  if (open) {
    var c = S.chat;
    if (!c.ids.has(row.id)) {
      var nm = msgFromRow(row);
      c.ids.add(row.id); c.msgs.push(nm); sortMsgs(); renderMsgs({ stick: nearBottom() });
      if (isVisible() && !nm.author) playFx(nm); // 沈剑心的回复不触发特效
    }
  }
  renderChats(); updateBadges();
  if (open && isVisible()) markReadIfNeeded();
  else {
    var rp = await replyPrefix(row);
    notifyMessage(row, rp);
    if (isVisible() && !open) toast('新消息：' + (row.author ? agentName(row.author) : nameOf(row.sender_id)) + '：' + cut(rp + (row.author ? row.body : previewOf(row.body)), rp ? 44 : 24));
  }
}
function onMessageUpdate(row) {
  var me = S.me.id;
  if (S.chat && (row.sender_id === S.chat.peer || row.receiver_id === S.chat.peer)) {
    var rx = S.chat.msgs.find(function (m) { return m.id === row.id; });
    if (rx && markReplyGone(rx, row)) renderMsgs({ stick: false }); // 被引用的消息删除后 reply_to 变空
  }
  if (row.sender_id === me) {
    // 对方读了我的消息
    if (S.chat && S.chat.peer === row.receiver_id) {
      var ex = S.chat.msgs.find(function (m) { return m.id === row.id; });
      if (ex && ex.read_at !== row.read_at) { ex.read_at = row.read_at; renderMsgs({ stick: false }); }
    }
    var conv = convOf(row.receiver_id);
    if (conv && Number(conv.last_id) === row.id) { conv.last_read_at = row.read_at; }
  } else if (row.receiver_id === me) {
    scheduleLoadAll(); // 在别的设备上读了：同步未读数
  }
}
var loadTimer = null;
function scheduleLoadAll() { clearTimeout(loadTimer); loadTimer = setTimeout(loadAll, 300); }

async function onFriendship(payload) {
  var f = payload.new, me = S.me.id;
  if (!f || !f.id) return scheduleLoadAll();
  await loadAll();
  var other = f.requester_id === me ? f.addressee_id : f.requester_id;
  var name = nameOf(other);
  var relevant = !(isVisible() && S.tab === 'friends' && !S.chat);
  if (f.addressee_id === me && f.status === 'pending') {
    if (relevant) notify({ title: '新的好友请求', body: name + ' 想加你为好友', tag: 'req-' + other, icon: avatarUrl((profileOf(other) || {}).avatar_path), data: { tab: 'friends' } });
    if (isVisible()) toast(name + ' 请求加你为好友');
  } else if (f.requester_id === me && f.status === 'accepted' && payload.eventType === 'UPDATE') {
    if (relevant) notify({ title: '好友请求已通过', body: name + ' 通过了你的好友请求', tag: 'req-' + other, icon: avatarUrl((profileOf(other) || {}).avatar_path), data: { peer: other } });
    if (isVisible()) { toast(name + ' 通过了你的好友请求'); popCheer('好耶！'); }
  }
}

export function startRealtime() {
  stopRealtime();
  var me = S.me.id;
  var ch = sb.channel('chat-' + me + '-' + Date.now());
  function msg(event, col, handler) {
    ch.on('postgres_changes', { event: event, schema: 'public', table: 'messages', filter: col + '=eq.' + me }, function (p) { handler(p.new); });
  }
  msg('INSERT', 'receiver_id', onMessageInsert);
  msg('INSERT', 'sender_id', onMessageInsert);
  msg('UPDATE', 'sender_id', onMessageUpdate);
  msg('UPDATE', 'receiver_id', onMessageUpdate);
  ['requester_id', 'addressee_id'].forEach(function (col) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: col + '=eq.' + me }, onFriendship);
  });
  ['player_x', 'player_o'].forEach(function (col) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'ttt_games', filter: col + '=eq.' + me }, onTttGame);
  });
  ['player_a', 'player_b'].forEach(function (col) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'sling_games', filter: col + '=eq.' + me }, onSlingGame);
  });
  ['player_a', 'player_b'].forEach(function (col) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'pool_games', filter: col + '=eq.' + me }, onPoolGame);
  });
  ['asker', 'peer'].forEach(function (col) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'agent_jobs', filter: col + '=eq.' + me }, onAgentJob);
  });
  ch.subscribe(function (status) {
    if (status === 'SUBSCRIBED') {
      // 重新连上之后补一次，避免断线期间漏消息
      refreshAll();
      S.hadSubscribed = true;
    }
  });
  S.channel = ch;
}
export function stopRealtime() {
  if (S.channel) { try { sb.removeChannel(S.channel); } catch (e) { /* 忽略 */ } }
  S.channel = null; S.hadSubscribed = false;
}
export async function refreshAll() {
  if (!S.me) return;
  await loadAll();
  if (S.chat) { await fetchLatest(false); markReadIfNeeded(); tttResync(); slResync(); poolResync(); agentResync(); }
}
