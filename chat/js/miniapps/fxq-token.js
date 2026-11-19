// 飞行棋邀请消息 "[飞行棋]#<桌 id>" 的识别（单独放一个文件：预览 / 引用 / 菜单都要用，不想把整个小程序模块拉进循环导入）
// 群聊和私聊里都是卡片（用 fxqKind 判断，见 fxq.js）
export function fxqOf(body) {
  var m = typeof body === 'string' ? /^\[飞行棋\]#(\d{1,15})$/.exec(body) : null;
  return m ? parseInt(m[1], 10) : null;
}
