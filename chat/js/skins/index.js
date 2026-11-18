// 皮肤表 SKINS

import { sandDisable, sandEnable } from './sand.js';
import { S } from '../state.js';
import { lsGet, lsSet } from '../utils.js';

// ===== 皮肤（我的 里选；只影响自己看到的样子，存在本机） =====
export var SKINS = [
  { id: 'default', name: '默认', hint: '气泡保持原来的样子。' },
  { id: 'sand', name: '沙子', hint: '新消息的文字会从沙粒聚拢成形；滚动时划到顶部的消息会化成沙子散去，滑回来再聚拢。只影响你自己看到的样子。' }
];
export function skinById(id) {
  for (var i = 0; i < SKINS.length; i++) if (SKINS[i].id === id) return SKINS[i];
  return SKINS[0];
}
export function skinMode() { return skinById(lsGet('chat.skin')).id; }
export function setSkin(id) { lsSet('chat.skin', skinById(id).id); if (S.chat) applySkin(); }
export function applySkin() {
  if (S.chat && skinMode() === 'sand') sandEnable(); else sandDisable();
}
