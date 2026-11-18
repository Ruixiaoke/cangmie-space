// 聊天页：单条消息行的装饰与更新（花环、爱心等气泡状态装饰）

import { refreshCls } from './view.js';
import { agentName, isAgentMsg, makeAgentAvatar, renderRich } from '../agent/info.js';
import { fxParse } from '../fx/table.js';
import { jumpTo, targetQuoteText } from '../menu.js';
import { poolFillCard } from '../miniapps/pool.js';
import { gameKind, slFillCard } from '../miniapps/sling.js';
import { tttFillCard } from '../miniapps/ttt.js';
import { updateQuote } from '../quote.js';
import { dropFailed, retrySend } from '../send.js';
import { S, makeAvatar, profileOf } from '../state.js';
import { clear, fmtStamp, h } from '../utils.js';
import { convOf, peerFromConv } from '../views/chats.js';

var HEART_POS = ['left:-7px;top:-9px', 'right:-7px;bottom:-9px', 'right:-5px;top:-9px', 'left:-5px;bottom:-9px', 'left:46%;top:-10px', 'left:40%;bottom:-10px'];
// 花：沿着气泡边框摆一圈（left / top）
var FLW_POS = [['10%', '0'], ['32%', '0'], ['55%', '0'], ['78%', '0'], ['100%', '0'], ['0', '0'], ['0', '50%'], ['100%', '50%'], ['0', '100%'], ['22%', '100%'], ['45%', '100%'], ['68%', '100%'], ['100%', '100%'], ['90%', '0'], ['88%', '100%'], ['0', '25%'], ['100%', '75%']];
var FLW_RING = [1, 3, 5, 6, 7, 9, 11, 12];
var ICL = [['10%', 9], ['26%', 14], ['44%', 8], ['60%', 12], ['76%', 16], ['90%', 10]];
function addFlowers(box, idxs) {
  idxs.forEach(function (n, i) {
    var f = h('span', { class: 'flw' + (i % 3 === 1 ? ' w' : ''), 'aria-hidden': 'true' });
    f.style.left = FLW_POS[n][0]; f.style.top = FLW_POS[n][1]; f.style.transform = 'rotate(' + ((n * 47) % 70 - 35) + 'deg)';
    box.appendChild(f);
  });
}
export function buildDeco(box, st, on) {
  clear(box);
  if (!on) return;
  var i, k = st.k;
  if (k === 'wet') {
    var xs = ['16%', '48%', '80%'];
    for (i = 0; i < 3; i++) box.appendChild(h('span', { class: 'drp', style: 'left:' + xs[i] + ';animation-delay:' + (i * 0.65) + 's', 'aria-hidden': 'true' }));
  } else if (k === 'love') {
    for (i = 0; i < st.lv * 2 && i < HEART_POS.length; i++) {
      box.appendChild(h('span', { class: 'hrt', style: HEART_POS[i] + ';animation-delay:' + (i * 0.25) + 's', text: '♥', 'aria-hidden': 'true' }));
    }
  } else if (k === 'passion') {
    var all = []; for (i = 0; i < FLW_POS.length; i++) all.push(i);
    addFlowers(box, all);
    for (i = 0; i < 3; i++) box.appendChild(h('span', { class: 'hrt', style: HEART_POS[i * 2] + ';animation-delay:' + (i * 0.25) + 's', text: '♥', 'aria-hidden': 'true' }));
  } else if (k === 'bloom') {
    addFlowers(box, FLW_RING);
  } else if (k === 'frozen') {
    ICL.forEach(function (n) { var ic = h('span', { class: 'icl', 'aria-hidden': 'true' }); ic.style.left = n[0]; ic.style.height = n[1] + 'px'; box.appendChild(ic); });
  } else if (k === 'hot') {
    var wx = ['20%', '50%', '78%'];
    for (i = 0; i < 3; i++) box.appendChild(h('span', { class: 'wsp', style: 'left:' + wx[i] + ';animation-delay:' + (i * 0.8) + 's', 'aria-hidden': 'true' }));
  } else if (k === 'plump') {
    box.appendChild(h('span', { class: 'chk', style: 'left:3px', 'aria-hidden': 'true' }));
    box.appendChild(h('span', { class: 'chk', style: 'right:3px', 'aria-hidden': 'true' }));
  }
  if (st.as) {
    box.appendChild(h('span', { class: 'moon', 'aria-hidden': 'true' }));
    box.appendChild(h('span', { class: 'zz', text: 'z', 'aria-hidden': 'true' }));
    box.appendChild(h('span', { class: 'zz', style: 'animation-delay:1.5s;right:-2px', text: 'z', 'aria-hidden': 'true' }));
  }
}
export function updateRow(el, m, prev) {
  var agent = isAgentMsg(m);
  var own = m.sender_id === S.me.id && !agent;
  var gap = !prev || (new Date(m.created_at) - new Date(prev.created_at) > 5 * 60000);
  el._stamp.hidden = !gap;
  if (gap) el._stamp.textContent = fmtStamp(m.created_at);
  // 头像：资料重新加载后头像路径变了就重建
  var ap = agent ? null : own ? S.me : (profileOf(m.sender_id) || (convOf(m.sender_id) ? peerFromConv(convOf(m.sender_id)) : null));
  var akey = agent ? 'a|' + m.author : (own ? 'o|' : 'p|') + (ap && ap.avatar_path || '');
  if (el._akey !== akey) { el._akey = akey; clear(el._av).appendChild(agent ? makeAgentAvatar(40, m.author) : makeAvatar(ap, 40)); }
  // 榴莲：头像右边、气泡上面的名字（两边的人看到的都一样）
  el._name.hidden = !agent;
  if (agent && el._name.textContent !== agentName(m.author)) el._name.textContent = agentName(m.author);
  el._m = m;
  var pf = agent ? null : fxParse(m.body); // 榴莲的回复永远是普通文字：不当特效 / 小游戏解析
  var q = pf && pf.tid != null ? targetQuoteText(pf.tid) : '';
  var bsig = (agent ? 'A|' : '') + m.body + '|' + q;
  if (el._body !== bsig) {
    el._body = bsig;
    var fx = pf && pf.fx;
    var gk = agent ? null : gameKind(m.body), gid = gk ? gk.id : null;
    el._gcid = gid; el._gkind = gk ? gk.k : null; el._gsig = null; // 井字棋卡片：不是文字气泡，不套状态装饰
    el._fxb = !!fx || gid != null;
    el._bubble.classList.toggle('fx', !!fx);
    el._bubble.classList.toggle('gcard', gid != null);
    el.classList.toggle('row-game', gid != null); // 开着小程序时整行隐藏（见 #chat.app-open 规则）
    clear(el._bubble);
    if (fx) {
      el._bubble.appendChild(h('span', { class: 'fx-ico', text: fx.icon, 'aria-hidden': 'true' }));
      var tx = h('span', { class: 'fx-txt' }, h('span', { text: fx.name }));
      if (pf.tid != null) {
        var tid = pf.tid;
        tx.appendChild(h('span', { class: 'fx-q', text: fx.hit.replace('{q}', q || '…'), onclick: function (ev) { ev.stopPropagation(); jumpTo(tid); } }));
      }
      el._bubble.appendChild(tx);
      el._bubble.title = '点一下再看一次';
    } else if (gid != null) {
      el._bubble.removeAttribute('title');
    } else if (agent) {
      renderRich(el._bubble, m.body); // 文字 + 安全链接
      el._bubble.removeAttribute('title');
    } else {
      el._bubble.textContent = m.body;
      el._bubble.removeAttribute('title');
    }
  }
  if (el._gcid != null) { if (el._gkind === 'sling') slFillCard(el); else if (el._gkind === 'pool') poolFillCard(el); else tttFillCard(el); }
  updateQuote(el, m);
  refreshCls(el);
  if (!own) { el._meta.hidden = true; return; }
  el._meta.hidden = false;
  var sig = m.status + '|' + (m.read_at ? 1 : 0);
  if (el._sig === sig) return;
  el._sig = sig;
  clear(el._meta);
  el._meta.className = 'meta';
  if (m.status === 'sending') el._meta.textContent = '发送中…';
  else if (m.status === 'failed') {
    el._meta.classList.add('fail');
    el._meta.appendChild(h('span', { text: '发送失败' }));
    el._meta.appendChild(h('button', { type: 'button', text: '重试', onclick: function () { retrySend(m); } }));
    el._meta.appendChild(h('button', { type: 'button', text: '删除', onclick: function () { dropFailed(m); } }));
  } else if (m.read_at) { el._meta.classList.add('read'); el._meta.textContent = '已读'; }
  else el._meta.textContent = '未读';
}
