// 自动生成，不要手改：来源 chat/js/miniapps/ddz-rules.js，由 supabase/functions/ddz/gen-rules.py 生成
// 斗地主规则引擎 + 机器人（纯逻辑：无 DOM、无 import、无 Date.now / Math.random）
// 浏览器和 Supabase Edge Function 共用；Edge Function 用的是 gen-rules.py 生成的副本。
// 牌编码 0..53：c<52 时 rank=floor(c/4)（3,4,...,K,A,2 对应 0..12），suit=c%4；52 小王(rank13)，53 大王(rank14)。

export const DDZ_RULES_VERSION = 1;

const LABELS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '小王', '大王'];

export function rankOf(c) { return c >= 52 ? c - 39 : c >> 2; }
export function suitOf(c) { return c % 4; }
export function cardLabel(c) { return LABELS[rankOf(c)]; }
// 手牌显示顺序：点数从大到小，同点数按花色从大到小
export function sortHand(cards) { return cards.slice().sort((a, b) => rankOf(b) - rankOf(a) || b - a); }

// 洗牌：Fisher-Yates，随机只来自注入的 rng()
export function shuffleDeck(rng) {
  const d = [];
  for (let i = 0; i < 54; i++) d.push(i);
  for (let i = 53; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = d[i]; d[i] = d[j]; d[j] = t;
  }
  return d;
}

export function deal(rng) {
  const d = shuffleDeck(rng);
  return {
    hands: [sortHand(d.slice(0, 17)), sortHand(d.slice(17, 34)), sortHand(d.slice(34, 51))],
    bottom: sortHand(d.slice(51, 54))
  };
}

function countRanks(cards) {
  const cnt = new Array(15).fill(0);
  for (const c of cards) cnt[rankOf(c)]++;
  return cnt;
}

function validCards(cards) {
  if (!Array.isArray(cards) || !cards.length) return false;
  const seen = new Set();
  for (const c of cards) {
    if (!Number.isInteger(c) || c < 0 || c > 53 || seen.has(c)) return false;
    seen.add(c);
  }
  return true;
}

