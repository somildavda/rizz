// HTML for the login page and the admin dashboard, and the tracker script.

const BASE_CSS = `
:root{--bg:#06070D;--panel:rgba(18,21,38,.82);--panel2:#141831;--line:rgba(140,150,220,.16);--text:#EDEFFA;--muted:#9097B5;--a:#7C5CFF;--b:#22D3EE;--c:#F472B6;--good:#34D399;--mid:#FBBF24;--low:#F87171}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh}
body::before{content:"";position:fixed;inset:-20% -10% auto;height:70vh;pointer-events:none;background:radial-gradient(closest-side,rgba(124,92,255,.28),transparent),radial-gradient(closest-side at 85% 30%,rgba(34,211,238,.16),transparent)}
a{color:var(--b);text-decoration:none}
.grad{background:linear-gradient(90deg,var(--a),var(--b) 60%,var(--c));-webkit-background-clip:text;background-clip:text;color:transparent}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 20px;border-radius:12px;font:inherit;font-weight:700;border:1px solid var(--line);cursor:pointer;background:var(--panel2);color:var(--text)}
.btn.primary{background:linear-gradient(90deg,var(--a),var(--b));border:0;color:#fff;box-shadow:0 12px 30px -12px rgba(124,92,255,.9)}
.tchips{display:flex;flex-wrap:wrap;gap:5px}
.tchip{font:inherit;font-size:12px;font-weight:600;padding:4px 9px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--muted);cursor:pointer;opacity:.55;white-space:nowrap}
.tchip.on{opacity:1;color:var(--text);background:rgba(124,92,255,.18);border-color:rgba(124,92,255,.55)}
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
<title>Sign in — SearchVerse</title><meta name="robots" content="noindex, nofollow">${FONT}
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
<div style="display:flex;justify-content:flex-end;margin:-12px -12px 4px 0" data-theme-slot></div><div class="logo">🔭 <span class="grad">SearchVerse</span></div>
<p class="sub">Search tools for your team.<br>Sign in, or ask for access.</p>
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
<p class="foot">Access is approved by the SearchVerse admin.</p>
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
      if(d.ok){location.href=d.admin?"/admin":next;return}
      if(d.pending){show("Thanks! Your request was sent. You can sign in as soon as it's approved.",true);$("#fUp").reset();b.disabled=false;return}
      show(d.error||"Couldn't send the request.");b.disabled=false})};
})();
</script></body></html>`;

export const TRACK_JS = `(function(){
  if (window.__svTrack) return; window.__svTrack = true;
  try { if (!/(^|; )sv_vid=/.test(document.cookie)) document.cookie = "sv_vid=" + Math.random().toString(36).slice(2) + Date.now().toString(36) + "; path=/; max-age=31536000; SameSite=Lax; Secure"; } catch (_) {}
  var start = Date.now(), path = location.pathname + location.hash, sent = false, title = document.title;
  // Pages set their title right after they switch screens, so read it a moment later.
  function grabTitle(){ setTimeout(function(){ title = document.title; }, 300); }
  grabTitle();
  var ref = document.referrer && document.referrer.indexOf(location.origin) !== 0 ? (function(){ try { return new URL(document.referrer).hostname; } catch (_) { return ""; } })() : "";
  function send(o){ var b = JSON.stringify(o); if (navigator.sendBeacon) navigator.sendBeacon("/api/track", new Blob([b], { type: "application/json" })); else fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: b, keepalive: true }); }
  function flush(){ if (sent) return; sent = true; send({ type: "view", path: path, title: title, duration: Date.now() - start, referrer: ref }); ref = ""; }
  function restart(){ start = Date.now(); path = location.pathname + location.hash; sent = false; grabTitle(); }
  addEventListener("visibilitychange", function(){ if (document.visibilityState === "hidden") flush(); else restart(); });
  addEventListener("pagehide", flush);
  addEventListener("hashchange", function(){ flush(); restart(); });
  // Tool clicks: links to a tool's page or launcher, and anything marked data-track.
  document.addEventListener("click", function(e){
    var a = e.target.closest && e.target.closest("a[href], [data-track]"); if (!a) return;
    var href = a.getAttribute("href") || "", m = href.match(/#\\/tools\\/([\\w-]+)/), tool = a.getAttribute("data-track") || (m && m[1]);
    if (!tool && a.hasAttribute("data-launch")) { var mm = location.hash.match(/#\\/tools\\/([\\w-]+)/); tool = mm && mm[1]; }
    if (!tool && /^\\/(performance|speed|youtube|content-gap)\\//.test(href)) tool = href.split("/")[1];
    if (tool) send({ type: "click", tool: tool, path: location.pathname + location.hash, title: (a.textContent || "").trim().slice(0, 80) });
  }, true);
})();`;

