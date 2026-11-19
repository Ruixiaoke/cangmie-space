// 特效表情播放队列（playFx / runFx）

import { reduced, releaseBev } from '../bubble/view.js';
import { fxBattle, stageExtra, stageTag } from './battle.js';
import { COMBO } from './combos.js';
import { fxOf, fxParse } from './table.js';
import { unlockRecipe } from '../recipes.js';
import { S, makeAvatar, nameOf, profileOf } from '../state.js';
import { $, clear, h, isVisible } from '../utils.js';
import { convOf, peerFromConv } from '../views/chats.js';
import { groupOf, memberIds } from '../groups/data.js';
import { makeCrowdAvatar } from '../groups/ui.js';

export var fxQueue = [], fxBusy = false, fxToken = 0;
export var fxCurKey = null, fxCurMsg = null, fxCurReplay = false, curAbort = null;
export function playFx(m, replay) {
  var c = S.chat;
  if (!fxOf(m.body) || !c || !isVisible() || fxQueue.length >= 3) { releaseBev(m.key); return; } // 连发太多就只排三个
  var info = !replay && c.finfo && c.finfo[m.key];
  if (info && info.combo) {
    // 三连的第三下直接演大招：前面还没开演的同款先不演（状态变化照常放出来）
    var tk = fxParse(m.body).tok, keep = [];
    fxQueue.forEach(function (q) {
      var qp = fxParse(q.m.body);
      if (!q.replay && q.m.sender_id === m.sender_id && qp && qp.tok === tk) releaseBev(q.key); else keep.push(q);
    });
    fxQueue = keep;
    // 正在演的也是同一个人连发的同款：直接切到大招
    if (fxBusy && fxCurMsg && !fxCurReplay && fxCurMsg.sender_id === m.sender_id && fxParse(fxCurMsg.body).tok === tk && curAbort) curAbort();
  }
  fxQueue.push({ m: m, key: m.key, replay: !!replay });
  if (!fxBusy) nextFx();
}
export function stopFx() {
  fxToken++; fxQueue = []; fxBusy = false; fxCurKey = null; fxCurMsg = null; curAbort = null;
  var st = $('fxStage'); st.hidden = true; clear(st);
}
function nextFx() {
  var q = fxQueue.shift();
  if (!q || !S.chat) { fxBusy = false; return; }
  fxBusy = true;
  fxCurKey = q.key; fxCurMsg = q.m; fxCurReplay = q.replay;
  var token = ++fxToken;
  runFx(q.m, token, q.replay).then(function () { fxCurKey = null; releaseBev(q.key); if (token === fxToken) nextFx(); });
}
function runFx(m, token, replay) {
  return new Promise(function (done) {
    var c = S.chat, fx = fxOf(m.body), p = fxParse(m.body);
    var own = m.sender_id === S.me.id;
    var grp = m.receiver_id == null; // 群聊：目标是 @ 的那个人或被指定的那条消息的发送者；都没有就是「大家」
    var other = grp ? m.sender_id : own ? m.receiver_id : m.sender_id;
    var otherP = profileOf(other) || (convOf(other) ? peerFromConv(convOf(other)) : null);
    // 我发的：喷对方的头像；对方发的：喷我的头像
    var target = own ? otherP : S.me;
    var info = (!replay && c && c.finfo && c.finfo[m.key]) || {};
    var mode = replay ? 'plain' : (info.combo ? 'combo' : (info.counter ? 'battle' : 'plain'));
    var st = $('fxStage');
    clear(st);
    var cap = (own ? fx.own : fx.peer).replace('{n}', nameOf(other));
    var crowd = null;
    if (grp) {
      var tuid = null;
      if (p.tid != null) {
        var tm = c ? c.msgs.find(function (x) { return x.id === p.tid; }) : null;
        tuid = tm && tm.sender_id !== m.sender_id ? tm.sender_id : null;
      } else if (p.uid && p.uid !== m.sender_id) tuid = p.uid;
      var tname = tuid ? (tuid === S.me.id ? '你' : nameOf(tuid)) : '大家';
      cap = own ? fx.own.replace('{n}', tname) : fx.peer.replace('你', tname).replace('{n}', nameOf(m.sender_id));
      target = tuid ? (tuid === S.me.id ? S.me : profileOf(tuid) || { id: tuid }) : null;
      // 没有目标：舞台上不放发的人，而是把其他所有人的头像缩进一个圆里
      if (!tuid) crowd = memberIds(c && c.gid != null ? groupOf(c.gid) : null).filter(function (u) { return u !== m.sender_id; });
      // 对战只在我是其中一方时演（我和 @ 我的人互相回敬）；旁观的人看普通动画
      if (mode === 'battle') {
        if (own && tuid) other = tuid;
        else if (tuid === S.me.id) other = m.sender_id;
        else mode = 'plain';
        if (mode === 'battle') target = otherP = profileOf(other) || { id: other };
      }
      if (mode !== 'battle') otherP = target;
    }
    if (mode === 'battle') cap = '你和 ' + nameOf(other) + ' 的' + fx.name + '对战';
    var av = null;
    if (mode !== 'battle') { av = crowd ? makeCrowdAvatar(crowd, 116, 3) : makeAvatar(target, 116); st.appendChild(h('div', { class: 'fx-av' }, av)); }
    st.appendChild(h('div', { class: 'fx-cap', text: cap }));
    st.hidden = false;
    st.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
    var total = 1400;
    var cb = mode === 'combo' ? COMBO[p.tok] : null;
    if (isVisible()) { if (cb) unlockRecipe(cb.id); if (mode === 'battle') unlockRecipe('battle'); }
    if (!reduced() && st.animate) {
      try {
        if (mode === 'battle') total = fxBattle(st, fx, otherP);
        else if (cb) { total = cb.play(st, av); stageTag(st, cb.name, 300); }
        else {
          total = fx.play(st, av, info);
          if (!replay) total = Math.max(total, stageExtra(st, av, fx, info));
        }
      } catch (e) { /* 动画失败就静态展示 */ }
    }
    var ended = false;
    function end() { if (ended) return; ended = true; if (curAbort === abort) curAbort = null; done(); }
    var tm = setTimeout(function () {
      if (token !== fxToken) return end();
      var a = st.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, fill: 'forwards' });
      a.onfinish = function () { a.cancel(); if (token === fxToken) { st.hidden = true; clear(st); } end(); };
    }, total);
    function abort() { clearTimeout(tm); if (token === fxToken) { st.hidden = true; clear(st); } end(); }
    curAbort = abort;
  });
}

// 小工具：坐标、粒子、随机数
