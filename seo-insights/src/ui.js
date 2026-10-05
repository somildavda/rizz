// Page markup for the Worker. Client-side JS avoids backslashes and ${} because it lives in a template literal.

const STYLE = `
:root{--bg:#f6f7f9;--card:#fff;--ink:#16181d;--mute:#667085;--acc:#3b5bdb;--acc-soft:#edf1ff;--line:#e4e7ec;--good:#12805c;--bad:#c4320a;--warn:#b54708}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--ink:#e8eaf0;--mute:#98a2b3;--acc:#7c95ff;--acc-soft:#1d2440;--line:#2a2f3a;--good:#4ccf9a;--bad:#ff8a65;--warn:#f5b453}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,sans-serif}
a{color:var(--acc)}
`;

export const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Searchverse Insights</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<style>${STYLE}
header{background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
.bar{max-width:1100px;margin:0 auto;padding:12px 16px 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.brand{font-weight:700;font-size:18px;margin-right:auto}.brand span{color:var(--acc)}
.chips{display:flex;gap:6px;font-size:12px}.chip{padding:3px 9px;border-radius:99px;border:1px solid var(--line);color:var(--mute);cursor:pointer}
.chip.ok{color:var(--good);border-color:currentColor}
nav{max-width:1100px;margin:0 auto;padding:0 16px;display:flex;gap:4px;overflow-x:auto}
nav button{background:none;border:0;border-bottom:2px solid transparent;color:var(--mute);padding:12px 14px;font:inherit;font-weight:600;cursor:pointer;white-space:nowrap}
nav button.on{color:var(--acc);border-color:var(--acc)}
main{max-width:1100px;margin:0 auto;padding:20px 16px 60px}
.tab{display:none}.tab.on{display:block}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:0 0 12px}h3{font-size:13px;margin:22px 0 8px;color:var(--mute);text-transform:uppercase;letter-spacing:.05em}
.sub{color:var(--mute);margin:0 0 16px}
.step{display:flex;gap:10px;align-items:center;margin-bottom:12px}.num{width:26px;height:26px;border-radius:50%;background:var(--acc-soft);color:var(--acc);display:grid;place-items:center;font-weight:700;font-size:13px;flex:none}
label{display:block;font-size:13px;color:var(--mute);margin:12px 0 5px}
input,textarea,select{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}
textarea{min-height:110px;font-family:ui-monospace,monospace;font-size:12px}
button{background:var(--acc);color:#fff;border:0;border-radius:8px;padding:10px 16px;font:inherit;font-weight:600;cursor:pointer}
button.ghost{background:var(--card);color:var(--ink);border:1px solid var(--line);font-weight:500}
button.big{padding:13px 22px;font-size:16px}
button:disabled{opacity:.6;cursor:wait}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center}
.seg{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.seg button{background:var(--card);color:var(--ink);border:1px solid var(--line);text-align:left;padding:12px;font-weight:500}
.seg button b{display:block}.seg button small{color:var(--mute)}
.seg button.on{border-color:var(--acc);background:var(--acc-soft)}
@media (max-width:640px){.seg{grid-template-columns:1fr}}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media (max-width:640px){.grid2{grid-template-columns:1fr}}
.hide{display:none!important}
.note{font-size:13px;color:var(--mute)}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}@media (max-width:640px){.kpis{grid-template-columns:1fr 1fr}}
.kpi{border:1px solid var(--line);border-radius:10px;padding:12px}.kpi small{color:var(--mute);display:block;font-size:12px}.kpi b{font-size:22px}
.up{color:var(--good)}.down{color:var(--bad)}
.summary h2{font-size:17px;margin:20px 0 8px;border:0}
.tw{overflow-x:auto;border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--mute);font-weight:600;background:var(--bg)}tr:last-child td{border-bottom:0}
details.tbl{border:1px solid var(--line);border-radius:10px;margin-bottom:10px;background:var(--card)}
details.tbl summary{padding:12px 14px;cursor:pointer;font-weight:600}details.tbl summary small{color:var(--mute);font-weight:400}
details.tbl .tw{border:0;border-top:1px solid var(--line);border-radius:0}
.list .item{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;margin-bottom:8px}
.list .item small{color:var(--mute)}
.empty{color:var(--mute);text-align:center;padding:28px}
.pre{display:flex;gap:8px;flex-wrap:wrap}
.answer{border-left:3px solid var(--acc);padding:4px 0 4px 14px;margin:16px 0}
.status{font-size:14px;margin-top:10px}
code{background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:12px;word-break:break-all}
@media print{header,.noprint{display:none!important}.tab{display:none!important}#tab-report{display:block!important}.card{border:0}details.tbl{break-inside:avoid}details.tbl>*{display:block}}
</style></head><body>
<header>
 <div class="bar"><div class="brand">Searchverse <span>Insights</span></div>
  <div class="chips"><span class="chip" id="chipAI" data-go="settings">Gemini AI</span><span class="chip" id="chipG" data-go="settings">Google</span></div></div>
 <nav>
  <button data-tab="report" class="on">📊 Weekly report</button>
  <button data-tab="ai">✨ AI analyst</button>
  <button data-tab="clients">👥 Clients &amp; history</button>
  <button data-tab="settings">⚙️ Settings</button>
 </nav>
</header>
<main>

<!-- REPORT -->
<section class="tab on" id="tab-report">
 <div class="card noprint" id="setupNudge" style="border-color:var(--acc)"><b>First time here?</b> Open <a href="#" data-go="settings">Settings</a> to add your free Gemini key and sign in with Google. It takes about 5 minutes, once.</div>
 <div class="card noprint">
  <h1>Weekly SEO report</h1><p class="sub">Choose a client and a week. You get the data compared with the week before, plus AI insights and recommendations.</p>
  <div class="step"><span class="num">1</span><b>Client</b></div>
  <div class="grid2"><div><label>Client name</label><input id="client" placeholder="e.g. Acme Dental" list="clientList"><datalist id="clientList"></datalist></div>
   <div><label>Notes for the AI (optional): launches, migrations, seasonality…</label><input id="notes"></div></div>
  <div class="step" style="margin-top:20px"><span class="num">2</span><b>Data source</b></div>
  <div class="seg" id="srcSeg">
   <button data-src="gsc" class="on"><b>🔎 Search Console</b><small>Live data, after Google sign-in</small></button>
   <button data-src="sheet"><b>📗 Google Sheet</b><small>Paste the sheet link</small></button>
   <button data-src="csv"><b>📄 CSV file</b><small>Upload or paste</small></button>
  </div>
  <input type="hidden" id="source" value="gsc">
  <div data-s="gsc"><label>Website (Search Console property)</label><select id="siteSel"><option value="">Sign in with Google in Settings to load your sites</option></select>
   <input id="site" class="hide" placeholder="sc-domain:example.com"></div>
  <div data-s="sheet" class="hide"><label>Google Sheet link</label><input id="csvUrl" placeholder="https://docs.google.com/spreadsheets/d/…">
   <p class="note">Signed in with Google: paste the normal sheet link. Otherwise use File → Share → Publish to web → CSV. Columns: Date, Page, Clicks, Impressions, Position (optional: Query, Conversions).</p>
   <details class="note"><summary>Advanced</summary><label>Sheet tab and range</label><input id="range" value="A:Z" placeholder="Sheet1!A:Z"><input id="sheetId" type="hidden"></details></div>
  <div data-s="csv" class="hide"><label>Upload CSV</label><input type="file" id="file" accept=".csv,text/csv">
   <label>…or paste it</label><textarea id="csv" placeholder="Date,Page,Clicks,Impressions,Position"></textarea></div>
  <div class="step" style="margin-top:20px"><span class="num">3</span><b>Week</b></div>
  <select id="week"></select>
  <div class="row"><button class="big" id="go">Generate report</button><button class="ghost" id="save">Save client</button><span class="note" id="goMsg"></span></div>
 </div>

 <div id="out" class="hide">
  <div class="card">
   <div class="row noprint" style="margin:0 0 6px;justify-content:flex-end"><button class="ghost" id="print">🖨️ Print / PDF</button><button class="ghost" id="copy">✉️ Copy as email</button><button class="ghost" id="dl">⬇️ Download CSV</button></div>
   <h1 id="rTitle"></h1><p class="sub" id="rPeriod"></p>
   <div class="kpis" id="kpis"></div>
   <div class="summary" id="summary"></div>
   <div class="row noprint"><button class="ghost" data-go="ai">✨ Ask the AI analyst about this report →</button></div>
  </div>
  <div class="card"><h2>The data</h2><div id="tables"></div></div>
 </div>
</section>

<!-- AI ANALYST -->
<section class="tab" id="tab-ai">
 <div class="card"><h1>AI analyst</h1><p class="sub" id="aiFor">Generate a report first, then ask anything about it.</p>
  <div class="pre">
   <button class="ghost" data-q="What are the 5 most important actions for this week, in priority order?">🎯 Top 5 actions</button>
   <button class="ghost" data-q="Write new title tags and meta descriptions for the pages with a low click rate. Give character counts.">✍️ Rewrite titles &amp; metas</button>
   <button class="ghost" data-q="Why might the biggest drops have happened, and how do we check each reason?">📉 Explain the drops</button>
   <button class="ghost" data-q="Which pages compete for the same searches, and should we merge, redirect or differentiate them?">🔀 Fix competing pages</button>
   <button class="ghost" data-q="Suggest new content and internal links based on the quick wins and top searches.">💡 Content ideas</button>
  </div>
  <div class="row"><input id="q" placeholder="Ask anything about this week's data…" style="flex:1"><button id="ask">Ask</button></div>
 </div>
 <div class="card" id="answersCard"><div id="answers"><div class="empty">Answers appear here.</div></div></div>
</section>

<!-- CLIENTS -->
<section class="tab" id="tab-clients">
 <div class="grid2">
  <div class="card"><h2>Saved clients</h2><div class="list" id="clients"></div></div>
  <div class="card"><h2>Past reports</h2><div class="list" id="history"></div></div>
 </div>
 <p class="note">Clients and reports are saved on the server, so they show up in every browser.</p>
</section>

<!-- SETTINGS -->
<section class="tab" id="tab-settings">
 <div class="card"><div class="step"><span class="num">1</span><h2 style="margin:0">Gemini AI (free)</h2></div>
  <p class="sub">Writes the insights and recommendations. Get a key at <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a> → <b>Create API key</b>, then paste it here.</p>
  <div class="row" style="margin:0"><input id="kGemini" type="password" placeholder="AIza…" autocomplete="off" style="flex:1"><button id="saveKeys">Save &amp; test</button></div>
  <div class="status" id="testOut"></div>
  <h3>Gemini usage</h3><div id="usage" class="note">No AI requests yet.</div>
  <p class="note">Google doesn't report how much free quota is left. Your exact limits and remaining quota are at <a href="https://aistudio.google.com/usage" target="_blank">AI Studio → Usage</a>. The free tier allows a set number of requests per minute and per day; when one runs out, Gemini returns a "quota exceeded" error and resets the next day.</p>
 </div>

 <div class="card"><div class="step"><span class="num">2</span><h2 style="margin:0">Google: Search Console &amp; Sheets</h2></div>
  <div id="gConnected" class="hide"><p>✅ Signed in as <b id="gEmail"></b></p><div class="status" id="gSites"></div>
   <form method="post" action="/auth/google/disconnect" class="row"><button class="ghost">Disconnect Google</button></form></div>
  <form id="gForm" method="post" action="/auth/google">
   <p class="sub">Sign in once and the tool can read every Search Console site and Google Sheet your account can see.</p>
   <div class="status" id="gErr" style="color:var(--bad)"></div>
   <p class="hide" id="gSaved">✅ Google app saved. Just click the button. <a href="#" id="gEdit">Change Client ID</a></p>
   <div class="grid2" id="gCreds"><div><label>OAuth Client ID</label><input name="cid" id="gCid" placeholder="…apps.googleusercontent.com" autocomplete="off"></div>
    <div><label>Client secret</label><input name="secret" id="gSecret" type="password" autocomplete="off"></div></div>
   <div class="row"><button class="big" id="gBtn">Sign in with Google</button></div>
   <details style="margin-top:14px" open><summary><b>One-time setup: get the Client ID (about 5 minutes)</b></summary><ol style="line-height:1.8">
    <li>Open <a href="https://console.cloud.google.com/projectcreate" target="_blank">Google Cloud → New project</a>, name it <b>searchverse-insights</b> → <b>Create</b>.</li>
    <li>Click <b>Enable</b> on the <a href="https://console.cloud.google.com/apis/library/searchconsole.googleapis.com" target="_blank">Search Console API</a> and on the <a href="https://console.cloud.google.com/apis/library/sheets.googleapis.com" target="_blank">Google Sheets API</a>.</li>
    <li>Open <a href="https://console.cloud.google.com/auth/branding" target="_blank">Google Auth Platform</a> → <b>Get started</b>: app name <b>Searchverse Insights</b>, your email, audience <b>External</b> → finish. Then go to <b>Audience</b> → <b>Publish app</b>, so Google doesn't sign you out every 7 days.</li>
    <li>Open <a href="https://console.cloud.google.com/auth/clients/create" target="_blank">Clients → Create client</a> → <b>Web application</b>. Under <b>Authorized redirect URIs</b> add <code id="gRedirect"></code> → <b>Create</b>.</li>
    <li>Copy the <b>Client ID</b> and <b>Client secret</b> into the boxes above and click <b>Sign in with Google</b>. When Google says the app isn't verified, click <b>Advanced → Go to Searchverse Insights</b>. It's your own app.</li>
   </ol></details>
  </form>
  <details class="note" style="margin-top:14px"><summary>Advanced: use a service account key file instead</summary>
   <input type="file" id="kGscFile" accept=".json,application/json" style="margin-top:8px"><div id="gscInfo" style="margin-top:6px"></div>
   <p>Create a service account in Google Cloud, download its JSON key, upload it here, then add its email as a user in Search Console.</p></details>
 </div>

 <div class="card"><h2>Privacy</h2><p class="note" style="margin:0">Your Gemini key, Google sign-in, clients and reports are saved on this tool's private Cloudflare storage, behind your passcode. <button class="ghost" id="clearKeys" style="margin-left:8px;padding:5px 10px">Remove saved keys</button></p></div>
</section>
</main>

<script>
const $=id=>document.getElementById(id);
const NL=String.fromCharCode(10);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const store={get(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};
const keys=()=>store.get('keys',{});
let serverData=false;
const sync=()=>{if(serverData)post('/api/data',{clients:store.get('clients',[]),history:store.get('history',[])}).catch(()=>{})};
const saveList=(k,v)=>{store.set(k,v);sync()};
async function loadData(){try{const d=await (await fetch('/api/data')).json();serverData=!!d.serverStorage;if(!serverData)return;
 if(d.clients||d.history){if(d.clients)store.set('clients',d.clients);if(d.history)store.set('history',d.history)}else sync();
 renderClients();renderHistory()}catch{}}
const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({keys:keys()},b))}).then(r=>r.json());
let last=null,gInfo={connected:false};
const hasGoogle=()=>gInfo.connected||!!keys().gsc;
const hasGemini=()=>!!keys().gemini||!!gInfo.gemini;

