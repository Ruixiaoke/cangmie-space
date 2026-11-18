// 外观：auto / light / dark

import { $, lsGet, lsSet } from './utils.js';

// ===== 外观：auto（自动，跟随系统）/ light（白天）/ dark（晚上） =====
export var THEMES = [['light', '白天'], ['dark', '晚上'], ['auto', '自动']];
var THEME_COLOR = { light: '#f4e3c8', dark: '#1c120d' };
var darkMq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
export function themeMode() { var t = lsGet('chat.theme'); return t === 'light' || t === 'dark' ? t : 'auto'; }
export function applyTheme(mode) {
  var root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode); else root.removeAttribute('data-theme');
  // 浏览器顶栏颜色：自动时交给 media 判断，手动时两个 meta 都设成所选模式的颜色
  var tl = $('tcLight'), td = $('tcDark');
  if (tl) tl.setAttribute('content', mode === 'dark' ? THEME_COLOR.dark : THEME_COLOR.light);
  if (td) td.setAttribute('content', mode === 'light' ? THEME_COLOR.light : THEME_COLOR.dark);
}
export function setTheme(mode) {
  if (mode !== 'light' && mode !== 'dark') mode = 'auto';
  lsSet('chat.theme', mode);
  applyTheme(mode);
}
export function watchSystemTheme() {
  if (!darkMq) return;
  var onChange = function () { if (themeMode() === 'auto') applyTheme('auto'); };
  if (darkMq.addEventListener) darkMq.addEventListener('change', onChange);
  else if (darkMq.addListener) darkMq.addListener(onChange);
}
