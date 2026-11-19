// 输入框里打 @ 弹出的小列表：选一个 agent（或群里的一个人），插入 "@榴莲 "

import { autosize } from '../composer.js';
import { enabledAgents, groupOf, memberIds } from '../groups/data.js';
import { S, makeAvatar, profileOf } from '../state.js';
import { $, clear, h } from '../utils.js';
import { AGENTS, makeAgentAvatar } from './info.js';

// ===== @ 选择器 =====
// 光标前面是 "@xxx" 时，按 xxx 过滤 AGENTS；没有匹配或已经打全了就收起
// 中文里 @ 常常紧跟在汉字后面（"你好@"），中文输入法还会打出全角 "＠"，两种都要认；
// 只有紧跟在英文字母 / 数字 / 点 / 下划线后面时不弹（像邮箱 a@b.com）
var TOKEN_RE = /(^|[^A-Za-z0-9_.])[@＠]([^\s@＠]{0,10})$/;
var st = { open: false, list: [], idx: 0, start: 0 };

// 群聊里列出这个群已经打开的助手，再列群里的其他人（@ 了人再点特效表情，就只打那个人）
function available() {
  var c = S.chat;
  if (!c || c.gid == null) return AGENTS;
  var g = groupOf(c.gid);
  return enabledAgents(g).concat(memberIds(g).filter(function (u) { return !S.me || u !== S.me.id; }).map(function (u) {
    var p = profileOf(u);
    if (!p || !p.nickname) return null;
    return { id: 'u-' + u, uid: u, name: p.nickname, mention: '@' + p.nickname, keys: [p.nickname, p.username || ''] };
  }).filter(Boolean));
}
function matches(q) {
  var l = q.toLowerCase();
  return available().filter(function (a) {
    if (l === '') return true;
    return a.keys.some(function (k) { return k.toLowerCase().indexOf(l) === 0; }) && q !== a.name;
  });
}
function tokenAt(input) {
  var caret = input.selectionStart == null ? input.value.length : input.selectionStart;
  var before = input.value.slice(0, caret);
  var m = TOKEN_RE.exec(before);
  return m ? { q: m[2], start: caret - m[2].length - 1, caret: caret } : null;
}
export function closeAtPicker() {
  if (!st.open) return;
  st.open = false;
  var pop = $('atPop');
  pop.hidden = true; clear(pop);
  $('input').removeAttribute('aria-activedescendant');
  $('input').setAttribute('aria-expanded', 'false');
}
function paint() {
  var pop = clear($('atPop'));
  st.list.forEach(function (a, i) {
    var b = h('button', { type: 'button', role: 'option', id: 'atOpt-' + a.id, class: i === st.idx ? 'on' : null, 'aria-selected': i === st.idx ? 'true' : 'false' },
      a.uid ? makeAvatar(profileOf(a.uid), 32) : makeAgentAvatar(32, a.id), h('span', { class: 'at-name', text: a.name }));
    b.addEventListener('pointerdown', function (ev) { ev.preventDefault(); }); // 不抢输入框焦点
    b.addEventListener('click', function () { pick(a); });
    pop.appendChild(b);
  });
  $('input').setAttribute('aria-activedescendant', 'atOpt-' + st.list[st.idx].id);
}
function pick(a) {
  var input = $('input'), t = tokenAt(input);
  if (!t) return closeAtPicker();
  var ins = a.mention + ' ';
  var tail = input.value.slice(t.caret);
  if (input.value.length - (t.caret - t.start) + ins.length > 2000) return closeAtPicker();
  input.value = input.value.slice(0, t.start) + ins + tail;
  input.selectionStart = input.selectionEnd = t.start + ins.length;
  closeAtPicker();
  autosize();
  input.focus();
}
export function refreshAtPicker() {
  var input = $('input'), t = tokenAt(input);
  var list = t ? matches(t.q) : [];
  if (!list.length) return closeAtPicker();
  var keep = st.open && st.list[st.idx] ? st.list[st.idx].id : null;
  st.list = list; st.start = t.start;
  st.idx = Math.max(0, list.findIndex(function (a) { return a.id === keep; }));
  st.open = true;
  $('atPop').hidden = false;
  input.setAttribute('aria-expanded', 'true');
  paint();
}
export function bindAtPicker() {
  var input = $('input');
  input.setAttribute('aria-controls', 'atPop');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');
  // 输入法组字中也刷新：iOS 中文键盘打 @ 时 input 事件常带 isComposing，只看光标前的文字，不会打断组字
  input.addEventListener('input', refreshAtPicker);
  input.addEventListener('compositionend', refreshAtPicker);
  input.addEventListener('click', refreshAtPicker);
  input.addEventListener('blur', function () { setTimeout(closeAtPicker, 120); });
  // 捕获阶段：列表开着时，方向键 / 回车 / Esc 归列表，不要触发发送
  input.addEventListener('keydown', function (ev) {
    if (!st.open || ev.isComposing || ev.keyCode === 229) return;
    var k = ev.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      ev.preventDefault();
      st.idx = (st.idx + (k === 'ArrowDown' ? 1 : st.list.length - 1)) % st.list.length;
      paint();
    } else if (k === 'Enter' || k === 'Tab') {
      ev.preventDefault(); ev.stopImmediatePropagation();
      pick(st.list[st.idx]);
    } else if (k === 'Escape') {
      ev.preventDefault(); ev.stopImmediatePropagation();
      closeAtPicker();
    }
  }, true);
  input.addEventListener('keyup', function (ev) { if (ev.key !== 'Enter' && ev.key !== 'Escape' && ev.key !== 'Tab' && ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') refreshAtPicker(); });
}