/* tabs */
function go(t){document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
 document.querySelectorAll('.tab').forEach(s=>s.classList.toggle('on',s.id==='tab-'+t));if(t==='settings')fillSettings();window.scrollTo(0,0)}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>go(b.dataset.tab));
document.addEventListener('click',e=>{const g=e.target.closest('[data-go]');if(g){e.preventDefault();go(g.dataset.go)}});

/* status */
function renderStatus(){const k=keys();
 $('chipAI').className='chip'+(hasGemini()?' ok':'');$('chipAI').textContent=(hasGemini()?'✓ ':'')+'Gemini AI';
 $('chipG').className='chip'+(hasGoogle()?' ok':'');$('chipG').textContent=(hasGoogle()?'✓ ':'')+'Google';
 $('setupNudge').classList.toggle('hide',!!(hasGemini()&&hasGoogle()))}

/* source picker */
function setSource(v){$('source').value=v;document.querySelectorAll('#srcSeg button').forEach(b=>b.classList.toggle('on',b.dataset.src===v));
 document.querySelectorAll('[data-s]').forEach(d=>d.classList.toggle('hide',d.dataset.s!==v))}
document.querySelectorAll('#srcSeg button').forEach(b=>b.onclick=()=>setSource(b.dataset.src));
$('file').onchange=async e=>{const f=e.target.files[0];if(f)$('csv').value=await f.text()};
$('siteSel').onchange=()=>{$('site').value=$('siteSel').value};

