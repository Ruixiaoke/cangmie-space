// 外观：auto / light / dark

import { $, lsGet, lsSet } from './utils.js';

// ===== 外观：auto（自动，跟随系统）/ light（白天）/ dark（晚上） =====
export var THEMES = [['light', '白天'], ['dark', '晚上'], ['auto', '自动']];
var THEME_COLOR = { light: '#f4e3c8', dark: '#1c120d' };
// 整套外观的皮肤（skins/index.js 里 look: true）各自的浏览器顶栏颜色；index.html 开头 theme-init 脚本里的 C 表要写同样的值
export var SKIN_COLOR = {
  chunyang: { light: '#e8eef5', dark: '#0f1828' },
  shaolin: { light: '#efe4cf', dark: '#1c160f' },
  tiance: { light: '#efe3dc', dark: '#1a1210' },
  wanhua: { light: '#eee6f2', dark: '#16101c' },
  qixiu: { light: '#f6e6ec', dark: '#1c1016' },
  wudu: { light: '#e7e9f4', dark: '#0f1222' },
  gaibang: { light: '#e9efe2', dark: '#111a10' },
  cangjian: { light: '#f4ecd6', dark: '#1a150a' },
  tangmen: { light: '#e3ecea', dark: '#0d1515' },
  mingjiao: { light: '#f4e7d8', dark: '#1c100b' },
  cangyun: { light: '#e6e8ec', dark: '#101216' },
  changge: { light: '#e3f0ee', dark: '#0d1816' },
  badao: { light: '#f0e4dc', dark: '#1a0f0b' },
  penglai: { light: '#e2eef6', dark: '#0c1620' },
  lingxue: { light: '#eee6e8', dark: '#140b0e' },
  yantian: { light: '#e9e6f2', dark: '#100d1c' },
  yaozong: { light: '#e6f0ea', dark: '#0d1712' },
  daozong: { light: '#e4ebf2', dark: '#0b121c' },
  wanling: { light: '#e6eee2', dark: '#0e160d' },
  duanshi: { light: '#f4eadb', dark: '#1a130a' },
  wuxiang: { light: '#f4e6e2', dark: '#1a0e10' }
};
var darkMq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
export function themeMode() { var t = lsGet('chat.theme'); return t === 'light' || t === 'dark' ? t : 'auto'; }
export function applyTheme(mode) {
  var root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode); else root.removeAttribute('data-theme');
  // 浏览器顶栏颜色：自动时交给 media 判断，手动时两个 meta 都设成所选模式的颜色
  var tl = $('tcLight'), td = $('tcDark'), c = SKIN_COLOR[root.getAttribute('data-skin')] || THEME_COLOR;
  if (tl) tl.setAttribute('content', mode === 'dark' ? c.dark : c.light);
  if (td) td.setAttribute('content', mode === 'light' ? c.light : c.dark);
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
