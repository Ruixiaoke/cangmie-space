// 配方图鉴

import { svgIcon } from './menu.js';
import { S } from './state.js';
import { $, clear, h, lsGet, lsSet, toast } from './utils.js';
import { renderMe } from './views/me.js';

// ===== 配方图鉴：每个有名字的变化 / 三连 / 对战，在这台设备上第一次“现场”演出时解锁 =====
export var RECIPES = [
  { id: 'steambath', name: '蒸汽浴', icon: '♨️', hint: '用水枪滋一个正在发热的人' },
  { id: 'melt', name: '化冰', icon: '💧', hint: '给冻住的人塞个辣椒' },
  { id: 'freezewet', name: '冰封', icon: '🧊', hint: '朝湿透的人扔雪球' },
  { id: 'shatter', name: '碎冰', icon: '🔨', hint: '敲一敲冻住的人' },
  { id: 'passion', name: '热恋', icon: '💞', hint: '给爱到最满的人送花' },
  { id: 'burp', name: '打嗝', icon: '🫧', hint: '拍拍圆滚滚的人' },
  { id: 'carrot', name: '吐萝卜', icon: '🥕', hint: '敲一敲吃撑了的人' },
  { id: 'nodisperse', name: '吹不散', icon: '💗', hint: '对满心是爱的人吹风' },
  { id: 'petalsaway', name: '落花', icon: '🌸', hint: '对戴着花环的人吹风' },
  { id: 'wake', name: '叫醒', icon: '⏰', hint: '水枪滋醒，或让对方发消息' },
  { id: 'evap', name: '蒸发', icon: '☁️', hint: '用水枪滋热恋中的人' },
  { id: 'moreice', name: '冰上加冰', icon: '❄️', hint: '用水枪滋冻住的人' },
  { id: 'meltwarm', name: '暖暖化开', icon: '🫠', hint: '给冻住的人一个飞吻' },
  { id: 'hiss', name: '嘶嘶对消', icon: '💨', hint: '朝发热的人扔雪球' },
  { id: 'wilt', name: '花朵枯萎', icon: '🥀', hint: '给戴着花环的人塞辣椒' },
  { id: 'flowerwilt', name: '花谢', icon: '🥀', hint: '给发热的人送花' },
  { id: 'thaw', name: '解冻', icon: '🌤️', hint: '对冻住的人吹风' },
  { id: 'soaked', name: '落花流水', icon: '🌧️', hint: '用水枪滋戴着花环的人' },
  { id: 'gentle', name: '轻轻拍', icon: '💤', hint: '拍拍已经睡着的人' },
  { id: 'spicylove', name: '辣味爱情', icon: '🌶️', hint: '给满怀爱意的人塞辣椒' },
  { id: 'knockflowers', name: '落英缤纷', icon: '🌼', hint: '敲一敲热恋中的人' },
  { id: 'cooldown', name: '冷静一下', icon: '🌨️', hint: '朝热恋中的人扔雪球' },
  { id: 'shiver', name: '冻得发抖', icon: '🥶', hint: '拍拍冻住的人' },
  { id: 'bigflame', name: '火上浇油', icon: '🔥', hint: '给已经发热的人再塞辣椒' },
  { id: 'flare', name: '呼啦火苗', icon: '🔥', hint: '对发热的人吹风' },
  { id: 'c_water', name: '水漫聊天框', icon: '🌊', hint: '8 秒内连发 3 次水枪' },
  { id: 'c_kiss', name: '爱心雨', icon: '💞', hint: '8 秒内连发 3 次飞吻' },
  { id: 'c_hammer', name: '群星环绕', icon: '🌟', hint: '8 秒内连发 3 次敲头' },
  { id: 'c_snow', name: '暴风雪', icon: '🌨️', hint: '8 秒内连发 3 次雪球' },
  { id: 'c_pepper', name: '烈焰边框', icon: '🔥', hint: '8 秒内连发 3 次辣椒' },
  { id: 'c_dryer', name: '龙卷风', icon: '🌪️', hint: '8 秒内连发 3 次吹风' },
  { id: 'c_feed', name: '美食堆', icon: '🍱', hint: '8 秒内连发 3 次投喂' },
  { id: 'c_flower', name: '花瓣风暴', icon: '💮', hint: '8 秒内连发 3 次送花' },
  { id: 'c_pat', name: '大手拍屏', icon: '🫳', hint: '8 秒内连发 3 次拍拍' },
  { id: 'c_night', name: '星空夜', icon: '🌌', hint: '8 秒内连发 3 次晚安' },
  { id: 'battle', name: '对战', icon: '⚔️', hint: '10 秒内回敬对方同样的表情' }
];
export var RC_IDX = {};
RECIPES.forEach(function (r, i) { RC_IDX[r.id] = i; });
function recipesGot() {
  var out = {}, raw = lsGet('chat.recipes'), arr = [];
  try { arr = raw ? JSON.parse(raw) : []; } catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  arr.forEach(function (id) { if (RC_IDX[id] != null) out[id] = 1; });
  return out;
}
export function recipeCount() { return Object.keys(recipesGot()).length; }
var recipeFresh = null;
export function unlockRecipe(id) {
  if (RC_IDX[id] == null) return;
  var got = recipesGot();
  if (got[id]) return;
  got[id] = 1;
  lsSet('chat.recipes', JSON.stringify(Object.keys(got)));
  recipeFresh = id;
  toast('解锁新配方：' + RECIPES[RC_IDX[id]].name, 2600);
  if (S.tab === 'me' && !S.chat) renderMe();
  if ($('recipeSheet')) renderRecipes();
}
function renderRecipes() {
  var sheet = $('recipeSheet'); if (!sheet) return;
  var got = recipesGot(), n = RECIPES.length, cnt = Object.keys(got).length;
  var grid = clear(sheet.querySelector('.rc-grid'));
  sheet.querySelector('.count').textContent = cnt + '/' + n;
  RECIPES.forEach(function (r) {
    var on = !!got[r.id];
    grid.appendChild(h('div', { class: 'rc' + (on ? '' : ' lock') + (recipeFresh === r.id ? ' fresh' : '') },
      h('div', { class: 'ico', text: on ? r.icon : '❔', 'aria-hidden': 'true' }),
      h('div', { class: 'nm', text: on ? r.name : '???' }),
      h('div', { class: 'ht', text: r.hint })));
  });
  recipeFresh = null;
}
export function openRecipes() {
  var ex = $('recipeSheet');
  if (ex) { if (ex.classList.contains('show')) return; ex.parentNode.removeChild(ex); }
  var resetBtn = h('button', { type: 'button', class: 'rc-reset', text: '重置图鉴' });
  var armed = 0;
  resetBtn.addEventListener('click', function () {
    if (!armed) { armed = 1; resetBtn.textContent = '再点一次确认重置'; setTimeout(function () { armed = 0; resetBtn.textContent = '重置图鉴'; }, 3000); return; }
    lsSet('chat.recipes', '[]'); armed = 0; resetBtn.textContent = '重置图鉴';
    renderRecipes(); if (S.tab === 'me') renderMe();
  });
  var sheet = h('div', { id: 'recipeSheet', role: 'dialog', 'aria-label': '配方图鉴' },
    h('div', { class: 'sheet' },
      h('div', { class: 'sh-top' }, h('h3', null, '配方图鉴', h('span', { class: 'count' })),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': '关闭', onclick: closeRecipes }, svgIcon('i-x'))),
      h('div', { class: 'rc-grid' }), resetBtn));
  sheet.addEventListener('click', function (ev) { if (ev.target === sheet) closeRecipes(); });
  $('shell').appendChild(sheet);
  renderRecipes();
  void sheet.offsetWidth;
  sheet.classList.add('show');
}
function closeRecipes() {
  var sheet = $('recipeSheet'); if (!sheet) return;
  sheet.classList.remove('show');
  setTimeout(function () { if (sheet.parentNode && !sheet.classList.contains('show')) sheet.parentNode.removeChild(sheet); }, 320);
}
