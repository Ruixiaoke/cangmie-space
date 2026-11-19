// 假的 Supabase 客户端：截图用。shots.mjs 把它替换成页面里的 supabase.js；数据是写死的几个人、一个群、一段私聊。
// 端口 8077 会被 shots.mjs 改成它自己的端口。
(function () {
  var ME = '11111111-1111-4111-8111-111111111111', P2 = '22222222-2222-4222-8222-222222222222', P3 = '33333333-3333-4333-8333-333333333333', P4 = '44444444-4444-4444-8444-444444444444';
  var now = new Date().toISOString();
  var db = window.__db = {
    profiles: [ME, P2, P3, P4].map(function (id, i) { return { id: id, username: 'u' + i, nickname: ['小雨', '小明', '阿杰', '小红'][i], avatar_path: null }; }),
    friendships: [P2, P3, P4].map(function (p, i) { return { id: i + 1, requester_id: ME, addressee_id: p, status: 'accepted', updated_at: now }; }),
    messages: [
      { id: 101, sender_id: '22222222-2222-4222-8222-222222222222', receiver_id: '11111111-1111-4111-8111-111111111111', group_id: null, body: '今天华山下雪了，纯阳宫那边一片白', created_at: new Date(Date.now() - 86400000).toISOString(), read_at: now, author: null },
      { id: 102, sender_id: '11111111-1111-4111-8111-111111111111', receiver_id: '22222222-2222-4222-8222-222222222222', group_id: null, body: '真的吗，想去看看', created_at: new Date(Date.now() - 86300000).toISOString(), read_at: now, author: null },
      { id: 103, sender_id: '22222222-2222-4222-8222-222222222222', receiver_id: '11111111-1111-4111-8111-111111111111', group_id: null, body: '晚上一起去老君宫门口看雪，顺便打一局麻将', created_at: new Date(Date.now() - 600000).toISOString(), read_at: now, author: null },
      { id: 104, sender_id: '11111111-1111-4111-8111-111111111111', receiver_id: '22222222-2222-4222-8222-222222222222', group_id: null, body: '好呀，我带上剑', created_at: new Date(Date.now() - 500000).toISOString(), read_at: now, author: null },
      { id: 1, sender_id: P2, receiver_id: ME, group_id: null, body: '来一局飞行棋', created_at: now, read_at: now, author: null },
      { id: 2, sender_id: P2, receiver_id: ME, group_id: null, body: '[飞行棋]#1', created_at: now, read_at: now, author: null },
      { id: 3, sender_id: P3, receiver_id: null, group_id: 7, body: '[飞行棋]#2', created_at: now, read_at: now, author: null },
      { id: 4, sender_id: P4, receiver_id: null, group_id: 7, body: '快来', created_at: now, read_at: now, author: null },
      { id: 5, sender_id: P2, receiver_id: ME, group_id: null, body: '[麻将]#1', created_at: now, read_at: now, author: null },
      { id: 6, sender_id: P3, receiver_id: null, group_id: 7, body: '[麻将]#2', created_at: now, read_at: now, author: null }
    ],
    fxq_games: [], fxq_scores: []
  };
  window.__ids = { ME: ME, P2: P2, P3: P3, P4: P4 };
  var dice = window.__dice = [];
  var T = '2030-01-01T00:00:00Z';
  function rows(t) { return db[t] || []; }
  function builder(table) {
    var q = { table: table, filters: [], single: false };
    var api = {};
    ['select', 'order', 'limit', 'not', 'or', 'is', 'gt', 'lt', 'neq', 'range', 'insert', 'update', 'delete', 'upsert'].forEach(function (m) { api[m] = function () { return api; }; });
    api.eq = function (k, v) { q.filters.push(function (r) { return r[k] === v; }); return api; };
    api.in = function (k, vs) { q.filters.push(function (r) { return vs.indexOf(r[k]) >= 0; }); return api; };
    api.maybeSingle = function () { q.single = true; return api; };
    api.single = api.maybeSingle;
    api.then = function (ok, bad) {
      var out = rows(table).filter(function (r) { return q.filters.every(function (f) { return f(r); }); });
      var res = { data: q.single ? (out[0] || null) : out, error: null };
      return Promise.resolve(res).then(ok, bad);
    };
    return api;
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function ok(data) { return Promise.resolve({ data: data, error: null }); }
  function err(m) { return Promise.resolve({ data: null, error: { message: m } }); }
  function game(id) { return db.fxq_games.filter(function (g) { return g.id === id; })[0]; }
  function push(g, ev) { g.version++; return import('http://localhost:8077/chat/js/miniapps/fxq.js').then(function (m) { m.onFxqGame({ eventType: ev || 'UPDATE', new: clone(g) }); }); }
  window.__push = push;
  var rpcs = {
    list_conversations: function () { return ok([{ peer_id: P2, peer_username: 'u1', peer_nickname: '小明', peer_avatar_path: null, last_id: 2, last_body: '[飞行棋]#1', last_sender_id: P2, last_at: now, unread_count: 0, last_read_id: 2 }]); },
    list_groups: function () { return ok([{ id: 7, name: '飞友群', owner_id: ME, agents: [], member_ids: [ME, P2, P3, P4], created_at: now, updated_at: now, last_id: 4, last_body: '快来', last_sender_id: P4, last_author: null, last_at: now, last_read_id: 4, unread_count: 0 }]); },
    mark_read: function () { return ok(null); }, mark_group_read: function () { return ok(null); },
    fxq_sit: function (a) { var g = game(a.p_game), i; for (i = 0; i < 4; i++) if (g.seats[i] === ME) g.seats[i] = null; g.seats[a.p_seat] = ME; return push(g).then(function () { return { data: clone(g), error: null }; }); },
    fxq_stand: function (a) { var g = game(a.p_game); g.seats = g.seats.map(function (u) { return u === ME ? null : u; }); return push(g).then(function () { return { data: clone(g), error: null }; }); },
    fxq_set_bot: function (a) { var g = game(a.p_game); g.bots[a.p_seat] = a.p_on; return push(g).then(function () { return { data: clone(g), error: null }; }); },
    fxq_leaderboard: function () { return ok([{ user_id: ME, nickname: '小雨', avatar_path: null, wins: 3, games: 7 }, { user_id: P2, nickname: '小明', avatar_path: null, wins: 2, games: 6 }, { user_id: P3, nickname: '阿杰', avatar_path: null, wins: 0, games: 0 }]); },
    mj_leaderboard: function () { return ok([{ user_id: ME, nickname: '小雨', avatar_path: null, total: 18, wins: 2, games: 5 }, { user_id: P2, nickname: '小明', avatar_path: null, total: -6, wins: 1, games: 5 }]); },
    game_leaderboard: function () { return ok([]); }, ddz_leaderboard: function () { return ok([]); }
  };
  var handleP = null; // 飞行棋服务器逻辑的打包文件，只有真的调用 Edge Function 时才加载（截皮肤用不到）
  function invoke(name, o) {
    handleP = handleP || import('http://localhost:8077/__bundle/game.bundle.js');
    return handleP.then(function (m) {
      var store = {
        getGame: function (id) { var g = game(id); return Promise.resolve(g ? clone(g) : null); },
        canAccess: function () { return Promise.resolve(true); },
        names: function (ids) { var r = {}; ids.forEach(function (i) { r[i] = db.profiles.filter(function (p) { return p.id === i; })[0].nickname; }); return Promise.resolve(r); },
        groupName: function () { return Promise.resolve('飞友群'); },
        commit: function (c) {
          var g = game(c.game);
          if (g.version !== c.version) return Promise.resolve(false);
          g.status = c.patch.status; g.pub = c.patch.pub; g.auto = c.patch.auto; g.round = c.patch.round; g.deadline = c.patch.deadline; g.version++;
          c.scores.forEach(function (s) { db.fxq_scores.push({ group_id: g.group_id, dm_lo: g.dm_lo, dm_hi: g.dm_hi, user_id: s.user_id, wins: s.win ? 1 : 0, games: 1 }); });
          return Promise.resolve(true);
        }
      };
      var rng = function () { return function () { if (dice.length) return (dice.shift() - 1) / 6 + 0.01; return Math.random(); }; };
      var uid = window.__as || ME;
      return m.handle({ store: store, now: function () { return Date.now(); }, rng: rng }, uid, o.body).then(function (r) {
        if (r.status === 200) return { data: r.body, error: null };
        return { data: null, error: { message: r.body.error, context: { json: function () { return Promise.resolve(r.body); } } } };
      });
    });
  }
  var client = {
    auth: {
      getSession: function () { return ok({ session: localStorage.getItem('fake.nosession') ? null : { user: { id: ME } } }); },
      getUser: function () { return ok({ user: { id: ME } }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: function () { return ok(null); }
    },
    from: function (t) { return builder(t); },
    rpc: function (n, a) { return rpcs[n] ? rpcs[n](a || {}) : ok(null); },
    functions: { invoke: invoke },
    channel: function () { var c = { on: function () { return c; }, subscribe: function () { return c; } }; return c; },
    removeChannel: function () {},
    storage: { from: function () { return { getPublicUrl: function (p) { return { data: { publicUrl: '' } }; }, download: function () { return err('x'); }, upload: function () { return err('x'); } }; } }
  };
  window.supabase = { createClient: function () { return client; } };
  // 造一张牌桌：o = { id, dm, seats, bots, status, planes: {seat: [r..]}, turn, roll, auto }
  window.__mk = function (o) {
    return import('http://localhost:8077/chat/js/miniapps/fxq-rules.js').then(function (R) {
      var seats = o.seats || [ME, P2, null, null], bots = o.bots || [false, false, false, false];
      var g = { id: o.id, group_id: o.dm ? null : 7, dm_lo: o.dm ? ME : null, dm_hi: o.dm ? P2 : null, created_by: ME, message_id: o.dm ? 2 : 3, status: o.status || 'waiting', seats: seats, bots: bots, auto: o.auto || [false, false, false, false], round: 1, pub: {}, deadline: null, version: (window.__ver = (window.__ver || 5) + 20), created_at: now, updated_at: now };
      if (g.status !== 'waiting') {
        var st = R.newGame({ seats: [0, 1, 2, 3].map(function (i) { return !!seats[i] || !!bots[i]; }), first: o.turn == null ? 0 : o.turn });
        Object.keys(o.planes || {}).forEach(function (s) { st.planes[s] = o.planes[s]; });
        if (o.roll) st.roll = o.roll;
        st.seq = window.__seq = (window.__seq || 0) + 100;
        if (g.status === 'over') { st.phase = 'over'; st.winner = o.winner; st.rank = R.ranking(st); }
        g.pub = Object.assign({}, st, { v: 1, round: 1, misses: [0, 0, 0, 0], log: [] });
        if (g.status === 'playing') g.deadline = new Date(Date.now() + 14000).toISOString();
      }
      db.fxq_games = db.fxq_games.filter(function (x) { return x.id !== o.id; });
      db.fxq_games.push(g);
      return push(g);
    });
  };
})();
