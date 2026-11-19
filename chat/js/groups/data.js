// 群聊数据：查找、预览、成员变化、被移出

import { AGENTS, agentName } from '../agent/info.js';
import { closeChat } from '../chat/view.js';
import { fxParse } from '../fx/table.js';
import { ddzOf } from '../miniapps/ddz-token.js';
import { mjOf } from '../miniapps/mahjong-token.js';
import { fxqOf } from '../miniapps/fxq-token.js';
import { S, nameOf, profileOf } from '../state.js';
import { cut, toast } from '../utils.js';
import { renderChats } from '../views/chats.js';
import { updateBadges } from '../views/tabs.js';
import { closeGroupInfo } from './info.js';

// ===== 群聊数据 =====
export function groupOf(gid) {
  for (var i = 0; i < S.groups.length; i++) if (S.groups[i].id === gid) return S.groups[i];
  return null;
}
export function isOwner(g) { return !!(g && S.me && g.owner_id === S.me.id); }
export function memberIds(g) { return (g && g.member_ids) || []; }
// 这个群里打开着的助手（按 AGENTS 的顺序）
export function enabledAgents(g) {
  var on = (g && g.agents) || [];
  return AGENTS.filter(function (a) { return on.indexOf(a.id) >= 0; });
}
// 群聊里特效表情只显示它的名字，斗地主、麻将、飞行棋卡片显示游戏名，其余小游戏邀请当普通文字
function bodyPreview(body) { if (ddzOf(body) != null) return '斗地主'; if (mjOf(body) != null) return '麻将'; if (fxqOf(body) != null) return '飞行棋'; var p = fxParse(body); return p ? p.tok : String(body || '').replace(/\s+/g, ' '); }
// 消息列表里群的预览：「昵称：内容」；助手的回复带助手名；系统提示原样
export function groupPreview(g) {
  if (g.last_id == null) return '';
  if (g.last_author === 'system') return String(g.last_body).replace(/\s+/g, ' ');
  if (g.last_author) return agentName(g.last_author) + '：' + String(g.last_body).replace(/\s+/g, ' ');
  var mine = S.me && g.last_sender_id === S.me.id;
  return (mine ? '你' : nameOf(g.last_sender_id)) + '：' + bodyPreview(g.last_body);
}
// 通知 / 提示里用的一句话
export function groupLine(row) {
  if (row.author === 'system') return String(row.body);
  var who = row.author ? agentName(row.author) : nameOf(row.sender_id);
  return who + '：' + (row.author ? cut(String(row.body).replace(/\s+/g, ' '), 40) : bodyPreview(row.body));
}
export function memberProfile(id) { return profileOf(id); }
export function defaultGroupName(ids) {
  var names = ids.map(function (id) { return nameOf(id); }).slice(0, 3);
  return names.join('、').slice(0, 20);
}
// 把一个群的最新一条消息合并进列表里的那一行；返回这条是不是更新的
export function applyGroupLast(g, row) {
  if (g.last_id != null && Number(g.last_id) >= row.id) return false;
  g.last_id = row.id; g.last_body = row.body; g.last_sender_id = row.sender_id; g.last_author = row.author || null; g.last_at = row.created_at;
  return true;
}
// 不再是这个群的成员（被移出、退群、群没了）：从列表里拿掉；正开着就关掉
export function dropGroup(gid, quiet) {
  var had = !!groupOf(gid);
  S.groups = S.groups.filter(function (g) { return g.id !== gid; });
  if (S.chat && S.chat.gid === gid) {
    if (!quiet) toast('你已经不在这个群里了');
    closeGroupInfo();
    closeChat();
  }
  renderChats(); updateBadges();
  return had;
}
