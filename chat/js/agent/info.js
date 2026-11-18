// 沈剑心：身份、头像、判断消息是不是它写的、把文字渲染成带安全链接的节点

import { AGENT_AVATAR_SRC } from '../config.js';
import { h } from '../utils.js';

// ===== 沈剑心 =====
// AGENTS 是列表：以后加别的 agent，只要在这里加一项（id 要和数据库里 messages.author 的取值一致）
export var AGENTS = [
  { id: 'durian', name: '沈剑心', mention: '@沈剑心', keys: ['沈剑心', 'shenjianxin', '榴莲', 'liulian', 'durian'] },
  { id: 'ye_ying', name: '叶英', mention: '@叶英', keys: ['叶英', 'yeying', '大庄主'] }
];
export function agentById(id) {
  for (var i = 0; i < AGENTS.length; i++) if (AGENTS[i].id === id) return AGENTS[i];
  return null;
}
// 消息是不是 agent 写的（author 只可能由服务器写入）
export function isAgentMsg(m) { return !!(m && m.author && agentById(m.author)); }
export function agentName(author) { var a = agentById(author); return a ? a.name : '沈剑心'; }
export function mentionedAgents(body) {
  var ids = new Set();
  for (var match of String(body || '').matchAll(/[@＠](沈剑心|榴莲|叶英)/g)) {
    ids.add(match[1] === '叶英' ? 'ye_ying' : 'durian');
  }
  return Array.from(ids, agentById);
}

// 头像：优先用 agent/ 目录里的图（部署时带内容哈希，换图后自动刷新）；加载失败就换成画出来的备用头像
var AVATAR_FALLBACKS = ['../agent/avatar.png', '../agent/avatar.jpg', '../agent/avatar.webp'];
export function makeAgentAvatar(size, author) {
  var box = h('div', { class: 'avatar agent-av', style: size ? 'width:' + size + 'px;height:' + size + 'px' : null });
  var cands = author === 'ye_ying' ? ['../agent/ye-ying-avatar.png']
    : AGENT_AVATAR_SRC.indexOf('?v=') > 0 ? [AGENT_AVATAR_SRC] : AVATAR_FALLBACKS.slice();
  var i = 0;
  function useDrawn() {
    box.classList.add('drawn');
    box.textContent = agentName(author).charAt(0);
    box.setAttribute('aria-hidden', 'true');
  }
  var img = h('img', { alt: '', draggable: 'false' });
  img.addEventListener('error', function () {
    i++;
    if (i < cands.length) img.src = cands[i]; else { if (img.parentNode) img.parentNode.removeChild(img); useDrawn(); }
  });
  img.src = cands[0];
  box.appendChild(img);
  return box;
}

// 文字里的 http(s) 链接变成可点的 <a>：只用 textContent 和代码创建的节点，不经过 innerHTML
var URL_RE = /https?:\/\/[^\s<>"'`「」『』（）]+/g;
var TRAIL_RE = /[.,;:!?)\]}、，。；：！？）】》”’]+$/;
export function renderRich(el, text) {
  while (el.firstChild) el.removeChild(el.firstChild);
  var s = String(text || ''), last = 0, m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(s))) {
    var raw = m[0], tail = TRAIL_RE.exec(raw), url = tail ? raw.slice(0, raw.length - tail[0].length) : raw;
    var ok = false;
    try { var u = new URL(url); ok = (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname; } catch (e) { ok = false; }
    if (!ok) continue;
    if (m.index > last) el.appendChild(document.createTextNode(s.slice(last, m.index)));
    el.appendChild(h('a', { class: 'agent-link', href: url, target: '_blank', rel: 'noopener noreferrer', text: url }));
    last = m.index + url.length;
    URL_RE.lastIndex = last;
  }
  if (last < s.length) el.appendChild(document.createTextNode(s.slice(last)));
}
