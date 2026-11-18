// 前端模块的 lint（CI 里 `npx eslint@9` 跑）：只抓会在运行时才炸的错误（漏 import、给导入赋值、没用到的变量）
const browser = [
  'window', 'document', 'navigator', 'localStorage', 'history', 'location', 'console', 'Notification', 'PushManager',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'fetch', 'URL', 'Blob', 'FileReader', 'Image', 'IntersectionObserver', 'ResizeObserver', 'MutationObserver',
  'AbortController', 'CustomEvent', 'Event', 'Promise', 'Map', 'Set', 'WeakMap', 'getComputedStyle', 'atob', 'btoa',
  'Uint8Array', 'ArrayBuffer', 'TextEncoder', 'TextDecoder', 'performance', 'alert', 'confirm', 'crypto', 'Intl',
  'HTMLElement', 'Element', 'Node', 'DOMException', 'self', 'screen', 'OffscreenCanvas', 'createImageBitmap',
  'matchMedia', 'innerWidth', 'innerHeight', 'NodeFilter', 'URLSearchParams', 'FormData', 'Audio'
];
const globals = {};
for (const g of browser) globals[g] = 'readonly';
globals.supabase = 'readonly'; // 页面上用 <script> 加载的 Supabase UMD 全局
globals.Matter = 'readonly'; // 弹弓大战：页面上用 <script> 加载的 Matter.js 全局

export default [
  {
    files: ['chat/js/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals },
    rules: { 'no-undef': 'error', 'no-import-assign': 'error', 'no-unused-vars': ['warn', { caughtErrors: 'none' }] }
  }
];
