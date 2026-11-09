// HTML for the sign-in page and the Access Center.

const BASE_CSS = `
:root{--bg:#06070D;--panel:rgba(18,21,38,.82);--panel2:#141831;--line:rgba(140,150,220,.16);--text:#EDEFFA;--muted:#9097B5;--a:#7C5CFF;--b:#22D3EE;--c:#F472B6;--good:#34D399;--mid:#FBBF24;--low:#F87171}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh}
body::before{content:"";position:fixed;inset:-20% -10% auto;height:70vh;pointer-events:none;background:radial-gradient(closest-side,rgba(124,92,255,.28),transparent),radial-gradient(closest-side at 85% 30%,rgba(34,211,238,.16),transparent)}
a{color:var(--b);text-decoration:none}
.grad{background:linear-gradient(90deg,var(--a),var(--b) 60%,var(--c));-webkit-background-clip:text;background-clip:text;color:transparent}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 20px;border-radius:12px;font:inherit;font-weight:700;border:1px solid var(--line);cursor:pointer;background:var(--panel2);color:var(--text)}
.btn.primary{background:linear-gradient(90deg,var(--a),var(--b));border:0;color:#fff;box-shadow:0 12px 30px -12px rgba(124,92,255,.9)}
.rolesel{width:auto;padding:6px 10px;font-size:13px;margin-right:6px}
.btn.sm{padding:7px 12px;font-size:13px;border-radius:9px}
.btn:disabled{opacity:.5;cursor:default}
input,textarea,select{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:11px;padding:12px 14px;color:var(--text);font:inherit}
input:focus,textarea:focus{outline:0;border-color:var(--a);box-shadow:0 0 0 3px rgba(124,92,255,.2)}
label{display:block;font-weight:600;font-size:14px;margin:14px 0 6px}
.muted{color:var(--muted)}
`;
const FONT = `<link rel="stylesheet" href="/sv/theme.css"><script src="/sv/theme.js"></script><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">`;

