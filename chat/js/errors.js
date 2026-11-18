// 错误翻译

import { EMAIL_DOMAIN } from './config.js';

// ===== 错误翻译 =====
export var ERR_TEXT = {
  user_not_found: '没有找到这个用户',
  cannot_add_self: '不能加自己为好友哦',
  already_friends: '你们已经是好友啦',
  request_already_sent: '已经发过请求了，等对方回应吧',
  request_not_found: '这条请求已经处理过了',
  not_friends: '你们还不是好友，不能发消息',
  empty_message: '消息不能是空的',
  message_too_long: '消息太长啦（最多 2000 字）',
  agent_busy: '助手还在想上一个问题呢，等它回完再问',
  agent_rate_limited: '今天问助手的次数用完啦，明天再来',
  agent_forbidden: '这条消息没法交给助手了，重新发一次吧',
  agent_not_mentioned: '这条消息没法交给助手了，重新发一次吧',
  agent_too_old: '这条消息太久了，重新发一次再叫助手吧',
  not_group_member: '你已经不在这个群里了',
  not_group_owner: '只有群主可以这样做',
  group_full: '群里最多 50 个人',
  invalid_group_name: '群名需要 1 到 20 个字',
  invalid_members: '至少选一位好友',
  agent_not_enabled: '先在群设置里打开这个助手',
  invalid_reply: '引用的消息已经不存在了，请重新发送',
  invalid_nickname: '昵称需要 1 到 20 个字',
  invalid_avatar: '头像保存失败，请换一张图片试试',
  not_authenticated: '登录已过期，请重新登录',
  invalid_argument: '操作无效',
  game_not_found: '找不到这局井字棋',
  not_your_turn: '还没轮到你',
  cell_taken: '这一格已经有人下了',
  game_over: '这局已经结束了',
  stale_turn: '这一发已经过期了，已刷新',
  invalid_ammo: '操作无效',
  invalid_shot: '这一发无效，再试一次',
  invalid_cell: '操作无效',
  invalid_cue: '白球不能放在这里',
};
export function errText(e) {
  var m = (e && e.message) || '';
  if (ERR_TEXT[m]) return ERR_TEXT[m];
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return '网络不太好，稍后再试';
  if (/JWT|expired/i.test(m)) return ERR_TEXT.not_authenticated;
  return '出错了，请稍后再试';
}
export function authErrText(e) {
  var code = (e && (e.code || e.error_code)) || '', m = ((e && e.message) || '').toLowerCase();
  if (code === 'invalid_credentials' || /invalid login credentials/.test(m)) return '用户名或密码不对';
  if (code === 'user_already_exists' || code === 'email_exists' || /already (been )?registered|already exists/.test(m)) return '这个用户名已经被占用了';
  if (code === 'weak_password' || /password should be at least|weak/.test(m)) return '密码太简单，至少需要 6 位（建议字母加数字）';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || (e && e.status === 429) || /rate limit|too many/.test(m)) return '操作太频繁了，请过一会儿再试';
  if (code === 'email_not_confirmed' || /email not confirmed/.test(m)) return '账号还没有通过邮箱验证。请管理员在 Supabase 后台关闭 “Confirm email”。';
  if (code === 'email_address_invalid' || /email address .*invalid|invalid email|unable to validate email/.test(m)) {
    return '服务器不接受这个邮箱格式（' + EMAIL_DOMAIN + '）。请管理员修改页面里的 EMAIL_DOMAIN。';
  }
  if (/database error saving new user/.test(m)) return '这个用户名不能用，请用 3 到 20 位小写字母、数字或下划线';
  if (code === 'signup_disabled' || /signups? not allowed|signup is disabled/.test(m)) return '当前不开放注册';
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return '网络不太好，稍后再试';
  return '出错了，请稍后再试';
}
