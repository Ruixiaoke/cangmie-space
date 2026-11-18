// 实时

import { agentResync, onAgentJob } from './agent/live.js';
import { agentName } from './agent/info.js';
import { fetchLatest, msgFromRow, nearBottom, renderChatHeader, renderMsgs, sortMsgs } from './chat/view.js';
import { loadAll } from './data.js';
import { playFx } from './fx/engine.js';
import { previewOf } from './fx/table.js';
import { onPoolGame, poolResync } from './miniapps/pool.js';
import { onSlingGame, slResync } from './miniapps/sling.js';
import { onDdzGame, onDdzHand, onDdzScore, ddzResync } from './miniapps/ddz.js';
import { onTttGame, tttResync } from './miniapps/ttt.js';
import { notify, notifyGroupMessage, notifyMessage } from './notify.js';
import { applyGroupLast, dropGroup, groupLine, groupOf } from './groups/data.js';
import { refreshGroupUi } from './groups/info.js';
import { markReplyGone, replyPrefix } from './quote.js';
import { markReadIfNeeded } from './read.js';
import { S, avatarUrl, nameOf, profileOf, rowInChat, sb } from './state.js';
import { popCheer } from './mascot.js';
import { cut, isVisible, toast } from './utils.js';
import { convOf, renderChats } from './views/chats.js';
import { updateBadges } from './views/tabs.js';

