// 自动生成，不要手改：来源 chat/js/miniapps/mahjong-rules.js，由 supabase/functions/mahjong/gen-rules.py 生成
// 麻将（推倒胡）规则引擎 + 机器人（纯逻辑：无 DOM、无 import、无 Date.now / Math.random）
// 浏览器和 Supabase Edge Function 共用；Edge Function 用的是 supabase/functions/mahjong/gen-rules.py 生成的副本 rules.gen.js。
//
// ===== 牌 =====
// 136 张：万 / 条 / 筒 各 1 到 9 每种 4 张，东南西北各 4 张，中发白各 4 张；没有花牌。
// 牌编码 0..33：0..8 万，9..17 条，18..26 筒，27..30 东南西北，31..33 中发白。手牌和牌墙都用这个编码（同种牌不区分）。
//
// ===== 一局 =====
// 4 个座位，每人 13 张，庄家第 14 张。出牌顺序 = 座位号递增（0 -> 1 -> 2 -> 3 -> 0）。
// 动作：出牌、吃（只能吃上家，也就是刚打牌那个人的下家吃）、碰、明杠、暗杠、补杠、胡（自摸或点炮）、抢杠胡（别人补杠时胡那张牌）。
// 优先级 胡 > 碰 / 杠 > 吃；几个人都能胡同一张牌时，只有按出牌顺序离打牌人最近的那一个胡（不一炮多响）。
// 杠完从牌墙另一头补一张，补牌后继续出牌。牌墙摸完就是流局。最后一张牌墙牌被摸走后不能再杠。
// 胡牌牌型：4 组面子 + 1 对将，或者七对（只能门清，四张相同的牌算两对）。推倒胡：胡牌没有最低番数要求。
//
// ===== 计分 =====
// 番 = 1（底）+ 碰碰胡 1 + 七对 2 + 混一色 1 + 清一色 2 + 门清 1 + 杠上开花 1 + 抢杠胡 1 + 海底捞月 1
//   碰碰胡：4 组都是刻子 / 杠（没有吃）加一对将；七对不算碰碰胡
//   混一色：只有一种花色（万 / 条 / 筒）加字牌（至少有一张字牌）；清一色：只有一种花色，没有字牌
//   门清：没有吃、碰、明杠、补杠（暗杠可以）；七对一定是门清
//   杠上开花：自己杠牌后补的那一张自摸胡；抢杠胡：别人补杠时胡他补杠的那张牌；海底捞月：摸走牌墙最后一张牌自摸胡
// 自摸：另外三家各付 番 分，赢家得 3 x 番。点炮（含抢杠胡）：打牌 / 补杠的人一个人付 3 x 番。杠不收钱。四家的分数加起来永远是 0。
// 下一局庄家：庄家胡牌或流局，庄家不变；否则下家做庄。

export const MJ_RULES_VERSION = 1;
export const WALL_SIZE = 136;

const SUIT_NAME = ['万', '条', '筒'];
const NUM_NAME = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONOR_NAME = ['东', '南', '西', '北', '中', '发', '白'];

// 0 万 1 条 2 筒 3 字
export function suitOf(t) { return t < 27 ? Math.floor(t / 9) : 3; }
// 花色牌的点数 0..8（字牌返回 -1）
export function numOf(t) { return t < 27 ? t % 9 : -1; }
export function isHonor(t) { return t >= 27; }
export function isTerminal(t) { return t < 27 && (t % 9 === 0 || t % 9 === 8); }
// 一万 / 二条 / 东 / 中
export function tileName(t) { return t < 27 ? NUM_NAME[t % 9] + SUIT_NAME[Math.floor(t / 9)] : HONOR_NAME[t - 27]; }
export function sortTiles(a) { return a.slice().sort(function (x, y) { return x - y; }); }

export function toCounts(tiles) {
  const c = [];
  for (let i = 0; i < 34; i++) c.push(0);
  for (let i = 0; i < tiles.length; i++) c[tiles[i]]++;
  return c;
}

// 洗牌：Fisher-Yates，随机只来自注入的 rng()（[0,1)）
export function shuffleWall(rng) {
  const d = [];
  for (let t = 0; t < 34; t++) for (let k = 0; k < 4; k++) d.push(t);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const x = d[i]; d[i] = d[j]; d[j] = x;
  }
  return d;
}

