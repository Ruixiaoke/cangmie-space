// 群聊的小界面：群头像、底部弹层、选好友、发起群聊（不用浏览器自带的对话框）

import { openGroup } from '../chat/view.js';
import { loadAll } from '../data.js';
import { errText } from '../errors.js';
import { S, makeAvatar, profileOf, sb } from '../state.js';
import { $, h, toast } from '../utils.js';
import { peerFromConv } from '../views/chats.js';
import { defaultGroupName, groupOf, memberIds } from './data.js';

// ===== 群头像：最多 4 个成员头像排成 2×2（纯 CSS 网格） =====
export function makeGroupAvatar(g, size) {
  var ids = memberIds(g).slice(0, 4);
  var box = h('div', { class: 'gav n' + Math.max(1, ids.length), style: size ? 'width:' + size + 'px;height:' + size + 'px' : null, 'aria-hidden': 'true' });
  ids.forEach(function (id) { box.appendChild(makeAvatar(profileOf(id) || { id: id }, 0)); });
  return box;
}

// ===== 底部弹层 =====
// opts：{ title, body: 元素, actions: [{ text, kind: 'primary' | 'ghost' | 'danger', onclick(btn) }], onClose }
// 返回 { el, close, setBusy }
export function openSheet(opts) {
  var wrap = h('div', { class: 'gs-wrap' });
  var actions = h('div', { class: 'gs-actions' });
  var sheet = h('div', { class: 'gs', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
    h('div', { class: 'gs-title', text: opts.title }),
    h('div', { class: 'gs-body' }, opts.body),
    actions);
  var closed = false, buttons = [];
  function close() {
    if (closed) return;
    closed = true;
    if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    document.removeEventListener('keydown', onKey);
    if (opts.onClose) opts.onClose();
  }
  function onKey(ev) { if (ev.key === 'Escape' && wrap === lastSheet()) close(); }
  function setBusy(on) { buttons.forEach(function (b) { b.disabled = !!on; }); }
  (opts.actions || []).forEach(function (a) {
    var b = h('button', { type: 'button', class: 'btn small' + (a.kind === 'primary' || !a.kind ? '' : ' ' + a.kind), text: a.text });
    b.addEventListener('click', function () { a.onclick(b, { close: close, setBusy: setBusy }); });
    buttons.push(b);
    actions.appendChild(b);
  });
  wrap.addEventListener('click', function (ev) { if (ev.target === wrap) close(); });
  wrap.appendChild(sheet);
  $('shell').appendChild(wrap);
  document.addEventListener('keydown', onKey);
  return { el: wrap, close: close, setBusy: setBusy, buttons: buttons };
}
function lastSheet() { var all = document.querySelectorAll('.gs-wrap'); return all[all.length - 1]; }

// 应用内确认：取消 / 确认
export function confirmSheet(title, text, okText, onOk, danger) {
  var sh = openSheet({
    title: title,
    body: h('p', { class: 'gs-text', text: text }),
    actions: [
      { text: '取消', kind: 'ghost', onclick: function (b, c) { c.close(); } },
      { text: okText, kind: danger ? 'danger' : 'primary', onclick: async function (b, c) { c.setBusy(true); var ok = await onOk(); c.setBusy(false); if (ok !== false) c.close(); } }
    ]
  });
  return sh;
}

// ===== 选好友 =====
// o：{ title, exclude: id 集合, withName, confirm, max, onDone(ids, name) -> 成功时返回 true }
export function pickFriends(o) {
  var friends = S.convs.map(peerFromConv).filter(function (p) { return !o.exclude || !o.exclude.has(p.id); })
    .sort(function (a, b) { return a.nickname.localeCompare(b.nickname, 'zh'); });
  var picked = [];
  var nameIn = o.withName ? h('input', { class: 'field gs-name', type: 'text', maxlength: '20', placeholder: '群名（不填就用成员昵称）', 'aria-label': '群名', autocomplete: 'off' }) : null;
  var list = h('div', { class: 'gs-list', role: 'group', 'aria-label': '选择好友' });
  var sh;
  function sync() {
    var n = picked.length;
    sh.buttons[1].textContent = n ? o.confirm + '（' + n + '）' : o.confirm;
    sh.buttons[1].disabled = n === 0;
    if (nameIn) nameIn.placeholder = n ? defaultGroupName(picked) : '群名（不填就用成员昵称）';
  }
  if (!friends.length) list.appendChild(h('p', { class: 'gs-empty', text: o.exclude && o.exclude.size ? '没有可以再拉的好友了' : '先去「好友」里加几个朋友吧' }));
  friends.forEach(function (p) {
    var cb = h('input', { type: 'checkbox', class: 'gs-cb', 'aria-label': p.nickname });
    cb.addEventListener('change', function () {
      var i = picked.indexOf(p.id);
      if (cb.checked && i < 0) {
        if (o.max && picked.length >= o.max) { cb.checked = false; toast('最多再选 ' + o.max + ' 个'); return; }
        picked.push(p.id);
      } else if (!cb.checked && i >= 0) picked.splice(i, 1);
      sync();
    });
    list.appendChild(h('label', { class: 'gs-row' }, cb, h('span', { class: 'gs-tick', 'aria-hidden': 'true' }), makeAvatar(p, 40), h('span', { class: 'gs-nick', text: p.nickname })));
  });
  var body = h('div', { class: 'gs-pick' }, nameIn, list);
  sh = openSheet({
    title: o.title,
    body: body,
    actions: [
      { text: '取消', kind: 'ghost', onclick: function (b, c) { c.close(); } },
      { text: o.confirm, kind: 'primary', onclick: async function (b, c) {
        if (!picked.length) return;
        c.setBusy(true);
        var ok = await o.onDone(picked.slice(), nameIn ? nameIn.value.replace(/^\s+|\s+$/g, '') : '');
        c.setBusy(false);
        if (ok) c.close(); else sync();
      } }
    ]
  });
  sync();
  return sh;
}

// ===== 发起群聊 =====
export function openCreateGroup() {
  pickFriends({
    title: '发起群聊', withName: true, confirm: '创建', max: 49,
    onDone: async function (ids, name) {
      var r;
      try { r = await sb.rpc('create_group', { p_name: name, p_members: ids }); } catch (e) { r = { error: e }; }
      if (r.error || !r.data) { toast(errText(r.error)); return false; }
      var gid = r.data.id;
      await loadAll();
      if (groupOf(gid)) openGroup(gid);
      return true;
    }
  });
}
