// 小程序注册表：新增小程序 = 新建 miniapps/<名字>.js，然后在 listMiniApps() 里加一行（+ 面板和宿主都读这里）。用函数而不是顶层数组，避免循环导入时读到还没初始化的值

import { poolV } from './pool.js';
import { slV } from './sling.js';
import { tttV } from './ttt.js';

export function listMiniApps() {
  return [
    tttV,
    slV,
    poolV
  ];
}
export function getMiniApp(id) {
  var apps = listMiniApps();
  for (var i = 0; i < apps.length; i++) if (apps[i].id === id) return apps[i];
  return undefined;
}