// ===== 实时 =====
export function applyOwnToConv(row) {
  if (row.group_id != null) {
    var g = groupOf(row.group_id);
    if (!g) return;
    if (applyGroupLast(g, row) && !row.author) g.unread_count = 0; // 自己发的消息：服务器已经把群读到这一条
    renderChats(); updateBadges();
    return;
  }
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
// 群消息（真人、助手回复、系统提示）。同一条可能经「我发的」和「群里的」两路到达，用 id 去重
async function onGroupMessage(row) {
  var me = S.me.id, g = groupOf(row.group_id);
  if (!g) {
    await loadAll(); // 刚被拉进群的第一条消息：先把群和成员资料取回来
    g = groupOf(row.group_id);
    if (!g) return;
  }
  var sys = row.author === 'system';
  var mine = row.sender_id === me && !row.author;
  var c = S.chat, open = !!(c && c.gid === row.group_id);
  if (applyGroupLast(g, row)) {
    if (mine) g.unread_count = 0;
    else if (!sys && !(open && isVisible())) g.unread_count = (Number(g.unread_count) || 0) + 1;
  }
  var fresh = false;
  if (open && !c.ids.has(row.id)) {
    if (!(mine && hasPendingTwin(c, row))) {
      fresh = true;
      var nm = msgFromRow(row);
      c.ids.add(row.id); c.msgs.push(nm); sortMsgs(); renderMsgs({ stick: nearBottom() });
      if (isVisible() && !nm.author && !mine) playFx(nm);
    }
  }
  renderChats(); updateBadges();
  if (sys) scheduleLoadAll(); // 有人进出 / 改名 / 开关助手：成员和资料重新取一次
  if (mine || sys) return;
  if (open && isVisible()) { markReadIfNeeded(); return; }
  if (!fresh && open) return;
  var rp = await replyPrefix(row);
  notifyGroupMessage(row, g, rp);
  if (isVisible() && !open) toast(g.name + '｜' + cut(groupLine(row), 24));
}
// 群或成员表变了：名字 / 助手开关 / 群主直接更新；加入新群重新取；被移出就关掉
function onGroupRow(p) {
  var row = p.new;
  if (!row || row.id == null) return;
  var g = groupOf(row.id);
  if (!g) return;
  g.name = row.name; g.owner_id = row.owner_id; g.agents = row.agents; g.updated_at = row.updated_at;
  renderChats();
  if (S.chat && S.chat.gid === row.id) { renderChatHeader(); refreshGroupUi(); }
}
function onMemberRow(p) {
  var me = S.me.id;
  if (p.eventType === 'DELETE') {
    var old = p.old || {};
    if (old.group_id != null && (old.user_id == null || old.user_id === me)) dropGroup(old.group_id, false);
    return;
  }
  var row = p.new || {};
  if (p.eventType === 'INSERT') { scheduleLoadAll(); return; }
  // UPDATE：别的设备读了这个群，同步未读数
  var g = groupOf(row.group_id);
  if (g && Number(g.unread_count) > 0 && g.last_id != null && Number(row.last_read_id) >= Number(g.last_id)) {
    g.unread_count = 0; renderChats(); updateBadges();
  }
}
async function onMessageInsert(row) {
  if (row.group_id != null) return; // 群消息走 onGroupMessage
  var me = S.me.id;
  if (row.sender_id === me) {
    // 自己在别处（另一个标签页 / 设备）发的
    if (S.chat && rowInChat(S.chat, row) && !S.chat.ids.has(row.id) && !hasPendingTwin(S.chat, row)) {
      S.chat.ids.add(row.id); S.chat.msgs.push(msgFromRow(row)); sortMsgs(); renderMsgs({ stick: nearBottom() });
    }
    applyOwnToConv(row);
    if (row.author && !(S.chat && rowInChat(S.chat, row)) && isVisible()) toast(agentName(row.author) + '回复了你：' + cut(row.body, 24)); // 提问的人不在这个聊天里
    return;
  }
  var open = S.chat && S.chat.gid == null && S.chat.peer === row.sender_id;
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
  if (row.group_id != null) {
    // 群里被引用的消息删除后 reply_to 变空
    if (S.chat && S.chat.gid === row.group_id) {
      var gx = S.chat.msgs.find(function (m) { return m.id === row.id; });
      if (gx && markReplyGone(gx, row)) renderMsgs({ stick: false });
    }
    return;
  }
  if (S.chat && S.chat.gid == null && (row.sender_id === S.chat.peer || row.receiver_id === S.chat.peer)) {
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
    // 群消息的 sender_id 也是我（我发的 / 我叫出来的助手回复）：这两路只管私聊，群消息走下面 group_id 的订阅
    ch.on('postgres_changes', { event: event, schema: 'public', table: 'messages', filter: col + '=eq.' + me }, function (p) { if (p.new && p.new.group_id == null) handler(p.new); });
  }
  msg('INSERT', 'receiver_id', onMessageInsert);
  msg('INSERT', 'sender_id', onMessageInsert);
  msg('UPDATE', 'sender_id', onMessageUpdate);
  msg('UPDATE', 'receiver_id', onMessageUpdate);
  // 群消息：Realtime 对每个订阅者各自套 RLS，所以 group_id > 0 只会收到我所在群的消息
  ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'group_id=gt.0' }, function (p) { onGroupMessage(p.new); });
  ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: 'group_id=gt.0' }, function (p) { onMessageUpdate(p.new); });
  ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'groups' }, onGroupRow);
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: 'user_id=eq.' + me }, onMemberRow);
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'agent_jobs', filter: 'group_id=gt.0' }, onAgentJob);
  ['requester_id', 'addressee_id'].forEach(function (col) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: col + '=eq.' + me }, onFriendship);
  });
  // 斗地主（群聊里）：Realtime 对每个订阅者各自套 RLS，ddz_games 只会收到我所在群的桌子；ddz_hands 只有我自己的手牌
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'ddz_games', filter: 'group_id=gt.0' }, onDdzGame);
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'ddz_hands', filter: 'user_id=eq.' + me }, onDdzHand);
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'ddz_scores', filter: 'group_id=gt.0' }, onDdzScore);
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
  if (S.chat) {
    await fetchLatest(false); markReadIfNeeded(); agentResync();
    if (S.chat && S.chat.gid == null) { tttResync(); slResync(); poolResync(); } // 双人小游戏只在私聊里
    else if (S.chat) ddzResync(); // 斗地主只在群聊里
  }
}