// ---------- 牌型识别 ----------
// 返回 null（不合法）或 { type, rank, len }：rank 是比较用的主牌点数，len 是连续长度（顺子=张数，连对=对数，飞机=三条数）。
// 顺子/连对/飞机只能用 3..A（rank 0..11），2 和王不能连。
// 歧义处理：把所有合法解释都列出来，取「主牌 rank 最大」的，rank 相同取 len 更长的。
//   例：333444555666 既是 4 连飞机（rank 3，len 4），也能当 3 连飞机带 3 张单牌（444555666 带 333，rank 同为 6）
//   → rank 相同取更长的，所以是 plane len 4。
//   333444555 带 666 的解释主牌是 555，比 444555666 带 333 小，不会被选。
// 飞机带单：翅膀不能是双王（火箭）；允许翅膀里带三条里拆出的牌（比如 3333+444 带 3、5）。
// 四带二：两张可以是对子，不能是双王；四带两对：两对点数必须成对（允许 4444 5555 这种）。
export function classify(cards) {
  if (!validCards(cards)) return null;
  const n = cards.length;
  const cnt = countRanks(cards);
  if (n === 1) return { type: 'single', rank: rankOf(cards[0]), len: 1 };
  if (n === 2) {
    if (cnt[13] && cnt[14]) return { type: 'rocket', rank: 14, len: 1 };
    for (let r = 0; r <= 12; r++) if (cnt[r] === 2) return { type: 'pair', rank: r, len: 1 };
    return null;
  }
  if (n === 3) {
    for (let r = 0; r <= 12; r++) if (cnt[r] === 3) return { type: 'trio', rank: r, len: 1 };
    return null;
  }
  if (n === 4) {
    for (let r = 0; r <= 12; r++) {
      if (cnt[r] === 4) return { type: 'bomb', rank: r, len: 1 };
      if (cnt[r] === 3) return { type: 'trio1', rank: r, len: 1 };
    }
    return null;
  }
  let best = null;
  const consider = (type, rank, len) => {
    if (!best || rank > best.rank || (rank === best.rank && len > best.len)) best = { type, rank, len };
  };
  if (n === 5) {
    for (let r = 0; r <= 12; r++) {
      if (cnt[r] === 3) {
        for (let q = 0; q <= 12; q++) if (cnt[q] === 2) consider('trio2', r, 1);
      }
    }
  }
  // 顺子 / 连对
  let top = -1, low = 99, kinds = 0, maxc = 0, minc = 9;
  for (let r = 0; r < 15; r++) {
    if (!cnt[r]) continue;
    kinds++;
    if (r > top) top = r;
    if (r < low) low = r;
    if (cnt[r] > maxc) maxc = cnt[r];
    if (cnt[r] < minc) minc = cnt[r];
  }
  if (top <= 11 && top - low + 1 === kinds && minc === maxc) {
    if (maxc === 1 && n >= 5) consider('straight', top, n);
    if (maxc === 2 && n >= 6) consider('pairs', top, n / 2);
  }
  // 飞机：枚举连续三条的起点和长度
  for (let s = 0; s <= 11; s++) {
    for (let k = 1; s + k - 1 <= 11 && cnt[s + k - 1] >= 3; k++) {
      if (k < 2) continue;
      const rest = n - 3 * k;
      if (rest < 0) break;
      const w = cnt.slice();
      for (let r = s; r < s + k; r++) w[r] -= 3;
      const t = s + k - 1;
      if (rest === 0) consider('plane', t, k);
      else if (rest === k) { if (!(w[13] && w[14])) consider('plane1', t, k); }
      else if (rest === 2 * k) {
        let even = true;
        for (let r = 0; r < 15; r++) if (w[r] % 2) even = false;
        if (even) consider('plane2', t, k);
      }
    }
  }
  // 四带二 / 四带两对
  if (n === 6 || n === 8) {
    for (let r = 0; r <= 12; r++) {
      if (cnt[r] !== 4) continue;
      const w = cnt.slice();
      w[r] = 0;
      if (n === 6) { if (!(w[13] && w[14])) consider('four2', r, 1); }
      else {
        let even = true;
        for (let q = 0; q < 15; q++) if (w[q] % 2) even = false;
        if (even) consider('four22', r, 1);
      }
    }
  }
  return best;
}

// cards 能否压过 prevCards（prevCards 为空 = 自己领出，只要合法）
export function beats(cards, prevCards) {
  const a = classify(cards);
  if (!a) return false;
  if (!prevCards || !prevCards.length) return true;
  const b = classify(prevCards);
  if (!b) return false;
  if (b.type === 'rocket') return false;
  if (a.type === 'rocket') return true;
  if (a.type === 'bomb') return b.type !== 'bomb' || a.rank > b.rank;
  if (b.type === 'bomb') return false;
  return a.type === b.type && a.len === b.len && a.rank > b.rank;
}

// ---------- 提示 ----------
function groupHand(hand) {
  const by = [];
  for (let r = 0; r < 15; r++) by.push([]);
  for (const c of hand) by[rankOf(c)].push(c);
  for (const a of by) a.sort((x, y) => x - y);
  return by;
}

// 拆牌代价：用了某点数的一部分牌（拆炸弹/三条/对子）要加罚分
function breakPen(cards, by) {
  const used = {};
  for (const c of cards) { const r = rankOf(c); used[r] = (used[r] || 0) + 1; }
  let p = 0;
  for (const r in used) {
    const t = by[r].length;
    if (used[r] < t) p += t === 4 ? 6 : t === 3 ? 4.5 : 1.5;
  }
  return p;
}

