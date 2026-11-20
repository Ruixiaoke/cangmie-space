// 启动：所有真正的工作都从 boot() 开始

import { authMsg, setAuthMode, show, showAuth } from './auth.js';
import { buildEmojiPanel } from './composer.js';
import { resolveConfig } from './config.js';
import { closeChat } from './chat/view.js';
import { initDesktop } from './desktop.js';
import { bind } from './events.js';
import { closeGroupInfo, groupInfoOpen } from './groups/info.js';
import { closeApp } from './miniapps/host.js';
import { closeLeaderboard } from './miniapps/leaderboard.js';
import { buildPlusPanel, closePanels } from './plus.js';
import { stopRealtime } from './realtime.js';
import { enterApp, resetState } from './session.js';
import { S, cfg, sb, setCfg, setSb } from './state.js';
import { applySkinLook } from './skins/index.js';
import { watchSystemTheme } from './theme.js';
import { setMascot } from './mascot.js';
import { $ } from './utils.js';
import { fitViewport } from './viewport.js';

// ===== 启动 =====
export async function boot() {
  applySkinLook(); // 皮肤（data-skin）和外观（data-theme、浏览器顶栏颜色）
  watchSystemTheme();
  setMascot($('bootHero'), 'normal');
  setMascot($('unconfHero'), 'normal');
  setMascot($('deskHero'), 'normal');
  setCfg(resolveConfig());
  if (!cfg) return show('unconfigured');
  if (typeof supabase === 'undefined' || !supabase.createClient) {
    $('unconfigured').querySelector('p').textContent = '没有加载到 Supabase 脚本，请检查网络后刷新页面。';
    return show('unconfigured');
  }
  setSb(supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }));
  buildEmojiPanel();
  buildPlusPanel();
  bind();
  // 桌面端双栏的键盘操作（Esc 一层层关、Alt+上下切会话）
  initDesktop({
    closePanels: closePanels, closeApp: closeApp, closeChat: closeChat,
    closeOverlay: function () {
      if (groupInfoOpen()) { closeGroupInfo(); return true; }
      var lb = document.querySelector('#rankSheet:not([hidden])');
      if (lb) { closeLeaderboard(); return true; }
      return false;
    }
  });
  setAuthMode('login');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { /* 不支持就算了 */ });
  sb.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_OUT' && S.me) {
      setTimeout(function () { stopRealtime(); resetState(); showAuth(); }, 0); // 会话失效（比如在别处退出）
    }
  });
  var s = await sb.auth.getSession();
  if (s.data && s.data.session) await enterApp(); else showAuth();
  fitViewport();
}
boot().catch(function (e) {
  console.error(e);
  show('auth');
  authMsg('启动失败，请刷新页面重试');
});
