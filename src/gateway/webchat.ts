// WebChat — Embedded single-page chat UI served from the gateway
// All in ONE file

export function getWebChatHtml(wsUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TinyClaw</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;height:100vh;display:flex;flex-direction:column}
#header{padding:12px 16px;background:#161b22;border-bottom:1px solid #30363d;display:flex;align-items:center;gap:8px}
#header h1{font-size:16px;font-weight:600;color:#58a6ff}
#status{width:8px;height:8px;border-radius:50%;background:#f85149}
#status.connected{background:#3fb950}
#messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}
.msg{max-width:80%;padding:10px 14px;border-radius:12px;line-height:1.5;font-size:14px;white-space:pre-wrap;word-break:break-word}
.msg.user{align-self:flex-end;background:#1f6feb;color:#fff;border-bottom-right-radius:4px}
.msg.assistant{align-self:flex-start;background:#21262d;border:1px solid #30363d;border-bottom-left-radius:4px}
.msg.error{align-self:center;background:#f8514922;color:#f85149;border:1px solid #f8514944;font-size:13px}
.msg.system{align-self:center;color:#8b949e;font-size:13px;background:none}
#input-bar{padding:12px 16px;background:#161b22;border-top:1px solid #30363d;display:flex;gap:8px}
#input{flex:1;padding:10px 14px;background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:8px;font-size:14px;font-family:inherit;outline:none;resize:none;max-height:120px}
#input:focus{border-color:#58a6ff}
#send{padding:10px 20px;background:#238636;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:500}
#send:hover{background:#2ea043}
#send:disabled{opacity:.5;cursor:default}
</style>
</head>
<body>
<div id="header"><div id="status"></div><h1>TinyClaw</h1></div>
<div id="messages"></div>
<div id="input-bar">
<textarea id="input" rows="1" placeholder="Type a message..." autocomplete="off"></textarea>
<button id="send">Send</button>
</div>
<script>
const messages=document.getElementById("messages"),input=document.getElementById("input"),sendBtn=document.getElementById("send"),status=document.getElementById("status");
let ws,rpcId=0,pending=new Map();
function connect(){
  ws=new WebSocket("${wsUrl}");
  ws.onopen=()=>{status.className="connected";addMsg("Connected","system")};
  ws.onclose=()=>{status.className="";addMsg("Disconnected. Reconnecting...","system");setTimeout(connect,2000)};
  ws.onerror=()=>{};
  ws.onmessage=(e)=>{
    try{
      const d=JSON.parse(e.data);
      if(d.id&&pending.has(d.id)){
        const{resolve,el}=pending.get(d.id);pending.delete(d.id);
        if(d.error){el.className="msg error";el.textContent="Error: "+d.error.message}
        else{el.textContent=d.result?.reply||d.result?.text||JSON.stringify(d.result)}
        resolve(d);
      }
      if(d.method==="chat.stream"&&d.params?.delta){
        const last=messages.querySelector(".msg.assistant:last-child.streaming");
        if(last)last.textContent+=d.params.delta;
      }
    }catch{}
  };
}
function addMsg(text,role){
  const el=document.createElement("div");el.className="msg "+role;el.textContent=text;
  messages.appendChild(el);messages.scrollTop=messages.scrollHeight;return el;
}
function send(){
  const text=input.value.trim();if(!text||!ws||ws.readyState!==1)return;
  input.value="";input.style.height="auto";
  addMsg(text,"user");
  const id=++rpcId,el=addMsg("...","assistant");el.classList.add("streaming");
  const p=new Promise(r=>pending.set(id,{resolve:r,el}));
  ws.send(JSON.stringify({jsonrpc:"2.0",id,method:"chat.send",params:{message:text}}));
  p.then(()=>el.classList.remove("streaming"));
}
sendBtn.onclick=send;
input.onkeydown=(e)=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}};
input.oninput=()=>{input.style.height="auto";input.style.height=Math.min(input.scrollHeight,120)+"px"};
connect();
</script>
</body>
</html>`;
}