// 从最便宜到最强。prevCards 为空时返回一组有代表性的领出（数量有界）；否则是所有能压过的（带牌只取最便宜的一两种）。
export function hints(hand, prevCards) {
  const by = groupHand(hand);
  const cnt = by.map(a => a.length);
  const hasPrev = !!(prevCards && prevCards.length);
  const pv = hasPrev ? classify(prevCards) : null;
  if (hasPrev && !pv) return [];
  const out = [];
  const seen = new Set();
  const add = (cards) => {
    if (!cards) return;
    const info = classify(cards);
    if (!info) return;
    if (pv && !beats(cards, prevCards)) return;
    const id = cards.slice().sort((x, y) => x - y).join(',');
    if (seen.has(id)) return;
    seen.add(id);
    let k;
    if (info.type === 'bomb') k = 100 + info.rank;
    else if (info.type === 'rocket') k = 200;
    else {
      let sum = 0;
      for (const c of cards) sum += rankOf(c);
      k = info.rank + breakPen(cards, by) + sum * 0.001 - (pv ? 0 : 0.4 * (cards.length - 1));
    }
    out.push({ cards: sortHand(cards), k });
  };
  const want = (t) => !pv || pv.type === t;
  const lenOk = (l) => !pv || pv.len === l;
  // 带牌：最便宜的 k 张单牌 / k 对
  const kSingles = (ex, k) => {
    const units = [];
    for (let r = 0; r < 15; r++) {
      if (ex.has(r) || !cnt[r]) continue;
      units.push({ r, key: r + (cnt[r] === 1 ? 0 : cnt[r] === 2 ? 2 : cnt[r] === 3 ? 4 : 8) });
    }
    units.sort((a, b) => a.key - b.key);
    const picked = [];
    for (const u of units) { if (picked.length < k) picked.push(by[u.r][0]); }
    for (const u of units) {
      for (let i = 1; i < cnt[u.r] && picked.length < k; i++) picked.push(by[u.r][i]);
    }
    return picked.length === k ? picked : null;
  };
  const kPairs = (ex, k) => {
    const units = [];
    for (let r = 0; r <= 12; r++) {
      if (ex.has(r) || cnt[r] < 2) continue;
      units.push({ r, key: r + (cnt[r] >= 3 ? 3 : 0) });
    }
    units.sort((a, b) => a.key - b.key);
    if (units.length < k) return null;
    const picked = [];
    for (let i = 0; i < k; i++) picked.push(by[units[i].r][0], by[units[i].r][1]);
    return picked;
  };
  const chainCards = (s, len, take) => {
    const cs = [];
    for (let r = s; r < s + len; r++) for (let i = 0; i < take; i++) cs.push(by[r][i]);
    return cs;
  };
  const chains = (minCnt, minLen, cb) => {
    for (let s = 0; s <= 11; s++) {
      let e = s;
      while (e <= 11 && cnt[e] >= minCnt) e++;
      for (let len = minLen; len <= e - s; len++) cb(s, len);
    }
  };

  if (want('single')) for (let r = 0; r < 15; r++) if (cnt[r]) add([by[r][0]]);
  if (want('pair')) for (let r = 0; r <= 12; r++) if (cnt[r] >= 2) add(by[r].slice(0, 2));
  for (let r = 0; r <= 12; r++) {
    if (cnt[r] < 3) continue;
    const t = by[r].slice(0, 3);
    const ex = new Set([r]);
    if (want('trio')) add(t);
    if (want('trio1')) { const k = kSingles(ex, 1); if (k) add(t.concat(k)); }
    if (want('trio2')) { const k = kPairs(ex, 1); if (k) add(t.concat(k)); }
  }
  if (want('straight')) chains(1, 5, (s, len) => { if (lenOk(len)) add(chainCards(s, len, 1)); });
  if (want('pairs')) chains(2, 3, (s, len) => { if (lenOk(len)) add(chainCards(s, len, 2)); });
  if (want('plane') || want('plane1') || want('plane2')) {
    chains(3, 2, (s, len) => {
      if (!lenOk(len)) return;
      const body = chainCards(s, len, 3);
      const ex = new Set();
      for (let r = s; r < s + len; r++) ex.add(r);
      if (want('plane')) add(body);
      if (want('plane1')) { const k = kSingles(ex, len); if (k) add(body.concat(k)); }
      if (want('plane2')) { const k = kPairs(ex, len); if (k) add(body.concat(k)); }
    });
  }
  if (want('four2') || want('four22')) {
    for (let r = 0; r <= 12; r++) {
      if (cnt[r] !== 4) continue;
      const ex = new Set([r]);
      if (want('four2')) { const k = kSingles(ex, 2); if (k) add(by[r].concat(k)); }
      if (want('four22')) { const k = kPairs(ex, 2); if (k) add(by[r].concat(k)); }
    }
  }
  for (let r = 0; r <= 12; r++) if (cnt[r] === 4) add(by[r].slice());
  if (cnt[13] && cnt[14]) add([by[13][0], by[14][0]]);
  out.sort((a, b) => a.k - b.k);
  return out.map(o => o.cards);
}

