// 皮肤表 SKINS

import { sandDisable, sandEnable } from './sand.js';
import { S } from '../state.js';
import { applyTheme, themeMode } from '../theme.js';
import { lsGet, lsSet } from '../utils.js';

// ===== 皮肤（我的 里选；只影响自己看到的样子，存在本机） =====
//   look: true 的皮肤换整套外观（<html data-skin="id">，样式在 css/skin-<id>.css），其余只改气泡的动效
export var SKINS = [
  { id: 'default', name: '默认', hint: '气泡保持原来的样子。' },
  { id: 'sand', name: '沙子', hint: '新消息的文字会从沙粒聚拢成形；滚动时划到顶部的消息会化成沙子散去，滑回来再聚拢。只影响你自己看到的样子。' },
  { id: 'chunyang', name: '纯阳', look: true, hint: '华山雪色、道袍青和朱砂印，整套界面换成纯阳宫的样子，聊天页的底色不变。只影响你自己看到的样子。' }
];
export function skinById(id) {
  for (var i = 0; i < SKINS.length; i++) if (SKINS[i].id === id) return SKINS[i];
  return SKINS[0];
}
export function skinMode() { return skinById(lsGet('chat.skin')).id; }
// 整套外观：写到 <html data-skin>；index.html 开头的脚本在首屏前已经设过一次，这里保持同步
export function applySkinLook() {
  var k = skinById(skinMode()), root = document.documentElement;
  if (k.look) root.setAttribute('data-skin', k.id); else root.removeAttribute('data-skin');
  applyTheme(themeMode()); // 浏览器顶栏颜色跟着皮肤变
}
export function setSkin(id) { lsSet('chat.skin', skinById(id).id); applySkinLook(); if (S.chat) applySkin(); }
export function applySkin() {
  if (S.chat && skinMode() === 'sand') sandEnable(); else sandDisable();
}
