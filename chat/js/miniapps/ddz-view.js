// 斗地主牌桌界面：大厅 / 叫分 / 出牌 / 倒计时 / 特效 / 结算（数据和网络在 ddz.js，规则在 ddz-rules.js）
// 三人局和四人局（两副牌，pub.players = 4）共用一套界面：四人局对手在左 / 上 / 右，底牌 8 张，手牌最多 33 张（两排，必要时三排）。
//
// 服务器给的是「整局的日志」（pub.log）：这里把新增的日志一条一条回放（约 700ms 一条），
// 自己刚做的那一手立刻显示，机器人和别人的动作逐个出现，所以看得清楚。界面上显示的是回放出来的状态 D，不是服务器的最终状态。

import { beats, canPass, cardLabel, classify, hints, sortHand, suitOf } from './ddz-rules.js';
import { errText } from '../errors.js';
import { S, makeAvatar } from '../state.js';
import { clear, h, toast } from '../utils.js';

var STEP_MS = 700; // 回放：两个动作之间的间隔
var SUITS = ['♠', '♥', '♣', '♦']; // 花色 0..3（c % 4），♥ ♦ 红
var BID_TOTAL = 20, PLAY_TOTAL = 30; // 和服务器一致，只用来画倒计时圈
var RING_R = 23, RING_C = 2 * Math.PI * RING_R;

// 机器人名字：机器人1、机器人2……（按座位顺序数机器人）
export function botName(bots, seat) {
  var n = 0;
  for (var i = 0; i <= seat; i++) if (bots[i]) n++;
  return '机器人' + n;
}
// 带加载失败兜底的图片：失败就换成一个文字小标
function img(src, cls, fallbackText) {
  var el = h('img', { class: cls, src: src, alt: '', draggable: 'false' });
  el.addEventListener('error', function () {
    var f = h('span', { class: cls + ' ddz-imgfb', text: fallbackText || '' });
    if (el.parentNode) el.parentNode.replaceChild(f, el);
  });
  return el;
}
function botAvatar(size) {
  var box = h('div', { class: 'avatar ddz-bot', style: 'width:' + size + 'px;height:' + size + 'px' });
  var im = h('img', { src: 'ddz/bot-avatar.png', alt: '', draggable: 'false' });
  im.addEventListener('error', function () { clear(box).appendChild(h('span', { class: 'ddz-botfb', text: '机' })); });
  box.appendChild(im);
  return box;
}
// 一张牌（CSS 画的牌面）：左上角点数 + 花色，中间大花色；王竖排文字
export function cardEl(c, cls) {
  var el = h('div', { class: 'ddz-card ' + (cls || '') });
  var base = c % 54; // 两副牌：第二副的牌编码 +54
  if (base >= 52) {
    el.classList.add('joker', base === 53 ? 'red' : 'black');
    el.appendChild(h('span', { class: 'jk', text: base === 53 ? '大王' : '小王' }));
    el.appendChild(h('span', { class: 'jk-s', text: '★' }));
  } else {
    var s = SUITS[suitOf(c)];
    if (suitOf(c) === 1 || suitOf(c) === 3) el.classList.add('red');
    el.appendChild(h('span', { class: 'cr', text: cardLabel(c) }));
    el.appendChild(h('span', { class: 'cs', text: s }));
    el.appendChild(h('span', { class: 'cc', text: s }));
  }
  return el;
}
function backEl(cls) {
  var el = h('div', { class: 'ddz-card back ' + (cls || '') });
  var im = h('img', { src: 'ddz/card-back.png', alt: '', draggable: 'false' });
  im.addEventListener('error', function () { im.remove(); el.classList.add('nofb'); });
  el.appendChild(im);
  return el;
}
function nowMs() { return Date.now(); }
function fill(n, v) { var a = []; for (var i = 0; i < n; i++) a.push(v); return a; }
var NUM = ['', '', '', '', '', '五', '六', '七', '八'];