// ---------- 状态机 ----------
function cloneState(s) {
  return Object.assign({}, s, {
    hands: s.hands.map(h => h.slice()),
    bottom: s.bottom ? s.bottom.slice() : s.bottom,
    bids: s.bids.slice(),
    played: s.played.map(a => a.slice()),
    playCounts: s.playCounts.slice(),
    log: s.log.slice(),
    scores: s.scores ? s.scores.slice() : null
  });
}

export function newGame(opts) {
  const o = opts || {};
  const first = Number.isInteger(o.firstSeat) ? ((o.firstSeat % 3) + 3) % 3 : 0;
  const d = deal(o.rng);
  return {
    phase: 'bidding',
    hands: d.hands,
    bottom: d.bottom,
    bids: [null, null, null],
    bidTurnCount: 0,
    bidStart: first,
    turn: first,
    landlord: null,
    bid: 0,
    lastPlay: null,
    passCount: 0,
    played: [[], [], []],
    playCounts: [0, 0, 0],
    bombs: 0,
    redeals: 0,
    winner: null,
    spring: false,
    multiplier: 1,
    scores: null,
    log: []
  };
}

function err(code) { return { ok: false, error: code }; }

function decideLandlord(s, seat, bidValue) {
  s.landlord = seat;
  s.bid = bidValue;
  s.hands[seat] = sortHand(s.hands[seat].concat(s.bottom));
  s.phase = 'playing';
  s.turn = seat;
  s.lastPlay = null;
  s.passCount = 0;
  s.multiplier = bidValue;
  s.log.push({ seat, kind: 'landlord', value: bidValue });
}

function finish(s, seat) {
  s.phase = 'over';
  s.winner = seat === s.landlord ? 'landlord' : 'farmers';
  const L = s.landlord;
  const farmersPlayed = s.playCounts.some((n, i) => i !== L && n > 0);
  s.spring = s.winner === 'landlord' ? !farmersPlayed : s.playCounts[L] <= 1;
  s.multiplier = s.bid * Math.pow(2, s.bombs) * (s.spring ? 2 : 1);
  const m = s.multiplier;
  const sc = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (i === L) sc[i] = s.winner === 'landlord' ? 2 * m : -2 * m;
    else sc[i] = s.winner === 'landlord' ? -m : m;
  }
  s.scores = sc;
}

export function canPass(state, seat) {
  return !!state && state.phase === 'playing' && state.turn === seat && state.lastPlay !== null;
}

