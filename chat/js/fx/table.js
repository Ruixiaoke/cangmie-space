// 特效表情表 FX：新增特效表情只要在这里加一项（并在 effects.js 里写它的动画）

import { fxDryer, fxFeed, fxFlower, fxHammer, fxKiss, fxNight, fxPat, fxPepper, fxSnow, fxWater } from './effects.js';
import { poolName, poolOf } from '../miniapps/pool.js';
import { slOf } from '../miniapps/sling.js';
import { tttOf } from '../miniapps/ttt.js';

// ===== 特效表情 =====
// 消息内容就是 "[水枪]" 这样的文字：不用改数据库，推送通知和旧版本里也能看懂
// 定向攻击在后面加 "#消息id"，比如 "[雪球]#123"，只打中那一条气泡
export var FX = {
  '[水枪]': { icon: '🔫', name: '水枪', own: '你用水枪滋了 {n}', peer: '{n} 用水枪滋了你', hit: '滋中了「{q}」', at: 700, play: fxWater },
  '[敲头]': { icon: '🔨', name: '敲头', own: '你敲了敲 {n} 的头', peer: '{n} 敲了敲你的头', hit: '敲中了「{q}」', at: 540, play: fxHammer },
  '[飞吻]': { icon: '😘', name: '飞吻', own: '你给 {n} 一个飞吻', peer: '{n} 给你一个飞吻', hit: '吻了吻「{q}」', at: 1000, play: fxKiss },
  '[拍拍]': { icon: '🫳', name: '拍拍', own: '你拍了拍 {n}', peer: '{n} 拍了拍你', hit: '拍了拍「{q}」', at: 600, play: fxPat },
  '[雪球]': { icon: '❄️', name: '雪球', own: '你朝 {n} 扔了个雪球', peer: '{n} 朝你扔了个雪球', hit: '砸中了「{q}」', at: 700, play: fxSnow },
  '[辣椒]': { icon: '🌶️', name: '辣椒', own: '你给 {n} 塞了个辣椒', peer: '{n} 给你塞了个辣椒', hit: '辣到了「{q}」', at: 800, play: fxPepper },
  '[吹风]': { icon: '💨', name: '吹风机', own: '你用吹风机吹了吹 {n}', peer: '{n} 用吹风机吹了吹你', hit: '吹了吹「{q}」', at: 700, play: fxDryer },
  '[投喂]': { icon: '🥕', name: '投喂', own: '你给 {n} 投喂了胡萝卜', peer: '{n} 给你投喂了胡萝卜', hit: '喂了「{q}」', at: 900, play: fxFeed },
  '[晚安]': { icon: '🌙', name: '晚安', own: '你对 {n} 说了晚安', peer: '{n} 对你说了晚安', hit: '对「{q}」说了晚安', at: 900, play: fxNight },
  '[送花]': { icon: '🌸', name: '送花', own: '你送了 {n} 一束花', peer: '{n} 送了你一束花', hit: '给「{q}」送了花', at: 900, play: fxFlower }
};
var FX_RE = /^(\[[^\[\]#]{1,4}\])(?:#(\d{1,15}))?$/;
export function fxParse(body) {
  if (typeof body !== 'string') return null;
  var mt = FX_RE.exec(body);
  if (!mt || !Object.prototype.hasOwnProperty.call(FX, mt[1])) return null;
  return { tok: mt[1], fx: FX[mt[1]], tid: mt[2] ? parseInt(mt[2], 10) : null };
}
export function fxOf(body) { var p = fxParse(body); return p ? p.fx : null; }
// 消息列表里的预览：定向特效不显示后面的 #id
export function previewOf(body) { if (tttOf(body) != null) return '井字棋'; if (slOf(body) != null) return '弹弓大战'; if (poolOf(body) != null) return poolName(body); var p = fxParse(body); return p ? p.tok : body; }
