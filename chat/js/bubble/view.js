// 气泡状态的显示、衰减计时与释放

import { bubbleEv } from './bev.js';
import { NORMAL, bubbleFold, sameSt } from './state.js';
import { refreshCls } from '../chat/view.js';
import { fxCurKey, fxQueue } from '../fx/engine.js';
import { RC_IDX, unlockRecipe } from '../recipes.js';
import { S } from '../state.js';
import { isVisible } from '../utils.js';

export function reduced() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
// 一条气泡实际显示的状态：被单独打过的用自己的，否则跟着这个人走
export function rowState(c, m) {
  var t = m.id != null && c.btshow[m.id];
  return t ? t.st : (c.bshow[m.sender_id] || NORMAL);
}
// 有排队中的变化动画：那个人（或那条气泡）先不动，等动画放到那一步
function bevPending(c, uid) {
  for (var i = 0; i < c.bev.length; i++) if (c.bev[i].uid === uid && c.bev[i].tid == null) return true;
  return false;
}
function bevPendingT(c, uid, tid) {
  for (var i = 0; i < c.bev.length; i++) if (c.bev[i].uid === uid && (c.bev[i].tid == null || String(c.bev[i].tid) === String(tid))) return true;
  return false;
}
// 屏幕上显示的状态 bshow / btshow 跟着推出来的状态 bstate / btstate 走；返回有没有变化
export function syncShow(c) {
  var uids = {}, k, changed = false;
  for (k in c.bstate) uids[k] = 1;
  for (k in c.bshow) uids[k] = 1;
  for (k in uids) {
    if (bevPending(c, k)) continue;
    var t = c.bstate[k] || NORMAL, o = c.bshow[k];
    if (!o || !sameSt(o, t)) { c.bshow[k] = t; changed = true; }
  }
  var ids = {};
  for (k in c.btstate) ids[k] = 1;
  for (k in c.btshow) ids[k] = 1;
  for (k in ids) {
    var nt = c.btstate[k], ot = c.btshow[k];
    if (!nt) { delete c.btshow[k]; changed = true; continue; }
    if (bevPendingT(c, nt.uid, k)) continue;
    if (!ot || !sameSt(ot.st, nt.st)) { c.btshow[k] = nt; changed = true; }
  }
  return changed;
}
function repaintRows(c) {
  c.nodes.forEach(function (el) { if (el._m) refreshCls(el); });
}
// 时间衰减：每分钟重算一次，只有显示的状态真的变了才改 class（不播动画）
var decayTimer = 0;
function tickDecay() {
  var c = S.chat; if (!c || !c.loaded) return;
  var f = bubbleFold(c.msgs.filter(function (m) { return !m.author; }), Date.now());
  c.bstate = f.states; c.btstate = f.tstates;
  if (syncShow(c)) repaintRows(c);
}
export function startDecay() { stopDecay(); decayTimer = setInterval(tickDecay, 60000); }
export function stopDecay() { if (decayTimer) { clearInterval(decayTimer); decayTimer = 0; } }
export function releaseBev(key) {
  var c = S.chat; if (!c || !c.bev.length) return;
  var keep = [], hit = [];
  c.bev.forEach(function (e) { (e.key === key ? hit : keep).push(e); });
  if (!hit.length) return;
  c.bev = keep;
  hit.forEach(function (e) {
    if (e.tid != null) c.btshow[e.tid] = { st: e.after, uid: e.uid };
    else c.bshow[e.uid] = e.after;
    syncShow(c);
    repaintRows(c);
    bubbleEv(e);
    if (isVisible()) {
      if (e.ev && RC_IDX[e.ev] != null) unlockRecipe(e.ev);
      if (e.x && RC_IDX[e.x] != null) unlockRecipe(e.x);
    }
  });
}
// 没有全屏动画可等的变化（后台、连发太多、重连补上的）直接放出来
export function settleBev() {
  var c = S.chat; if (!c || !c.bev.length) return;
  c.bev.slice().forEach(function (e) {
    if (fxCurKey === e.key) return;
    for (var i = 0; i < fxQueue.length; i++) if (fxQueue[i].key === e.key) return;
    releaseBev(e.key);
  });
}