function newD(pub) {
  var n = pub.players === 4 ? 4 : 3, per = n === 4 ? 25 : 17;
  return { n: n, per: per, round: pub.round, logLen: 0, last: fill(n, null), lastPlay: null, passCount: 0, counts: fill(n, per), landlord: null, bottom: null, turn: pub.first, bid: 0, bombs: 0, phase: 'bidding', notice: '' };
}
// 把一条日志应用到显示状态 D；返回需要播的特效
function applyEntry(D, e, pub) {
  var fx = null, n = D.n, rules = { players: n };
  D.logLen++;
  D.notice = '';
  if (e.kind === 'bid') {
    D.last[e.seat] = { t: 'bid', v: e.value };
    if (e.value > 0) D.bid = e.value;
    D.turn = (e.seat + 1) % n;
  } else if (e.kind === 'landlord') {
    D.landlord = e.seat; D.phase = 'playing'; D.bid = e.value;
    D.counts[e.seat] += n === 4 ? 8 : 3;
    D.bottom = pub.bottom ? pub.bottom.slice() : null;
    D.last = fill(n, null); D.lastPlay = null; D.passCount = 0;
    D.turn = e.seat;
  } else if (e.kind === 'play') {
    if (!D.lastPlay) D.last = fill(n, null);
    var info = classify(e.cards, rules);
    D.last[e.seat] = { t: 'play', cards: e.cards, type: info ? info.type : 'single' };
    D.lastPlay = { seat: e.seat, cards: e.cards, type: info ? info.type : 'single' };
    D.passCount = 0;
    D.counts[e.seat] -= e.cards.length;
    D.turn = (e.seat + 1) % n;
    if (info) {
      if (info.type === 'bomb') {
        D.bombs++;
        var big = n === 4 && info.len >= 5;
        fx = { kind: 'bomb', label: big ? NUM[info.len] + '炸' : '炸弹', big: big };
      } else if (info.type === 'rocket') { D.bombs++; fx = n === 4 ? { kind: 'rocket', label: '天王炸', big: true, king: true } : { kind: 'rocket', label: '火箭' }; }
      else if (info.type === 'plane' || info.type === 'plane1' || info.type === 'plane2') fx = { kind: 'plane', label: '飞机' };
    }
  } else if (e.kind === 'pass') {
    D.last[e.seat] = { t: 'pass' };
    D.passCount++;
    if (D.passCount >= n - 1 && D.lastPlay) { D.turn = D.lastPlay.seat; D.lastPlay = null; D.passCount = 0; }
    else D.turn = (e.seat + 1) % n;
  } else if (e.kind === 'redeal') {
    D.last = fill(n, null); D.bid = 0; D.counts = fill(n, D.per); D.turn = e.seat; D.notice = '没人叫分，重新发牌';
  }
  return fx;
}