/* weeks */
(()=>{const d=new Date();d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7)-7);
 const f=x=>x.toLocaleDateString(undefined,{day:'numeric',month:'short',timeZone:'UTC'});const o=[];
 for(let i=0;i<12;i++){const s=new Date(d-i*7*864e5),e=new Date(+s+6*864e5);
  o.push('<option value="'+s.toISOString().slice(0,10)+'">'+f(s)+' – '+f(e)+(i===0?' (last week)':'')+'</option>')}
 o.push('<option value="">All data in the sheet / CSV</option>');$('week').innerHTML=o.join('')})();

/* google + sites */
async function loadGoogle(){try{gInfo=await (await fetch('/api/google')).json()}catch{}renderStatus();renderUsage()}
function renderUsage(){const u=gInfo.usage||{},days=Object.keys(u).sort().reverse();if(!days.length)return;
 const today=new Date().toISOString().slice(0,10),t=u[today]||{requests:0,input:0,output:0};
 const sum=days.slice(0,7).reduce((a,d)=>({r:a.r+u[d].requests,t:a.t+u[d].input+u[d].output}),{r:0,t:0});
 $('usage').innerHTML='<div class="kpis" style="margin:8px 0"><div class="kpi"><small>Requests today</small><b>'+t.requests+'</b></div><div class="kpi"><small>Tokens today</small><b>'+(t.input+t.output).toLocaleString()+'</b><small>'+t.input.toLocaleString()+' in · '+t.output.toLocaleString()+' out</small></div><div class="kpi"><small>Requests, last 7 days</small><b>'+sum.r+'</b></div><div class="kpi"><small>Tokens, last 7 days</small><b>'+sum.t.toLocaleString()+'</b></div></div>Model: '+esc((u[days[0]]||{}).model||'')}