export const ADMIN_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard — SearchVerse</title><meta name="robots" content="noindex, nofollow">${FONT}
<style>${BASE_CSS}
.app{position:relative;max-width:1240px;margin:auto;padding:0 16px 80px}
.top{display:flex;align-items:center;gap:12px;padding:18px 0;border-bottom:1px solid var(--line);margin-bottom:24px;flex-wrap:wrap}
.top .logo{font-weight:900;font-size:20px}.grow{flex:1}
h1{font-size:32px;letter-spacing:-.03em}h2{font-size:19px;margin-bottom:12px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:20px 0}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}
.kpi b{display:block;font-size:30px;font-weight:900;letter-spacing:-.02em}.kpi span{color:var(--muted);font-size:13px}
.kpi.alert{border-color:rgba(251,191,36,.5)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:20px;margin-bottom:16px;overflow:hidden}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px}
.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
.chart{display:flex;align-items:flex-end;gap:4px;height:180px;padding-top:10px}
.chart div{flex:1;position:relative;border-radius:6px 6px 2px 2px;background:linear-gradient(var(--b),var(--a));min-height:2px}
.chart div:hover::after{content:attr(data-t);position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:var(--panel2);border:1px solid var(--line);padding:4px 8px;border-radius:8px;font-size:12px;white-space:nowrap;margin-bottom:6px;z-index:2}
.axis{display:flex;justify-content:space-between;color:var(--muted);font-size:11px;margin-top:6px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:12.5px}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.tw{overflow:auto;max-height:520px}
.bar{height:8px;border-radius:8px;background:var(--line);overflow:hidden;margin-top:4px}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--a),var(--b))}
.pill{display:inline-block;padding:3px 9px;border-radius:99px;font-size:12px;border:1px solid var(--line);color:var(--muted)}
.pill.approved{color:var(--good);border-color:rgba(52,211,153,.4)}.pill.pending{color:var(--mid);border-color:rgba(251,191,36,.4)}.pill.rejected{color:var(--low);border-color:rgba(248,113,113,.4)}.pill.admin{color:var(--b);border-color:rgba(34,211,238,.4)}
.pend{display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}
.pend:last-child{border:0}
.tools{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.tools select,.tools input{width:auto;min-width:180px;padding:8px 10px}
.empty{color:var(--muted);padding:12px 0}
.seg{display:flex;gap:4px;background:var(--bg);border:1px solid var(--line);border-radius:11px;padding:4px}
.seg button{background:transparent;border:0;color:var(--muted);padding:7px 12px;border-radius:8px;font:inherit;font-weight:600;cursor:pointer}.seg button.on{background:var(--panel2);color:var(--text)}
</style></head><body><div class="app">
<div class="top"><span class="logo">🔭 <span class="grad">SearchVerse</span> · Dashboard</span><span class="grow"></span>
<div class="seg" id="range"><button data-d="7">7 days</button><button data-d="30" class="on">30 days</button><button data-d="90">90 days</button></div>
<a class="btn sm" href="/">← Back to tools</a><a class="btn sm" href="/logout">Sign out</a><span data-theme-slot></span></div>
<h1>Who's using <span class="grad">SearchVerse</span></h1><p class="muted" style="margin-top:6px">Only you can see this page.</p>
<div class="kpis" id="kpis"></div>
<div class="card" id="pendBox"></div>
<div class="card"><h2>📈 Visitors per day</h2><div class="chart" id="chart"></div><div class="axis" id="axis"></div></div>
<div class="grid2">
  <div class="card"><h2>🧰 Tool clicks</h2><div id="tools"></div></div>
  <div class="card"><h2>📄 Pages viewed &amp; time spent</h2><div class="tw" id="pages"></div></div>
</div>
<div class="grid3">
  <div class="card"><h2>🌍 Countries</h2><div id="countries"></div></div>
  <div class="card"><h2>📱 Devices</h2><div id="devices"></div></div>
  <div class="card"><h2>🔗 Came from</h2><div id="refs"></div></div>
</div>
<div class="card"><h2>👥 People</h2><div class="tw" id="people"></div></div>
<div class="card"><h2>🕒 Activity — who did what</h2>
  <div class="tools"><select id="fUser"><option value="">Everyone</option></select><select id="fType"><option value="">All activity</option><option value="click">Tool clicks</option><option value="view">Page views</option><option value="login">Logins</option><option value="signup">Access requests</option></select></div>
  <div class="tw" id="activity"></div></div>
</div>
<script>
(function(){
  var $=function(s){return document.querySelector(s)}, days=30, users=[], me={role:""};
  var RN={owner:"Owner",admin:"Team admin",manager:"Project manager",member:"Member",viewer:"Viewer"};
  function canGive(){return me.role==="owner"?["admin","manager","member","viewer"]:["manager","member","viewer"]}
  var TL=[["performance","📊"],["workspace","🗂️"],["speed","🚀"],["content-gap","🧩"],["youtube","▶️"]];
  function toolsOf(u){if(u.role==="owner"||u.role==="admin")return null;try{var t=JSON.parse(u.tools||"null");return Array.isArray(t)?t:TL.map(function(x){return x[0]})}catch(e){return TL.map(function(x){return x[0]})}}
  function toolChips(u,pick){var t=toolsOf(u);if(!t)return '<span class="muted" style="font-size:12px">All tools</span>';
    return '<div class="tchips">'+TL.map(function(x){var on=t.indexOf(x[0])>=0;return '<button class="tchip'+(on?" on":"")+'" '+(pick?'data-pick="'+u.id+'"':'data-tool="'+u.id+'"')+' data-k="'+x[0]+'" title="'+(TOOL[x[0]]||x[0])+'">'+x[1]+" "+(TOOL[x[0]]||x[0]).replace(/^\\S+\\s/,"")+"</button>"}).join("")+"</div>"}
  function canEdit(u){return u.role!=="owner"&&(me.role==="owner"||u.role!=="admin")}
  function rolePick(u){if(!canEdit(u))return '<span class="pill admin">'+(RN[u.role]||u.role)+(u.email===me.email?" (you)":"")+"</span>";
    var opts=canGive();if(opts.indexOf(u.role)<0)opts=[u.role].concat(opts);
    return '<select class="rolesel" data-rid="'+u.id+'">'+opts.map(function(r){return '<option value="'+r+'"'+(r===u.role?" selected":"")+">"+RN[r]+"</option>"}).join("")+"</select>"}
  function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
  function when(t){return t?new Date(t).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"}):"—"}
  function secs(s){if(!s)return"—";s=Math.round(s);return s<60?s+"s":Math.floor(s/60)+"m "+(s%60)+"s"}
  function get(u){return fetch(u).then(function(r){if(r.status===401||r.status===403){location.href="/login";throw 0}return r.json()})}
  function post(u,b){return fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}).then(function(r){return r.json()})}
  function bars(list,label,val){var max=Math.max.apply(null,list.map(function(x){return x[val]}).concat([1]));
    return list.length?list.map(function(x){return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:8px"><span>'+esc(x[label])+'</span><b>'+x[val].toLocaleString()+'</b></div><div class="bar"><i style="width:'+(x[val]/max*100)+'%"></i></div></div>'}).join(""):'<p class="empty">No data yet.</p>'}
  var TOOL={performance:"📊 Performance Explorer",workspace:"🗂️ Search Workspace",speed:"🚀 PageSpeed Lab","content-gap":"🧩 Topic Planner",youtube:"▶️ Video Visibility","launch-share:linkedin":"🚀 Launch shared on LinkedIn","launch-share:whatsapp":"🚀 Launch shared on WhatsApp","launch-share:x":"🚀 Launch shared on X","launch-share:copy":"🚀 Launch link copied"};
  function stats(){get("/api/admin/stats?days="+days).then(function(s){
    var t=s.totals||{};
    $("#kpis").innerHTML=[["👀",t.visitors,"visitors"],["📄",t.views,"page views"],["🖱️",t.clicks,"tool clicks"],["🔑",t.logins,"logins"],["⏱️",secs(t.avg_seconds),"avg. time on a page"],["👥",s.users,"people with access"],["⏳",s.pending,"waiting for approval",s.pending>0]]
      .map(function(k){return '<div class="kpi'+(k[3]?" alert":"")+'"><b>'+k[0]+" "+(k[1]==null?0:k[1]).toLocaleString()+"</b><span>"+k[2]+"</span></div>"}).join("");
    var byDay={};(s.daily||[]).forEach(function(d){byDay[d.day]=d});var today=Math.floor(Date.now()/86400000),arr=[];
    for(var i=days-1;i>=0;i--){var d=byDay[today-i]||{visitors:0,views:0,clicks:0};arr.push({day:today-i,v:d.visitors,views:d.views,clicks:d.clicks})}
    var mx=Math.max.apply(null,arr.map(function(x){return x.v}).concat([1]));
    $("#chart").innerHTML=arr.map(function(x){var dt=new Date(x.day*86400000).toLocaleDateString(undefined,{day:"numeric",month:"short"});return '<div style="height:'+Math.max(1,x.v/mx*100)+'%" data-t="'+dt+": "+x.v+" visitors · "+x.views+" views · "+x.clicks+' clicks"></div>'}).join("");
    $("#axis").innerHTML="<span>"+new Date(arr[0].day*86400000).toLocaleDateString(undefined,{day:"numeric",month:"short"})+"</span><span>today</span>";
    $("#tools").innerHTML=bars((s.tools||[]).map(function(x){return{name:(TOOL[x.tool]||x.tool)+" · "+x.people+" people",clicks:x.clicks}}),"name","clicks");
    $("#pages").innerHTML=(s.pages||[]).length?'<table><tr><th>Page</th><th class="n">Views</th><th class="n">People</th><th class="n">Avg. time</th></tr>'+s.pages.map(function(p){return"<tr><td>"+esc(p.title||p.path)+'<br><span class="muted" style="font-size:12px">'+esc(p.path)+'</span></td><td class="n">'+p.views+'</td><td class="n">'+p.people+'</td><td class="n">'+secs(p.avg_seconds)+"</td></tr>"}).join("")+"</table>":'<p class="empty">No page views yet.</p>';
    $("#countries").innerHTML=bars(s.countries||[],"name","people");$("#devices").innerHTML=bars(s.devices||[],"name","people");$("#refs").innerHTML=bars(s.referrers||[],"name","visits");
  })}
  function people(){get("/api/admin/users").then(function(list){users=list;
    var pend=list.filter(function(u){return u.status==="pending"});
    $("#pendBox").innerHTML="<h2>⏳ Waiting for your approval ("+pend.length+")</h2>"+(pend.length?pend.map(function(u){return '<div class="pend"><div style="flex:1;min-width:220px"><b>'+esc(u.name)+'</b> <span class="muted">'+esc(u.email)+"</span>"+(u.note?'<div class="muted" style="font-size:13px;margin-top:4px">“'+esc(u.note)+"”</div>":"")+'<div class="muted" style="font-size:12px;margin-top:4px">Asked '+when(u.created_at)+'</div></div><select class="rolesel" id="pr'+u.id+'">'+canGive().map(function(r){return '<option value="'+r+'"'+(r==="member"?" selected":"")+">"+RN[r]+"</option>"}).join("")+'</select><button class="btn sm primary" data-id="'+u.id+'" data-s="approved">✓ Approve</button><button class="btn sm" data-id="'+u.id+'" data-s="rejected">✕ Reject</button><div style="flex-basis:100%;margin-top:8px"><span class="muted" style="font-size:12px;margin-right:6px">Tools they can open:</span>'+toolChips(u,true)+'</div></div>'}).join(""):'<p class="empty">Nobody is waiting. 🎉</p>');
    $("#people").innerHTML='<table><tr><th>Person</th><th>Role</th><th>Tools</th><th>Status</th><th class="n">Tool clicks</th><th class="n">Page views</th><th>Last seen</th><th>Joined</th><th></th></tr>'+list.map(function(u){
      return "<tr><td><b>"+esc(u.name)+'</b><br><span class="muted" style="font-size:12px">'+esc(u.email)+'</span></td><td>'+rolePick(u)+'</td><td>'+(canEdit(u)||u.role==="owner"||u.role==="admin"?toolChips(u):"")+'</td><td><span class="pill '+u.status+'">'+u.status+'</span></td><td class="n">'+u.clicks+'</td><td class="n">'+u.views+"</td><td>"+when(u.last_seen)+"</td><td>"+when(u.created_at)+"</td><td>"+(!canEdit(u)?"":u.status==="approved"?'<button class="btn sm" data-id="'+u.id+'" data-s="rejected">Remove access</button>':'<button class="btn sm" data-id="'+u.id+'" data-s="approved">Approve</button>')+' <button class="btn sm" data-act="'+u.id+'">Activity</button></td></tr>'}).join("")+"</table>";
    var sel=$("#fUser"),cur=sel.value;sel.innerHTML='<option value="">Everyone</option>'+list.map(function(u){return'<option value="'+u.id+'">'+esc(u.name)+"</option>"}).join("");sel.value=cur;
  })}
  function activity(){var q="?"+(($("#fUser").value)?"user="+$("#fUser").value+"&":"")+(($("#fType").value)?"type="+$("#fType").value:"");
    get("/api/admin/activity"+q).then(function(list){var label={view:"👀 viewed",click:"🖱️ opened",login:"🔑 signed in",signup:"🙋 asked for access"};
      $("#activity").innerHTML=list.length?'<table><tr><th>When</th><th>Who</th><th>What</th><th>Time</th><th>Where</th></tr>'+list.map(function(e){
        return"<tr><td>"+when(e.ts)+"</td><td>"+esc(e.name||"Visitor")+"</td><td>"+(label[e.type]||e.type)+" "+esc(e.tool?(TOOL[e.tool]||e.tool):(e.title||e.path||""))+'</td><td>'+secs(e.duration/1000)+'</td><td class="muted">'+esc([e.country,e.device,e.referrer].filter(Boolean).join(" · "))+"</td></tr>"}).join("")+"</table>":'<p class="empty">No activity yet.</p>'})}
  document.addEventListener("click",function(e){var b=e.target.closest("[data-s]");var tp=e.target.closest("[data-pick]");if(tp){tp.classList.toggle("on");return}
    var tc=e.target.closest("[data-tool]");if(tc){var on=[].map.call(tc.parentNode.querySelectorAll(".tchip"),function(c){return c===tc?!c.classList.contains("on"):c.classList.contains("on")});
      var list=[].filter.call(tc.parentNode.querySelectorAll(".tchip"),function(c,i){return on[i]}).map(function(c){return c.dataset.k});
      post("/api/admin/user",{id:+tc.dataset.tool,tools:list}).then(function(r){if(r.error)alert(r.error);people()});return}
    if(b){b.disabled=true;var pk=document.getElementById("pr"+b.dataset.id),body={id:+b.dataset.id,status:b.dataset.s};if(pk&&b.dataset.s==="approved")body.role=pk.value;
      if(b.dataset.s==="approved"){var picks=document.querySelectorAll('[data-pick="'+b.dataset.id+'"]');if(picks.length)body.tools=[].filter.call(picks,function(c){return c.classList.contains("on")}).map(function(c){return c.dataset.k})}
      post("/api/admin/user",body).then(function(r){if(r.error)alert(r.error);people();stats()});return}
    var a=e.target.closest("[data-act]");if(a){$("#fUser").value=a.dataset.act;activity();$("#activity").scrollIntoView({behavior:"smooth"})}});
  document.addEventListener("change",function(e){var s=e.target.closest("[data-rid]");if(!s)return;
    post("/api/admin/user",{id:+s.dataset.rid,role:s.value}).then(function(r){if(r.error)alert(r.error);people()})});
  $("#fUser").onchange=activity;$("#fType").onchange=activity;
  document.querySelectorAll("#range button").forEach(function(b){b.onclick=function(){document.querySelectorAll("#range button").forEach(function(x){x.classList.toggle("on",x===b)});days=+b.dataset.d;stats()}});
  fetch("/api/auth/me").then(function(r){return r.json()}).then(function(d){if(d.user)me=d.user}).finally(function(){stats();people();activity()});
})();
</script></body></html>`;