export function apply(state, seat, action, rng) {
  if (!state || !action || typeof action !== 'object') return err('bad_phase');
  if (state.phase === 'over') return err('bad_phase');
  if (seat !== state.turn) return err('not_your_turn');
  const kind = action.kind;
  if (state.phase === 'bidding') {
    if (kind !== 'bid') return err('bad_phase');
    const v = action.value;
    if (!Number.isInteger(v) || v < 0 || v > 3) return err('bad_bid');
    if (v !== 0 && v <= state.bid) return err('bad_bid');
    const s = cloneState(state);
    s.bids[seat] = v;
    s.bidTurnCount++;
    if (v > 0) s.bid = v;
    s.log.push({ seat, kind: 'bid', value: v });
    if (v === 3) { decideLandlord(s, seat, 3); return { ok: true, state: s }; }
    if (s.bidTurnCount >= 3) {
      if (s.bid > 0) {
        let who = 0;
        for (let i = 0; i < 3; i++) if (s.bids[i] === s.bid) who = i;
        decideLandlord(s, who, s.bid);
      } else if (s.redeals >= 3) {
        decideLandlord(s, s.bidStart, 1);
      } else {
        if (typeof rng !== 'function') return err('no_rng');
        const d = deal(rng);
        s.hands = d.hands;
        s.bottom = d.bottom;
        s.redeals++;
        s.bidStart = (s.bidStart + 1) % 3;
        s.turn = s.bidStart;
        s.bids = [null, null, null];
        s.bidTurnCount = 0;
        s.bid = 0;
        s.log.push({ seat: s.bidStart, kind: 'redeal' });
      }
      return { ok: true, state: s };
    }
    s.turn = (seat + 1) % 3;
    return { ok: true, state: s };
  }
  // playing
  if (kind === 'pass') {
    if (!canPass(state, seat)) return err('cannot_pass');
    const s = cloneState(state);
    s.passCount++;
    s.log.push({ seat, kind: 'pass' });
    if (s.passCount >= 2) {
      s.turn = s.lastPlay.seat;
      s.lastPlay = null;
      s.passCount = 0;
    } else s.turn = (seat + 1) % 3;
    return { ok: true, state: s };
  }
  if (kind !== 'play') return err('bad_phase');
  const cards = action.cards;
  if (!Array.isArray(cards) || !cards.length || !cards.every(Number.isInteger)) return err('illegal_combo');
  if (new Set(cards).size !== cards.length) return err('illegal_combo');
  const hand = state.hands[seat];
  for (const c of cards) if (hand.indexOf(c) < 0) return err('not_in_hand');
  const info = classify(cards);
  if (!info) return err('illegal_combo');
  if (state.lastPlay && !beats(cards, state.lastPlay.cards)) return err('too_small');
  const s = cloneState(state);
  const drop = new Set(cards);
  s.hands[seat] = hand.filter(c => !drop.has(c));
  const sorted = sortHand(cards);
  s.played[seat] = s.played[seat].concat(sorted);
  s.playCounts[seat]++;
  if (info.type === 'bomb' || info.type === 'rocket') s.bombs++;
  s.multiplier = s.bid * Math.pow(2, s.bombs);
  s.lastPlay = { seat, cards: sorted, type: info.type };
  s.passCount = 0;
  s.log.push({ seat, kind: 'play', cards: sorted });
  if (!s.hands[seat].length) finish(s, seat);
  else s.turn = (seat + 1) % 3;
  return { ok: true, state: s };
}

// 给某个玩家看的状态：别人的手牌换成张数；叫牌阶段底牌不可见
export function publicView(state, viewerSeat) {
  const v = cloneState(state);
  v.handCounts = state.hands.map(h => h.length);
  v.myHand = Number.isInteger(viewerSeat) && viewerSeat >= 0 && viewerSeat < 3 ? state.hands[viewerSeat].slice() : null;
  delete v.hands;
  if (state.phase === 'bidding') v.bottom = null;
  return v;
}

// ---------- 机器人 ----------
// 手牌强度 → 叫分
function handStrength(hand) {
  const cnt = countRanks(hand);
  let s = 0;
  if (cnt[14]) s += 3.5;
  if (cnt[13]) s += 2.5;
  if (cnt[13] && cnt[14]) s += 2;
  s += cnt[12] * 1.8;
  s += cnt[11] * 0.7;
  s += cnt[10] * 0.2;
  let run = 0, best = 0, trios = 0;
  for (let r = 0; r <= 12; r++) {
    if (cnt[r] === 4) s += 3;
    if (cnt[r] === 3) trios++;
    if (r <= 11 && cnt[r] > 0) { run++; if (run > best) best = run; } else run = 0;
  }
  if (best >= 6) s += 1;
  if (best >= 8) s += 1;
  s += trios * 0.4;
  return s;
}

function bidFor(hand, cur) {
  const st = handStrength(hand);
  const want = st >= 11 ? 3 : st >= 8 ? 2 : st >= 5 ? 1 : 0;
  return want > cur ? want : 0;
}

