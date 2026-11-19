// 麻将牌桌界面：大厅 / 牌桌 / 吃碰杠胡 / 倒计时 / 结算（数据和网络在 mahjong.js，规则在 mahjong-rules.js）
// 界面直接画服务器给的状态（pub 公开状态 + 我自己的手牌行）；没有日志回放。刚打出的牌在牌河里高亮，别人的吃碰杠胡会在座位旁冒一个字。
// 牌面全部用 HTML / CSS 画（象牙色圆角牌）：万 = 汉字数字 + 红「万」；条 = 汉字数字 + 绿「条」；筒 = 汉字数字 + 蓝「筒」；东南西北深色，中红，发绿，白是一个蓝框。

import { numOf, suitOf, tileName } from './mahjong-rules.js';
import { errText } from '../errors.js';
import { S, makeAvatar } from '../state.js';
import { clear, h, toast } from '../utils.js';
import { openLeaderboard, rankButton } from './leaderboard.js';

var TURN_TOTAL = 20, CLAIM_TOTAL = 8; // 和服务器一致，只用来显示倒计时
var NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
var SUITS = ['万', '条', '筒'];
var WINDS = ['东', '南', '西', '北'];
var CALLS = { peng: '碰', chi: '吃', gang: '杠', angang: '杠', bugang: '杠', hu: '胡', zimo: '自摸' };

// 机器人名字：机器人1、机器人2……（按座位顺序数机器人）
export function botName(bots, seat) {
  var n = 0;
  for (var i = 0; i <= seat; i++) if (bots[i]) n++;
  return '机器人' + n;
}
function botAvatar(size) {
  return h('div', { class: 'avatar mj-bot', style: 'width:' + size + 'px;height:' + size + 'px', text: '机' });
}
// 一张牌（CSS 画的牌面）；尺寸由外面的 --tw（牌宽）决定
export function tileEl(t, cls) {
  var el = h('div', { class: 'mj-t ' + (cls || ''), 'data-t': t, 'aria-label': tileName(t) });
  var s = suitOf(t);
  if (s < 3) {
    el.classList.add('mj-s' + s);
    el.appendChild(h('i', { class: 'mj-n', text: NUMS[numOf(t)] }));
    el.appendChild(h('b', { class: 'mj-s', text: SUITS[s] }));
  } else if (t === 33) {
    el.classList.add('mj-bai');
    el.appendChild(h('span', { class: 'mj-frame' }));
  } else {
    el.classList.add(t === 31 ? 'mj-zhong' : t === 32 ? 'mj-fa' : 'mj-wind');
    el.appendChild(h('i', { class: 'mj-hz', text: tileName(t) }));
  }
  return el;
}
export function backEl(cls) { return h('div', { class: 'mj-t mj-back ' + (cls || '') }); }
function nowMs() { return Date.now(); }