async function loadSites(){if(!hasGoogle())return null;const d=await post('/api/sites',{});
 if(d.sites&&d.sites.length){const cur=$('site').value;$('siteSel').innerHTML='<option value="">Choose a website…</option>'+d.sites.map(x=>'<option'+(x===cur?' selected':'')+'>'+esc(x)+'</option>').join('')}
 else if(d.sites){$('siteSel').innerHTML='<option value="">No Search Console sites on this Google account</option>'}
 return d}
$('gEdit').onclick=e=>{e.preventDefault();$('gCreds').classList.remove('hide');$('gSaved').classList.add('hide')};
$('gForm').onsubmit=e=>{if(!gInfo.configured&&(!$('gCid').value.trim()||!$('gSecret').value.trim())){e.preventDefault();alert('Paste the Client ID and Client secret first. The setup steps are just below.');return}store.set('gcid',$('gCid').value.trim())};

/* settings */
let pendingGsc=null;
function fillSettings(){const k=keys();$('kGemini').value=k.gemini||'';
 $('gRedirect').textContent=gInfo.redirectUri||location.origin+'/auth/callback';$('gCid').value=store.get('gcid','');
 $('gConnected').classList.toggle('hide',!gInfo.connected);$('gForm').classList.toggle('hide',!!gInfo.connected);$('gEmail').textContent=gInfo.email||'your Google account';
 $('gCreds').classList.toggle('hide',!!gInfo.configured);$('gSaved').classList.toggle('hide',!gInfo.configured);
 $('gscInfo').innerHTML=k.gsc?'Loaded key for <b>'+esc(JSON.parse(k.gsc).client_email)+'</b>':''}