// ===== 胡牌判断 =====
// 把 c（计数，会临时修改再还原）里剩下的牌全部拆成刻子 / 顺子
function allMelds(c) {
  let i = 0;
  while (i < 34 && c[i] === 0) i++;
  if (i >= 34) return true;
  if (c[i] >= 3) {
    c[i] -= 3;
    const ok = allMelds(c);
    c[i] += 3;
    if (ok) return true;
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    const ok2 = allMelds(c);
    c[i]++; c[i + 1]++; c[i + 2]++;
    if (ok2) return true;
  }
  return false;
}
function stdWin(c) {
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const ok = allMelds(c);
    c[p] += 2;
    if (ok) return true;
  }
  return false;
}
function sevenPairsCounts(c) {
  let n = 0;
  for (let i = 0; i < 34; i++) {
    if (c[i] % 2) return false;
    n += c[i];
  }
  return n === 14;
}
// tiles：手里没亮出来的牌（含要胡的那张），nMelds：已经亮出来的组数（吃 / 碰 / 杠）
export function isSevenPairs(tiles, nMelds) { return nMelds === 0 && tiles.length === 14 && sevenPairsCounts(toCounts(tiles)); }
export function canHu(tiles, nMelds) {
  if (tiles.length !== 14 - 3 * nMelds) return false;
  const c = toCounts(tiles);
  if (nMelds === 0 && sevenPairsCounts(c)) return true;
  return stdWin(c);
}
// 碰碰胡：没有吃，手里剩下的牌恰好是若干刻子 + 一对
function allTriplets(tiles, melds) {
  for (let i = 0; i < melds.length; i++) if (melds[i].kind === 'chi') return false;
  const c = toCounts(tiles);
  let pairs = 0;
  for (let i = 0; i < 34; i++) {
    if (c[i] === 0 || c[i] === 3) continue;
    if (c[i] === 2) pairs++;
    else return false;
  }
  return pairs === 1;
}

// 算番：tiles 是手里没亮出来的牌（含胡的那张），melds 是亮出来的组 [{ kind, tile, tiles }]；ctx：{ zimo, gangFlag, qiang, haidi }
// 返回 { fan, items: [{ name, fan }], shape }（不能胡返回 null）
export function scoreHand(tiles, melds, ctx) {
  const x = ctx || {};
  if (!canHu(tiles, melds.length)) return null;
  const items = [{ name: '底番', fan: 1 }];
  const seven = isSevenPairs(tiles, melds.length);
  let shape = '平胡';
  if (seven) { items.push({ name: '七对', fan: 2 }); shape = '七对'; }
  else if (allTriplets(tiles, melds)) { items.push({ name: '碰碰胡', fan: 1 }); shape = '碰碰胡'; }
  const suits = {};
  let honors = 0, nsuits = 0;
  const all = tiles.slice();
  for (let i = 0; i < melds.length; i++) for (let k = 0; k < melds[i].tiles.length; k++) all.push(melds[i].tiles[k]);
  for (let i = 0; i < all.length; i++) {
    const s = suitOf(all[i]);
    if (s === 3) honors++;
    else if (!suits[s]) { suits[s] = 1; nsuits++; }
  }
  if (nsuits === 1 && honors === 0) items.push({ name: '清一色', fan: 2 });
  else if (nsuits === 1 && honors > 0) items.push({ name: '混一色', fan: 1 });
  let closed = true;
  for (let i = 0; i < melds.length; i++) if (melds[i].kind !== 'angang') closed = false;
  if (closed) items.push({ name: '门清', fan: 1 });
  if (x.zimo && x.gangFlag) items.push({ name: '杠上开花', fan: 1 });
  if (x.qiang) items.push({ name: '抢杠胡', fan: 1 });
  if (x.zimo && x.haidi) items.push({ name: '海底捞月', fan: 1 });
  let fan = 0;
  for (let i = 0; i < items.length; i++) fan += items[i].fan;
  return { fan: fan, items: items, shape: shape };
}

