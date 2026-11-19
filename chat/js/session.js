// 进入 / 退出

import { setAuthMode, show, showAuth } from './auth.js';
import { openChat, openGroup } from './chat/view.js';
import { loadAll, loadProfile } from './data.js';
import { errText } from './errors.js';
import { closeApp } from './miniapps/host.js';
import { lbReset } from './miniapps/leaderboard.js';
import { poolReset } from './miniapps/pool.js';
import { slReset } from './miniapps/sling.js';
import { tttReset } from './miniapps/ttt.js';
import { pushSync, pushUnsubscribe } from './notify.js';
import { resetQuoteUi } from './quote.js';
import { startRealtime, stopRealtime } from './realtime.js';
import { sandDisable } from './skins/sand.js';
import { S, sb } from './state.js';
import { $, toast } from './utils.js';
import { setSearchState } from './views/friends.js';
import { showTab } from './views/tabs.js';

// ===== 进入 / 退出 =====
export async function enterApp() {
  try {
    await loadProfile();
  } catch (e) {
    if (e && e.message === 'profile_missing') toast('账号资料缺失，请退出后重新注册');
    else toast(errText(e));
    await sb.auth.signOut().catch(function () {});
    S.me = null;
    return showAuth();
  }
  show('app');
  showTab('chats');
  await loadAll();
  startRealtime();
  routeFromUrl();
  pushSync();
}
function routeFromUrl() {
  var q = new URLSearchParams(location.search);
  var peer = q.get('peer'), tab = q.get('tab'), group = q.get('group');
  if (peer || tab || group) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* 忽略 */ } }
  if (tab === 'friends' || tab === 'me' || tab === 'chats') showTab(tab);
  if (peer && /^[0-9a-f-]{36}$/i.test(peer)) openChat(peer.toLowerCase());
  else if (group && /^[0-9]{1,15}$/.test(group)) openGroup(Number(group));
}
export async function logout() {
  await pushUnsubscribe();
  stopRealtime();
  lbReset(); closeApp(); S.chat = null; sandDisable(); $('chat').hidden = true; resetQuoteUi();
  try { await sb.auth.signOut(); } catch (e) { /* 本地状态照样清掉 */ }
  resetState();
  setAuthMode('login');
  showAuth();
}
export function resetState() {
  S.me = null; S.convs = []; S.groups = []; S.friendships = []; S.profiles = new Map(); S.chat = null; setSearchState(null); resetQuoteUi(); tttReset(); slReset(); poolReset();
  document.title = '藏咩空间';
  try { if (navigator.clearAppBadge) navigator.clearAppBadge(); } catch (e) { /* 忽略 */ }
}