// host: { game(), hand(), scores(), person(id), act(body), sit(seat), stand(), setBot(seat, on), start(), rematch(), leave(), refreshHand(), refreshScores() }
export function createTable(box, host) {
  var T = { g: null, D: null, queue: [], tm: 0, ui: 0, sel: {}, hintI: -1, hintKey: '', busy: false, sheet: false, sheetRound: -1, sheetHidden: false, tickV: -1, tickAt: 0, fixV: -1, fxTm: 0, dead: false, lastSig: '', handSig: '' };
  var root = h('div', { class: 'ddz' });
  box.appendChild(root);
  var fxLayer = h('div', { class: 'ddz-fxlayer', 'aria-hidden': 'true' }); // 特效层：render 重画牌桌时不清掉它

  function mySeat() { var x = T.g; return x && S.me ? x.seats.indexOf(S.me.id) : -1; }
  function seated() { return mySeat() >= 0; }
  function live() { var x = T.g; return !!x && (x.status === 'bidding' || x.status === 'playing'); }
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
  function nP() { var x = T.g; return T.D ? T.D.n : x && x.pub && x.pub.players === 4 ? 4 : 3; }
  function rules() { return { players: nP() }; }
  // 0 我（下），1 下家（右）；三人局 2 是上家（左）；四人局 2 是对家（上），3 是上家（左）；旁观时 0 号位在下
  function rel(s) { var m = mySeat(), n = nP(); return m >= 0 ? (s - m + n) % n : s; }
  function posClass(s) { var r = rel(s); return r === 0 ? 'me' : r === 1 ? 'r' : nP() === 4 ? (r === 2 ? 't' : 'l') : 'l'; }

  // ----- 回放 -----
  function feed(initial) {
    var x = T.g, pub = x && x.pub;
    if (!x || !pub || !pub.log || (x.status !== 'bidding' && x.status !== 'playing' && x.status !== 'over')) { T.D = null; T.queue = []; clearTimeout(T.tm); T.tm = 0; return; }
    var D = T.D;
    if (!D || D.round !== pub.round || pub.log.length < D.logLen) {
      D = T.D = newD(pub); T.queue = []; clearTimeout(T.tm); T.tm = 0; T.sheetRound = -1; T.sheet = false; T.sel = {};
    }
    var have = D.logLen + T.queue.length;
    if (pub.log.length > have) T.queue = T.queue.concat(pub.log.slice(have));
    pump(initial);
  }
  function settle() {
    // 回放完：和服务器的最终状态对齐
    var x = T.g, pub = x.pub, D = T.D;
    D.counts = pub.handCounts.slice();
    if (x.status !== 'over') { D.turn = pub.turn; D.bid = pub.bid; }
    if (pub.landlord !== null && pub.landlord !== undefined) { D.landlord = pub.landlord; D.bottom = pub.bottom ? pub.bottom.slice() : D.bottom; D.phase = 'playing'; }
    D.lastPlay = pub.lastPlay ? { seat: pub.lastPlay.seat, cards: pub.lastPlay.cards, type: pub.lastPlay.type } : null;
    D.passCount = pub.passCount;
    D.bombs = pub.bombs;
  }
  function pump(instant) {
    if (T.tm || T.dead) return;
    while (T.queue.length) {
      var e = T.queue[0];
      var now = instant || (e.seat === mySeat() && e.kind !== 'landlord' && e.kind !== 'redeal');
      if (!now) {
        T.tm = setTimeout(function () {
          T.tm = 0;
          if (T.dead || !T.D) return;
          var ev = T.queue.shift();
          playFx(applyEntry(T.D, ev, T.g.pub));
          render();
          pump(false);
        }, STEP_MS);
        render();
        return;
      }
      var fx = applyEntry(T.D, T.queue.shift(), T.g.pub);
      if (!instant) playFx(fx);
    }
    settle();
    render();
    afterReplay(instant);
  }
  function afterReplay(instant) {
    var x = T.g;
    if (x.status !== 'over' || T.sheetRound === x.pub.round) return;
    T.sheetRound = x.pub.round;
    var delay = instant ? 0 : 900;
    var go = function () { if (T.dead) return; T.sheet = true; T.sheetHidden = false; host.refreshScores(); render(); };
    if (x.pub.spring && !instant) { banner(x.pub.winner === 'landlord' ? '春天' : '反春', 'spring'); setTimeout(go, 1900); }
    else if (delay) setTimeout(go, delay);
    else go();
  }
  function banner(text, cls) {
    var b = h('div', { class: 'ddz-banner ' + (cls || ''), text: text });
    fxLayer.appendChild(b);
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 1900);
  }
  function playFx(fx) {
    if (!fx) return;
    var wrap = h('div', { class: 'ddz-fx ' + fx.kind + (fx.big ? ' big' : '') + (fx.king ? ' king' : ''), 'aria-hidden': 'true' });
    wrap.appendChild(img('ddz/fx-' + fx.kind + '.png', 'ddz-fx-img', fx.label));
    wrap.appendChild(h('span', { class: 'ddz-fx-t', text: fx.label }));
    if (fx.king) fxLayer.appendChild(h('div', { class: 'ddz-flash' }));
    fxLayer.appendChild(wrap);
    setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 1300);
    if (fx.king) setTimeout(function () { var f = fxLayer.querySelector('.ddz-flash'); if (f) f.remove(); }, 1300);
  }

  // ----- 我的手牌（显示用）：服务器的手牌 + 还没回放到的「我已经出掉的牌」 - 还没回放到的「底牌」 -----
  function shownHand() {
    var x = T.g, m = mySeat(), hd = host.hand();
    if (m < 0 || !hd || !x.pub || hd.round !== x.pub.round) return null;
    var cards = hd.cards.slice();
    T.queue.forEach(function (e) {
      if (e.kind === 'play' && e.seat === m) cards = cards.concat(e.cards);
      if (e.kind === 'landlord' && e.seat === m && x.pub.bottom) cards = cards.filter(function (c) { return x.pub.bottom.indexOf(c) < 0; });
    });
    return sortHand(cards);
  }
  function selCards(hand) { return hand.filter(function (c) { return T.sel[c]; }); }
  function idle() { return !T.queue.length && !T.tm; }
  function myTurn() { var x = T.g, D = T.D; return live() && idle() && seated() && D && D.turn === mySeat() && !x.auto[mySeat()]; }

  // ----- 渲染 -----
  function render() {
    if (T.dead) return;
    var x = T.g;
    clear(root);
    root.classList.toggle('lobby', !x || x.status === 'waiting' || x.status === 'closed');
    if (!x) { root.appendChild(h('div', { class: 'ddz-loading', text: '载入中…' })); return; }
    if (x.status === 'waiting' || x.status === 'closed') renderLobby();
    else if (T.D) renderTable();
    else root.appendChild(h('div', { class: 'ddz-loading', text: '载入中…' }));
    if (T.sheet && x.status === 'over') renderSheet();
    else if (x.status === 'over' && T.sheetHidden && idle()) {
      var again = h('button', { type: 'button', class: 'btn small ddz-reopen', text: '看结果' });
      again.addEventListener('click', function () { T.sheet = true; T.sheetHidden = false; render(); });
      root.appendChild(again);
    }
    root.appendChild(fxLayer);
    updateUi();
  }

  function seatBox(s, lobby) {
    var x = T.g, D = T.D, pc = posClass(s);
    var box = h('div', { class: 'ddz-seat ' + pc, 'data-seat': s });
    var av = h('div', { class: 'ddz-av' });
    av.appendChild(avatarOfSeat(s, 46));
    if (!lobby) {
      var ns = 'http://www.w3.org/2000/svg';
      var ring = document.createElementNS(ns, 'svg');
      ring.setAttribute('class', 'ddz-ring'); ring.setAttribute('viewBox', '0 0 52 52'); ring.setAttribute('aria-hidden', 'true');
      var c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', '26'); c.setAttribute('cy', '26'); c.setAttribute('r', String(RING_R));
      c.setAttribute('stroke-dasharray', RING_C.toFixed(2)); c.setAttribute('stroke-dashoffset', '0');
      ring.appendChild(c); av.appendChild(ring);
      av.appendChild(h('span', { class: 'ddz-sec', hidden: true }));
      if (D && D.landlord !== null) av.appendChild(img(s === D.landlord ? 'ddz/badge-landlord.png' : 'ddz/badge-farmer.png', 'ddz-role', s === D.landlord ? '地主' : '农民'));
    }
    box.appendChild(av);
    box.appendChild(h('div', { class: 'ddz-nm', text: nameOfSeat(s) }));
    if (!lobby && D) {
      var info = h('div', { class: 'ddz-ct' });
      info.appendChild(backEl('mini'));
      info.appendChild(h('b', { text: String(D.counts[s]) }));
      box.appendChild(info);
      if (x.auto[s] && !x.bots[s]) box.appendChild(h('span', { class: 'ddz-tag', text: '托管' }));
    }
    return box;
  }

  // 一手牌排成一行（牌多就均匀分成几行，每行至少叠 16px），四人局两侧的位置窄，用 wrap
  function playsRow(cards, maxW, wrap) {
    var n = cards.length, cw = wrap ? 26 : 30, minStep = 16;
    var cap = Math.max(1, Math.floor((maxW - cw) / minStep) + 1);
    var lines = wrap ? Math.ceil(n / cap) : 1;
    var per = Math.ceil(n / lines);
    var sorted = sortHand(cards);
    var col = h('div', { class: 'ddz-plays-col' });
    for (var li = 0; li < lines; li++) {
      var part = sorted.slice(li * per, (li + 1) * per);
      var step = part.length > 1 ? Math.min(minStep, (maxW - cw) / (part.length - 1)) : 0;
      var row = h('div', { class: 'ddz-plays-row' + (wrap ? ' sm' : '') });
      row.style.setProperty('--step', step.toFixed(1) + 'px');
      part.forEach(function (c) { row.appendChild(cardEl(c, 'pc' + (wrap ? ' sm' : ''))); });
      col.appendChild(row);
    }
    return col;
  }
  function slot(s) {
    var D = T.D, a = D.last[s];
    var pc = posClass(s);
    var el = h('div', { class: 'ddz-slot ' + pc });
    if (!a) return el;
    if (a.t === 'bid') el.appendChild(h('span', { class: 'ddz-pill' + (a.v ? ' on' : ''), text: a.v ? a.v + '分' : '不叫' }));
    else if (a.t === 'pass') el.appendChild(h('span', { class: 'ddz-pill', text: '不出' }));
    else {
      var W = root.clientWidth || 360;
      if (nP() === 4) el.appendChild(playsRow(a.cards, pc === 'me' || pc === 't' ? W - 40 : Math.max(84, W * 0.5 - 86), pc === 'l' || pc === 'r'));
      else el.appendChild(playsRow(a.cards, pc === 'me' ? W - 40 : Math.max(120, W * 0.5 - 24)));
    }
    return el;
  }

  function renderTable() {
    var x = T.g, D = T.D, m = mySeat(), vs = m >= 0 ? m : 0, n = D.n, four = n === 4;
    var seatAt = function (r) { return (vs + r) % n; };
    root.classList.toggle('p4', four);
    var mid = h('div', { class: 'ddz-info' });
    var bt = h('div', { class: 'ddz-bottom' });
    var bn = four ? 8 : 3;
    for (var i = 0; i < bn; i++) bt.appendChild(D.bottom && D.landlord !== null && D.bottom[i] !== undefined ? cardEl(D.bottom[i], 'pc' + (four ? ' sm' : ' small')) : backEl('small'));
    mid.appendChild(bt);
    var mult = Math.max(1, (D.bid || 1)) * Math.pow(2, D.bombs);
    mid.appendChild(h('div', { class: 'ddz-mult', text: D.phase === 'bidding' ? '叫分中' : '× ' + mult }));
    var top = h('div', { class: 'ddz-top' + (four ? ' p4' : '') });
    if (four) {
      top.appendChild(mid);
      top.appendChild(seatBox(seatAt(2)));
    } else {
      top.appendChild(seatBox(seatAt(2)));
      top.appendChild(mid);
      top.appendChild(seatBox(seatAt(1)));
    }
    root.appendChild(top);

    var table = h('div', { class: 'ddz-mid' });
    if (four) {
      table.appendChild(seatBox(seatAt(3)));
      table.appendChild(seatBox(seatAt(1)));
      table.appendChild(slot(seatAt(2)));
      table.appendChild(slot(seatAt(3)));
      table.appendChild(slot(seatAt(1)));
    } else {
      table.appendChild(slot(seatAt(2)));
      table.appendChild(slot(seatAt(1)));
    }
    table.appendChild(slot(seatAt(0)));
    if (D.notice) table.appendChild(h('div', { class: 'ddz-notice', text: D.notice }));
    root.appendChild(table);

    var bar = h('div', { class: 'ddz-bar' });
    var hand = shownHand();
    bar.classList.toggle('spec', !seated());
    bar.appendChild(seatBox(vs));
    var acts = h('div', { class: 'ddz-acts' });
    if (!seated()) acts.appendChild(h('span', { class: 'ddz-watch', text: '旁观中' }));
    bar.appendChild(acts);
    root.appendChild(bar);

    if (seated() && x.auto[m] && x.status !== 'over') {
      var b = h('button', { type: 'button', class: 'btn small ddz-auto', text: '取消托管' });
      b.addEventListener('click', function () { doAct({ action: 'auto_off' }); });
      acts.appendChild(h('span', { class: 'ddz-wait', text: '托管中' }));
      acts.appendChild(b);
    } else if (myTurn() && x.status === 'bidding') {
      [0, 1, 2, 3].forEach(function (v) {
        var btn = h('button', { type: 'button', class: 'btn small ddz-bid' + (v === 3 ? '' : ' ghost'), text: v === 0 ? '不叫' : v + '分' });
        btn.disabled = T.busy || (v !== 0 && v <= D.bid);
        btn.addEventListener('click', function () { doAct({ action: 'bid', value: v }); });
        acts.appendChild(btn);
      });
    } else if (myTurn() && x.status === 'playing') {
      var sel = hand ? selCards(hand) : [];
      var lead = !D.lastPlay;
      var pass = h('button', { type: 'button', class: 'btn small ghost', text: '不出' });
      pass.disabled = T.busy || lead || !canPass({ phase: 'playing', turn: m, lastPlay: D.lastPlay }, m);
      pass.addEventListener('click', function () { doAct({ action: 'pass' }); });
      var hint = h('button', { type: 'button', class: 'btn small ghost', text: '提示' });
      hint.disabled = T.busy;
      hint.addEventListener('click', onHint);
      var ok = sel.length > 0 && !!classify(sel, rules()) && beats(sel, D.lastPlay ? D.lastPlay.cards : null, rules());
      var play = h('button', { type: 'button', class: 'btn small ddz-play', text: '出牌' });
      play.disabled = T.busy || !ok;
      play.addEventListener('click', function () { doPlay(); });
      acts.appendChild(pass); acts.appendChild(hint); acts.appendChild(play);
    } else if (x.status !== 'over') {
      var wait = D.turn === m ? '' : '等 ' + nameOfSeat(D.turn) + (x.status === 'bidding' ? ' 叫分' : ' 出牌');
      if (wait && idle()) acts.appendChild(h('span', { class: 'ddz-wait', text: wait }));
    }

    var hw = h('div', { class: 'ddz-hand', 'data-n': hand ? hand.length : 0 });
    if (seated()) {
      if (hand) renderHand(hw, hand);
      else {
        var cnt = D.counts[m];
        for (var k = 0; k < Math.min(cnt, 17); k++) hw.appendChild(backEl('hc'));
        hw.classList.add('loading');
        host.refreshHand();
      }
    }
    root.appendChild(hw);
  }

  // 手牌：最多 10 张一排；再多分两排（三人局）。四人局最多 33 张：按宽度算每排最多放几张（相邻牌至少露出 18px），两排放不下才用三排
  function renderHand(hw, hand) {
    var n = hand.length, W = root.clientWidth || 360, four = nP() === 4;
    var cw = four ? Math.max(38, Math.min(52, Math.round(W * 0.122))) : Math.max(44, Math.min(58, Math.round(W * 0.14)));
    var rows;
    if (n <= 10) rows = [hand];
    else if (!four) rows = [hand.slice(0, Math.ceil(n / 2)), hand.slice(Math.ceil(n / 2))];
    else {
      var cap = Math.floor((W - cw - 16) / 18) + 1;
      var nr = n <= 2 * cap ? 2 : 3, per = Math.ceil(n / nr);
      rows = [];
      for (var q = 0; q < nr; q++) rows.push(hand.slice(q * per, (q + 1) * per));
    }
    hw.style.setProperty('--cw', cw + 'px');
    hw.classList.toggle('rows3', rows.length === 3);
    var maxK = 0;
    rows.forEach(function (rc) { if (rc.length > maxK) maxK = rc.length; });
    rows.forEach(function (rc, ri) {
      var row = h('div', { class: 'ddz-hrow r' + ri });
      var k = rc.length;
      var step = k > 1 ? Math.min(cw * 0.78, (W - cw - 16) / ((four ? maxK : k) - 1)) : 0;
      row.style.setProperty('--step', step.toFixed(1) + 'px');
      row.style.width = (cw + step * (k - 1)).toFixed(1) + 'px';
      rc.forEach(function (c, i) {
        var el = cardEl(c, 'hc' + (T.sel[c] ? ' sel' : ''));
        el.setAttribute('data-c', c);
        el.style.left = (step * i).toFixed(1) + 'px';
        row.appendChild(el);
      });
      hw.appendChild(row);
    });
  }

  // ----- 选牌：点一下或者划过去都会切换；划过去的牌都变成和第一张一样的状态 -----
  var drag = null;
  function cardAt(ev) {
    var el = document.elementFromPoint(ev.clientX, ev.clientY);
    while (el && el !== root && !(el.getAttribute && el.getAttribute('data-c') !== null && el.classList.contains('hc'))) el = el.parentNode;
    return el && el !== root ? el : null;
  }
  function setSel(el, on) {
    var c = Number(el.getAttribute('data-c'));
    if (on) T.sel[c] = true; else delete T.sel[c];
    el.classList.toggle('sel', on);
  }
  root.addEventListener('pointerdown', function (ev) {
    if (!myTurn() || T.g.status !== 'playing') return;
    var el = cardAt(ev);
    if (!el) return;
    ev.preventDefault();
    var on = !T.sel[Number(el.getAttribute('data-c'))];
    drag = { on: on, id: ev.pointerId };
    setSel(el, on);
    T.hintI = -1;
  });
  root.addEventListener('pointermove', function (ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    var el = cardAt(ev);
    if (el && el.classList.contains('sel') !== drag.on) setSel(el, drag.on);
  });
  function endDrag(ev) { if (drag && (!ev || ev.pointerId === drag.id)) { drag = null; render(); } }
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);

  function onHint() {
    var D = T.D, hand = shownHand();
    if (!hand) return;
    var key = hand.join(',') + '|' + (D.lastPlay ? D.lastPlay.cards.join(',') : '');
    if (key !== T.hintKey) { T.hintKey = key; T.hintI = -1; }
    var list = hints(hand, D.lastPlay ? D.lastPlay.cards : null, rules());
    if (!list.length) { toast('没有能压住的牌'); return; }
    T.hintI = (T.hintI + 1) % list.length;
    T.sel = {};
    list[T.hintI].forEach(function (c) { T.sel[c] = true; });
    render();
  }

  // ----- 动作 -----
  function doAct(body) {
    if (T.busy) return;
    T.busy = true; render();
    host.act(body).then(function (r) {
      T.busy = false;
      if (r && r.error) toast(errText({ message: r.error }));
      else if (body.action === 'play') { T.sel = {}; T.hintI = -1; }
      if (!T.dead) render();
    });
  }
  function doPlay() {
    var hand = shownHand();
    if (!hand) return;
    var cards = selCards(hand);
    doAct({ action: 'play', cards: cards });
  }

  // ----- 倒计时圈（每 250ms 更新）+ 超时 tick（谁在看谁就发，服务器只认第一个）-----
  function updateUi() {
    var x = T.g, D = T.D;
    if (T.dead || !x || !D || !live() || !idle()) return;
    var seat = D.turn;
    var el = root.querySelector('.ddz-seat[data-seat="' + seat + '"]');
    var total = (x.status === 'bidding' ? BID_TOTAL : PLAY_TOTAL) * 1000;
    var dl = x.deadline ? Date.parse(x.deadline) : NaN;
    if (el) el.classList.add('turn');
    if (!Number.isFinite(dl)) return;
    var left = dl - nowMs();
    if (el) {
      var circle = el.querySelector('.ddz-ring circle'), sec = el.querySelector('.ddz-sec');
      var f = Math.max(0, Math.min(1, left / total));
      if (circle) circle.setAttribute('stroke-dashoffset', (RING_C * (1 - f)).toFixed(2));
      if (sec) { sec.hidden = false; sec.textContent = String(Math.max(0, Math.ceil(left / 1000))); }
      el.classList.toggle('urgent', left < 6000);
    }
    // 过了截止时间：任何在看的客户端都可以催一下（带一点随机延迟，错开）；失败（还没到点 / 别人先催了）每 2 秒再试
    if (left < -700 && (T.tickV !== x.version || nowMs() - T.tickAt > 2500)) {
      T.tickV = x.version; T.tickAt = nowMs() + Math.random() * 600;
      host.act({ action: 'tick' });
    }
  }
  T.ui = setInterval(updateUi, 250);

  // ----- 大厅 -----
  function renderLobby() {
    var x = T.g;
    var lb = h('div', { class: 'ddz-lobby' });
    lb.appendChild(h('div', { class: 'ddz-title', text: x.status === 'closed' ? '这桌已关闭' : '斗地主' }));
    lb.appendChild(h('div', { class: 'ddz-sub', text: x.status === 'closed' ? '回到聊天，再开一桌吧' : '3 到 4 人一桌，人不够开始时自动补机器人' }));
    var sc = host.scores();
    var m = mySeat(), filled = 0, humans = 0;
    [0, 1, 2, 3].forEach(function (s) {
      if (x.seats[s] || x.bots[s]) filled++;
      if (x.seats[s]) humans++;
      var row = h('div', { class: 'ddz-lrow' + (x.seats[s] || x.bots[s] ? ' on' : '') });
      row.appendChild(h('div', { class: 'ddz-lav' }, x.seats[s] || x.bots[s] ? avatarOfSeat(s, 48) : h('span', { class: 'ddz-empty', text: String(s + 1) })));
      var nm = h('div', { class: 'ddz-lnm' }, h('b', { text: x.seats[s] || x.bots[s] ? nameOfSeat(s) : '空位' }));
      if (x.seats[s]) {
        var r = sc[x.seats[s]];
        nm.appendChild(h('span', { class: 'ddz-lsub', text: r ? '累计 ' + (r.total > 0 ? '+' : '') + r.total + '，' + r.games + ' 局' : '还没打过' }));
      } else if (x.bots[s]) nm.appendChild(h('span', { class: 'ddz-lsub', text: '机器人' }));
      row.appendChild(nm);
      var ops = h('div', { class: 'ddz-lops' });
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
        // 按钮上写清楚会发生什么：不足 3 人补机器人到 3 人；3 人三人局；4 人四人局
        var label = filled >= 4 ? '开始（四人局）' : filled === 3 ? '开始（三人局）' : '开始（三人局，补 ' + (3 - filled) + ' 个机器人）';
        var st = lbtn(label, 'btn ddz-start', function () { host.start(); });
        st.disabled = humans < 1;
        lb.appendChild(st);
      } else lb.appendChild(h('div', { class: 'ddz-sub', text: filled >= 4 ? '人满了，等他们开始' : '你可以坐到空位上一起玩' }));
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
    var x = T.g, pub = x.pub, me = mySeat();
    var shade = h('div', { class: 'ddz-shade' });
    var sh = h('div', { class: 'ddz-sheet', role: 'dialog', 'aria-label': '结算' });
    var L = pub.landlord;
    var n = pub.players === 4 ? 4 : 3;
    var iWin = me >= 0 ? ((pub.winner === 'landlord') === (me === L)) : null;
    sh.appendChild(h('div', { class: 'ddz-res ' + (iWin === null ? '' : iWin ? 'win' : 'lose'), text: iWin === null ? (pub.winner === 'landlord' ? '地主赢了' : '农民赢了') : iWin ? '你赢了' : '你输了' }));
    sh.appendChild(h('div', { class: 'ddz-res-sub', text: (pub.winner === 'landlord' ? '地主' : '农民') + '获胜' + (pub.spring ? (pub.winner === 'landlord' ? '，春天' : '，反春') : '') }));
    var list = h('div', { class: 'ddz-rrows' });
    for (var s = 0; s < n; s++) {
      var row = h('div', { class: 'ddz-rrow' + (s === me ? ' me' : '') });
      row.appendChild(h('div', { class: 'ddz-rav' }, avatarOfSeat(s, 40), img(s === L ? 'ddz/badge-landlord.png' : 'ddz/badge-farmer.png', 'ddz-role', s === L ? '地主' : '农民')));
      row.appendChild(h('div', { class: 'ddz-rnm' }, h('b', { text: nameOfSeat(s) }), h('span', { text: (s === L ? '地主' : '农民') + (pub.finalHands ? '，剩 ' + pub.finalHands[s].length + ' 张' : '') })));
      var d = pub.scores[s];
      row.appendChild(h('div', { class: 'ddz-rsc ' + (d > 0 ? 'pos' : 'neg'), text: (d > 0 ? '+' : '') + d }));
      list.appendChild(row);
    }
    sh.appendChild(list);
    var bombs = pub.bombs, kings = 0;
    (pub.log || []).forEach(function (e) { if (e.kind === 'play' && n === 4 && e.cards.length === 4 && classify(e.cards, { players: 4 }).type === 'rocket') kings++; });
    var bt = bombs ? bombs + ' 个' + (kings ? '（天王炸 ' + kings + '）' : '') + ' ×' + Math.pow(2, bombs) : '无';
    var springText = pub.spring ? (pub.winner === 'landlord' ? '春天 ×2' : '反春 ×2') : '无';
    sh.appendChild(h('div', { class: 'ddz-mulx' },
      h('span', { text: '叫分 ' + pub.bid }),
      h('i', { text: '×' }), h('span', { text: '炸弹 ' + bt }),
      h('i', { text: '×' }), h('span', { text: springText }),
      h('i', { text: '=' }), h('b', { text: pub.multiplier + ' 倍' })));
    sh.appendChild(h('div', { class: 'ddz-share', text: '地主 ' + (n - 1) + ' 份，每个农民 1 份' }));
    // 本群 / 你们的累计（桌上的真人）
    var sc = host.scores(), tot = h('div', { class: 'ddz-tot' }, h('div', { class: 'ddz-tot-h', text: host.dm ? '你们的累计' : '本群累计' }));
    var any = false;
    x.seats.forEach(function (u) {
      if (!u) return;
      var r = sc[u];
      any = true;
      var p = host.person(u);
      tot.appendChild(h('div', { class: 'ddz-tot-r' }, h('span', { text: p ? p.nickname : '好友' }), h('b', { text: r ? (r.total > 0 ? '+' : '') + r.total : '…' }), h('em', { text: r ? r.games + ' 局 ' + r.wins + ' 胜' : '' })));
    });
    if (any) sh.appendChild(tot);
    var ops = h('div', { class: 'ddz-sheet-ops' });
    if (me >= 0) {
      var again = lbtn('再来一局', 'btn', function () { host.rematch(); });
      ops.appendChild(again);
    }
    ops.appendChild(lbtn('离开', 'btn ghost', function () { host.leave(); }));
    sh.appendChild(ops);
    var peek = lbtn('收起', 'ddz-peek', function () { T.sheet = false; T.sheetHidden = true; render(); });
    sh.appendChild(peek);
    shade.appendChild(sh);
    root.appendChild(shade);
  }

  // ----- 对外 -----
  var api = {
    update: function (game, initial) {
      var prevStatus = T.g && T.g.status, prevRound = T.g && T.g.pub && T.g.pub.round;
      T.g = game;
      if (game.status === 'waiting' || game.status === 'closed') { T.D = null; T.queue = []; clearTimeout(T.tm); T.tm = 0; T.sheet = false; render(); return; }
      var wasStart = prevStatus === 'waiting' && (game.status === 'bidding' || game.status === 'playing');
      var rematch = prevStatus === 'over' && (game.status === 'bidding' || game.status === 'playing') && prevRound !== (game.pub && game.pub.round);
      if (wasStart || rematch) { T.D = null; T.sheet = false; T.sheetHidden = false; }
      feed(!!initial && !wasStart && !rematch);
    },
    setHand: function () { if (!T.dead && T.g && T.D) render(); },
    setScores: function () { if (!T.dead && T.sheet) render(); },
    resize: function () { if (!T.dead && T.g && T.D) render(); },
    destroy: function () { T.dead = true; clearTimeout(T.tm); clearTimeout(T.fxTm); clearInterval(T.ui); T.queue = []; }
  };
  return api;
}