// 把手牌拆成若干出牌组合，选「手数」最少的拆法
function decompose(hand) {
  const by0 = groupHand(hand);
  const fixed = [];
  const push = (list, cards) => { const i = classify(cards); list.push({ cards, type: i.type, rank: i.rank, len: i.len }); };
  if (by0[13].length && by0[14].length) { push(fixed, [by0[13][0], by0[14][0]]); by0[13] = []; by0[14] = []; }
  for (let r = 0; r <= 12; r++) if (by0[r].length === 4) { push(fixed, by0[r].slice()); by0[r] = []; }
  const extract = (rem, out, minCnt, take, minLen) => {
    for (;;) {
      let bs = -1, bl = 0;
      for (let s = 0; s <= 11;) {
        if (rem[s].length >= minCnt) {
          let e = s;
          while (e <= 11 && rem[e].length >= minCnt) e++;
          if (e - s >= minLen && e - s > bl) { bs = s; bl = e - s; }
          s = e;
        } else s++;
      }
      if (bs < 0) return;
      const cs = [];
      for (let r = bs; r < bs + bl; r++) cs.push(...rem[r].splice(0, take));
      push(out, cs);
    }
  };
  const orders = [['plane', 'straight', 'pairs'], ['plane', 'pairs', 'straight'], ['plane']];
  let bestList = null, bestScore = 1e9;
  for (const order of orders) {
    const rem = by0.map(a => a.slice());
    const list = [];
    for (const step of order) {
      if (step === 'plane') extract(rem, list, 3, 3, 2);
      else if (step === 'straight') extract(rem, list, 1, 1, 5);
      else extract(rem, list, 2, 2, 3);
    }
    for (let r = 0; r < 15; r++) {
      const n = rem[r].length;
      if (n === 3) push(list, rem[r]);
      else if (n === 2) push(list, rem[r]);
      else if (n === 1) push(list, rem[r]);
    }
    let loose = 0, cap = 0;
    for (const c of list) {
      if (c.type === 'single' || c.type === 'pair') loose++;
      else if (c.type === 'trio') cap++;
      else if (c.type === 'plane') cap += c.len;
    }
    const score = list.length - Math.min(loose, cap);
    if (score < bestScore) { bestScore = score; bestList = list; }
  }
  return { fixed, list: bestList };
}

// 其他对手的最少手牌数（地主的对手是两个农民；农民的对手只有地主）
function opponentMin(state, seat) {
  let m = 99;
  for (let i = 0; i < 3; i++) {
    if (i === seat) continue;
    if (seat !== state.landlord && i !== state.landlord) continue;
    if (state.hands[i].length < m) m = state.hands[i].length;
  }
  return m;
}

function lowestKey(a) { return a.rank; }

