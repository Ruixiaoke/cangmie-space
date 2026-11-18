// 界面切换 + 登录 / 注册

import { EMAIL_DOMAIN, USERNAME_RE } from './config.js';
import { authErrText } from './errors.js';
import { enterApp } from './session.js';
import { sb } from './state.js';
import { setMascot } from './mascot.js';
import { $, sleep } from './utils.js';

// ===== 界面切换 =====
export function show(screenId) {
  ['boot', 'unconfigured', 'auth', 'app'].forEach(function (id) { $(id).hidden = id !== screenId; });
  if (screenId !== 'app') $('chat').hidden = true;
}

// ===== 登录 / 注册 =====
var authMode = 'login', authBusy = false;
export function setAuthMode(mode) {
  authMode = mode;
  $('segLogin').classList.toggle('on', mode === 'login');
  $('segRegister').classList.toggle('on', mode === 'register');
  $('fNick').hidden = mode !== 'register';
  $('regHint').hidden = mode !== 'register';
  $('fPass').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
  $('authSubmit').textContent = mode === 'login' ? '登录' : '注册';
  authMsg('');
}
export function authMsg(text, ok) {
  var el = $('authMsg');
  el.textContent = text;
  el.classList.toggle('ok', !!ok);
}
export function showAuth() {
  show('auth');
  setMascot($('heroBox'), 'normal');
  $('heroBox').classList.add('bob');
  $('heroBox').classList.remove('cheer');
  $('fPass').value = '';
  authBusy = false;
  $('authSubmit').disabled = false;
}
export async function submitAuth(ev) {
  ev.preventDefault();
  if (authBusy) return;
  var username = $('fUser').value.trim().toLowerCase();
  var password = $('fPass').value;
  if (!USERNAME_RE.test(username)) return authMsg('用户名需要 3 到 20 位，只能用小写字母、数字和下划线');
  if (password.length < 6) return authMsg('密码至少需要 6 位');
  var email = username + '@' + EMAIL_DOMAIN;
  authBusy = true;
  $('authSubmit').disabled = true;
  authMsg('');
  try {
    var res;
    if (authMode === 'register') {
      var av = await sb.rpc('username_available', { p_username: username });
      if (!av.error && av.data === false) { authMsg('这个用户名已经被占用了，换一个吧'); return finishAuthFail(); }
      var nickname = $('fNick').value.trim().slice(0, 20);
      res = await sb.auth.signUp({ email: email, password: password, options: { data: nickname ? { nickname: nickname } : {} } });
      if (res.error) { authMsg(authErrText(res.error)); return finishAuthFail(); }
      if (!res.data.session) {
        authMsg('注册成功，但服务器要求邮箱验证，暂时无法登录。请管理员在 Supabase 后台（Authentication，Sign In / Providers，Email）关闭 “Confirm email”。');
        return finishAuthFail();
      }
    } else {
      res = await sb.auth.signInWithPassword({ email: email, password: password });
      if (res.error && res.error.code === 'invalid_credentials') {
        res = await sb.auth.signInWithPassword({ email: username + '@users.local', password: password });
      }
      if (res.error) { authMsg(authErrText(res.error)); return finishAuthFail(); }
    }
    // 成功：吉祥物欢呼一下，再进入
    var hero = $('heroBox');
    setMascot(hero, 'cheer');
    hero.classList.remove('bob');
    hero.classList.add('cheer');
    authMsg(authMode === 'register' ? '注册成功，欢迎你' : '登录成功', true);
    await sleep(900);
    $('fPass').value = '';
    await enterApp();
  } catch (e) {
    authMsg(authErrText(e));
    finishAuthFail();
  }
}
function finishAuthFail() { authBusy = false; $('authSubmit').disabled = false; }
