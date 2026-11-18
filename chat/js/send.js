// 发送（乐观更新）

import { askAgent } from './agent/live.js';
import { renderMsgs, sortMsgs } from './chat/view.js';
import { autosize } from './composer.js';
import { ERR_TEXT } from './errors.js';
import { playFx } from './fx/engine.js';
import { fxOf } from './fx/table.js';
import { firePush } from './notify.js';
import { closePanels } from './plus.js';
import { clearQuote } from './quote.js';
import { applyOwnToConv } from './realtime.js';
import { S, sb } from './state.js';
import { popCheer } from './mascot.js';
import { $, lsGet, lsSet, toast } from './utils.js';

// ===== 发送（乐观更新） =====
export async function sendCurrent() {
  var c = S.chat; if (!c) return;
  var input = $('input');
  // 全角 "＠沈剑心"（中文输入法常见）统一成半角，才能叫到沈剑心
  var body = input.value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '').replace(/＠(沈剑心|榴莲)/g, '@$1');
  if (!body) return;
  if (body.length > 2000) return toast(ERR_TEXT.message_too_long);
  input.value = '';
  autosize();
  closePanels();
  sendBody(body);
}
export function sendBody(body) {
  var c = S.chat; if (!c) return;
  var m = { key: 't' + (++S.tempSeq), seq: S.tempSeq, id: null, sender_id: S.me.id, receiver_id: c.peer, body: body, created_at: new Date().toISOString(), read_at: null, reply_to: c.quote ? c.quote.id : null, status: 'sending' };
  if (c.quote) clearQuote();
  c.msgs.push(m);
  renderMsgs({ stick: true });
  doSend(m);
  if (fxOf(body)) playFx(m);
}
async function doSend(m) {
  var c = S.chat;
  m.status = 'sending';
  var r;
  var args = { p_peer: m.receiver_id, p_body: m.body };
  if (m.reply_to != null) args.p_reply_to = m.reply_to; // 不引用时保持旧的两参数调用
  try { r = await sb.rpc('send_message', args); }
  catch (e) { r = { error: e }; }
  if (r.error) {
    m.status = 'failed';
    if (S.chat && S.chat.peer === m.receiver_id) renderMsgs({ stick: false });
    if (r.error.message === 'not_friends') toast(ERR_TEXT.not_friends);
    if (r.error.message === 'invalid_reply') { m.reply_to = null; m.reply_gone = true; toast(ERR_TEXT.invalid_reply); if (S.chat && S.chat.peer === m.receiver_id) renderMsgs({ stick: false }); }
    return;
  }
  var row = r.data;
  var cc = S.chat && S.chat.peer === m.receiver_id ? S.chat : null;
  if (cc) {
    if (cc.ids.has(row.id)) {
      // 实时推送比 RPC 返回先到：丢掉乐观的那条
      cc.msgs = cc.msgs.filter(function (x) { return x !== m; });
    } else {
      cc.ids.add(row.id);
      m.id = row.id; m.created_at = row.created_at; m.read_at = row.read_at; m.status = 'sent';
      sortMsgs();
    }
    renderMsgs({ stick: true });
  }
  applyOwnToConv(row);
  firePush('message', row.id);
  askAgent(row); // 带 @沈剑心 的消息：存好之后叫沈剑心（没有 @ 时什么也不做）
  var flag = 'chat.firstSent.' + S.me.id;
  if (!lsGet(flag)) { lsSet(flag, '1'); popCheer('好耶！'); }
}
export function retrySend(m) { if (m.status === 'failed') doSend(m); }
export function dropFailed(m) {
  var c = S.chat; if (!c) return;
  c.msgs = c.msgs.filter(function (x) { return x !== m; });
  renderMsgs({ stick: false });
}
