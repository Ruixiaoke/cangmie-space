// 小程序注册表：新增小程序 = 新建 miniapps/<名字>.js，然后在 listMiniApps() 里加一行（+ 面板和宿主都读这里）。用函数而不是顶层数组，避免循环导入时读到还没初始化的值

import { ddzV } from './ddz.js';
import { poolV } from './pool.js';
import { slV } from './sling.js';
import { tttV } from './ttt.js';

// 每个小程序有 scope：'dm' = 只在私聊里（双人回合制小游戏），'group' = 只在群聊里（多人游戏，目前只有斗地主）
export function listMiniApps() {
  return [
    tttV,
    slV,
    poolV,
    ddzV
  ];
}
export function appsForScope(scope) {
  return listMiniApps().filter(function (a) { return a.scope === scope; });
}
export function getMiniApp(id) {
  var apps = listMiniApps();
  for (var i = 0; i < apps.length; i++) if (apps[i].id === id) return apps[i];
  return undefined;
}
