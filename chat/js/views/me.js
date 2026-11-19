// 渲染：我的（通知、外观、皮肤、配方图鉴入口、退出）

import { errText } from '../errors.js';
import { svgIcon } from '../menu.js';
import { pushSubscribe, pushSupported, pushUnsubscribe } from '../notify.js';
import { RECIPES, openRecipes, recipeCount } from '../recipes.js';
import { logout } from '../session.js';
import { SKINS, setSkin, skinById, skinMode } from '../skins/index.js';
import { S, makeAvatar, sb } from '../state.js';
import { THEMES, setTheme, themeMode } from '../theme.js';
import { emptyState } from '../mascot.js';
import { $, clear, h, lsGet, lsSet, toast } from '../utils.js';
import { uploadAvatar } from './avatar-upload.js';

// ===== 渲染：我的 =====
var iosHint = '在 iPhone / iPad 的 Safari 里还不能开启通知（需要 iOS 16.4 或更高）。请先点底部的「分享」，选「添加到主屏幕」，再从主屏幕上的图标打开本页，回到这里再开启通知。';
function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}
function notifSupported() { return 'Notification' in window && 'serviceWorker' in navigator; }
export function notifOn() {
  return notifSupported() && Notification.permission === 'granted' && lsGet('chat.notify') !== '0';
}
function notifStateText() {
  if (!notifSupported()) return '当前浏览器不支持';
  if (Notification.permission === 'denied') return '已被浏览器拦截';
  if (Notification.permission === 'granted') return notifOn() ? '已开启' : '已关闭';
  return '未开启';
}
export function renderMe() {
  var box = clear($('meBody'));
  if (!S.me) return;
  var fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  fileInput.addEventListener('change', function () { if (fileInput.files[0]) uploadAvatar(fileInput.files[0]); fileInput.value = ''; });
  var avatarBtn = h('button', { type: 'button', class: 'btn small ghost', text: '更换头像', onclick: function () { fileInput.click(); } });
  box.appendChild(h('div', { class: 'me-head' },
    makeAvatar(S.me, 104),
    h('div', { class: 'name', text: S.me.nickname }),
    h('div', { class: 'uname', text: '用户名 @' + S.me.username + '（不可修改）' }),
    avatarBtn, fileInput));

  var nick = h('input', { class: 'field', type: 'text', maxlength: '20', value: S.me.nickname, placeholder: '昵称（1 到 20 个字）', autocomplete: 'off' });
  var save = h('button', { type: 'button', class: 'btn small', text: '保存' });
  save.addEventListener('click', async function () {
    var v = nick.value.trim();
    if (!v || v.length > 20) return toast('昵称需要 1 到 20 个字');
    save.disabled = true;
    var r = await sb.rpc('update_profile', { p_nickname: v, p_avatar_path: null });
    save.disabled = false;
    if (r.error) return toast(errText(r.error));
    S.me = r.data; S.profiles.set(S.me.id, S.me);
    toast('昵称已更新');
    renderMe();
  });
  box.appendChild(h('div', { class: 'panel' }, h('h3', { text: '昵称' }), h('div', { class: 'row-flex' }, nick, save)));

  var cur = themeMode();
  var themeBtns = THEMES.map(function (t) {
    return h('button', {
      type: 'button', role: 'radio', 'aria-checked': t[0] === cur ? 'true' : 'false', class: t[0] === cur ? 'on' : '', text: t[1],
      onclick: function () {
        setTheme(t[0]);
        themeBtns.forEach(function (b, i) {
          var on = THEMES[i][0] === t[0];
          b.className = on ? 'on' : ''; b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
      }
    });
  });
  var themeSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '外观', style: 'margin-bottom:0' });
  themeBtns.forEach(function (b) { themeSeg.appendChild(b); });
  box.appendChild(h('div', { class: 'panel' }, h('h3', { text: '外观' }), themeSeg,
    h('p', { class: 'hint', style: 'margin-top:12px', text: '自动会跟随手机的白天或晚上设置。' })));

  // 皮肤：上面「基础」（默认、沙子），下面「门派」，每个门派一张卡片（场景缩略图 + 左上角徽记 + 名字）。
  // 缩略图加载失败就退回成主色和底色的斜分色块；下面的说明跟着选中项变
  var skinCur = skinMode();
  var skinNow = h('b', { class: 'skin-now-nm', text: skinById(skinCur).name });
  var skinHint = h('span', { text: skinById(skinCur).hint });
  var skinCards = [];
  function pickSkin(k) {
    setSkin(k.id);
    skinNow.textContent = k.name; skinHint.textContent = k.hint;
    skinCards.forEach(function (c) {
      var on = c._id === k.id;
      c.classList.toggle('on', on); c.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }
  function skinCard(k) {
    var sw = k.sw || ['#bb3862', '#f4e3c8'];
    var art = h('span', { class: 'skin-art skin-art-' + k.id, 'aria-hidden': 'true', style: '--sw-a:' + sw[0] + ';--sw-b:' + sw[1] });
    if (k.thumb) {
      var img = h('img', { class: 'skin-thumb', src: k.thumb, alt: '', draggable: 'false', loading: 'lazy' });
      img.addEventListener('error', function () { img.remove(); art.classList.add('nothumb'); });
      art.appendChild(img);
    }
    if (k.em) {
      var em = h('img', { class: 'skin-em', src: k.em, alt: '', draggable: 'false', loading: 'lazy' });
      em.addEventListener('error', function () { em.remove(); });
      art.appendChild(em);
    }
    var c = h('button', {
      type: 'button', role: 'radio', class: 'skin-card' + (k.id === skinCur ? ' on' : ''), 'aria-checked': k.id === skinCur ? 'true' : 'false',
      onclick: function () { pickSkin(k); }
    }, art, h('span', { class: 'skin-nm', text: k.name }), h('span', { class: 'skin-tick', 'aria-hidden': 'true' }));
    c._id = k.id;
    skinCards.push(c);
    return c;
  }
  var baseRow = h('div', { class: 'skin-grid skin-base' });
  var sectRow = h('div', { class: 'skin-grid' });
  SKINS.forEach(function (k) { (k.group === 'base' ? baseRow : sectRow).appendChild(skinCard(k)); });
  var picker = h('div', { class: 'skin-picker', role: 'radiogroup', 'aria-label': '皮肤' },
    h('div', { class: 'skin-sec' }, '基础'), baseRow,
    h('div', { class: 'skin-sec' }, '门派'), sectRow);
  box.appendChild(h('div', { class: 'panel' }, h('h3', { text: '皮肤' }), picker,
    h('p', { class: 'hint skin-now' }, skinNow, skinHint)));

  var toggle = h('button', { type: 'button', class: 'toggle', role: 'switch', 'aria-label': '消息通知' });
  toggle.setAttribute('aria-checked', notifOn() ? 'true' : 'false');
  toggle.disabled = !notifSupported() || (Notification.permission === 'denied');
  toggle.addEventListener('click', toggleNotify);
  var panel = h('div', { class: 'panel' }, h('h3', { text: '通知' }),
    h('div', { class: 'switch-row' }, h('div', null, h('div', { class: 'lbl', text: '新消息和好友请求提醒' }), h('div', { class: 'state', text: notifStateText() })), toggle),
    h('p', { class: 'hint', style: 'margin-top:12px', text: pushSupported() ? '开启后，即使页面在后台或已经关闭，也能收到新消息和好友请求的系统通知。' : '只在页面开着（含后台标签页）时提醒，关掉页面后收不到。' }));
  if (!notifSupported()) panel.appendChild(h('p', { class: 'hint', style: 'margin-top:8px', text: /iPhone|iPad|iPod/.test(navigator.userAgent) && !isStandalone() ? iosHint : '当前浏览器不支持通知。' }));
  else if (Notification.permission === 'denied') panel.appendChild(h('p', { class: 'hint', style: 'margin-top:8px', text: '通知被浏览器拦截了，请在浏览器的网站设置里允许通知，然后刷新页面。' }));
  box.appendChild(panel);

  var rc = h('button', { type: 'button', class: 'card', onclick: openRecipes },
    h('span', { class: 'ri' }, svgIcon('i-book')),
    h('div', { class: 'info' }, h('div', { class: 'name', text: '配方图鉴 ' + recipeCount() + '/' + RECIPES.length }),
      h('div', { class: 'line2', text: '特效表情的隐藏玩法' })),
    h('span', { class: 'chev' }, svgIcon('i-chevron-right')));
  box.appendChild(rc);
  box.appendChild(h('div', { class: 'panel' }, h('h3', { text: '账号' }),
    h('button', { type: 'button', class: 'btn danger', style: 'width:100%', text: '退出登录', onclick: logout })));
  box.appendChild(emptyState('藏剑和纯阳都在这里陪你', true));
}
async function toggleNotify() {
  if (!notifSupported()) return toast('当前浏览器不支持通知');
  if (notifOn()) { lsSet('chat.notify', '0'); await pushUnsubscribe(); renderMe(); return; }
  if (Notification.permission === 'denied') return toast('通知被浏览器拦截了，请在网站设置里允许');
  try {
    // 请求权限和订阅都必须紧跟在用户点击之后（iOS 的要求）
    if (Notification.permission !== 'granted') {
      var p = await Notification.requestPermission();
      if (p !== 'granted') { toast('没有开启通知'); renderMe(); return; }
    }
    if (pushSupported()) {
      var err = await pushSubscribe();
      if (err) { lsSet('chat.notify', '0'); toast(err); renderMe(); return; }
    }
    lsSet('chat.notify', '1'); toast('通知已开启');
  } catch (e) { toast('当前浏览器不支持通知'); }
  renderMe();
}
