// 配置：Supabase 占位符（部署时替换）、VAPID 公钥、常量、表情列表、resolveConfig

import { lsGet } from './utils.js';

// ===== 配置 =====
// 部署时由 GitHub Actions 用仓库变量替换这两个占位符；本地调试从 localStorage 读取
var CFG_URL = '__SUPABASE_URL__';
var CFG_KEY = '__SUPABASE_ANON_KEY__';
// 榴莲的头像地址：部署时（frontend.yml）把占位符换成 ../agent/avatar.<后缀>?v=<内容哈希>，头像一换哈希就变；本地调试保持占位符，info.js 里退回默认路径
export var AGENT_AVATAR_SRC = '__AGENT_AVATAR__';
// Web Push 的 VAPID 公钥（公钥可以公开；私钥只放在 Supabase Edge Function 的 secret 里）
export var VAPID_PUBLIC_KEY = 'BHhMeM39Tgd8G3AkzDyjsbNm0yxcQ5t_6-oUFs-YJCVAMEmTZE6zFL2TLfV9h5IQpQMW7GyNNkY-G7ePO2sKMJo';
// 用户名对应的邮箱后缀：email = 用户名 + "@" + EMAIL_DOMAIN（如果 Supabase 拒绝这个域名，改这里）
export var EMAIL_DOMAIN = 'ruixiaoke.github.io';
export var USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export var PAGE = 50;
export var EMOJIS = ['😀','😂','🥹','😍','🥰','😘','😋','😎','🤗','🤔','😴','😭','😡','🥺','😅','🙈',
  '👍','👏','🙏','💪','🎉','✨','💗','💕','💖','❤️','🔥','🌟','🌸','🍫','🍓','🍰',
  '🥕','🐑','🐱','🐶','🌈','☀️','🌙','⭐','🎀','🎁','🍀','☕','🍜','🍙','🧸','👋'];

export function resolveConfig() {
  var u = CFG_URL, k = CFG_KEY;
  if (!u || !k || u.indexOf('__SUPABASE_') === 0 || k.indexOf('__SUPABASE_') === 0) {
    u = lsGet('chat.devSupabaseUrl') || '';
    k = lsGet('chat.devSupabaseAnonKey') || '';
  }
  if (!/^https?:\/\//.test(u) || !k) return null;
  return { url: u.replace(/\/+$/, ''), key: k };
}
