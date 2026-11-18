// 弹弓大战：物理模拟（Matter.js，页面上用 <script> 加载的全局 Matter）
// 确定性测试会提取 SIM-BEGIN 到 SIM-END 之间的内容，不要在里面引用模块之外的东西
/* global Matter */

/*SIM-BEGIN*/
// 物理模拟：固定步长 1/60 秒，布局由种子决定，模拟过程中不用 Math.random。
// 出手方的设备是权威：它模拟、上传落定后的状态；对方设备按同样的输入重放动画，最后对齐到上传的状态。
var SLW = 2000, SLH = 1000, PLAT_Y = 827, PLAT_X = 490, VALLEY_Y = 951, BS = 56, AV_R = 24;
var SL_ANCHOR = { x: 410, y: 700 };
var SL_VMAX = 24, SL_WINDK = 1.08e-4, SL_MAXSTEPS = 480, SL_DMGK = 0.22, SL_DMGMIN = 3.5;
var SL_TYPES = {
  biscuit: { w: 55, h: 55, density: 0.002, hp: 100 },
  chocolate: { w: 55, h: 55, density: 0.0035, hp: 230 },
  wafer: { w: 111, h: 55, density: 0.0006, hp: 45 }
};
var SL_AMMO = {
  carrot: { r: 17, density: 0.05, rest: 0.15 },
  snowball: { r: 18, density: 0.02, rest: 0.1 },
  chili: { r: 14, density: 0.016, rest: 0.1 }
};
function slRng(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 堡垒布局（A 方）；B 方是镜像。返回 { blocks: [{type,x,y,w,h}], av: {x,y} }
function slLayout(seed) {
  var r = slRng(seed), blocks = [], x0 = 112, row, col, rowsN = 3 + (r() < 0.5 ? 1 : 0);
  var span = [4, r() < 0.5 ? 4 : 3, r() < 0.5 ? 3 : 2, 2], off = 0, topL = 0, topR = 0, pOff = 0, pN = 4;
  for (row = 0; row < rowsN; row++) {
    var n = span[row], used = 0;
    // 每一层都落在下面那一层的范围里，不会有方块悬空（r() 的调用次数不变，方块的数量 / 类型 / 顺序和以前一样）
    off = row === 0 ? 0 : pOff + Math.min(pN - n, Math.floor(r() * (pN - n + 1)));
    pOff = off; pN = n;
    var cy = PLAT_Y - (row + 0.5) * BS;
    while (used < n) {
      var type, wide = false;
      if (n - used >= 2 && r() < 0.32) { type = 'wafer'; wide = true; }
      else type = r() < (row === 0 ? 0.5 : 0.3) ? 'chocolate' : 'biscuit';
      var cols = wide ? 2 : 1, d = SL_TYPES[type];
      blocks.push({ type: type, x: x0 + (off + used + cols / 2) * BS, y: cy - 0.5, w: d.w, h: d.h });
      used += cols;
    }
    topL = x0 + off * BS; topR = x0 + (off + n) * BS;
  }
  var top = PLAT_Y - rowsN * BS;
  return { blocks: blocks, av: { x: (topL + topR) / 2, y: top - AV_R - 1 }, flag: { x: topL + 16, y: top } };
}
function slMirror(l) {
  return {
    blocks: l.blocks.map(function (b) { return { type: b.type, x: SLW - b.x, y: b.y, w: b.w, h: b.h }; }),
    av: { x: SLW - l.av.x, y: l.av.y }, flag: { x: SLW - l.flag.x, y: l.flag.y }
  };
}
function slRound(v, k) { return Math.round(v * k) / k; }

function SlSim(seed, state, wind) {
  var M = Matter, i;
  this.seed = seed; this.wind = wind || 0;
  this.engine = M.Engine.create({ enableSleeping: true, positionIterations: 8, velocityIterations: 6 });
  this.engine.gravity.y = 1;
  this.world = this.engine.world;
  this.ev = []; this.steps = 0; this.proj = null; this.projIdle = 0; this.projAge = 0; this.hitAt = -1;
  this.boom = null; this.calm = 0; this.over = false; this.knocked = [false, false]; this.shooter = 0; this.ammo = null;
  var statics = [];
  var stat = { isStatic: true, friction: 0.9, frictionStatic: 1, restitution: 0, label: 'ground' };
  statics.push(M.Bodies.rectangle((-400 + PLAT_X) / 2, PLAT_Y + 200, PLAT_X + 400, 400, stat));
  statics.push(M.Bodies.rectangle(SLW - (-400 + PLAT_X) / 2, PLAT_Y + 200, PLAT_X + 400, 400, stat));
  statics.push(M.Bodies.fromVertices(0, 0, [[{ x: PLAT_X, y: PLAT_Y }, { x: 700, y: VALLEY_Y }, { x: 700, y: VALLEY_Y + 400 }, { x: PLAT_X, y: VALLEY_Y + 400 }]], stat));
  statics.push(M.Bodies.fromVertices(0, 0, [[{ x: SLW - PLAT_X, y: PLAT_Y }, { x: SLW - 700, y: VALLEY_Y }, { x: SLW - 700, y: VALLEY_Y + 400 }, { x: SLW - PLAT_X, y: VALLEY_Y + 400 }]], stat));
  statics.push(M.Bodies.rectangle(SLW / 2, VALLEY_Y + 200, SLW - 1400, 400, stat));
  this.slopes = [statics[2], statics[3]];
  statics.forEach(function (b) { b.slk = 'ground'; });
  M.World.add(this.world, statics);
  var la = slLayout(seed), lb = slMirror(la);
  this.layouts = [la, lb];
  this.blocks = []; this.av = [];
  [la, lb].forEach(function (l, side) {
    l.blocks.forEach(function (d) {
      var t = SL_TYPES[d.type];
      var b = M.Bodies.rectangle(d.x, d.y, d.w, d.h, { density: t.density, friction: 0.7, frictionStatic: 1.2, restitution: 0.05, label: 'block' });
      b.slk = 'block'; b.sl = { id: this.blocks.length, type: d.type, hp: t.hp, maxhp: t.hp, frozen: false, broken: false, w: d.w, h: d.h, side: side };
      this.blocks.push(b);
    }, this);
    var a = M.Bodies.circle(l.av.x, l.av.y, AV_R, { density: 0.003, friction: 1, frictionStatic: 6, restitution: 0.1, label: 'avatar' });
    a.slk = 'avatar'; a.sl = { side: side };
    this.av.push(a);
  }, this);
  M.World.add(this.world, this.blocks.concat(this.av));
  this.slopeFix();
  if (state) this.applyState(state);
  this.sleepAll();
  if (state) { this.settle(); this.knocked = [false, false]; this.sleepAll(); } // 读到的状态里有悬空的东西：先让它落定（各设备结果一致）
  var me = this;
  M.Events.on(this.engine, 'collisionStart', function (e) { me.onCollide(e.pairs); });
}
SlSim.prototype.slopeFix = function () {
  // fromVertices 的结果以重心为中心：按期望的顶点把它挪到正确位置
  var M = Matter, s = this.slopes, want = [
    { x: PLAT_X, y: PLAT_Y, cx: (PLAT_X + 700) / 2 }, { x: SLW - PLAT_X, y: PLAT_Y, cx: SLW - (PLAT_X + 700) / 2 }
  ];
  s.forEach(function (b, k) {
    var minY = Infinity, minX = Infinity, maxX = -Infinity, j;
    for (j = 0; j < b.vertices.length; j++) { minY = Math.min(minY, b.vertices[j].y); minX = Math.min(minX, b.vertices[j].x); maxX = Math.max(maxX, b.vertices[j].x); }
    M.Body.translate(b, { x: want[k].cx - (minX + maxX) / 2, y: PLAT_Y - minY });
  });
};
SlSim.prototype.sleepAll = function () {
  // 只让底下有东西托着的物体睡着；悬空的（比如旧版本存下来的、底下方块已经碎了的状态）保持醒着，下一发时会掉下来
  var M = Matter, me = this;
  this.blocks.concat(this.av).forEach(function (b) { if (!b.sl.broken && me.supported(b)) M.Sleeping.set(b, true); });
};
SlSim.prototype.supported = function (b) {
  // 用真实形状判断：把它往下挪 3px（拿一份拷贝，不动原物体），看会不会碰到别的东西；斜靠着的方块也算有支撑
  var M = Matter;
  var probe = M.Body.create({ position: { x: b.position.x, y: b.position.y + 3 }, vertices: b.vertices.map(function (v) { return { x: v.x, y: v.y }; }) });
  M.Body.setPosition(probe, { x: b.position.x, y: b.position.y + 3 });
  var others = M.Composite.allBodies(this.world).filter(function (o) { return o !== b && o.slk !== 'proj'; });
  return M.Query.collides(probe, others).length > 0;
};
// 睡着的物体底下的东西被撞走 / 推开时，Matter 不会叫醒它：每一步检查一遍，悬空的叫醒让它掉下来
SlSim.prototype.wakeLoose = function () {
  var M = Matter, me = this;
  this.blocks.concat(this.av).forEach(function (b) { if (!b.sl.broken && b.isSleeping && !me.supported(b)) M.Sleeping.set(b, false); });
};
// 飞出地图的（会一直往下掉，永远落不定）：落定检查里不管它们
function slGone(b) { return b.position.y > SLH + 200 || b.position.x < -400 || b.position.x > SLW + 400; }
SlSim.prototype.checkKnocked = function () {
  // 头像掉下堡垒底（低于平台）或离开平台，也算被击落
  for (var i = 0; i < 2; i++) {
    var v = this.av[i];
    if (v.position.y > PLAT_Y + 10) this.knocked[i] = true;
    if (i === 0 && v.position.x > PLAT_X + 30 && v.position.y > PLAT_Y - 80) this.knocked[i] = true;
    if (i === 1 && v.position.x < SLW - PLAT_X - 30 && v.position.y > PLAT_Y - 80) this.knocked[i] = true;
  }
};
// 没有弹丸，一直模拟到没有东西悬空、也没有东西在动（最多 10 秒）。用在读状态时和拍快照之前
SlSim.prototype.settle = function () {
  var M = Matter, me = this, calm = 0, n;
  function busy() {
    return me.blocks.concat(me.av).some(function (b) {
      return !b.sl.broken && !b.isSleeping && !slGone(b) && (b.speed > 0.15 || Math.abs(b.angularVelocity) > 0.01 || !me.supported(b));
    });
  }
  this.removeProj();
  this.wakeLoose();
  if (!busy()) return;
  for (n = 0; n < 600 && calm < 30; n++) {
    M.Engine.update(this.engine, 1000 / 60);
    this.wakeLoose();
    this.checkKnocked();
    calm = busy() ? 0 : calm + 1;
  }
  this.ev = [];
};
SlSim.prototype.wakeAll = function () {
  var M = Matter;
  this.blocks.concat(this.av).forEach(function (b) { if (!b.sl.broken && b.isSleeping) M.Sleeping.set(b, false); });
};
SlSim.prototype.applyState = function (st) {
  var M = Matter, i;
  for (i = 0; i < this.blocks.length; i++) {
    var b = this.blocks[i], d = st.b && st.b[i];
    if (!d) continue;
    if (d[5]) { this.breakBlock(b, true); continue; }
    if (b.sl.broken) { b.sl.broken = false; Matter.World.add(this.world, b); } // 重放和权威状态有出入时，把方块放回去
    M.Body.setPosition(b, { x: d[0], y: d[1] }); M.Body.setAngle(b, d[2]);
    M.Body.setVelocity(b, { x: 0, y: 0 }); M.Body.setAngularVelocity(b, 0);
    b.sl.hp = d[3]; b.sl.frozen = !!d[4];
  }
  for (i = 0; i < 2; i++) {
    var v = st.v && st.v[i];
    if (!v) continue;
    M.Body.setPosition(this.av[i], { x: v[0], y: v[1] }); M.Body.setAngle(this.av[i], v[2]);
    M.Body.setVelocity(this.av[i], { x: 0, y: 0 }); M.Body.setAngularVelocity(this.av[i], 0);
  }
};
SlSim.prototype.snapshot = function () {
  var b = this.blocks.map(function (x) {
    return x.sl.broken ? [0, 0, 0, 0, 0, 1] : [slRound(x.position.x, 10), slRound(x.position.y, 10), slRound(x.angle, 1000), Math.max(1, Math.round(x.sl.hp)), x.sl.frozen ? 1 : 0, 0];
  });
  var v = this.av.map(function (x) { return [slRound(x.position.x, 10), slRound(x.position.y, 10), slRound(x.angle, 1000)]; });
  return { b: b, v: v };
};
SlSim.prototype.breakBlock = function (b, silent) {
  if (b.sl.broken) return;
  b.sl.broken = true; b.sl.hp = 0;
  Matter.World.remove(this.world, b);
  // Matter 不会因为底下的方块没了就唤醒压在上面的睡眠物体，不叫醒的话头像 / 方块会悬在半空
  if (!silent) this.wakeAll();
  if (!silent) this.ev.push({ t: 'break', x: b.position.x, y: b.position.y, type: b.sl.type, w: b.sl.w, h: b.sl.h, a: b.angle });
};
SlSim.prototype.dmg = function (b, rel, other) {
  // 给方块 b 记一次撞击：相对速度 × 对方质量
  if (b.slk !== 'block' || b.sl.broken || rel < SL_DMGMIN) return;
  var m = other.slk === 'ground' ? b.mass * 0.6 : Math.min(other.mass, 60);
  var d = (rel - SL_DMGMIN + 1) * m * SL_DMGK * (b.sl.frozen ? 2 : 1);
  b.sl.hp -= d;
  this.ev.push({ t: 'hit', x: b.position.x, y: b.position.y, s: Math.min(1, d / 60) });
  if (b.sl.hp <= 0) this.breakBlock(b);
};
SlSim.prototype.onCollide = function (pairs) {
  var i, p, a, b, dvx, dvy, rel;
  for (i = 0; i < pairs.length; i++) {
    p = pairs[i]; a = p.bodyA; b = p.bodyB;
    if (a.slk === 'proj' || b.slk === 'proj') {
      var pr = a.slk === 'proj' ? a : b, o = pr === a ? b : a;
      if (this.hitAt < 0) this.hitAt = this.steps;
      if (pr.sl.ammo === 'chili' && !this.boom) {
        this.boom = { x: pr.position.x, y: pr.position.y }; // 第一次撞到就炸
      }
      if (pr.sl.ammo === 'snowball' && o.slk === 'block' && !o.sl.frozen) {
        // 先按未冻结算伤害，再标记冻结
        var rv = Math.sqrt(Math.pow(pr.velocity.x - o.velocity.x, 2) + Math.pow(pr.velocity.y - o.velocity.y, 2));
        this.dmg(o, rv, pr);
        if (!o.sl.broken) { o.sl.frozen = true; this.ev.push({ t: 'freeze', x: o.position.x, y: o.position.y }); }
        continue;
      }
    }
    if (a.slk === 'avatar' && b.slk === 'ground') this.knocked[a.sl.side] = true;
    if (b.slk === 'avatar' && a.slk === 'ground') this.knocked[b.sl.side] = true;
    dvx = a.velocity.x - b.velocity.x; dvy = a.velocity.y - b.velocity.y;
    rel = Math.sqrt(dvx * dvx + dvy * dvy);
    this.dmg(a, rel, b); this.dmg(b, rel, a);
  }
};
SlSim.prototype.explode = function (c) {
  var M = Matter, R = 150, i, all = this.blocks.concat(this.av);
  this.ev.push({ t: 'boom', x: c.x, y: c.y });
  for (i = 0; i < all.length; i++) {
    var b = all[i];
    if (b.sl.broken) continue;
    var dx = b.position.x - c.x, dy = b.position.y - c.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d > R) continue;
    var s = 1 - d / R, nx = d < 1 ? 0 : dx / d, ny = d < 1 ? -1 : dy / d;
    M.Sleeping.set(b, false);
    var k = 15 * s / Math.sqrt(Math.max(b.mass, 2.5) / 2.5);
    M.Body.setVelocity(b, { x: b.velocity.x + nx * k, y: b.velocity.y + ny * k - 3 * s });
    M.Body.setAngularVelocity(b, b.angularVelocity + (nx >= 0 ? 1 : -1) * 0.1 * s);
    if (b.slk === 'block') {
      b.sl.hp -= 150 * s * (b.sl.frozen ? 2 : 1);
      if (b.sl.hp <= 0) this.breakBlock(b);
    }
  }
};
SlSim.prototype.fire = function (side, ammo, angleDeg, power) {
  var M = Matter, d = SL_AMMO[ammo], dir = side === 0 ? 1 : -1, rad = angleDeg * Math.PI / 180;
  var ax = side === 0 ? SL_ANCHOR.x : SLW - SL_ANCHOR.x;
  var p = M.Bodies.circle(ax, SL_ANCHOR.y, d.r, { density: d.density, friction: 0.4, frictionStatic: 0.5, frictionAir: 0, restitution: d.rest, label: 'proj', sleepThreshold: 1e9 });
  p.slk = 'proj'; p.sl = { ammo: ammo, r: d.r };
  M.Body.setVelocity(p, { x: Math.cos(rad) * dir * power * SL_VMAX, y: -Math.sin(rad) * power * SL_VMAX });
  M.World.add(this.world, p);
  this.proj = p; this.projAge = 0; this.projIdle = 0; this.hitAt = -1; this.shooter = side; this.ammo = ammo;
  this.launched = true; this.calm = 0;
};
SlSim.prototype.removeProj = function () {
  if (this.proj) { Matter.World.remove(this.world, this.proj); this.proj = null; }
};
SlSim.prototype.step = function () {
  var M = Matter, i, p = this.proj;
  if (p) M.Body.applyForce(p, p.position, { x: this.wind * SL_WINDK * p.mass, y: 0 });
  for (i = 0; i < this.av.length; i++) {
    var a = this.av[i];
    if (!a.isSleeping) M.Body.setAngularVelocity(a, a.angularVelocity * 0.88); // 头像不容易自己滚走
  }
  M.Engine.update(this.engine, 1000 / 60);
  this.steps++;
  this.wakeLoose();
  if (this.boom) {
    var bm = this.boom; this.boom = null;
    this.explode(bm);
    this.removeProj();
    p = null;
  }
  p = this.proj;
  if (p) {
    this.projAge++;
    var sp = Math.sqrt(p.velocity.x * p.velocity.x + p.velocity.y * p.velocity.y);
    if (this.hitAt >= 0 && sp < 0.5) this.projIdle++; else this.projIdle = 0;
    if (p.position.x < -400 || p.position.x > SLW + 400 || p.position.y > SLH + 300 ||
        this.projIdle > 40 || this.projAge > 420 || (this.hitAt >= 0 && this.steps - this.hitAt > 200)) {
      this.ev.push({ t: 'projEnd', x: p.position.x, y: p.position.y });
      this.removeProj();
    }
  }
  this.checkKnocked();
  // 落定：没有弹丸，所有东西都睡着或几乎不动，持续半秒
  if (!this.proj && this.launched) {
    var still = true, all = this.blocks.concat(this.av);
    for (i = 0; i < all.length; i++) {
      var b = all[i];
      if (b.sl.broken || b.isSleeping) continue;
      if (b.speed > 0.15 || Math.abs(b.angularVelocity) > 0.01) { still = false; break; }
    }
    this.calm = still ? this.calm + 1 : 0;
    if (this.calm >= 30) this.over = true;
  }
  if (this.steps >= SL_MAXSTEPS) { this.removeProj(); this.over = true; }
};
// 出手方的这一发是否算击落（只算对手的头像；自己的头像掉下去不算）
SlSim.prototype.enemyKnocked = function () { return this.knocked[1 - this.shooter]; };
// 弹道预览：和 Matter 的积分一致（速度先加加速度，再挪位置）
function slPreview(side, angleDeg, power, wind, n) {
  var dir = side === 0 ? 1 : -1, rad = angleDeg * Math.PI / 180, g = 0.001 * 1 * (1000 / 60) * (1000 / 60);
  var x = side === 0 ? SL_ANCHOR.x : SLW - SL_ANCHOR.x, y = SL_ANCHOR.y;
  var vx = Math.cos(rad) * dir * power * SL_VMAX, vy = -Math.sin(rad) * power * SL_VMAX, out = [], i;
  var wx = wind * SL_WINDK * (1000 / 60) * (1000 / 60);
  for (i = 0; i < n; i++) { vx += wx; vy += g; x += vx; y += vy; out.push({ x: x, y: y }); }
  return out;
}
/*SIM-END*/
export { AV_R, PLAT_X, PLAT_Y, SLH, SLW, SL_AMMO, SL_ANCHOR, SlSim, slPreview };
