// 共享状态：sb / cfg / S，以及按 id 取头像、资料的小函数。跨模块要重新赋值的变量只能通过这里的 setter

import { mascot } from './mascot.js';
import { clear, h } from './utils.js';

// ===== 状态 =====
export var sb = null, cfg = null;
// ES 模块的导入是只读的：别的模块要改 sb / cfg 只能调这两个 setter（导入方读到的永远是最新值）
export function setSb(v) { sb = v; }
export function setCfg(v) { cfg = v; }
export var S = {
  me: null,
  profiles: new Map(),     // id -> {id, username, nickname, avatar_path}
  convs: [],               // list_conversations() 的结果（每个好友一行）
  groups: [],              // list_groups() 的结果（每个群一行）
  friendships: [],         // 我的所有 friendships 行
  tab: 'chats',
  chat: null,              // 当前打开的会话：私聊 { peer, gid: null }，群聊 { peer: null, gid }
  channel: null,
  hadSubscribed: false,
  tempSeq: 0
};

// 当前打开的是群聊吗
export function isGroupChat(c) { return !!c && c.gid != null; }
// 会话的稳定键（私聊 p<对方 id>，群聊 g<群 id>）：异步回来之后核对「还是不是刚才那个会话」
export function convKey(c) { return c ? (c.gid != null ? 'g' + c.gid : 'p' + c.peer) : null; }
// 一条消息行（数据库行或本地乐观消息）属于这个打开的会话吗
export function rowInChat(c, row) {
  if (!c || !row) return false;
  if (c.gid != null) return row.group_id === c.gid;
  return row.group_id == null && (row.sender_id === c.peer || row.receiver_id === c.peer);
}
export function avatarUrl(path) {
  if (!path) return null;
  try { return sb.storage.from('avatars').getPublicUrl(path).data.publicUrl; } catch (e) { return null; }
}
export function profileOf(id) {
  return S.profiles.get(id) || null;
}
export function nameOf(id) {
  var p = profileOf(id);
  return p ? p.nickname : '好友';
}
// 头像：有自定义头像就用，没有（或加载失败）就用藏剑或纯阳（按用户 id 固定一个）
export function makeAvatar(p, size) {
  var box = h('div', { class: 'avatar', style: size ? 'width:' + size + 'px;height:' + size + 'px' : null });
  var custom = p && avatarUrl(p.avatar_path);
  function useDefault() {
    box.classList.add('default');
    clear(box).appendChild(mascot('normal', '', p && p.id));
  }
  if (custom) {
    var img = h('img', { src: custom, alt: '', draggable: 'false' });
    img.addEventListener('error', useDefault);
    box.appendChild(img);
  } else {
    useDefault();
  }
  return box;
}
