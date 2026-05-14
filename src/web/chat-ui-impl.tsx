import { h, Fragment, HtmlNode, escJs } from '../jsx/index.js';

/** チャット UI のオプション。すべてサーバーサイドの設定値。 */
export interface ChatUiOptions {
  /** ページタイトルとヘッダーに表示するテキスト。デフォルト: `'Hikari Chat'`。 */
  title?: string;
  /** チャット送信先エンドポイント。デフォルト: `'/chat'`。 */
  endpoint?: string;
  /** SSE ストリームエンドポイント。デフォルト: `'/events'`。 */
  eventsEndpoint?: string;
}

const CSS = `*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;height:100vh;background:#f5f5f5}
#header{padding:12px 16px;background:#1a1a2e;color:#fff;font-weight:600;font-size:14px}
#messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px}
.msg{max-width:75%;padding:10px 14px;border-radius:12px;font-size:14px;line-height:1.5;word-break:break-word;white-space:pre-wrap}
.msg.user{align-self:flex-end;background:#1a1a2e;color:#fff;border-bottom-right-radius:4px}
.msg.assistant{align-self:flex-start;background:#fff;color:#333;border:1px solid #e0e0e0;border-bottom-left-radius:4px}
.msg.tool{align-self:flex-start;background:#f0f7ff;color:#555;border:1px solid #b3d4f0;font-size:12px;font-family:monospace;border-radius:6px}
.msg.error{background:#fff0f0;color:#c00;border:1px solid #f0b0b0}
#form{display:flex;padding:12px;gap:8px;background:#fff;border-top:1px solid #e0e0e0}
#input{flex:1;padding:8px 12px;border:1px solid #ccc;border-radius:8px;font-size:14px;outline:none}
#input:focus{border-color:#1a1a2e}
#send{padding:8px 16px;background:#1a1a2e;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px}
#send:disabled{opacity:.5;cursor:not-allowed}
.streaming::after{content:'▌';animation:blink 1s step-end infinite}
@keyframes blink{50%{opacity:0}}`;

function buildScript(endpoint: string, eventsEndpoint: string): string {
  return `(function(){
  var ENDPOINT='${escJs(endpoint)}';
  var EVENTS_ENDPOINT='${escJs(eventsEndpoint)}';
  var sessionId=null;
  var streaming=false;
  var msgs=document.getElementById('messages');
  var form=document.getElementById('form');
  var input=document.getElementById('input');
  var btn=document.getElementById('send');
  function addMsg(role,text){
    var el=document.createElement('div');
    el.className='msg '+role;
    el.textContent=text;
    msgs.appendChild(el);
    msgs.scrollTop=msgs.scrollHeight;
    return el;
  }
  function setStreaming(on){
    streaming=on;btn.disabled=on;input.disabled=on;
  }
  form.addEventListener('submit',async function(e){
    e.preventDefault();
    var text=input.value.trim();
    if(!text||streaming)return;
    input.value='';
    addMsg('user',text);
    setStreaming(true);
    try{
      var res=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,sessionId:sessionId})});
      if(!res.ok){addMsg('error','HTTP '+res.status);setStreaming(false);return;}
      var data=await res.json();
      sessionId=data.sessionId;
      var aMsg=addMsg('assistant','');
      aMsg.classList.add('streaming');
      var fullText='';
      var es=new EventSource(EVENTS_ENDPOINT+'?requestId='+encodeURIComponent(data.requestId));
      es.addEventListener('text_delta',function(ev){
        var d=JSON.parse(ev.data);
        fullText+=d.delta;
        aMsg.textContent=fullText;
        msgs.scrollTop=msgs.scrollHeight;
      });
      es.addEventListener('tool_use',function(ev){
        var d=JSON.parse(ev.data);
        addMsg('tool','\\u2699 '+d.name+'('+JSON.stringify(d.input)+')');
      });
      es.addEventListener('tool_result',function(ev){
        var d=JSON.parse(ev.data);
        var last=msgs.querySelector('.msg.tool:last-child');
        if(last)last.textContent+=' \\u2192 '+JSON.stringify(d.output);
      });
      es.addEventListener('done',function(){
        es.close();
        aMsg.classList.remove('streaming');
        if(!fullText)aMsg.textContent='(done)';
        setStreaming(false);
      });
      es.addEventListener('error',function(ev){
        es.close();
        var msg=ev.data?JSON.parse(ev.data).message:'Stream error';
        aMsg.classList.remove('streaming');
        aMsg.classList.add('error');
        aMsg.textContent=msg;
        setStreaming(false);
      });
      es.onerror=function(){
        es.close();
        aMsg.classList.remove('streaming');
        setStreaming(false);
      };
    }catch(err){
      addMsg('error',String(err));
      setStreaming(false);
    }
  });
})();`;
}

interface ChatPageProps {
  title: string;
  endpoint: string;
  eventsEndpoint: string;
}

function ChatPage({ title, endpoint, eventsEndpoint }: ChatPageProps): HtmlNode {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{title}</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <div id="header">{title}</div>
        <div id="messages"></div>
        <form id="form">
          <input id="input" placeholder="Type a message…" autocomplete="off" />
          <button id="send" type="submit">Send</button>
        </form>
        <script dangerouslySetInnerHTML={{ __html: buildScript(endpoint, eventsEndpoint) }} />
      </body>
    </html>
  );
}

/**
 * 自己完結型のチャット UI を HTML 文字列としてレンダリングする。
 *
 * @param options - タイトル・エンドポイントなどのカスタマイズ設定。
 */
export function renderChatHtml(options: ChatUiOptions = {}): string {
  const title = options.title ?? 'Hikari Chat';
  const endpoint = options.endpoint ?? '/chat';
  const eventsEndpoint = options.eventsEndpoint ?? '/events';
  return '<!DOCTYPE html>\n' + ChatPage({ title, endpoint, eventsEndpoint }).value;
}

export { Fragment };