function leadPlay(state, seat, hand) {
  if (classify(hand)) return hand.slice();
  const { fixed, list } = decompose(hand);
  const singles = list.filter(c => c.type === 'single' && c.rank < 12).sort((a, b) => lowestKey(a) - lowestKey(b));
  const pairs = list.filter(c => c.type === 'pair' && c.rank < 12).sort((a, b) => lowestKey(a) - lowestKey(b));
  const opts = [];
  for (const c of list) {
    if (c.type === 'trio') {
      if (singles.length) opts.push({ cards: c.cards.concat(singles[0].cards), rank: c.rank, type: 'trio1' });
      else if (pairs.length) opts.push({ cards: c.cards.concat(pairs[0].cards), rank: c.rank, type: 'trio2' });
      else opts.push({ cards: c.cards, rank: c.rank, type: 'trio' });
    } else if (c.type === 'plane') {
      if (singles.length >= c.len) {
        let k = [];
        for (let i = 0; i < c.len; i++) k = k.concat(singles[i].cards);
        opts.push({ cards: c.cards.concat(k), rank: c.rank, type: 'plane1' });
      } else if (pairs.length >= c.len) {
        let k = [];
        for (let i = 0; i < c.len; i++) k = k.concat(pairs[i].cards);
        opts.push({ cards: c.cards.concat(k), rank: c.rank, type: 'plane2' });
      } else opts.push({ cards: c.cards, rank: c.rank, type: 'plane' });
    } else opts.push({ cards: c.cards, rank: c.rank, type: c.type });
  }
  let pool = opts.filter(o => o.type !== 'bomb' && o.type !== 'rocket');
  const oppMin = opponentMin(state, seat);
  if (pool.length) {
    if (oppMin === 1) {
      const f = pool.filter(o => o.type !== 'single');
      if (f.length) pool = f;
      else {
        // 只剩单张：对手剩一张，出最大的单张
        let hi = pool[0];
        for (const o of pool) if (o.rank > hi.rank) hi = o;
        return hi.cards;
      }
    } else if (oppMin === 2) {
      const f = pool.filter(o => o.type !== 'pair');
      if (f.length) pool = f;
    }
    let best = pool[0], bk = 1e9;
    for (const o of pool) {
      // 农民更看重一手多出牌（尽快跑牌），地主更看重出小牌；自博弈把地主胜率压到 55~60%
      const k = o.rank - (seat === state.landlord ? 0.4 : 3) * (o.cards.length - 1);
      if (k < bk) { bk = k; best = o; }
    }
    return best.cards;
  }
  // 只剩炸弹 / 火箭：先出最小的炸弹
  fixed.sort((a, b) => (a.type === 'rocket' ? 99 : a.rank) - (b.type === 'rocket' ? 99 : b.rank));
  return fixed[0].cards;
}

function followPlay(state, seat, hand) {
  const prev = state.lastPlay;
  const pinfo = classify(prev.cards);
  const cands = hints(hand, prev.cards);
  if (!cands.length) return null;
  for (const c of cands) if (c.length === hand.length) return c; // 能出完就出
  const isBomb = (c) => { const t = classify(c).type; return t === 'bomb' || t === 'rocket'; };
  const normal = cands.filter(c => !isBomb(c));
  const bombs = cands.filter(isBomb);
  const L = state.landlord;
  const mate = seat !== L && prev.seat !== L;
  const oppMin = opponentMin(state, seat);
  if (mate) {
    // 队友出的牌：除非地主只差一手就能走且这手牌很小，否则不压
    const lc = state.hands[L].length;
    if (lc <= 2 && lc === prev.cards.length && (prev.type === 'single' || prev.type === 'pair') && pinfo.rank <= 9 && normal.length) {
      return normal[normal.length - 1];
    }
    return null;
  }
  if (normal.length) {
    const c = normal[0];
    const info = classify(c);
    // 不用 2 / 王去压很小的单张或对子，除非对手快跑完了
    // （农民压地主不受此限：地主牌多时压住他才有机会抢出牌权）
    if (seat === L && info.rank >= 12 && pinfo.rank < 8 && (pinfo.type === 'single' || pinfo.type === 'pair') && oppMin > 4) return null;
    return c;
  }
  if (bombs.length) {
    const b = bombs[0];
    const drop = new Set(b);
    const rest = hand.filter(x => !drop.has(x));
    if (oppMin <= 4 || classify(rest) || (seat !== L && state.hands[L].length <= 8)) return b;
  }
  return null;
}

// 返回一个能被 apply 接受的动作；同一个状态结果固定（超时托管也用它）
export function botAction(state, seat) {
  if (state.phase === 'bidding') {
    return { kind: 'bid', value: bidFor(state.hands[seat], state.bid) };
  }
  const hand = state.hands[seat];
  if (!state.lastPlay) {
    const cards = leadPlay(state, seat, hand);
    if (cards && cards.length && classify(cards)) return { kind: 'play', cards: sortHand(cards) };
    // 兜底：最小的一张
    return { kind: 'play', cards: [hand.slice().sort((a, b) => rankOf(a) - rankOf(b) || a - b)[0]] };
  }
  const cards = followPlay(state, seat, hand);
  if (cards) return { kind: 'play', cards: sortHand(cards) };
  return { kind: 'pass' };
}
