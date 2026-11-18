// 标签页 / 角标 / 标题

import { renderChatHeader, renderMsgs } from '../chat/view.js';
import { refreshGroupUi } from '../groups/info.js';
import { S } from '../state.js';
import { $ } from '../utils.js';
import { incomingRequests, renderChats, totalUnread } from './chats.js';
import { renderFriends, renderSearchResult } from './friends.js';
import { renderMe } from './me.js';

// ===== 标签页 / 角标 / 标题 =====
export function showTab(name) {
  S.tab = name;
  ['chats', 'friends', 'me'].forEach(function (t) { $('view-' + t).hidden = t !== name; });
  document.querySelectorAll('#tabbar button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); });
  if (name === 'me') renderMe();
}
function setBadge(el, n) {
  el.hidden = !(n > 0);
  el.textContent = n > 99 ? '99+' : String(n);
}
export function updateBadges() {
  var n = totalUnread();
  setBadge($('badgeChats'), n);
  setBadge($('badgeFriends'), incomingRequests().length);
  document.title = (n > 0 ? '(' + (n > 99 ? '99+' : n) + ') ' : '') + '藏咩空间';
  try {
    if (navigator.setAppBadge) { if (n > 0) navigator.setAppBadge(n); else navigator.clearAppBadge(); }
  } catch (e) { /* 不支持就算了 */ }
}
export function renderAll() {
  renderChats();
  renderFriends();
  renderSearchResult();
  if (S.tab === 'me') renderMe();
  updateBadges();
  if (S.chat) {
    renderChatHeader();
    if (S.chat.gid != null) { if (S.chat.loaded) renderMsgs({ stick: false, quiet: true }); refreshGroupUi(); } // 成员资料更新后，名字和头像跟着变
  }
}
