import { escJs } from '../jsx/index.js';

/** チャット UI のクライアント側 SSE / 承認ロジック（インライン script 用）。 */
export const buildChatClientScript = (endpoint: string, eventsEndpoint: string): string =>
  `(function(){
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
  async function postApprovalCommand(cmd){
    var res=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:cmd,sessionId:sessionId})});
    var data=await res.json();
    if(!res.ok){addMsg('error',data.error||('HTTP '+res.status));return;}
    addMsg('tool',cmd+(data.ok?' \\u2713':' \\u2717'));
  }
  function showApprovalCard(d){
    var el=document.createElement('div');
    el.className='msg approval';
    var title=document.createElement('div');
    title.textContent='Approval required: '+d.capabilityName+' ['+d.riskLevel+']';
    el.appendChild(title);
    var detail=document.createElement('pre');
    detail.style.fontSize='12px';
    detail.style.marginTop='8px';
    detail.textContent=JSON.stringify(d.input,null,2);
    el.appendChild(detail);
    var approveBtn=document.createElement('button');
    approveBtn.className='approve-btn';
    approveBtn.textContent='Approve';
    approveBtn.type='button';
    approveBtn.addEventListener('click',function(){postApprovalCommand('/approve '+d.requestId);});
    var rejectBtn=document.createElement('button');
    rejectBtn.className='reject-btn';
    rejectBtn.textContent='Reject';
    rejectBtn.type='button';
    rejectBtn.addEventListener('click',function(){postApprovalCommand('/reject '+d.requestId+' denied');});
    el.appendChild(approveBtn);
    el.appendChild(rejectBtn);
    msgs.appendChild(el);
    msgs.scrollTop=msgs.scrollHeight;
  }
  form.addEventListener('submit',async function(e){
    e.preventDefault();
    var text=input.value.trim();
    if(!text||streaming)return;
    input.value='';
    addMsg('user',text);
    if(/^\\/approve\\s+\\S+$/i.test(text)||/^\\/reject\\s+\\S+/i.test(text)){
      await postApprovalCommand(text);
      return;
    }
    setStreaming(true);
    try{
      var res=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,sessionId:sessionId})});
      if(!res.ok){addMsg('error','HTTP '+res.status);setStreaming(false);return;}
      var data=await res.json();
      if(data.requestId===undefined){
        setStreaming(false);
        return;
      }
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
      es.addEventListener('approval_required',function(ev){
        showApprovalCard(JSON.parse(ev.data));
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