// ===== 吃 / 碰 / 杠 的候选 =====
// 吃 tile 的所有组合（手里要有的两张）：[[a, b], ...]，按点数从小到大
export function chiOptions(hand, tile) {
  if (tile >= 27) return [];
  const c = toCounts(hand), r = tile % 9, out = [];
  if (r >= 2 && c[tile - 2] > 0 && c[tile - 1] > 0) out.push([tile - 2, tile - 1]);
  if (r >= 1 && r <= 7 && c[tile - 1] > 0 && c[tile + 1] > 0) out.push([tile - 1, tile + 1]);
  if (r <= 6 && c[tile + 1] > 0 && c[tile + 2] > 0) out.push([tile + 1, tile + 2]);
  return out;
}

// ===== 牌局状态 =====
// 完整状态 g（只在服务器的 mj_state 里；每个真人只能拿到自己的手牌）：
//   n: 4, dealer, quan（做过几次庄家交接，只用来显示圈风）, wall（尾部是下一张要摸的牌，补牌从头部拿）
//   hands[4]（排好序，含刚摸的那张）, melds[4]: [{ kind: chi|peng|gang|angang|bugang, tile, tiles, from }]
//   discards[4]（打出且没被吃碰杠走的牌）, turn, phase: 'discard' | 'claim' | 'over'
//   drawn：轮到的人刚摸（或补）的那张，吃 / 碰之后是 null
//   claim: { kind: 'discard' | 'qianggang', tile, from, opts: { 座位: { hu, peng, gang, chi } }, resp: { 座位: 动作 } }
//   gangFlag（刚杠完补牌）, haidi（刚摸走最后一张牌墙牌）, lastDiscard: { seat, tile, n }（高亮刚打出的那张）
//   recent（最近的动作，给界面和榜单看）, step（每个动作加一）, result, nextDealer, nextQuan
const RECENT = 8;

function clone(g) { return JSON.parse(JSON.stringify(g)); }
function removeOne(arr, t) {
  const i = arr.indexOf(t);
  if (i < 0) return false;
  arr.splice(i, 1);
  return true;
}
function note(g, seat, kind, tile) {
  g.recent.push({ seat: seat, kind: kind, tile: tile === undefined ? null : tile });
  if (g.recent.length > RECENT) g.recent.shift();
}

export function newGame(cfg) {
  const rng = cfg.rng, dealer = cfg.dealer || 0;
  const wall = shuffleWall(rng);
  const hands = [[], [], [], []];
  for (let r = 0; r < 13; r++) for (let s = 0; s < 4; s++) hands[s].push(wall.pop());
  const g = {
    n: 4, dealer: dealer, quan: cfg.quan || 0, wall: wall,
    hands: hands, melds: [[], [], [], []], discards: [[], [], [], []],
    turn: dealer, phase: 'discard', drawn: null, claim: null, gangFlag: false, haidi: false, lastDiscard: null,
    recent: [], step: 0, result: null, nextDealer: dealer, nextQuan: cfg.quan || 0
  };
  for (let s = 0; s < 4; s++) hands[s].sort(function (a, b) { return a - b; });
  drawTile(g, dealer, false);
  return g;
}

// 给 seat 摸一张；replacement：杠后补牌（从牌墙头部拿）。牌墙空了返回 false
function drawTile(g, seat, replacement) {
  if (!g.wall.length) return false;
  const t = replacement ? g.wall.shift() : g.wall.pop();
  g.hands[seat].push(t);
  g.hands[seat].sort(function (a, b) { return a - b; });
  g.drawn = t;
  g.turn = seat;
  g.phase = 'discard';
  g.gangFlag = !!replacement;
  g.haidi = !replacement && g.wall.length === 0;
  return true;
}

