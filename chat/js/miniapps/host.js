// 小程序宿主

import { scrollToBottom } from '../chat/view.js';
import { closeActMenu } from '../menu.js';
import { getMiniApp } from './registry.js';
import { sand } from '../skins/sand.js';
import { S } from '../state.js';
import { $, clear } from '../utils.js';

// ===== 小程序宿主 =====
// 小程序是聊天页里一整层，垫在消息后面；消息半透明地漂在上面，点击和长按穿透下去。
// 注册：在 miniapps/registry.js 的 listMiniApps() 里加一项；每个小程序 = { id, label, icon, run(), mount(box, params), unmount(), same(a, b) }。
// 打开：openApp(id, params)；同一时间只有一个。
// scope：'dm'（私聊）或 'group'（群聊），+ 面板只列出和当前会话匹配的；
// 可选字段：strip: 'hidden' = 消息带子默认完全收起（0 高），顶栏右侧出现"消息"按钮，点开恢复成约 30% 高，再点收起；收起时来了新消息，按钮上显示未读数；
// flush: true = 小程序内容贴边，不要宿主的内边距。
export var APP = { cur: null, scroll: null, stripOpen: false, base: 0 };
function stripBtn() {
  var b = $('appStrip');
  if (b) return b;
  b = document.createElement('button');
  b.type = 'button'; b.id = 'appStrip'; b.hidden = true;
  b.addEventListener('click', function () {
    APP.stripOpen = !APP.stripOpen;
    if (!APP.stripOpen) APP.base = S.chat ? S.chat.msgs.length : 0;
    layoutApp();
  });
  $('chat').querySelector('.top').appendChild(b);
  if (window.MutationObserver) new MutationObserver(function () { stripBadge(); }).observe($('msgs'), { childList: true, subtree: true });
  return b;
}
// 收起期间别人发来的消息数
function stripBadge() {
  var b = $('appStrip');
  if (!b || b.hidden || !S.chat) return;
  var n = 0, ms = S.chat.msgs;
  if (!APP.stripOpen) for (var i = APP.base; i < ms.length; i++) if (S.me && (ms[i].sender_id !== S.me.id || ms[i].author)) n++;
  b.setAttribute('data-n', n ? String(n > 9 ? '9+' : n) : '');
}
export function layoutApp() {
  var layer = $('appLayer'), chat = $('chat');
  if (layer.hidden) return;
  var cr = chat.getBoundingClientRect();
  var top = chat.querySelector('.top').getBoundingClientRect().bottom - cr.top;
  // 消息带子：#msgs 底边（已经在输入栏/面板上方）往上数 30% 的聊天区高度；小程序区域 = 顶栏下沿 到 带子上沿
  var mr = $('msgs').getBoundingClientRect();
  var hid = !!(APP.cur && APP.cur.def.strip === 'hidden');
  var strip = Math.round(Math.min(hid && !APP.stripOpen ? 0 : cr.height * 0.3, mr.height));
  var stripTop = mr.bottom - strip - cr.top;
  chat.style.setProperty('--strip-h', strip + 'px');
  layer.style.setProperty('--app-top', Math.max(0, top) + 'px');
  layer.style.setProperty('--app-bot', Math.max(0, cr.height - stripTop) + 'px');
  layer.style.setProperty('--app-h', Math.max(0, stripTop - top) + 'px');
  var btn = stripBtn();
  btn.hidden = !hid;
  btn.className = APP.stripOpen ? 'open' : '';
  btn.textContent = APP.stripOpen ? '收起消息' : '消息';
  btn.setAttribute('aria-label', APP.stripOpen ? '收起消息' : '展开消息');
  stripBadge();
  if (APP.cur) scrollToBottom(); // 带子里始终是最新几条（输入栏变高时 #msgs 会变矮）
}
export function openApp(id, params) {
  var def = getMiniApp(id);
  if (!def || !S.chat) return false;
  if (def.scope !== 'any' && def.scope !== (S.chat.gid != null ? 'group' : 'dm')) return false; // 私聊的小游戏不能在群里开，反过来也一样；scope 'any' 两边都能开
  params = params || {};
  if (APP.cur) {
    if (APP.cur.id === id && def.same && def.same(APP.cur.params, params)) return true; // 已经开着：保持
    unmountApp();
  }
  closeActMenu();
  var box = clear($('appBody'));
  var mb = $('msgs');
  // 记下打开前的滚动位置（离底部多远），关闭时原样还原
  APP.scroll = { bottom: mb.scrollHeight - mb.scrollTop - mb.clientHeight };
  sand.hold = Date.now() + 700; // 布局切换期间不触发沙子消散
  $('appLayer').hidden = false;
  $('chat').classList.add('app-open');
  APP.cur = { id: id, def: def, params: params, box: box };
  APP.stripOpen = false; APP.base = S.chat.msgs.length;
  $('appLayer').classList.toggle('flush', !!def.flush);
  layoutApp();
  def.mount(box, params);
  return true;
}
function unmountApp() {
  var cur = APP.cur;
  APP.cur = null;
  if (cur) { try { cur.def.unmount(); } catch (e) { /* 小程序出错不影响聊天 */ } }
  clear($('appBody'));
}
export function closeApp() {
  if (!APP.cur) return;
  unmountApp();
  $('appLayer').hidden = true;
  APP.stripOpen = false;
  stripBtn().hidden = true;
  sand.hold = Date.now() + 700;
  $('chat').classList.remove('app-open');
  $('chat').style.removeProperty('--strip-h');
  var mb = $('msgs'), sc = APP.scroll;
  APP.scroll = null;
  if (sc) mb.scrollTop = mb.scrollHeight - mb.clientHeight - sc.bottom;
}
