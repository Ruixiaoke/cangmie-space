// 已读

import { closeNotifications } from './notify.js';
import { S, sb } from './state.js';
import { isVisible } from './utils.js';
import { convOf, renderChats } from './views/chats.js';
import { updateBadges } from './views/tabs.js';

// ===== 已读 =====
var marking = false, markAgain = false;
// 打开的会话里是否有对方发来、还没标已读的消息
function hasUnreadInChat(c) {
  return c.msgs.some(function (m) { return m.sender_id === c.peer && !m.read_at; });
}
export async function markReadIfNeeded() {
  var c = S.chat;
  if (!c || !isVisible()) return;
  // 正在请求：记一笔，等本次结束后再标一次，不丢
  if (marking) { markAgain = true; return; }
  var conv = convOf(c.peer);
  // 以打开会话里的消息为准，再并上会话的未读数
  if (!hasUnreadInChat(c) && !(conv && Number(conv.unread_count) > 0)) return;
  marking = true; markAgain = false;
  var sent = c.msgs.filter(function (m) { return m.sender_id === c.peer && !m.read_at; }); // 本次请求覆盖的消息
  var ok = false;
  try {
    var r = await sb.rpc('mark_read', { p_peer: c.peer });
    if (!r.error) {
      ok = true;
      var cv = convOf(c.peer);
      if (cv) cv.unread_count = 0;
      // 本地先标上已读，避免重复触发
      var now = new Date().toISOString();
      sent.forEach(function (m) { if (!m.read_at) m.read_at = now; });
      updateBadges(); renderChats(); closeNotifications('msg-' + c.peer);
    }
  } finally { marking = false; }
  // 标记期间又来了新消息的话再标一次（请求失败时不重试，避免死循环）
  if (ok && markAgain) { markAgain = false; markReadIfNeeded(); }
}
