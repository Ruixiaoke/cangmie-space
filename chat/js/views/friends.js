// 渲染：好友页（搜索、请求、好友）

import { openChat } from '../chat/view.js';
import { USERNAME_RE } from '../config.js';
import { loadAll } from '../data.js';
import { errText } from '../errors.js';
import { firePush } from '../notify.js';
import { S, makeAvatar, profileOf, sb } from '../state.js';
import { emptyState, popCheer } from '../mascot.js';
import { $, clear, h, toast } from '../utils.js';
import { incomingRequests, outgoingRequests, peerFromConv } from './chats.js';

// ===== 渲染：好友页 =====
var searchState = null; // {username, result|null}
export function setSearchState(v) { searchState = v; }
export function renderFriends() {
  var box = clear($('friendsBody'));
  var inc = incomingRequests(), out = outgoingRequests();

  box.appendChild(h('div', { class: 'section-title' }, '好友请求', inc.length ? h('span', { class: 'count', text: String(inc.length) }) : null));
  if (!inc.length) box.appendChild(emptyState('暂时没有新的好友请求', true));
  inc.forEach(function (f) {
    var p = profileOf(f.requester_id) || { id: f.requester_id, nickname: '新朋友', username: '' };
    box.appendChild(h('div', { class: 'card' },
      makeAvatar(p),
      h('div', { class: 'info' }, h('div', { class: 'name', text: p.nickname }), h('div', { class: 'line2', text: '@' + p.username })),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn small ghost', text: '拒绝', onclick: function (ev) { respond(f.id, false, ev.currentTarget); } }),
        h('button', { type: 'button', class: 'btn small', text: '接受', onclick: function (ev) { respond(f.id, true, ev.currentTarget); } }))));
  });

  if (out.length) {
    box.appendChild(h('div', { class: 'section-title' }, '等待对方回应'));
    out.forEach(function (f) {
      var p = profileOf(f.addressee_id) || { id: f.addressee_id, nickname: '好友', username: '' };
      box.appendChild(h('div', { class: 'card' },
        makeAvatar(p),
        h('div', { class: 'info' }, h('div', { class: 'name', text: p.nickname }), h('div', { class: 'line2', text: '@' + p.username })),
        h('span', { class: 'line2', text: '等待中…' })));
    });
  }

  box.appendChild(h('div', { class: 'section-title' }, '我的好友', S.convs.length ? h('span', { class: 'count', text: String(S.convs.length) }) : null));
  if (!S.convs.length) box.appendChild(emptyState('还没有好友，搜索对方的用户名把 Ta 请进来吧'));
  S.convs.slice().sort(function (a, b) { return a.peer_nickname.localeCompare(b.peer_nickname, 'zh'); }).forEach(function (c) {
    box.appendChild(h('button', { type: 'button', class: 'card', onclick: function () { openChat(c.peer_id); } },
      makeAvatar(peerFromConv(c)),
      h('div', { class: 'info' }, h('div', { class: 'name', text: c.peer_nickname }), h('div', { class: 'line2', text: '@' + c.peer_username })),
      h('span', { class: 'line2', text: '发消息 ›' })));
  });
}

export function renderSearchResult() {
  var box = clear($('searchResult'));
  if (!searchState) return;
  var r = searchState.result;
  if (!r) {
    box.appendChild(emptyState('没有找到 @' + searchState.username + '，再确认一下用户名吧'));
    return;
  }
  var p = { id: r.user_id, username: r.username, nickname: r.nickname, avatar_path: r.avatar_path };
  var action;
  if (r.relation === 'none') action = h('button', { type: 'button', class: 'btn small', text: '加好友', onclick: function (ev) { addFriend(r.username, ev.currentTarget); } });
  else if (r.relation === 'friend') action = h('button', { type: 'button', class: 'btn small ghost', text: '发消息', onclick: function () { openChat(r.user_id); } });
  else if (r.relation === 'outgoing') action = h('span', { class: 'line2', text: '已发送请求' });
  else if (r.relation === 'incoming') action = h('span', { class: 'line2', text: 'Ta 已请求你，见下方' });
  else action = h('span', { class: 'line2', text: '这是你自己' });
  box.appendChild(h('div', { class: 'card' },
    makeAvatar(p),
    h('div', { class: 'info' }, h('div', { class: 'name', text: r.nickname }), h('div', { class: 'line2', text: '@' + r.username })),
    action));
}

export async function doSearch(ev) {
  ev.preventDefault();
  var u = $('searchInput').value.trim().toLowerCase().replace(/^@/, '');
  if (!u) return;
  var btn = $('searchBtn');
  btn.disabled = true;
  try {
    if (!USERNAME_RE.test(u)) { searchState = { username: u, result: null }; return renderSearchResult(); }
    var r = await sb.rpc('find_user', { p_username: u });
    if (r.error) return toast(errText(r.error));
    searchState = { username: u, result: (r.data && r.data[0]) || null };
    renderSearchResult();
  } finally { btn.disabled = false; }
}
async function addFriend(username, btn) {
  btn.disabled = true;
  var r = await sb.rpc('send_friend_request', { p_username: username });
  if (r.error) { btn.disabled = false; toast(errText(r.error)); if (r.error.message === 'already_friends') await refreshSearch(username); return; }
  toast(r.data === 'accepted' ? '你们已经是好友了' : '好友请求已发送，等 Ta 通过吧');
  if (r.data === 'accepted') popCheer('好耶！');
  await loadAll();
  // 对方先请求过我时直接通过：这一行里我是被请求方，对方收到"已通过"
  var fid = friendshipIdWith(username);
  if (fid) firePush(r.data === 'accepted' ? 'friend_accepted' : 'friend_request', fid);
  await refreshSearch(username);
}
function friendshipIdWith(username) {
  var me = S.me && S.me.id, found = null;
  S.friendships.forEach(function (f) {
    var p = S.profiles.get(f.requester_id === me ? f.addressee_id : f.requester_id);
    if (p && p.username === username) found = f.id;
  });
  return found;
}
async function refreshSearch(username) {
  var r = await sb.rpc('find_user', { p_username: username });
  if (!r.error && searchState && searchState.username === username) {
    searchState.result = (r.data && r.data[0]) || null;
    renderSearchResult();
  }
}
async function respond(id, accept, btn) {
  btn.disabled = true;
  var r = await sb.rpc('respond_friend_request', { p_id: id, p_accept: accept });
  if (r.error) { btn.disabled = false; toast(errText(r.error)); await loadAll(); return; }
  if (accept) { toast('已添加为好友'); popCheer('好耶！'); firePush('friend_accepted', id); }
  await loadAll();
  if (searchState && searchState.result) refreshSearch(searchState.username);
}