// 轮到 seat 出牌时能做的事（摸牌之后）：{ hu, angang: [牌], bugang: [牌] }
export function turnOptions(g, seat) {
  const o = { hu: false, angang: [], bugang: [] };
  if (g.drawn === null || g.drawn === undefined) return o;
  const hand = g.hands[seat], melds = g.melds[seat];
  o.hu = canHu(hand, melds.length);
  if (g.wall.length > 0) {
    const c = toCounts(hand);
    for (let t = 0; t < 34; t++) if (c[t] === 4) o.angang.push(t);
    for (let i = 0; i < melds.length; i++) if (melds[i].kind === 'peng' && c[melds[i].tile] > 0) o.bugang.push(melds[i].tile);
  }
  return o;
}
// 别人打出 tile（from 打的）时 seat 能做的事：{ hu, peng, gang, chi: [[a, b]] }
function claimOptionsFor(g, seat, tile, from, huOnly) {
  const hand = g.hands[seat], c = toCounts(hand);
  const o = { hu: false, peng: false, gang: false, chi: [] };
  o.hu = canHu(hand.concat([tile]), g.melds[seat].length);
  if (huOnly) return o;
  o.peng = c[tile] >= 2;
  o.gang = c[tile] >= 3 && g.wall.length > 0;
  if (seat === (from + 1) % 4) o.chi = chiOptions(hand, tile);
  return o;
}
function anyOpt(o) { return o.hu || o.peng || o.gang || o.chi.length > 0; }
function prioOf(o) { return o.hu ? 3 : (o.peng || o.gang) ? 2 : o.chi.length ? 1 : 0; }
function dist(from, seat) { return (seat - from + 4) % 4; }

// 现在需要谁动：出牌阶段是轮到的人，吃碰胡窗口是还没表态的人
export function pending(g) {
  if (g.phase === 'discard') return [g.turn];
  if (g.phase === 'claim') {
    const out = [];
    for (let s = 0; s < 4; s++) if (g.claim.opts[s] && !g.claim.resp[s]) out.push(s);
    return out;
  }
  return [];
}

function openClaim(g, kind, tile, from) {
  const opts = {};
  for (let s = 0; s < 4; s++) {
    if (s === from) continue;
    const o = claimOptionsFor(g, s, tile, from, kind === 'qianggang');
    if (anyOpt(o)) opts[s] = o;
  }
  g.drawn = null;
  g.gangFlag = false;
  g.haidi = false;
  if (!Object.keys(opts).length) return false;
  g.phase = 'claim';
  g.claim = { kind: kind, tile: tile, from: from, opts: opts, resp: {} };
  return true;
}

function finishDraw(g) {
  g.phase = 'over'; g.claim = null; g.drawn = null;
  g.result = { type: 'draw', winner: null, from: null, tile: null, fan: 0, items: [], shape: '', scores: [0, 0, 0, 0], hands: g.hands.map(function (h) { return h.slice(); }) };
  g.nextDealer = g.dealer; g.nextQuan = g.quan;
  note(g, g.turn, 'draw');
}
// 结算一次胡牌：winner 胡，from 是点炮的人（自摸时为 null），tile 是胡的那张（自摸时已经在手里）
function settleWin(g, winner, from, tile, qiang) {
  const zimo = from === null;
  const hand = zimo ? g.hands[winner].slice() : g.hands[winner].concat([tile]).sort(function (a, b) { return a - b; });
  const sc = scoreHand(hand, g.melds[winner], { zimo: zimo, gangFlag: g.gangFlag, qiang: !!qiang, haidi: g.haidi });
  const scores = [0, 0, 0, 0];
  if (zimo) {
    for (let s = 0; s < 4; s++) if (s !== winner) { scores[s] = -sc.fan; scores[winner] += sc.fan; }
  } else {
    scores[from] = -3 * sc.fan; scores[winner] = 3 * sc.fan;
  }
  const hands = g.hands.map(function (h) { return h.slice(); });
  hands[winner] = hand;
  g.phase = 'over'; g.claim = null; g.drawn = null;
  g.result = { type: zimo ? 'zimo' : qiang ? 'qianggang' : 'ron', winner: winner, from: from, tile: tile, fan: sc.fan, items: sc.items, shape: sc.shape, scores: scores, hands: hands };
  g.nextDealer = winner === g.dealer ? g.dealer : (g.dealer + 1) % 4;
  g.nextQuan = g.quan + (g.nextDealer === g.dealer ? 0 : 1);
  note(g, winner, zimo ? 'zimo' : 'hu', tile);
}