// host: { hand(), scores(), person(id), act(body), sit(seat), stand(), setBot(seat, on), start(), rematch(), leave(), refreshHand(), refreshScores(), dm }
export function createTable(box, host) {
  var T = { g: null, ui: 0, sel: -1, busy: false, choice: null, sheet: false, sheetRound: -1, sheetHidden: false, tickV: -1, tickAt: 0, dead: false, lastStep: -1, lastRound: -1 };
  var root = h('div', { class: 'mj' });
  box.appendChild(root);
  var fxLayer = h('div', { class: 'mj-fxlayer', 'aria-hidden': 'true' }); // render 重画牌桌时不清掉它

  function mySeat() { var x = T.g; return x && S.me ? x.seats.indexOf(S.me.id) : -1; }
  function seated() { return mySeat() >= 0; }
  function live() { return !!T.g && T.g.status === 'playing'; }
  function pub() { return T.g && T.g.pub; }
  function nameOfSeat(s) {
    var x = T.g;
    if (x.seats[s]) { var p = host.person(x.seats[s]); return p ? p.nickname : '好友'; }
    if (x.bots[s]) return botName(x.bots, s);
    return '空位';
  }
  function avatarOfSeat(s, size) {
    var x = T.g;
    if (x.seats[s]) return makeAvatar(host.person(x.seats[s]), size);
    return botAvatar(size);
  }
  // 0 我（下），1 下家（右），2 对家（上），3 上家（左）；旁观时 0 号位在下
  function rel(s) { var m = mySeat(); return m >= 0 ? (s - m + 4) % 4 : s; }
  function windOf(s) { return WINDS[(s - pub().dealer + 4) % 4]; }
  // 我的手牌行：必须是这一局的；step 和公开状态对得上才允许操作
  function myHand() { var hd = host.hand(), p = pub(); return hd && p && hd.round === p.round ? hd : null; }
  function fresh() { var hd = myHand(); return !!hd && hd.step === pub().step; }
  function myOpts() { return fresh() && live() && !T.g.auto[mySeat()] ? myHand().opts : null; }
  // ----- 渲染 -----
  function render() {
    if (T.dead) return;
    var x = T.g;
    clear(root);
    root.classList.toggle('mj-lobbymode', !x || x.status === 'waiting' || x.status === 'closed');
    if (!x) { root.appendChild(h('div', { class: 'mj-loading', text: '载入中…' })); return; }
    if (x.status === 'waiting' || x.status === 'closed') renderLobby();
    else if (x.pub && x.pub.handCounts) renderTable();
    else root.appendChild(h('div', { class: 'mj-loading', text: '载入中…' }));
    if (T.sheet && x.status === 'over') renderSheet();
    else if (x.status === 'over' && T.sheetHidden) {
      var again = h('button', { type: 'button', class: 'btn small mj-reopen', text: '看结果' });
      again.addEventListener('click', function () { T.sheet = true; T.sheetHidden = false; render(); });
      root.appendChild(again);
    }
    root.appendChild(rankButton('mahjong', 'mj-rk'));
    root.appendChild(fxLayer);
    updateUi();
  }

  function meldEl(m, size) {
    var g = h('div', { class: 'mj-meld ' + m.kind });
    m.tiles.forEach(function (t) { g.appendChild(tileEl(t, size)); });
    return g;
  }
  function meldsRow(seat, size) {
    var p = pub(), row = h('div', { class: 'mj-melds' });
    var hd = seat === mySeat() ? myHand() : null;
    var ag = hd ? hd.ag.slice() : [];
    p.melds[seat].forEach(function (m) {
      if (m.kind === 'angang' && !(m.tiles && m.tiles.length)) {
        var g = h('div', { class: 'mj-meld angang' });
        var known = ag.length ? ag.shift() : null;
        for (var k = 0; k < 4; k++) g.appendChild(known !== null && k === 1 ? tileEl(known, size) : backEl(size));
        row.appendChild(g);
      } else row.appendChild(meldEl(m, size));
    });
    return row;
  }
  function chip(s) {
    var x = T.g, p = pub();
    var el = h('div', { class: 'mj-chip' + (p.phase === 'discard' && p.turn === s ? ' mj-turn' : ''), 'data-seat': s });
    var av = h('div', { class: 'mj-av' });
    av.appendChild(avatarOfSeat(s, 32));
    if (p.dealer === s) av.appendChild(h('span', { class: 'mj-dealer', text: '庄' }));
    el.appendChild(av);
    var tx = h('div', { class: 'mj-ctx' });
    tx.appendChild(h('b', { class: 'mj-nm', text: nameOfSeat(s) }));
    tx.appendChild(h('span', { class: 'mj-ct', text: windOf(s) + ' · ' + p.handCounts[s] + ' 张' + (x.auto[s] && !x.bots[s] ? ' · 托管' : '') }));
    el.appendChild(tx);
    el.appendChild(h('span', { class: 'mj-sec', hidden: true }));
    return el;
  }
  function pool(s, cls) {
    var p = pub(), el = h('div', { class: 'mj-pool ' + cls });
    p.discards[s].forEach(function (t, i) {
      var last = p.lastDiscard && p.lastDiscard.seat === s && p.lastDiscard.n === i;
      el.appendChild(tileEl(t, 'mj-pl' + (last ? ' mj-last' : '')));
    });
    return el;
  }

  function renderTable() {
    var p = pub(), m = mySeat(), vs = m >= 0 ? m : 0;
    var seatAt = function (r) { return (vs + r) % 4; };
    var W = root.clientWidth || 360;
    var tw = Math.max(22, Math.min(40, Math.floor((W - 16 - 13) / 14.35)));
    root.style.setProperty('--tw', tw + 'px');
    root.style.setProperty('--pw', (W >= 380 ? 21 : 17) + 'px');
    root.style.setProperty('--mw', '15px');

    // 对家
    var top = h('div', { class: 'mj-seatrow mj-top' });
    top.appendChild(chip(seatAt(2)));
    top.appendChild(meldsRow(seatAt(2), 'mj-mm'));
    root.appendChild(top);
    root.appendChild(pool(seatAt(2), 'mj-across'));

    // 中间：上家 | 中央 | 下家
    var mid = h('div', { class: 'mj-mid' });
    [3, 1].forEach(function (r, i) {
      var col = h('div', { class: 'mj-side ' + (i ? 'mj-r' : 'mj-l') });
      col.appendChild(chip(seatAt(r)));
      col.appendChild(meldsRow(seatAt(r), 'mj-mm'));
      col.appendChild(pool(seatAt(r), 'mj-sidepool'));
      if (i === 0) { mid.appendChild(col); mid.appendChild(centre()); } else mid.appendChild(col);
    });
    root.appendChild(mid);

    root.appendChild(pool(seatAt(0), 'mj-mine'));
    var me = h('div', { class: 'mj-seatrow mj-me' });
    me.appendChild(chip(seatAt(0)));
    me.appendChild(meldsRow(seatAt(0), 'mj-mm'));
    root.appendChild(me);

    // 我的手牌
    var hd = myHand();
    var hw = h('div', { class: 'mj-hand' });
    if (seated()) {
      if (hd) renderHand(hw, hd, tw);
      else {
        for (var k = 0; k < Math.min(p.handCounts[m], 14); k++) hw.appendChild(backEl('mj-hc'));
        hw.classList.add('mj-loadingh');
        host.refreshHand();
      }
    }
    root.appendChild(hw);
    root.appendChild(actions());
  }

  function centre() {
    var p = pub(), x = T.g, c = h('div', { class: 'mj-centre' });
    c.appendChild(h('div', { class: 'mj-quan', text: WINDS[Math.floor(p.quan / 4) % 4] + '风圈' }));
    c.appendChild(h('div', { class: 'mj-wall' }, h('b', { text: String(p.wallLeft) }), h('span', { text: '张牌墙' })));
    var ld = p.lastDiscard;
    var big = h('div', { class: 'mj-big' });
    if (ld && p.phase !== 'over') {
      big.appendChild(tileEl(ld.tile, 'mj-bg'));
      big.appendChild(h('span', { class: 'mj-bigby', text: nameOfSeat(ld.seat) + ' 打出' }));
    }
    c.appendChild(big);
    var st = '';
    var m = mySeat();
    if (x.status === 'playing') {
      if (p.phase === 'claim') st = '等大家表态';
      else if (p.turn === m) st = '轮到你了';
      else st = '等 ' + nameOfSeat(p.turn) + ' 出牌';
    }
    c.appendChild(h('div', { class: 'mj-state', text: st }));
    c.appendChild(h('div', { class: 'mj-csec', hidden: true }));
    return c;
  }

  // 手牌：牌宽按可用宽度算，14 张刚好放下；刚摸的那张隔开放在右边
  function renderHand(hw, hd, tw) {
    var cards = hd.cards.slice(), drawn = hd.drawn;
    if (drawn !== null && drawn !== undefined) {
      var i = cards.indexOf(drawn);
      if (i >= 0) cards.splice(i, 1); else drawn = null;
    }
    hw.style.setProperty('--tw', tw + 'px');
    var canPlay = live() && fresh() && seated() && !T.g.auto[mySeat()] && pub().phase === 'discard' && pub().turn === mySeat() && !T.busy;
    hw.classList.toggle('mj-canplay', canPlay);
    cards.forEach(function (t, k) { hw.appendChild(handTile(t, 'k' + k, canPlay)); });
    if (drawn !== null && drawn !== undefined) {
      var d = handTile(drawn, 'drawn', canPlay);
      d.classList.add('mj-drawn');
      hw.appendChild(d);
    }
  }
  function handTile(t, key, canPlay) {
    var el = tileEl(t, 'mj-hc' + (T.sel === key ? ' mj-sel' : ''));
    el.setAttribute('data-k', key);
    el.addEventListener('click', function () {
      if (!canPlay) return;
      if (T.sel === key) { T.sel = -1; doAct({ action: 'discard', tile: t }); }
      else { T.sel = key; T.choice = null; render(); }
    });
    return el;
  }

  // ----- 操作栏：吃 / 碰 / 杠 / 胡 / 过 只在合法时出现 -----
  function btn(text, cls, fn) {
    var b = h('button', { type: 'button', class: 'btn small ' + cls, text: text });
    b.disabled = T.busy;
    b.addEventListener('click', fn);
    return b;
  }
  function pairText(a, b) { return tileName(a) + tileName(b); }
  function actions() {
    var x = T.g, p = pub(), bar = h('div', { class: 'mj-acts' });
    var o = myOpts();
    var m = mySeat();
    if (!seated()) { bar.appendChild(h('span', { class: 'mj-watch', text: '旁观中' })); return bar; }
    if (x.status === 'over') return bar;
    if (x.auto[m]) {
      bar.appendChild(h('span', { class: 'mj-wait', text: '托管中' }));
      bar.appendChild(btn('取消托管', 'ghost', function () { doAct({ action: 'auto_off' }); }));
      return bar;
    }
    if (T.choice && o) {
      bar.classList.add('mj-choice');
      bar.appendChild(h('span', { class: 'mj-wait', text: T.choice.type === 'chi' ? '吃哪两张' : '杠哪张' }));
      T.choice.items.forEach(function (it) {
        var b = h('button', { type: 'button', class: 'btn small mj-opt' });
        if (T.choice.type === 'chi') { b.appendChild(tileEl(it[0], 'mj-mm')); b.appendChild(tileEl(it[1], 'mj-mm')); }
        else b.appendChild(tileEl(it.tile, 'mj-mm'));
        b.disabled = T.busy;
        b.addEventListener('click', function () {
          var body = T.choice.type === 'chi' ? { action: 'chi', with: it } : { action: it.kind, tile: it.tile };
          T.choice = null;
          doAct(body);
        });
        bar.appendChild(b);
      });
      bar.appendChild(btn('取消', 'ghost', function () { T.choice = null; render(); }));
      return bar;
    }
    if (o && o.mode === 'claim') {
      if (o.chi && o.chi.length) bar.appendChild(btn('吃', '', function () {
        if (o.chi.length === 1) doAct({ action: 'chi', with: o.chi[0] });
        else { T.choice = { type: 'chi', items: o.chi }; render(); }
      }));
      if (o.peng) bar.appendChild(btn('碰', '', function () { doAct({ action: 'peng' }); }));
      if (o.gang) bar.appendChild(btn('杠', '', function () { doAct({ action: 'gang' }); }));
      if (o.hu) bar.appendChild(btn('胡', 'mj-hu', function () { doAct({ action: 'hu' }); }));
      bar.appendChild(btn('过', 'ghost', function () { doAct({ action: 'pass' }); }));
      return bar;
    }
    if (o && o.mode === 'turn') {
      var gangs = (o.angang || []).map(function (t) { return { kind: 'angang', tile: t }; }).concat((o.bugang || []).map(function (t) { return { kind: 'bugang', tile: t }; }));
      if (gangs.length) bar.appendChild(btn('杠', '', function () {
        if (gangs.length === 1) doAct({ action: gangs[0].kind, tile: gangs[0].tile });
        else { T.choice = { type: 'gang', items: gangs }; render(); }
      }));
      if (o.hu) bar.appendChild(btn('自摸', 'mj-hu', function () { doAct({ action: 'hu' }); }));
      bar.appendChild(h('span', { class: 'mj-wait', text: T.sel !== -1 ? '再点一下打出' : '轮到你了，点一张牌打出' }));
      return bar;
    }
    if (p.phase === 'claim') bar.appendChild(h('span', { class: 'mj-wait', text: '等大家表态' }));
    else if (p.turn !== m) bar.appendChild(h('span', { class: 'mj-wait', text: '等 ' + nameOfSeat(p.turn) + ' 出牌' }));
    else bar.appendChild(h('span', { class: 'mj-wait', text: '载入中…' }));
    return bar;
  }

  function doAct(body) {
    if (T.busy) return;
    T.busy = true; T.sel = -1; render();
    host.act(body).then(function (r) {
      T.busy = false;
      if (r && r.error) toast(errText({ message: r.error }));
      if (!T.dead) render();
    });
  }

  // ----- 倒计时（每 250ms）+ 超时 tick（谁在看谁就发，服务器只认第一个）-----
  function updateUi() {
    var x = T.g, p = pub();
    if (T.dead || !x || !p || !live()) return;
    var dl = x.deadline ? Date.parse(x.deadline) : NaN;
    var total = (p.phase === 'claim' ? CLAIM_TOTAL : TURN_TOTAL) * 1000;
    var left = dl - nowMs();
    var cs = root.querySelector('.mj-csec');
    if (Number.isFinite(dl) && cs) {
      cs.hidden = false;
      cs.textContent = String(Math.max(0, Math.ceil(left / 1000)));
      cs.classList.toggle('mj-urgent', left < 6000 && total > 0);
    }
    var turnChip = p.phase === 'discard' ? root.querySelector('.mj-chip[data-seat="' + p.turn + '"] .mj-sec') : null;
    if (turnChip && Number.isFinite(dl)) { turnChip.hidden = false; turnChip.textContent = String(Math.max(0, Math.ceil(left / 1000))); }
    if (Number.isFinite(dl) && left < -700 && (T.tickV !== x.version || nowMs() - T.tickAt > 2500)) {
      T.tickV = x.version; T.tickAt = nowMs() + Math.random() * 600;
      host.act({ action: 'tick' });
    }
  }
  T.ui = setInterval(updateUi, 250);

  // 别人吃碰杠胡：座位旁冒一个字
  function callFx(p) {
    var last = p.recent && p.recent[p.recent.length - 1];
    if (!last || !CALLS[last.kind]) return;
    var r = rel(last.seat);
    var b = h('div', { class: 'mj-call mj-p' + r, text: CALLS[last.kind] });
    fxLayer.appendChild(b);
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 1300);
  }

  // ----- 大厅 -----
  function renderLobby() {
    var x = T.g;
    var lb = h('div', { class: 'mj-lobby' });
    lb.appendChild(h('div', { class: 'mj-title', text: x.status === 'closed' ? '这桌已关闭' : '麻将' }));
    lb.appendChild(h('div', { class: 'mj-sub', text: x.status === 'closed' ? '回到聊天，再开一桌吧' : '四人一桌，人不够开始时自动补机器人' }));
    var sc = host.scores();
    var m = mySeat(), humans = 0, empty = 0;
    [0, 1, 2, 3].forEach(function (s) {
      if (x.seats[s]) humans++;
      if (!x.seats[s] && !x.bots[s]) empty++;
      var row = h('div', { class: 'mj-lrow' + (x.seats[s] || x.bots[s] ? ' mj-on' : '') });
      row.appendChild(h('div', { class: 'mj-lav' }, x.seats[s] || x.bots[s] ? avatarOfSeat(s, 48) : h('span', { class: 'mj-empty', text: WINDS[s] })));
      var nm = h('div', { class: 'mj-lnm' }, h('b', { text: x.seats[s] || x.bots[s] ? nameOfSeat(s) : '空位' }));
      if (x.seats[s]) {
        var r = sc[x.seats[s]];
        nm.appendChild(h('span', { class: 'mj-lsub', text: r ? '累计 ' + (r.total > 0 ? '+' : '') + r.total + ' 分，' + r.games + ' 局' : '还没打过' }));
      } else if (x.bots[s]) nm.appendChild(h('span', { class: 'mj-lsub', text: '机器人' }));
      row.appendChild(nm);
      var ops = h('div', { class: 'mj-lops' });
      if (x.status === 'waiting') {
        if (!x.seats[s] && !x.bots[s]) {
          ops.appendChild(lbtn('坐这里', 'btn small', function () { host.sit(s); }));
          if (m >= 0) ops.appendChild(lbtn('加机器人', 'btn small ghost', function () { host.setBot(s, true); }));
        } else if (x.bots[s] && m >= 0) ops.appendChild(lbtn('移除', 'btn small ghost', function () { host.setBot(s, false); }));
        else if (x.seats[s] === (S.me && S.me.id)) ops.appendChild(lbtn('站起来', 'btn small ghost', function () { host.stand(); }));
      }
      row.appendChild(ops);
      lb.appendChild(row);
    });
    if (x.status === 'waiting') {
      if (m >= 0) {
        var label = empty ? '开始（补 ' + empty + ' 个机器人）' : '开始';
        var st = lbtn(label, 'btn mj-start', function () { host.start(); });
        st.disabled = humans < 1;
        lb.appendChild(st);
      } else lb.appendChild(h('div', { class: 'mj-sub', text: empty ? '你可以坐到空位上一起玩' : '人满了，等他们开始' }));
    }
    root.appendChild(lb);
  }
  function lbtn(text, cls, fn) {
    var b = h('button', { type: 'button', class: cls, text: text });
    b.addEventListener('click', fn);
    return b;
  }

  // ----- 结算 -----
  function renderSheet() {
    var x = T.g, p = pub(), me = mySeat(), r = p.result;
    var shade = h('div', { class: 'mj-shade' });
    var sh = h('div', { class: 'mj-sheet', role: 'dialog', 'aria-label': '结算' });
    var iWin = me >= 0 && r.winner === me;
    var head, sub;
    if (r.type === 'draw') { head = '流局'; sub = '牌墙摸完了，这局不算分'; }
    else {
      head = me < 0 ? nameOfSeat(r.winner) + ' 胡了' : iWin ? '你胡了' : r.winner !== null ? nameOfSeat(r.winner) + ' 胡了' : '';
      sub = r.type === 'zimo' ? '自摸' : r.type === 'qianggang' ? '抢杠胡，' + nameOfSeat(r.from) + ' 点炮' : nameOfSeat(r.from) + ' 点炮';
      sub += '，' + r.shape + '，' + r.fan + ' 番';
    }
    sh.appendChild(h('div', { class: 'mj-res ' + (iWin ? 'mj-w' : r.type === 'draw' ? '' : 'mj-lose'), text: head }));
    sh.appendChild(h('div', { class: 'mj-res-sub', text: sub }));
    if (r.type !== 'draw') {
      var wt = h('div', { class: 'mj-final' });
      var wm = h('div', { class: 'mj-final-row', style: '--tw:20px' });
      p.melds[r.winner].forEach(function (mm) { wm.appendChild(meldEl(mm, 'mj-mm')); });
      var hand = r.hands[r.winner].slice(), wi = r.tile !== null && r.tile !== undefined ? hand.indexOf(r.tile) : -1;
      hand.forEach(function (t, i) { wm.appendChild(tileEl(t, 'mj-mm' + (i === wi ? ' mj-win' : ''))); });
      wt.appendChild(wm);
      sh.appendChild(wt);
      var items = h('div', { class: 'mj-items' });
      r.items.forEach(function (it) { items.appendChild(h('span', {}, h('em', { text: it.name }), h('b', { text: '+' + it.fan }))); });
      items.appendChild(h('span', { class: 'mj-sum' }, h('em', { text: '合计' }), h('b', { text: r.fan + ' 番' })));
      sh.appendChild(items);
    }
    var list = h('div', { class: 'mj-rrows' });
    for (var s = 0; s < 4; s++) {
      var row = h('div', { class: 'mj-rrow' + (s === me ? ' mj-meRow' : '') });
      row.appendChild(h('div', { class: 'mj-rav' }, avatarOfSeat(s, 36)));
      row.appendChild(h('div', { class: 'mj-rnm' }, h('b', { text: nameOfSeat(s) }), h('span', { text: windOf(s) + (p.dealer === s ? ' · 庄' : '') + (r.winner === s ? ' · 胡' : r.from === s ? ' · 点炮' : '') })));
      var d = r.scores[s];
      row.appendChild(h('div', { class: 'mj-rsc ' + (d > 0 ? 'mj-pos' : d < 0 ? 'mj-neg' : ''), text: (d > 0 ? '+' : '') + d }));
      list.appendChild(row);
    }
    sh.appendChild(list);
    var sc = host.scores(), tot = h('div', { class: 'mj-tot' }, h('div', { class: 'mj-tot-h', text: host.dm ? '你们的累计' : '本群累计' }));
    var any = false;
    x.seats.forEach(function (u) {
      if (!u) return;
      var rr = sc[u];
      any = true;
      var pp = host.person(u);
      tot.appendChild(h('div', { class: 'mj-tot-r' }, h('span', { text: pp ? pp.nickname : '好友' }), h('b', { text: rr ? (rr.total > 0 ? '+' : '') + rr.total : '…' }), h('em', { text: rr ? rr.games + ' 局 ' + rr.wins + ' 胜' : '' })));
    });
    if (any) sh.appendChild(tot);
    var ops = h('div', { class: 'mj-sheet-ops' });
    if (me >= 0) ops.appendChild(lbtn('再来一局', 'btn', function () { host.rematch(); }));
    ops.appendChild(lbtn('排行榜', 'btn ghost', function () { openLeaderboard('mahjong'); }));
    ops.appendChild(lbtn('离开', 'btn ghost', function () { host.leave(); }));
    sh.appendChild(ops);
    sh.appendChild(lbtn('收起', 'mj-peek', function () { T.sheet = false; T.sheetHidden = true; render(); }));
    shade.appendChild(sh);
    root.appendChild(shade);
  }

  // ----- 对外 -----
  var api = {
    update: function (game, initial) {
      var prev = T.g, p = game.pub;
      T.g = game;
      if (game.status === 'waiting' || game.status === 'closed') { T.sheet = false; T.sel = -1; T.choice = null; render(); return; }
      if (p && p.round !== T.lastRound) { T.lastRound = p.round; T.sheet = false; T.sheetHidden = false; T.sel = -1; T.choice = null; T.sheetRound = -1; }
      if (p && p.step !== T.lastStep) {
        if (!initial && prev && prev.pub && p.step > prev.pub.step && p.round === prev.pub.round) callFx(p);
        T.lastStep = p.step; T.sel = -1; T.choice = null;
      }
      if (game.status === 'over' && p && T.sheetRound !== p.round) {
        T.sheetRound = p.round;
        var go = function () { if (T.dead) return; T.sheet = true; T.sheetHidden = false; host.refreshScores(); render(); };
        if (initial) go(); else setTimeout(go, 900);
      }
      render();
    },
    setHand: function () { if (!T.dead && T.g && T.g.status === 'playing') render(); },
    setScores: function () { if (!T.dead && T.sheet) render(); },
    resize: function () { if (!T.dead && T.g) render(); },
    destroy: function () { T.dead = true; clearInterval(T.ui); }
  };
  return api;
}
