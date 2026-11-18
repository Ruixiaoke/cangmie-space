// 头像上传：居中裁成正方形，缩到 256px，WebP（不支持则 JPEG）

import { errText } from '../errors.js';
import { S, sb } from '../state.js';
import { toast } from '../utils.js';
import { renderMe } from './me.js';

// ===== 头像上传：居中裁成正方形，缩到 256px，WebP（不支持则 JPEG） =====
function loadImage(file) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}
function canvasBlob(canvas, type, q) {
  return new Promise(function (resolve) { canvas.toBlob(resolve, type, q); });
}
async function makeAvatarBlob(file) {
  var img = await loadImage(file);
  var w = img.naturalWidth || img.width, hgt = img.naturalHeight || img.height;
  if (!w || !hgt) throw new Error('decode');
  var side = Math.min(w, hgt);
  var canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 256);
  ctx.drawImage(img, (w - side) / 2, (hgt - side) / 2, side, side, 0, 0, 256, 256);
  var blob = await canvasBlob(canvas, 'image/webp', 0.85);
  if (blob && blob.type === 'image/webp') return { blob: blob, ext: 'webp', type: 'image/webp' };
  blob = await canvasBlob(canvas, 'image/jpeg', 0.88); // Safari 等不支持 WebP 编码
  if (!blob) throw new Error('encode');
  return { blob: blob, ext: 'jpg', type: 'image/jpeg' };
}
export async function uploadAvatar(file) {
  if (file.size > 20 * 1024 * 1024) return toast('这张图片太大了，换一张小一点的吧');
  toast('头像上传中…', 8000);
  var out;
  try { out = await makeAvatarBlob(file); } catch (e) { return toast('这张图片读不出来，换一张试试'); }
  var old = S.me.avatar_path;
  var path = S.me.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + out.ext;
  var up = await sb.storage.from('avatars').upload(path, out.blob, { contentType: out.type, cacheControl: '31536000', upsert: false });
  if (up.error) return toast('头像上传失败，请稍后再试');
  var r = await sb.rpc('update_profile', { p_nickname: null, p_avatar_path: path });
  if (r.error) {
    sb.storage.from('avatars').remove([path]).catch(function () {});
    return toast(errText(r.error));
  }
  S.me = r.data; S.profiles.set(S.me.id, S.me);
  if (old && old !== path) sb.storage.from('avatars').remove([old]).catch(function () {}); // 尽力删除旧头像
  toast('头像已更新');
  renderMe();
}
