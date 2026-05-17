/** Vanilla JS が動的に追加するメッセージ用 CSS（Tamagui テーマ色と揃える）。 */
export const CHAT_MSG_CSS = `*{box-sizing:border-box}
#messages{display:flex;flex-direction:column;gap:8px;overflow-y:auto}
.msg{max-width:75%;padding:10px 14px;border-radius:12px;font-size:14px;line-height:1.5;word-break:break-word;white-space:pre-wrap}
.msg.user{align-self:flex-end;background:#1a1a2e;color:#fff;border-bottom-right-radius:4px}
.msg.assistant{align-self:flex-start;background:#fff;color:#333;border:1px solid #e0e0e0;border-bottom-left-radius:4px}
.msg.tool{align-self:flex-start;background:#f0f7ff;color:#555;border:1px solid #b3d4f0;font-size:12px;font-family:monospace;border-radius:6px}
.msg.error{background:#fff0f0;color:#c00;border:1px solid #f0b0b0}
.msg.approval{align-self:stretch;max-width:100%;background:#fff8e6;border:1px solid #e6c200;padding:12px;border-radius:12px}
.msg.approval button{margin-right:8px;margin-top:8px;padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:13px}
.msg.approval .approve-btn{background:#1a7f37;color:#fff}
.msg.approval .reject-btn{background:#c00;color:#fff}
#input{flex:1;padding:8px 12px;border:1px solid #ccc;border-radius:8px;font-size:14px;outline:none;font-family:inherit}
#input:focus{border-color:#1a1a2e}
.streaming::after{content:'▌';animation:blink 1s step-end infinite}
@keyframes blink{50%{opacity:0}}`;
