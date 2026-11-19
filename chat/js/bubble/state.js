// 气泡状态：由聊天记录推出（纯函数，不碰 DOM）

import { fxParse } from '../fx/table.js';

// ===== 气泡状态：特效表情会改变“被打中的人”的所有气泡（或者定向攻击时只改一条） =====
// 状态完全由聊天记录推出（不用改数据库）：按顺序走一遍消息，每条特效消息改变对方的状态
// @reducer-begin
// 状态：{ k 主状态, lv 等级, as 睡着, t 主状态计时起点, ta 睡着起点 }（毫秒时间戳，全部来自消息的 created_at，所以两边看到的一样）
var HR = 3600000;
var DECAY = { wet: 12 * HR, frozen: HR, hot: 6 * HR, love: 24 * HR, passion: 24 * HR, plump: 6 * HR, bloom: 48 * HR, asleep: 12 * HR };
var COMBO_MS = 8000, COUNTER_MS = 10000;
function mkSt(k, lv, as, t, ta) { return { k: k, lv: lv, as: !!as, t: t, ta: ta }; }
export var NORMAL = mkSt('normal', 0, false, 0, 0);
// 时间衰减：只看时间，不产生动画。冰冻 1 小时后变湿，湿的 12 小时计时从那一刻开始
function decayState(st, now) {
  var k = st.k, lv = st.lv, t = st.t, as = st.as, n = 0;
  while (n++ < 80 && k !== 'normal') {
    var d = now - t;
    if (k === 'wet' && d >= DECAY.wet) { k = 'normal'; lv = 0; }
    else if (k === 'frozen' && d >= DECAY.frozen) { k = 'wet'; lv = 0; t += DECAY.frozen; }
    else if (k === 'hot' && d >= DECAY.hot) { k = 'normal'; lv = 0; }
    else if (k === 'bloom' && d >= DECAY.bloom) { k = 'normal'; lv = 0; }
    else if (k === 'love' && d >= DECAY.love) { lv--; t += DECAY.love; if (lv <= 0) { k = 'normal'; lv = 0; } }
    else if (k === 'passion' && d >= DECAY.passion) { k = 'love'; lv = 3; t += DECAY.passion; }
    else if (k === 'plump' && d >= DECAY.plump) { lv--; t += DECAY.plump; if (lv <= 0) { k = 'normal'; lv = 0; } }
    else break;
  }
  if (as && now - st.ta >= DECAY.asleep) as = false;
  return mkSt(k, lv, as, t, st.ta);
}
export function sameSt(a, b) { return a.k === b.k && a.lv === b.lv && !!a.as === !!b.as; }
// 纯函数：sticker 是 "[水枪]" 这样的 token，空（null）表示这个人自己发了普通消息
// 返回新状态 + ev（气泡变化动画）+ x（额外动作：wake 醒来 / gentle 轻拍睡着的人）+ before（衰减后的旧状态）
function bubbleStep(st0, sticker, meta) {
  var hasTs = !!(meta && meta.ts != null), ts = hasTs ? meta.ts : 0;
  var st = hasTs ? decayState(st0, ts) : st0;
  var k = st.k, lv = st.lv, as = st.as, ta = st.ta, t = st.t, x = null;
  function r(k2, l2, ev, fresh) {
    var chg = k2 !== k || (k2 !== 'normal' && l2 !== lv);
    var o = mkSt(k2, k2 === 'normal' ? 0 : l2, as, (chg || fresh) ? ts : t, ta);
    o.ev = ev; o.x = x; o.before = st;
    return o;
  }
  function up() { return Math.min(3, lv + 1); }
  if (!sticker) { if (as) { as = false; x = 'wake'; } return r(k, lv, null, false); }
  switch (sticker) {
    case '[水枪]':
      if (as) { as = false; x = 'wake'; }
      if (k === 'passion') return r('passion', 0, 'evap', false);
      if (k === 'frozen') return r('frozen', 0, 'moreice', true);
      if (k === 'hot') return r('normal', 0, 'steambath', false);
      if (k === 'bloom') return r('wet', 0, 'soaked', false);
      return r('wet', 0, 'wet', true);
    case '[敲头]':
      if (k === 'love') return r('normal', 0, 'unlove', false);
      if (k === 'passion') return r('love', 3, 'knockflowers', false);
      if (k === 'frozen') return r('normal', 0, 'shatter', false);
      if (k === 'plump') return lv > 1 ? r('plump', lv - 1, 'carrot', false) : r('normal', 0, 'carrot', false);
      return r(k, lv, 'bonk', false);
    case '[飞吻]':
      if (k === 'passion') return r('passion', 0, 'heartburst', false);
      if (k === 'frozen') return r('wet', 0, 'meltwarm', false);
      if (k === 'love') return r('love', up(), 'lovemore', true);
      return r('love', 1, 'love', false);
    case '[拍拍]':
      if (as) x = 'gentle';
      if (k === 'wet') return r('normal', 0, 'dry', false);
      if (k === 'love') return r('love', up(), 'lovemore', true);
      if (k === 'plump') return r('normal', 0, 'burp', false);
      if (k === 'frozen') return r('frozen', 0, 'shiver', false);
      return r(k, lv, 'bounce', false);
    case '[雪球]':
      if (k === 'hot') return r('normal', 0, 'hiss', false);
      if (k === 'passion') return r('love', 3, 'cooldown', false);
      if (k === 'wet') return r('frozen', 0, 'freezewet', false);
      if (k === 'frozen') return r('frozen', 0, 'freeze', true);
      return r('frozen', 0, 'freeze', false);
    case '[辣椒]':
      if (k === 'frozen') return r('wet', 0, 'melt', false);
      if (k === 'wet') return r('normal', 0, 'steam', false);
      if (k === 'love') return r('love', up(), 'spicylove', true);
      if (k === 'passion') return r('passion', 0, 'spicy', false);
      if (k === 'hot') return r('hot', 0, 'bigflame', true);
      if (k === 'bloom') return r('hot', 0, 'wilt', false);
      return r('hot', 0, 'heat', false);
    case '[吹风]':
      if (k === 'wet') return r('normal', 0, 'blowdry', false);
      if (k === 'frozen') return r('wet', 0, 'thaw', false);
      if (k === 'bloom') return r('normal', 0, 'petalsaway', false);
      if (k === 'love' || k === 'passion') return r(k, lv, 'nodisperse', false);
      if (k === 'hot') return r('hot', 0, 'flare', false);
      return r(k, lv, 'wobble', false);
    case '[投喂]':
      if (k === 'plump') return r('plump', up(), 'feedmore', true);
      return r('plump', 1, 'feed', false);
    case '[晚安]':
      as = true; ta = ts;
      return r(k, lv, 'sleep', false);
    case '[送花]':
      if (k === 'love') return lv < 3 ? r('love', lv + 1, 'petalburst', false) : r('passion', 0, 'passion', false);
      if (k === 'bloom') return r('bloom', 0, 'morebloom', true);
      if (k === 'passion') return r('passion', 0, 'petalburst', false);
      if (k === 'frozen') return r('frozen', 0, 'frostflower', false);
      if (k === 'hot') return r('hot', 0, 'flowerwilt', false);
      return r('bloom', 0, 'bloom', false);
  }
  return r(k, lv, null, false);
}
function keepSt(o) { return mkSt(o.k, o.lv, o.as, o.t, o.ta); }
function tsOf(m) { var v = Date.parse(m.created_at); return isNaN(v) ? 0 : v; }
// 走一遍消息，推出：每个人的状态 states、定向攻击只影响某条气泡的状态 tstates（按消息 id）、变化事件 evs、
// 以及每条特效消息的附加信息 info（combo 三连、counter 对战）。now：最后一步按这个时间衰减
// members：群成员 id（群聊才传）。群里不指定目标的特效打所有人：成员 + 聊天记录里出现过的人，发的人自己除外
export function bubbleFold(msgs, now, members) {
  var states = {}, tstates = {}, evs = [], info = {}, runs = {}, prev = null, byId = {}, id, uid, everyone = {};
  if (now == null) now = Date.now();
  (members || []).forEach(function (u) { everyone[u] = 1; });
  msgs.forEach(function (m) { if (m.id != null) byId[m.id] = m; if (m.receiver_id == null && m.sender_id) everyone[m.sender_id] = 1; });
  var crowd = Object.keys(everyone).sort(); // 排好序：两台设备算出的顺序一样
  // 打中一个人的所有气泡（包括已经被单独打过的）
  function hitAll(m, u, tok, ts, rec) {
    var nx = bubbleStep(states[u] || NORMAL, tok, { ts: ts });
    states[u] = keepSt(nx);
    for (var k in tstates) if (tstates[k].uid === u) tstates[k].st = keepSt(bubbleStep(tstates[k].st, tok, { ts: ts }));
    if (rec.ev == null && rec.x == null) { rec.ev = nx.ev; rec.x = nx.x; }
    evs.push({ m: m, uid: u, tid: null, ev: nx.ev, x: nx.x, before: nx.before, after: states[u] });
  }
  msgs.forEach(function (m) {
    if (m.status === 'failed' || m.sender_id === m.receiver_id) return;
    var p = fxParse(m.body), ts = tsOf(m), nx, i;
    if (!p) {
      // 睡着的人自己发了消息就醒了（连带他被定向攻击过的气泡）
      uid = m.sender_id;
      nx = bubbleStep(states[uid] || NORMAL, null, { ts: ts });
      states[uid] = keepSt(nx);
      for (id in tstates) if (tstates[id].uid === uid) tstates[id].st = keepSt(bubbleStep(tstates[id].st, null, { ts: ts }));
      if (nx.x) evs.push({ m: m, uid: uid, tid: null, ev: null, x: nx.x, before: nx.before, after: states[uid] });
      return;
    }
    var tok = p.tok, s = m.sender_id;
    uid = m.receiver_id; // 被打中的是收到的人
    // 三连：同一个人 8 秒内连发三个同样的特效，第三个是 combo（用完重新数）
    var run = runs[s];
    if (run && run.tok === tok) run.ts.push(ts); else run = runs[s] = { tok: tok, ts: [ts] };
    if (run.ts.length > 3) run.ts.shift();
    var combo = false;
    if (run.ts.length === 3 && run.ts[2] - run.ts[0] <= COMBO_MS) { combo = true; run.ts = []; }
    // 群里：@ 了某人（"[雪球]@uid"）只打那个人；指定了某条消息（"#id"）只打那条气泡；什么都没指定就打所有人（发的人自己除外）
    var grp = m.receiver_id == null;
    var gto = grp && p.tid == null && p.uid && p.uid !== s ? p.uid : null;
    // 对战：对方刚发过同样的特效，10 秒内回敬（群里要互相 @ 对方才算）
    var near = !!(prev && prev.tok === tok && ts - prev.ts >= 0 && ts - prev.ts <= COUNTER_MS);
    var counter = grp ? !!(gto && near && prev.sender === gto && prev.to === s) : !!(near && prev.sender !== s);
    prev = { sender: s, to: grp ? gto : m.receiver_id, tok: tok, ts: ts };
    var rec = info[m.key] = { combo: combo, counter: counter, ev: null, x: null, tid: null, uid: uid, all: false };
    if (grp) {
      if (p.tid != null) {
        var gt = byId[p.tid];
        if (!gt || gt.sender_id === s) return;
        uid = gt.sender_id;
      } else if (gto) {
        uid = gto;
      } else {
        rec.uid = null;
        if (p.uid) return; // @ 的是自己：不改任何人
        rec.all = true;
        crowd.forEach(function (u) { if (u !== s) hitAll(m, u, tok, ts, rec); });
        return;
      }
      rec.uid = uid;
    }
    if (p.tid != null) {
      var tm = byId[p.tid];
      // 只认已加载、而且是被打中的人发的普通消息
      if (!tm || tm.sender_id !== uid || fxParse(tm.body)) return;
      var base = tstates[tm.id] ? tstates[tm.id].st : (states[uid] || NORMAL);
      nx = bubbleStep(base, tok, { ts: ts });
      tstates[tm.id] = { st: keepSt(nx), uid: uid };
      rec.ev = nx.ev; rec.x = nx.x; rec.tid = tm.id;
      evs.push({ m: m, uid: uid, tid: tm.id, ev: nx.ev, x: nx.x, before: nx.before, after: tstates[tm.id].st });
    } else {
      hitAll(m, uid, tok, ts, rec); // 没指定气泡的特效影响这个人的所有气泡
    }
  });
  for (uid in states) states[uid] = decayState(states[uid], now);
  for (id in tstates) tstates[id].st = decayState(tstates[id].st, now);
  return { states: states, tstates: tstates, evs: evs, info: info };
}
// @reducer-end
