// 皮肤截图：SKIN=chunyang|default，主题 light / dark，默认 390x844；桌面用 VW=1440 VH=900（DSF 默认 2）
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const PORT = Number(process.env.PORT || 8079), WT = process.env.WT, OUT = process.env.OUT, SKIN = process.env.SKIN || 'chunyang', ONLY = process.env.ONLY || '';
const VW = Number(process.env.VW || 390), VH = Number(process.env.VH || 844), DSF = Number(process.env.DSF || 2);
fs.mkdirSync(OUT, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => {
  let f = path.join(WT, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
}).listen(PORT);
const fake = fs.readFileSync(new URL('./fake-sb.js', import.meta.url), 'utf8').replaceAll('localhost:8077', 'localhost:' + PORT);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = [];
async function ctxFor(scheme, extra) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, colorScheme: scheme, deviceScaleFactor: DSF });
  await ctx.addInitScript(([skin, x]) => {
    localStorage.setItem('chat.devSupabaseUrl', 'http://localhost:1'); localStorage.setItem('chat.devSupabaseAnonKey', 'k');
    localStorage.setItem('chat.skin', skin);
    if (x) localStorage.setItem('fake.nosession', '1'); else localStorage.removeItem('fake.nosession');
  }, [SKIN, !!extra]);
  await ctx.route('**/supabase.js', (r) => r.fulfill({ contentType: 'text/javascript', body: fake }));
  await ctx.route(/sw\.js$/, (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(scheme + ' PAGEERR ' + e.message));
  page.on('response', (r) => { if (r.status() === 404 && !/sw\.js|bundle/.test(r.url())) errs.push(scheme + ' 404 ' + r.url()); });
  return { ctx, page };
}
async function run(scheme) {
  const tag = SKIN + '-' + scheme;
  const shot = (p, n) => (!ONLY || ONLY.split(',').includes(n)) ? p.screenshot({ path: `${OUT}/${tag}-${n}.png` }) : null;
  // 登录页
  let { ctx, page } = await ctxFor(scheme, true);
  await page.goto('http://localhost:' + PORT + '/chat/'); await page.waitForSelector('#auth:not([hidden])', { timeout: 8000 }); await sleep(700);
  await shot(page, '01-auth'); await ctx.close();
  ({ ctx, page } = await ctxFor(scheme, false));
  const ev = (f, a) => page.evaluate(f, a);
  await page.goto('http://localhost:' + PORT + '/chat/'); await page.waitForSelector('#app:not([hidden])', { timeout: 8000 }); await sleep(900);
  await shot(page, '02-chats');
  await page.click('#tabbar button[data-tab="friends"]'); await sleep(500); await shot(page, '03-friends');
  await page.click('#tabbar button[data-tab="me"]'); await sleep(500); await shot(page, '04-me');
  await ev(() => { const p = document.querySelector('.skin-picker'); if (p) p.closest('.panel').scrollIntoView({ block: 'start' }); const s = document.querySelector('#meBody'); s.scrollTop -= 72; }); await sleep(400); await shot(page, '05-me-skin');
  // 私聊
  await page.goto('http://localhost:' + PORT + '/chat/?peer=22222222-2222-4222-8222-222222222222');
  await page.waitForSelector('#msgs .row', { timeout: 8000 }); await sleep(800);
  await ev(() => { const m = document.querySelector('#msgs'); m.scrollTop = 0; }); await sleep(300);
  await shot(page, '06-dm');
  // 长按菜单
  const b = await page.$('#msgs .row.peer .bubble');
  if (b) { await b.click({ button: 'right' }); await sleep(400); await shot(page, '07-menu'); await page.keyboard.press('Escape'); await page.mouse.click(5, 420); await sleep(300); }
  await page.click('#emojiBtn'); await sleep(500); await shot(page, '08-emoji'); await page.click('#emojiBtn'); await sleep(300);
  await page.click('#plusBtn'); await sleep(500); await shot(page, '09-plus');
  await page.click('#toolGrid button:has-text("排行榜")'); await sleep(700); await shot(page, '10-rank');
  await page.click('.rk-x'); await sleep(300);
  // 小程序（飞行棋大厅）
  await ev(() => window.__mk({ id: 1, dm: true, status: 'waiting', seats: [window.__ids.ME, null, null, null] }));
  await ev(() => import('/chat/js/miniapps/host.js').then((m) => m.openApp('fxq', { id: 1 }))); await sleep(800);
  await shot(page, '11-miniapp');
  await ev(() => import('/chat/js/miniapps/host.js').then((m) => m.closeApp())); await sleep(300);
  // 群聊 + 群资料
  await page.goto('http://localhost:' + PORT + '/chat/?group=7'); await page.waitForSelector('#msgs .row', { timeout: 8000 }); await sleep(700);
  await shot(page, '12-group');
  const info = await page.$('#chat .top .avatar, #chat .who');
  if (info) { await info.click(); await sleep(700); await shot(page, '13-group-info'); }
  await ctx.close();
}
for (const s of (process.env.SCHEMES || 'light,dark').split(',')) await run(s);
console.log('ERRORS', errs.length ? errs.join('\n') : 'none');
await Promise.race([browser.close(), sleep(5000)]); srv.close(); process.exit(0);