$('kGscFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;const t=await f.text();
 try{const j=JSON.parse(t);if(!j.client_email||!j.private_key)throw 0;const k=keys();k.gsc=t;store.set('keys',k);$('gscInfo').innerHTML='Saved. Add <b>'+esc(j.client_email)+'</b> as a user in Search Console.';renderStatus();loadSites()}
 catch{$('gscInfo').textContent='That is not a service account key file.'}};
async function testGoogle(){if(!hasGoogle())return;$('gSites').textContent='Loading your sites…';const d=await loadSites();
 $('gSites').innerHTML=d.error?'❌ '+esc(d.error):d.sites.length?'✅ '+d.sites.length+' Search Console sites: '+d.sites.map(esc).join(', '):'⚠️ This Google account has no Search Console sites.'}
$('saveKeys').onclick=async()=>{const k=keys();k.gemini=$('kGemini').value.trim();store.set('keys',k);
 await post('/api/settings',{gemini:k.gemini}).catch(()=>{});await loadGoogle();
 if(!k.gemini){$('testOut').textContent='Removed.';return}
 $('testOut').textContent='Testing…';const d=await post('/api/ask',{question:'Reply with just: OK',findings:{}});
 $('testOut').innerHTML=d.error?'❌ '+esc(d.error):'✅ Gemini works';loadGoogle()};