// 一个动作：{ kind: 'discard', tile } | { kind: 'hu' } | { kind: 'angang', tile } | { kind: 'bugang', tile }
//          | 吃碰杠胡窗口里：{ kind: 'pass' | 'hu' | 'peng' | 'gang' } | { kind: 'chi', with: [a, b] }
// 返回 { ok: true, state } 或 { ok: false, error }（不改传进来的 g）
export function apply(g0, seat, act) {
  if (!act || typeof act.kind !== 'string') return { ok: false, error: 'bad_action' };
  if (g0.phase === 'over') return { ok: false, error: 'bad_phase' };
  const g = clone(g0);
  g.step++;
  if (g.phase === 'discard') {
    if (seat !== g.turn) return { ok: false, error: 'not_your_turn' };
    const hand = g.hands[seat], opt = turnOptions(g, seat);
    if (act.kind === 'discard') {
      if (!Number.isInteger(act.tile) || !removeOne(hand, act.tile)) return { ok: false, error: 'not_in_hand' };
      g.discards[seat].push(act.tile);
      g.lastDiscard = { seat: seat, tile: act.tile, n: g.discards[seat].length - 1 };
      note(g, seat, 'discard', act.tile);
      if (!openClaim(g, 'discard', act.tile, seat)) {
        if (!advance(g, seat)) finishDraw(g);
      }
      return { ok: true, state: g };
    }
    if (act.kind === 'hu') {
      if (!opt.hu) return { ok: false, error: 'cannot_hu' };
      settleWin(g, seat, null, g.drawn, false);
      return { ok: true, state: g };
    }
    if (act.kind === 'angang') {
      if (opt.angang.indexOf(act.tile) < 0) return { ok: false, error: 'cannot_gang' };
      for (let i = 0; i < 4; i++) removeOne(hand, act.tile);
      g.melds[seat].push({ kind: 'angang', tile: act.tile, tiles: [act.tile, act.tile, act.tile, act.tile], from: seat });
      note(g, seat, 'angang'); // 暗杠是哪张牌不公开
      g.lastDiscard = null;
      if (!drawTile(g, seat, true)) finishDraw(g);
      return { ok: true, state: g };
    }
    if (act.kind === 'bugang') {
      if (opt.bugang.indexOf(act.tile) < 0) return { ok: false, error: 'cannot_gang' };
      removeOne(hand, act.tile);
      g.lastDiscard = null;
      note(g, seat, 'bugang', act.tile);
      g.drawn = null;
      if (!openClaim(g, 'qianggang', act.tile, seat)) completeBugang(g, seat, act.tile);
      return { ok: true, state: g };
    }
    return { ok: false, error: 'bad_action' };
  }
  // 吃碰杠胡窗口
  const cl = g.claim, o = cl.opts[seat];
  if (!o || cl.resp[seat]) return { ok: false, error: 'cannot_claim' };
  if (act.kind === 'pass') cl.resp[seat] = { kind: 'pass' };
  else if (act.kind === 'hu') { if (!o.hu) return { ok: false, error: 'cannot_hu' }; cl.resp[seat] = { kind: 'hu' }; }
  else if (act.kind === 'peng') { if (!o.peng) return { ok: false, error: 'cannot_claim' }; cl.resp[seat] = { kind: 'peng' }; }
  else if (act.kind === 'gang') { if (!o.gang) return { ok: false, error: 'cannot_claim' }; cl.resp[seat] = { kind: 'gang' }; }
  else if (act.kind === 'chi') {
    const w = act.with;
    if (!Array.isArray(w) || w.length !== 2 || !o.chi.some(function (p) { return p[0] === w[0] && p[1] === w[1]; })) return { ok: false, error: 'cannot_claim' };
    cl.resp[seat] = { kind: 'chi', with: [w[0], w[1]] };
  } else return { ok: false, error: 'bad_action' };
  resolveClaim(g);
  return { ok: true, state: g };
}

// 打牌后没人要：下一家摸牌。牌墙空了返回 false
function advance(g, from) { return drawTile(g, (from + 1) % 4, false); }

function completeBugang(g, seat, tile) {
  for (let i = 0; i < g.melds[seat].length; i++) {
    const m = g.melds[seat][i];
    if (m.kind === 'peng' && m.tile === tile) { m.kind = 'bugang'; m.tiles = [tile, tile, tile, tile]; }
  }
  g.claim = null;
  if (!drawTile(g, seat, true)) finishDraw(g);
}

