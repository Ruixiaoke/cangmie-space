// 小工具：localStorage 包装、DOM 构建 h()/$()、时间格式、toast


export function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
export function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 隐私模式等 */ } }

// ===== 小工具 =====
export function $(id) { return document.getElementById(id); }
export function h(tag, props) {
  var el = document.createElement(tag);
  if (props) for (var k in props) {
    var v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (var i = 2; i < arguments.length; i++) {
    var c = arguments[i];
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
export function isVisible() { return document.visibilityState === 'visible'; }
export function pad(n) { return n < 10 ? '0' + n : '' + n; }
function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
export function fmtTime(iso) {
  var d = new Date(iso), now = new Date();
  if (sameDay(d, now)) return hhmm(d);
  var y = new Date(now.getTime() - 86400000);
  if (sameDay(d, y)) return '昨天 ' + hhmm(d);
  if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
}
export function fmtStamp(iso) {
  var d = new Date(iso), now = new Date();
  if (sameDay(d, now)) return hhmm(d);
  return fmtTime(iso).indexOf(' ') > 0 ? fmtTime(iso) : fmtTime(iso) + ' ' + hhmm(d);
}
export function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

var toastTimer = null;
export function toast(text, ms) {
  var t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2600);
}
