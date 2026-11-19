// 皮肤表 SKINS

import { sandDisable, sandEnable } from './sand.js';
import { S } from '../state.js';
import { applyTheme, themeMode } from '../theme.js';
import { lsGet, lsSet } from '../utils.js';

// ===== 皮肤（我的 里选；只影响自己看到的样子，存在本机） =====
//   look: true 的皮肤换整套外观（<html data-skin="id">，样式在 css/skin-<id>.css），其余只改气泡的动效
//   sw: [主色, 底色]（选择器里缩略图加载失败时的底色）；thumb / em: 选择器卡片的缩略图和徽记（整套外观皮肤才有）
//   group: 'base' 的是基础皮肤（默认、沙子），其余是门派
export var SKINS = [
  { id: 'default', name: '默认', group: 'base', sw: ['#bb3862', '#f4e3c8'], hint: '气泡保持原来的样子。' },
  { id: 'sand', name: '沙子', group: 'base', sw: ['#c9a46a', '#f4e3c8'], hint: '新消息的文字会从沙粒聚拢成形；滚动时划到顶部的消息会化成沙子散去，滑回来再聚拢。只影响你自己看到的样子。' },
  { id: 'chunyang', name: '纯阳', look: true, sw: ['#3b6a9c', '#e8eef5'], thumb: 'skins/chunyang/thumb.jpg', em: 'skins/chunyang/taiji.png', hint: '华山雪色、道袍青和朱砂印，整套界面换成纯阳宫的样子，聊天页的底色不变。只影响你自己看到的样子。' },
  { id: 'shaolin', name: '少林', look: true, sw: ['#b07a2a', '#efe4cf'], thumb: 'skins/shaolin/thumb.jpg', em: 'skins/shaolin/emblem.png', hint: '银杏古刹的赭黄配色，标题用宋体，时间线是一根禅杖。只影响你自己看到的样子。' },
  { id: 'tiance', name: '天策', look: true, sw: ['#a8322d', '#efe3dc'], thumb: 'skins/tiance/thumb.jpg', em: 'skins/tiance/emblem.png', hint: '旌旗城楼的朱红配色，标题用宋体，时间线是一杆红缨长枪。只影响你自己看到的样子。' },
  { id: 'wanhua', name: '万花', look: true, sw: ['#6d4b8f', '#eee6f2'], thumb: 'skins/wanhua/thumb.jpg', em: 'skins/wanhua/emblem.png', hint: '紫色花谷的配色，标题用宋体，时间线是一支毛笔。只影响你自己看到的样子。' },
  { id: 'qixiu', name: '七秀', look: true, sw: ['#c4567a', '#f6e6ec'], thumb: 'skins/qixiu/thumb.jpg', em: 'skins/qixiu/emblem.png', hint: '桃花与垂柳的粉绿配色，标题用宋体，时间线是一柄系着丝带的短剑。只影响你自己看到的样子。' },
  { id: 'wudu', name: '五毒', look: true, sw: ['#3c4f9a', '#e7e9f4'], thumb: 'skins/wudu/thumb.jpg', em: 'skins/wudu/emblem.png', hint: '苗寨靛蓝配银饰的配色，时间线是一支骨笛。只影响你自己看到的样子。' },
  { id: 'gaibang', name: '丐帮', look: true, sw: ['#4f7d4a', '#e9efe2'], thumb: 'skins/gaibang/thumb.jpg', em: 'skins/gaibang/emblem.png', hint: '竹青、酒褐配赭红，君山芦苇与湖上明月，时间线是挂着酒葫芦的竹棒。只影响你自己看到的样子。' },
  { id: 'cangjian', name: '藏剑', look: true, sw: ['#b8860b', '#f4ecd6'], thumb: 'skins/cangjian/thumb.jpg', em: 'skins/cangjian/emblem.png', hint: '藏剑金配西湖绿，山庄屋檐与湖上灯影，时间线是一柄重剑。只影响你自己看到的样子。' },
  { id: 'tangmen', name: '唐门', look: true, sw: ['#2f5150', '#e3ecea'], thumb: 'skins/tangmen/thumb.jpg', em: 'skins/tangmen/emblem.png', hint: '墨青配银灰，蜀中竹海与悬崖堡垒，时间线是千机匣的弩箭。只影响你自己看到的样子。' },
  { id: 'mingjiao', name: '明教', look: true, sw: ['#b5371f', '#f4e7d8'], thumb: 'skins/mingjiao/thumb.jpg', em: 'skins/mingjiao/emblem.png', hint: '赤红配金，光明顶的白色穹顶与圣火，时间线是一柄弯刀。只影响你自己看到的样子。' },
  { id: 'cangyun', name: '苍云', look: true, sw: ['#3d4450', '#e6e8ec'], thumb: 'skins/cangyun/thumb.jpg', em: 'skins/cangyun/emblem.png', hint: '玄铁灰配血红，雁门关外的城墙与风雪，时间线是一柄陌刀。只影响你自己看到的样子。' },
  { id: 'changge', name: '长歌', look: true, sw: ['#2f7a73', '#e3f0ee'], thumb: 'skins/changge/thumb.jpg', em: 'skins/changge/emblem.png', hint: '千岛湖的青碧、月白与墨色，书院竹亭随昼夜换景，时间线是一根琴弦。只影响你自己看到的样子。' },
  { id: 'badao', name: '霸刀', look: true, sw: ['#8e2f1f', '#f0e4dc'], thumb: 'skins/badao/thumb.jpg', em: 'skins/badao/emblem.png', hint: '太行山下的赤褐、黑与金，雄关石崖在秋色与灯火里切换，时间线是一柄大刀。只影响你自己看到的样子。' },
  { id: 'penglai', name: '蓬莱', look: true, sw: ['#2c6f9e', '#e2eef6'], thumb: 'skins/penglai/thumb.jpg', em: 'skins/penglai/emblem.png', hint: '东海仙岛的海蓝与天青，白鹤浮岛在晴空与明月下换景，时间线是一把收拢的伞。只影响你自己看到的样子。' },
  { id: 'lingxue', name: '凌雪阁', look: true, sw: ['#8a2232', '#eee6e8'], thumb: 'skins/lingxue/thumb.jpg', em: 'skins/lingxue/emblem.png', hint: '长安深雪里的暗红、夜黑与雪白，屋脊宫墙在飞雪与红灯下换景，时间线是带锁链的弯刃。只影响你自己看到的样子。' },
  { id: 'yantian', name: '衍天宗', look: true, sw: ['#4a3a7a', '#e9e6f2'], thumb: 'skins/yantian/thumb.jpg', em: 'skins/yantian/emblem.png', hint: '高山观星台的夜紫、金与星蓝，浑天仪云海在白天与星河间换景，时间线是铜钱和卦签。只影响你自己看到的样子。' },
  { id: 'yaozong', name: '药宗', look: true, sw: ['#3f7a5c', '#e6f0ea'], thumb: 'skins/yaozong/thumb.jpg', em: 'skins/yaozong/emblem.png', hint: '北地雪山药谷的青绿配色，雪白玻璃面板，赭色印章，时间线是一把药锄。只影响你自己看到的样子。' },
  { id: 'daozong', name: '刀宗', look: true, sw: ['#26476b', '#e4ebf2'], thumb: 'skins/daozong/thumb.jpg', em: 'skins/daozong/emblem.png', hint: '东海翁洲的海靛配霜白，赤红印章，时间线是一柄唐横刀。只影响你自己看到的样子。' },
  { id: 'wanling', name: '万灵', look: true, sw: ['#3e6b3a', '#e6eee2'], thumb: 'skins/wanling/thumb.jpg', em: 'skins/wanling/emblem.png', hint: '南方深山的森绿配琥珀金，藤蔓纹面板，赭红印章，时间线是一支羽箭。只影响你自己看到的样子。' },
  { id: 'duanshi', name: '段氏', look: true, sw: ['#a8742a', '#f4eadb'], thumb: 'skins/duanshi/thumb.jpg', em: 'skins/duanshi/emblem.png', hint: '大理洱海苍山的鎏金配色，暖白玻璃面板，朱红印章，时间线是一把合拢的折扇。只影响你自己看到的样子。' },
  { id: 'wuxiang', name: '无相楼', look: true, sw: ['#a8384b', '#f4e6e2'], thumb: 'skins/wuxiang/thumb.jpg', em: 'skins/wuxiang/emblem.png', hint: '泉州永宁湾的胭脂朱配青灰，金色细线，木偶戏台的味道，时间线是提线木偶的提线板。只影响你自己看到的样子。' }
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
