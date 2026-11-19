// 斗地主邀请消息 "[斗地主]#<桌 id>" 的识别（单独放一个文件：预览 / 引用 / 菜单都要用，不想把整个小程序模块拉进循环导入）
// 只有群聊里才会当卡片，私聊里它就是普通文字（用 ddzKind 判断，见 ddz.js）
export function ddzOf(body) {
  var m = typeof body === 'string' ? /^\[斗地主\]#(\d{1,15})$/.exec(body) : null;
  return m ? parseInt(m[1], 10) : null;
}