export const LOGIN_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sign in — Topic Planner</title><meta name="robots" content="noindex, nofollow">${FONT}
<style>${BASE_CSS}
.wrap{position:relative;min-height:100vh;display:grid;place-items:center;padding:24px 16px}
.box{width:100%;max-width:440px;background:var(--panel);border:1px solid var(--line);border-radius:24px;padding:32px;backdrop-filter:blur(12px);box-shadow:0 30px 80px -30px rgba(0,0,0,.8)}
.logo{text-align:center;font-weight:900;font-size:26px;letter-spacing:-.02em}
.sub{text-align:center;color:var(--muted);margin:8px 0 22px;line-height:1.5}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:var(--bg);padding:5px;border-radius:12px;border:1px solid var(--line)}
.tabs button{background:transparent;border:0;color:var(--muted);padding:10px;border-radius:9px;font:inherit;font-weight:700;cursor:pointer}
.tabs button.on{background:var(--panel2);color:var(--text)}
.msg{margin-top:16px;padding:12px 14px;border-radius:12px;font-size:14px;line-height:1.5;display:none}
.msg.err{display:block;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.35);color:#FBCACA}
.msg.ok{display:block;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.35);color:#BDEFD9}
form .btn{width:100%;margin-top:20px}
.foot{text-align:center;color:var(--muted);font-size:13px;margin-top:18px}
</style></head><body><div class="wrap"><div class="box">
<div style="display:flex;justify-content:flex-end;margin:-12px -12px 4px 0" data-theme-slot></div><div class="logo">🧩 Topic <span class="grad">Planner</span></div>
<p class="sub">Plan what to write next, with your team.<br>Sign in, or ask for access.</p>
<div class="tabs"><button id="tIn" class="on" type="button">Sign in</button><button id="tUp" type="button">Request access</button></div>
<form id="fIn"><label for="e1">Email</label><input id="e1" type="email" autocomplete="email" required>
<label for="p1">Password</label><input id="p1" type="password" autocomplete="current-password" required>
<button class="btn primary" type="submit">Sign in →</button></form>
<form id="fUp" hidden><label for="n2">Your name</label><input id="n2" autocomplete="name" required>
<label for="e2">Work email</label><input id="e2" type="email" autocomplete="email" required>
<label for="p2">Choose a password</label><input id="p2" type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters">
<label for="w2">Why do you need access? (optional)</label><textarea id="w2" rows="2" placeholder="e.g. I work on SEO for…"></textarea>
<button class="btn primary" type="submit">Request access →</button></form>
<div class="msg" id="msg"></div>
<p class="foot">Access is approved by your Topic Planner admin.</p>
</div></div>
<script>
(function(){
  var $=function(s){return document.querySelector(s)}, msg=$("#msg");
  var next=new URLSearchParams(location.search).get("next")||"/"; if(!/^\\/(?!\\/)/.test(next)) next="/";
  function show(t,ok){msg.className="msg "+(ok?"ok":"err");msg.textContent=t}
  function tab(up){$("#tIn").classList.toggle("on",!up);$("#tUp").classList.toggle("on",up);$("#fIn").hidden=up;$("#fUp").hidden=!up;msg.className="msg"}
  $("#tIn").onclick=function(){tab(false)}; $("#tUp").onclick=function(){tab(true)};
  function post(u,b){return fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}).then(function(r){return r.json()})}
  $("#fIn").onsubmit=function(e){e.preventDefault();var b=this.querySelector("button");b.disabled=true;
    post("/api/auth/login",{email:$("#e1").value,password:$("#p1").value}).then(function(d){if(d.ok)location.href=next;else{show(d.error||"Couldn't sign in.");b.disabled=false}})};
  $("#fUp").onsubmit=function(e){e.preventDefault();var b=this.querySelector("button");b.disabled=true;
    post("/api/auth/signup",{name:$("#n2").value,email:$("#e2").value,password:$("#p2").value,note:$("#w2").value}).then(function(d){
      if(d.ok){location.href=d.admin?"/access":next;return}
      if(d.pending){show("Thanks! Your request was sent. You can sign in as soon as it's approved.",true);$("#fUp").reset();b.disabled=false;return}
      show(d.error||"Couldn't send the request.");b.disabled=false})};
})();
</script></body></html>`;

export const ACCESS_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Access Center — Topic Planner</title><meta name="robots" content="noindex, nofollow">${FONT}
<style>${BASE_CSS}
.app{position:relative;max-width:1100px;margin:auto;padding:0 16px 80px}
.top{display:flex;align-items:center;gap:10px;padding:18px 0;border-bottom:1px solid var(--line);margin-bottom:24px;flex-wrap:wrap}
.top .logo{font-weight:900;font-size:20px}.grow{flex:1}
h1{font-size:30px;letter-spacing:-.03em}h2{font-size:18px;margin-bottom:12px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}
.kpi b{display:block;font-size:28px;font-weight:900}.kpi span{color:var(--muted);font-size:13px}.kpi.alert{border-color:rgba(251,191,36,.5)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:20px;margin-bottom:16px}
.tw{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line);vertical-align:middle}
th{color:var(--muted);font-weight:600;font-size:12.5px}
.pill{display:inline-block;padding:3px 9px;border-radius:99px;font-size:12px;border:1px solid var(--line);color:var(--muted)}
.pill.approved{color:var(--good);border-color:rgba(52,211,153,.4)}.pill.pending{color:var(--mid);border-color:rgba(251,191,36,.4)}.pill.rejected{color:var(--low);border-color:rgba(248,113,113,.4)}
.pend{display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}.pend:last-child{border:0}
.roles{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;font-size:13.5px}
.roles div{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:12px}.roles b{display:block;margin-bottom:4px}
.tools{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}.tools input,.tools select{width:auto;min-width:200px;padding:8px 10px}
.empty{color:var(--muted);padding:10px 0}
#toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--panel2);border:1px solid var(--line);padding:10px 16px;border-radius:12px;display:none;z-index:9}
</style></head><body><div class="app">
<div class="top"><span class="logo">🧩 Topic <span class="grad">Planner</span> · Access Center</span><span class="grow"></span>
<a class="btn sm" href="/">← Dashboard</a><a class="btn sm" href="/logout">Sign out</a><span data-theme-slot></span></div>
<h1>Who can use <span class="grad">Topic Planner</span></h1>
<p class="muted" style="margin-top:6px">Approve access requests and choose what each person can do. Only team admins and the owner see this page.</p>
<div class="kpis" id="kpis"></div>
<div class="card" id="pendBox"></div>
<div class="card"><h2>👥 People</h2>
<div class="tools"><input id="q" placeholder="Search name or email"><select id="fs"><option value="">Everyone</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div>
<div class="tw" id="people"></div></div>
<div class="card"><h2>🔑 What each role can do</h2><div class="roles">
<div><b>👑 Owner</b>Everything, including making team admins and backups.</div>
<div><b>🛡️ Team admin</b>Approve people and give manager, member or viewer roles.</div>
<div><b>📋 Project manager</b>Create, edit, scan and delete projects.</div>
<div><b>✍️ Member</b>Update topic statuses and notes, add topics to the plan.</div>
<div><b>👀 Viewer</b>Look only.</div></div></div>
</div><div id="toast"></div>
<script>
(function(){
  var $=function(s){return document.querySelector(s)}, me=null, users=[];
  var NAMES={owner:"👑 Owner",admin:"🛡️ Team admin",manager:"📋 Project manager",member:"✍️ Member",viewer:"👀 Viewer"};
  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
  function when(t){return t?new Date(t).toLocaleDateString(undefined,{dateStyle:"medium"}):"—"}
  function toast(t){var e=$("#toast");e.textContent=t;e.style.display="block";clearTimeout(e._t);e._t=setTimeout(function(){e.style.display="none"},2500)}
  function post(u,b){return fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||"Error");return d})})}
  function canEdit(u){return u.role!=="owner"&&u.id!==me.id&&(me.role==="owner"||u.role!=="admin")}
  function roleOpts(cur){var list=me.role==="owner"?["admin","manager","member","viewer"]:["manager","member","viewer"];
    return list.map(function(r){return '<option value="'+r+'"'+(r===cur?" selected":"")+'>'+NAMES[r]+'</option>'}).join("")}
  function load(){fetch("/api/access/users").then(function(r){return r.json()}).then(function(d){users=d;render()})}
  function render(){
    var pend=users.filter(function(u){return u.status==="pending"}), ok=users.filter(function(u){return u.status==="approved"});
    $("#kpis").innerHTML='<div class="kpi"><b>'+ok.length+'</b><span>people with access</span></div>'+
      '<div class="kpi'+(pend.length?" alert":"")+'"><b>'+pend.length+'</b><span>waiting for approval</span></div>'+
      '<div class="kpi"><b>'+ok.filter(function(u){return ["owner","admin","manager"].indexOf(u.role)>=0}).length+'</b><span>can run scans</span></div>';
    $("#pendBox").innerHTML='<h2>⏳ Access requests</h2>'+(pend.length?pend.map(function(u){return '<div class="pend"><div style="flex:1;min-width:220px"><b>'+esc(u.name)+'</b> <span class="muted">'+esc(u.email)+'</span>'+(u.note?'<div class="muted" style="font-size:13px;margin-top:4px">“'+esc(u.note)+'”</div>':'')+'<div class="muted" style="font-size:12px">Asked '+when(u.created_at)+'</div></div><select class="rolesel" data-r="'+u.id+'">'+roleOpts("member")+'</select><button class="btn sm primary" data-ok="'+u.id+'">Approve</button><button class="btn sm" data-no="'+u.id+'">Reject</button></div>'}).join(""):'<div class="empty">No one is waiting. New requests from the sign-in page show up here.</div>');
    var q=$("#q").value.toLowerCase(), fs=$("#fs").value;
    var rows=users.filter(function(u){return u.status!=="pending"&&(!fs||u.status===fs)&&(!q||(u.name+" "+u.email).toLowerCase().indexOf(q)>=0)});
    $("#people").innerHTML=rows.length?'<table><tr><th>Person</th><th>Access</th><th>Role</th><th>Last sign-in</th><th></th></tr>'+rows.map(function(u){var e=canEdit(u);
      return '<tr><td><b>'+esc(u.name)+'</b>'+(u.id===me.id?' <span class="muted">(you)</span>':'')+'<div class="muted" style="font-size:13px">'+esc(u.email)+'</div></td><td><span class="pill '+u.status+'">'+u.status+'</span></td><td>'+
      (e&&u.status==="approved"?'<select class="rolesel" data-set="'+u.id+'">'+roleOpts(u.role)+'</select>':NAMES[u.role]||u.role)+'</td><td>'+when(u.last_login)+'</td><td style="white-space:nowrap">'+
      (e?(u.status==="approved"?'<button class="btn sm" data-no="'+u.id+'">Block</button> ':'<button class="btn sm" data-ok="'+u.id+'">Restore</button> ')+'<button class="btn sm" data-rm="'+u.id+'">Remove</button>':'')+'</td></tr>'}).join("")+'</table>':'<div class="empty">No one matches.</div>';
  }
  document.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;var id;
    if((id=b.dataset.ok)){var sel=document.querySelector('[data-r="'+id+'"]');post("/api/access/user",{id:+id,status:"approved",role:sel?sel.value:undefined}).then(function(){toast("Approved");load()}).catch(function(x){toast(x.message)})}
    else if((id=b.dataset.no)){post("/api/access/user",{id:+id,status:"rejected"}).then(function(){toast("Access removed");load()}).catch(function(x){toast(x.message)})}
    else if((id=b.dataset.rm)){var u=users.find(function(x){return x.id==id});if(confirm("Remove "+u.name+" completely? They'd have to ask for access again."))post("/api/access/remove",{id:+id}).then(function(){toast("Removed");load()}).catch(function(x){toast(x.message)})}
  });
  document.addEventListener("change",function(e){var id=e.target.dataset.set;if(id)post("/api/access/user",{id:+id,role:e.target.value}).then(function(){toast("Role updated");load()}).catch(function(x){toast(x.message);load()})});
  $("#q").oninput=render;$("#fs").onchange=render;
  fetch("/api/auth/me").then(function(r){return r.json()}).then(function(d){me=d.user;load()});
})();
</script></body></html>`;