$('clearKeys').onclick=()=>{if(confirm('Remove the saved Gemini key and key file from this browser?')){store.set('keys',{});fillSettings();renderStatus()}};

/* clients + history */
const FIELDS=['client','source','csvUrl','sheetId','range','site','notes'];
function renderClients(){const cs=store.get('clients',[]);
 $('clientList').innerHTML=cs.map(c=>'<option value="'+esc(c.client)+'">').join('');
 $('clients').innerHTML=cs.length?cs.map((c,i)=>'<div class="item"><div><b>'+esc(c.client)+'</b><br><small>'+esc(c.site||c.csvUrl||'CSV')+'</small></div><div><button class="ghost" data-load="'+i+'">Open</button> <button class="ghost" data-del="'+i+'">✕</button></div></div>').join(''):'<div class="empty">No saved clients yet. Fill in a report and click <b>Save client</b>.</div>'}
function loadClient(c){FIELDS.forEach(f=>{if($(f))$(f).value=c[f]??''});setSource(c.source||'gsc');if(c.site)$('siteSel').value=c.site}
$('clients').onclick=e=>{const cs=store.get('clients',[]);const l=e.target.dataset.load,d=e.target.dataset.del;
 if(d!==undefined){if(confirm('Remove this client?')){cs.splice(+d,1);saveList('clients',cs);renderClients()}}
 if(l!==undefined){loadClient(cs[+l]);go('report')}};
$('client').onchange=()=>{const c=store.get('clients',[]).find(x=>x.client===$('client').value);if(c)loadClient(c)};
$('save').onclick=()=>{const c=Object.fromEntries(FIELDS.map(f=>[f,$(f).value]));if(!c.client)return alert('Add a client name first');
 const cs=store.get('clients',[]).filter(x=>x.client!==c.client);cs.push(c);cs.sort((a,b)=>a.client.localeCompare(b.client));saveList('clients',cs);renderClients();
 $('goMsg').textContent='Saved ✓';setTimeout(()=>$('goMsg').textContent='',1500)};
function renderHistory(){const h=store.get('history',[]);
 $('history').innerHTML=h.length?h.slice(0,30).map(r=>'<div class="item"><div><b>'+esc(r.client||'Untitled')+'</b><br><small>'+esc(r.period||new Date(r.id).toLocaleDateString())+'</small></div><button class="ghost" data-id="'+r.id+'">Open</button></div>').join(''):'<div class="empty">Reports you generate appear here.</div>'}
$('history').onclick=e=>{const id=e.target.dataset.id;if(!id)return;const r=store.get('history',[]).find(x=>x.id==id);if(r){show(r);go('report')}};

