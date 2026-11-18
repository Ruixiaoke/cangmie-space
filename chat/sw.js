// 聊天页的 Service Worker：接收 Web Push 并显示通知，处理点击通知；不做离线缓存。
// 页面不支持 Push 时，页面自己调用 showNotification 作为后备。

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if (c.url.indexOf(self.registration.scope) === 0) {
        try { await c.focus(); } catch (e) { /* 忽略 */ }
        c.postMessage({ type: 'notification-click', peer: data.peer || null, tab: data.tab || null });
        return;
      }
    }
    // 没有已打开的页面：新开一个，带上参数，页面登录后会自己跳转
    const url = new URL('./', self.registration.scope);
    if (data.peer) url.searchParams.set('peer', data.peer);
    else if (data.tab) url.searchParams.set('tab', data.tab);
    await self.clients.openWindow(url.href);
  })());
});

// ===== Web Push =====
function isApple() {
  return /iPhone|iPad|iPod|Macintosh|Safari/.test(self.navigator.userAgent) && !/Chrome|Chromium|Android|Edg\//.test(self.navigator.userAgent);
}

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  const icon = new URL('icon-192.png', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = wins.filter((c) => c.url.indexOf(self.registration.scope) === 0);
    const visible = mine.some((c) => c.visibilityState === 'visible');
    // 页面正在前台：非苹果浏览器只通知页面，不弹系统通知。
    // 苹果平台：正常情况下服务器已经因为这台设备在前台而没有推送（见 send-push 的 active_until）；
    // 万一仍然收到（心跳刚好过期的竞态），Safari 收到推送却什么都没显示可能撤销推送权限，所以照常显示。
    if (visible && !isApple()) {
      mine.forEach((c) => c.postMessage({ type: 'push', peer: d.peer || null, tab: d.tab || null, tag: d.tag || null }));
      return;
    }
    await self.registration.showNotification(d.title || '藏咩空间', {
      body: d.body || '',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      icon: icon,
      badge: icon,
      data: { peer: d.peer || null, tab: d.tab || null }
    });
  })());
});

// 订阅被浏览器轮换时尽量重新订阅；服务器上的旧记录会在下次推送返回 404 / 410 时被清掉，
// 新的订阅由页面下次登录时同步（需要登录态，这里没法保存）
self.addEventListener('pushsubscriptionchange', (event) => {
  const old = event.oldSubscription;
  const key = old && old.options && old.options.applicationServerKey;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(() => {})
  );
});