// 窗口里的表态够了就结算：最高优先级里离打牌人最近的人说了算；还有更高优先级的人没表态就继续等
function resolveClaim(g) {
  const cl = g.claim;
  let best = -1, bestP = 0;
  for (let s = 0; s < 4; s++) {
    const r = cl.resp[s];
    if (!r || r.kind === 'pass') continue;
    const p = r.kind === 'hu' ? 3 : r.kind === 'chi' ? 1 : 2;
    if (best < 0 || p > bestP || (p === bestP && dist(cl.from, s) < dist(cl.from, best))) { best = s; bestP = p; }
  }
  if (best >= 0) {
    for (let s = 0; s < 4; s++) {
      if (!cl.opts[s] || cl.resp[s]) continue;
      const p = prioOf(cl.opts[s]);
      if (p > bestP || (p === bestP && dist(cl.from, s) < dist(cl.from, best))) return; // 他可能压过去：等他
    }
    return execClaim(g, best, cl.resp[best]);
  }
  for (let s = 0; s < 4; s++) if (cl.opts[s] && !cl.resp[s]) return; // 还有人没表态
  // 全部放弃
  const kind = cl.kind, tile = cl.tile, from = cl.from;
  g.claim = null;
  if (kind === 'qianggang') completeBugang(g, from, tile);
  else if (!advance(g, from)) finishDraw(g);
}

function execClaim(g, seat, r) {
  const cl = g.claim, tile = cl.tile, from = cl.from, hand = g.hands[seat];
  g.claim = null;
  if (r.kind === 'hu') {
    if (cl.kind === 'qianggang') {
      g.hands[from].push(tile); g.hands[from].sort(function (a, b) { return a - b; }); // 补杠没成：那张牌还在他手里
      settleWin(g, seat, from, tile, true);
    } else settleWin(g, seat, from, tile, false);
    return;
  }
  // 吃 / 碰 / 杠：牌从打牌人的牌河里拿走
  g.discards[from].pop();
  g.lastDiscard = null;
  g.drawn = null; g.gangFlag = false; g.haidi = false;
  if (r.kind === 'peng') {
    removeOne(hand, tile); removeOne(hand, tile);
    g.melds[seat].push({ kind: 'peng', tile: tile, tiles: [tile, tile, tile], from: from });
    g.turn = seat; g.phase = 'discard';
    note(g, seat, 'peng', tile);
  } else if (r.kind === 'gang') {
    removeOne(hand, tile); removeOne(hand, tile); removeOne(hand, tile);
    g.melds[seat].push({ kind: 'gang', tile: tile, tiles: [tile, tile, tile, tile], from: from });
    note(g, seat, 'gang', tile);
    if (!drawTile(g, seat, true)) finishDraw(g);
  } else {
    removeOne(hand, r.with[0]); removeOne(hand, r.with[1]);
    g.melds[seat].push({ kind: 'chi', tile: tile, tiles: [r.with[0], r.with[1], tile].sort(function (a, b) { return a - b; }), from: from });
    g.turn = seat; g.phase = 'discard';
    note(g, seat, 'chi', tile);
  }
}

