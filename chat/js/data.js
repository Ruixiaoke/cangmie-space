// 数据加载：loadProfile / loadAll

import { errText } from './errors.js';
import { markReadIfNeeded } from './read.js';
import { S, sb } from './state.js';
import { dropGroup, groupOf } from './groups/data.js';
import { isVisible, toast } from './utils.js';
import { convOf } from './views/chats.js';
import { renderAll } from './views/tabs.js';

// ===== 数据加载 =====
export async function loadProfile() {
  var u = (await sb.auth.getUser()).data.user;
  if (!u) throw new Error('not_authenticated');
  var r = await sb.from('profiles').select('id,username,nickname,avatar_path').eq('id', u.id).maybeSingle();
  if (r.error) throw r.error;
  if (!r.data) throw new Error('profile_missing');
  S.me = r.data;
  S.profiles.set(S.me.id, S.me);
}
// 最后一条消息是不是榴莲写的：list_conversations 不返回 author（改它的返回列会让迁移二次运行失败），这里按 id 另查一次
async function markLastAuthors(convs) {
  var ids = convs.map(function (c) { return c.last_id; }).filter(function (x) { return x != null; });
  var got = {};
  if (ids.length) {
    try {
      var r = await sb.from('messages').select('id,author').in('id', ids).not('author', 'is', null);
      (r.data || []).forEach(function (x) { got[x.id] = x.author; });
    } catch (e) { /* 取不到就当没有：只影响列表预览的前缀 */ }
  }
  convs.forEach(function (c) { c.last_author = c.last_id != null && got[c.last_id] ? got[c.last_id] : null; });
}
var loadingAll = null, loadAgain = false;
export function loadAll() {
  // 合并并发调用：正在加载时只记一个“再来一次”
  if (loadingAll) { loadAgain = true; return loadingAll; }
  loadingAll = (async function () {
    try {
      do {
        loadAgain = false;
        var rs = await Promise.all([
          sb.rpc('list_conversations'),
          sb.rpc('list_groups'),
          sb.from('friendships').select('id,requester_id,addressee_id,status,updated_at'),
          sb.from('profiles').select('id,username,nickname,avatar_path')
        ]);
        // 群列表取不到（比如后端还没升级）不影响私聊：当作没有群
        var bad = [rs[0], rs[2], rs[3]].find(function (r) { return r.error; });
        if (bad) { if (isVisible()) toast(errText(bad.error)); return false; }
        S.convs = rs[0].data || [];
        await markLastAuthors(S.convs);
        var groupsOk = !rs[1].error;
        if (groupsOk) S.groups = (rs[1].data || []).map(function (g) { g.unread_count = Number(g.unread_count) || 0; return g; });
        S.friendships = rs[2].data || [];
        var map = new Map();
        (rs[3].data || []).forEach(function (p) { map.set(p.id, p); });
        if (S.me && !map.has(S.me.id)) map.set(S.me.id, S.me);
        S.profiles = map;
        if (S.me && map.get(S.me.id)) S.me = map.get(S.me.id);
        // 正开着的群已经不在我的群列表里：被移出了（实时漏掉了也靠这里兜底）
        if (groupsOk && S.chat && S.chat.gid != null && !groupOf(S.chat.gid)) dropGroup(S.chat.gid, false);
        renderAll();
        // 重新加载后，打开且可见的会话若还有未读，补标一次
        if (S.chat && isVisible()) {
          var oc = S.chat.gid != null ? groupOf(S.chat.gid) : convOf(S.chat.peer);
          if (oc && Number(oc.unread_count) > 0) markReadIfNeeded();
        }
      } while (loadAgain);
      return true;
    } finally { loadingAll = null; }
  })();
  return loadingAll;
}