/* report */
const fmt=(c,v)=>typeof v==='number'?(c==='ctr'?(v*100).toFixed(1)+'%':c==='delta'?(v>0?'+':'')+Math.round(v):c==='position'||c==='prev_position'?v.toFixed(1):Math.round(v).toLocaleString()):Array.isArray(v)?v.map(p=>esc(p.page)+' <small>(#'+Math.round(p.position)+')</small>').join('<br>'):esc(v);
const NAMES={page:'Page',impressions:'Impressions',clicks:'Clicks',position:'Avg. position',ctr:'Click rate',missed_clicks:'Missed clicks (est.)',prev_clicks:'Clicks last week',delta:'Change',query:'Search',pages:'Competing pages',best_page:'Best page',conversions:'Conversions',section:'Section'};
const TABLES=[['🚀 Quick wins','Ranking 4–20 with real demand: a small push can reach the top 3','strikingDistance',['page','impressions','clicks','position']],
 ['👀 Seen but not clicked','Ranking well, but few people click: improve the title and description','lowCtr',['page','position','ctr','missed_clicks']],
 ['📈 Biggest gains','','winners',['page','clicks','prev_clicks','delta']],
 ['📉 Biggest drops','','losers',['page','clicks','prev_clicks','delta']],
 ['🔀 Pages competing for the same search','Consider merging or differentiating these','keywordOverlap',['query','impressions','pages']],
 ['🔎 Top searches','','topSearches',['query','impressions','clicks','position','best_page']],
 ['💰 Top converting pages','','converters',['page','conversions','clicks']],
 ['🗂️ By section','Traffic grouped by URL folder','sections',['section','pages','clicks','prev_clicks','impressions']]];
const tbl=(rows,cols)=>'<div class="tw"><table><tr>'+cols.map(c=>'<th>'+(NAMES[c]||c)+'</th>').join('')+'</tr>'+rows.map(r=>'<tr>'+cols.map(c=>'<td class="'+(c==='delta'?(r[c]>0?'up':'down'):'')+'">'+fmt(c,r[c])+'</td>').join('')+'</tr>').join('')+'</table></div>';
function kpi(label,val,prev){let ch='';if(prev!=null&&prev>0){const p=Math.round((val-prev)/prev*100);ch='<small class="'+(p>=0?'up':'down')+'">'+(p>=0?'▲ ':'▼ ')+Math.abs(p)+'% vs last week</small>'}
 return '<div class="kpi"><small>'+label+'</small><b>'+Math.round(val).toLocaleString()+'</b>'+ch+'</div>'}
function show(r){last=r;const f=r.findings,t=f.totals||{};$('out').classList.remove('hide');
 $('rTitle').textContent=(r.client||'SEO report');$('rPeriod').textContent=r.period||new Date(r.id).toLocaleDateString();
 $('kpis').innerHTML=kpi('Clicks from Google',t.clicks||0,t.prev_clicks)+kpi('Impressions',t.impressions||0)+kpi('Pages with traffic',t.pages||0)+
  '<div class="kpi"><small>Traffic from top 5 pages</small><b>'+Math.round((f.concentration||0)*100)+'%</b></div>';
 $('summary').innerHTML=r.summary?marked.parse(r.summary):'<p class="note">'+esc(r.aiError||'Add your free Gemini key in Settings to get AI insights and recommendations.')+'</p>';
 $('tables').innerHTML=TABLES.filter(x=>f[x[2]]&&f[x[2]].length).map((x,i)=>'<details class="tbl"'+(i<2?' open':'')+'><summary>'+x[0]+' <small>'+f[x[2]].length+' rows'+(x[1]?' · '+x[1]:'')+'</small></summary>'+tbl(f[x[2]],x[3])+'</details>').join('')||'<div class="empty">No rows matched.</div>';
 $('aiFor').textContent='Asking about: '+(r.client||'report')+', '+(r.period||'');$('out').scrollIntoView({behavior:'smooth'})}