// ===== 机器人 =====
// 一张牌留在手里的价值：成对 / 成刻、旁边有搭子的值钱；孤零零的字牌和幺九最该先打
function keepScore(c, t) {
  let s = 0;
  if (c[t] >= 3) s += 7; else if (c[t] === 2) s += 4.5;
  if (t < 27) {
    const r = t % 9;
    if (r > 0 && c[t - 1] > 0) s += 2.2;
    if (r < 8 && c[t + 1] > 0) s += 2.2;
    if (r > 1 && c[t - 2] > 0) s += 1.1;
    if (r < 7 && c[t + 2] > 0) s += 1.1;
    if (r >= 2 && r <= 6) s += 0.6;
  } else s -= 0.3;
  return s;
}
// 机器人打哪一张：价值最低的；同分时先打字牌、再打幺九
export function pickDiscard(hand, avoid) {
  const c = toCounts(hand);
  let best = -1, bestS = 1e9;
  for (let t = 0; t < 34; t++) {
    if (!c[t]) continue;
    let s = keepScore(c, t);
    if (avoid !== undefined && avoid !== null && t === avoid) s += 0.01;
    if (isTerminal(t)) s -= 0.1;
    if (s < bestS - 1e-9) { bestS = s; best = t; }
  }
  return best;
}
// 碰 / 杠会不会拆掉更好的牌：只碰字牌，或者这张牌附近两格内没有别的花色牌（孤对）
function pengIsSafe(hand, tile) {
  if (tile >= 27) return true;
  const c = toCounts(hand), r = tile % 9;
  for (let d = -2; d <= 2; d++) {
    if (d === 0) continue;
    const rr = r + d;
    if (rr >= 0 && rr <= 8 && c[tile + d] > 0) return false;
  }
  return true;
}
// 机器人在 seat 的动作（轮到它出牌，或者在吃碰胡窗口里表态）
export function botAction(g, seat) {
  if (g.phase === 'discard') {
    const o = turnOptions(g, seat);
    if (o.hu) return { kind: 'hu' };
    if (o.angang.length) return { kind: 'angang', tile: o.angang[0] };
    if (o.bugang.length) return { kind: 'bugang', tile: o.bugang[0] };
    return { kind: 'discard', tile: pickDiscard(g.hands[seat], g.drawn) };
  }
  const o2 = g.claim.opts[seat];
  if (!o2) return { kind: 'pass' };
  if (o2.hu) return { kind: 'hu' };
  if (o2.gang && pengIsSafe(g.hands[seat], g.claim.tile)) return { kind: 'gang' };
  if (o2.peng && pengIsSafe(g.hands[seat], g.claim.tile)) return { kind: 'peng' };
  return { kind: 'pass' };
}
// 真人超时：出牌阶段打掉刚摸的牌（没有就打最没用的牌）；吃碰胡窗口放弃
export function timeoutAction(g, seat) {
  if (g.phase === 'discard') return { kind: 'discard', tile: g.drawn !== null && g.drawn !== undefined ? g.drawn : pickDiscard(g.hands[seat]) };
  return { kind: 'pass' };
}

// ===== 视图 =====
// 公开状态：所有人（包括旁观者、榜单、榴莲）都能看到；只有张数，没有任何手牌；结束后才亮牌
export function publicView(g) {
  const over = g.phase === 'over';
  return {
    v: MJ_RULES_VERSION, step: g.step, players: 4, dealer: g.dealer, quan: g.quan,
    phase: g.phase, turn: g.turn, wallLeft: g.wall.length,
    handCounts: g.hands.map(function (h) { return h.length; }),
    melds: g.melds.map(function (ms) {
      return ms.map(function (m) { return m.kind === 'angang' && !over ? { kind: 'angang', tile: null, tiles: [], from: m.from } : m; }); // 暗杠没结束前不亮牌
    }),
    discards: g.discards, lastDiscard: g.lastDiscard,
    claim: g.claim ? { kind: g.claim.kind, tile: g.claim.tile, from: g.claim.from } : null,
    recent: g.recent,
    result: over ? g.result : null
  };
}
// 一个座位自己的视图（写进只有他能读的 mj_hands）：手牌、刚摸的牌、现在能做的事
export function privateView(g, seat) {
  let opts = null;
  if (g.phase === 'discard' && g.turn === seat) {
    const o = turnOptions(g, seat);
    opts = { mode: 'turn', hu: o.hu, angang: o.angang, bugang: o.bugang };
  } else if (g.phase === 'claim' && g.claim.opts[seat] && !g.claim.resp[seat]) {
    const o2 = g.claim.opts[seat];
    opts = { mode: 'claim', hu: o2.hu, peng: o2.peng, gang: o2.gang, chi: o2.chi };
  }
  const ag = [];
  for (let i = 0; i < g.melds[seat].length; i++) if (g.melds[seat][i].kind === 'angang') ag.push(g.melds[seat][i].tile);
  return { cards: g.hands[seat].slice(), drawn: g.phase === 'discard' && g.turn === seat ? g.drawn : null, opts: opts, ag: ag };
}