$('go').onclick=async()=>{const body=Object.fromEntries(FIELDS.map(f=>[f,$(f).value]));body.csv=$('csv').value;body.week=$('week').value;
 if(body.source==='gsc'&&!hasGoogle()){go('settings');return}
 if(body.source==='gsc'&&!body.site){$('goMsg').textContent='Choose a website first.';return}
 $('go').disabled=true;$('go').textContent='Working… (up to 30s)';$('goMsg').textContent='';
 try{const d=await post('/api/analyze',body);
  if(d.error){$('goMsg').innerHTML='❌ '+esc(d.error);return}
  const r={id:Date.now(),client:body.client,period:d.period,findings:d.findings,summary:d.summary,aiError:d.aiError};
  const h=store.get('history',[]);h.unshift(r);saveList('history',h.slice(0,50));renderHistory();show(r)}
 catch(e){$('goMsg').textContent='❌ '+e.message}
 finally{$('go').disabled=false;$('go').textContent='Generate report'}};
$('print').onclick=()=>{document.querySelectorAll('details.tbl').forEach(d=>d.open=true);window.print()};
$('copy').onclick=async()=>{if(!last)return;let t=(last.summary||'').split('## Internal notes')[0].replace(/^#+ */gm,'').replace(/[*][*]/g,'');
 await navigator.clipboard.writeText('Hi,'+NL+NL+'Here is your SEO update for '+(last.client||'the site')+' ('+(last.period||'')+').'+NL+NL+t.trim()+NL+NL+'Best,'+NL);
 $('copy').textContent='Copied ✓';setTimeout(()=>$('copy').textContent='✉️ Copy as email',1500)};
$('dl').onclick=()=>{if(!last)return;const q=v=>'"'+String(Array.isArray(v)?v.map(p=>p.page).join(' | '):v??'').replace(/"/g,'""')+'"';
 const csv=TABLES.filter(x=>last.findings[x[2]]&&last.findings[x[2]].length).map(x=>[q(x[0]),x[3].map(c=>NAMES[c]||c).join(','),...last.findings[x[2]].map(r=>x[3].map(c=>q(r[c])).join(','))].join(NL)).join(NL+NL);
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=(last.client||'searchverse')+'-insights.csv';a.click()};

/* AI analyst */
$('ask').onclick=async()=>{const q=$('q').value.trim();if(!q)return;if(!last){$('answers').innerHTML='<div class="empty">Generate a report on the Weekly report tab first.</div>';return}
 if(!hasGemini()){go('settings');return}
 const box=$('answers');if(box.querySelector('.empty'))box.innerHTML='';
 const el=document.createElement('div');el.className='answer';el.innerHTML='<b>'+esc(q)+'</b><p class="note">Thinking…</p>';box.prepend(el);$('q').value='';
 const d=await post('/api/ask',{question:q,client:last.client,findings:last.findings,summary:last.summary});
 el.innerHTML='<b>'+esc(q)+'</b>'+(d.error?'<p>❌ '+esc(d.error)+'</p>':marked.parse(d.answer))};
$('q').onkeydown=e=>{if(e.key==='Enter')$('ask').click()};
document.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{$('q').value=b.dataset.q;$('ask').click()});

/* start */
renderClients();renderHistory();renderStatus();loadData();
const gErr=new URLSearchParams(location.search).get('google_error');
loadGoogle().then(()=>{if(gErr){history.replaceState(null,'','/');go('settings');$('gErr').textContent='❌ '+gErr}loadSites().catch(()=>{});
 const justSignedIn=location.search.includes('google=connected');if(justSignedIn)history.replaceState(null,'','/');
 if(justSignedIn){go('settings');testGoogle()}
 if(!hasGoogle())setSource('sheet')});
</script></body></html>`;

export const LOGIN = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Searchverse Insights</title>
<style>${STYLE}
body{min-height:100vh;display:grid;place-items:center}
form{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px;width:min(340px,90vw)}
h2{margin:0 0 4px}h2 span{color:var(--acc)}p{color:var(--mute);margin:0 0 8px;font-size:14px}
input{width:100%;padding:11px;margin:12px 0;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}
button{width:100%;padding:11px;border:0;border-radius:8px;background:var(--acc);color:#fff;font:inherit;font-weight:600;cursor:pointer}.err{color:var(--bad)}</style></head>
<body><form method="post" action="/login"><h2>Searchverse <span>Insights</span></h2><p>Weekly SEO reports with AI recommendations</p><!--err--><input name="pass" type="password" placeholder="Passcode" autofocus><button>Enter</button></form></body></html>`;
