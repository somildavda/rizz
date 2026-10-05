export const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>SEO Insights</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<style>
:root{--bg:#f7f7f5;--card:#fff;--ink:#1d1d1b;--mute:#6b6b66;--acc:#2f6f4f;--line:#e4e4df}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#1f1f1d;--ink:#ecece8;--mute:#9a9a94;--acc:#6fbf94;--line:#33332f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:20px 16px;display:grid;grid-template-columns:240px 1fr;gap:16px}
@media (max-width:800px){.wrap{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 12px}h3{margin:0 0 8px;font-size:14px;color:var(--mute);text-transform:uppercase;letter-spacing:.04em}
label{display:block;font-size:13px;color:var(--mute);margin:10px 0 4px}
input,textarea,select{width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font:inherit}
textarea{min-height:110px;font-family:ui-monospace,monospace;font-size:12px}
button{background:var(--acc);color:#fff;border:0;border-radius:6px;padding:9px 14px;font:inherit;cursor:pointer}
button.ghost{background:none;color:var(--acc);border:1px solid var(--line)}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.list div{padding:7px 8px;border-radius:6px;cursor:pointer;display:flex;justify-content:space-between;gap:6px}
.list div:hover,.list .on{background:var(--bg)}.list small{color:var(--mute)}
.hide{display:none}#report h2{border-bottom:1px solid var(--line);padding-bottom:4px}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:5px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
@media print{.wrap{display:block}aside,#form,.noprint{display:none!important}.card{border:0}}
</style></head><body><div class="wrap">
<aside>
 <div class="card"><h3>Clients</h3><div class="list" id="clients"></div>
  <div class="row"><button class="ghost" id="newClient">+ New client</button></div></div>
 <div class="card"><h3>Past reports</h3><div class="list" id="history"><small>None yet</small></div></div>
</aside>
<main>
<div class="card" id="form"><h1>SEO Insights</h1>
<label>Client name</label><input id="client" placeholder="e.g. Acme Dental">
<label>Data source</label>
<select id="source"><option value="csv">CSV file or paste (export from Sheets / GSC)</option>
<option value="sheet">Google Sheet link</option><option value="gsc">Search Console (live)</option></select>
<div data-s="csv"><label>Upload CSV</label><input type="file" id="file" accept=".csv,text/csv">
<label>…or paste CSV. Columns: Page, Clicks, Impressions, CTR, Position. Optional: Query, Prev Clicks, Prev Position, Conversions</label><textarea id="csv"></textarea></div>
<div data-s="sheet" class="hide"><label>Published CSV link (File → Share → Publish to web → CSV)</label><input id="csvUrl">
<label>…or private Sheet ID (shared with the service account)</label><input id="sheetId"><label>Range</label><input id="range" value="A:Z"></div>
<div data-s="gsc" class="hide"><label>Property (e.g. sc-domain:example.com)</label><input id="site"><label>Days per period</label><input id="days" type="number" value="28"></div>
<label>Context for the write-up (launches, migrations, seasonality…)</label><input id="notes">
<div class="row"><button id="go">Generate insights</button><button class="ghost" id="save">Save client</button></div>
</div>
<div id="out" class="card hide">
 <div class="row noprint" style="margin:0 0 12px"><button class="ghost" id="print">Print / PDF</button><button class="ghost" id="copy">Copy as email</button><button class="ghost" id="dl">Download tables (CSV)</button></div>
 <div id="report"></div>
 <div class="noprint" style="margin-top:20px"><h2>Ask the AI analyst</h2>
  <div class="row"><button class="ghost" data-q="What are the 5 most important actions for next month, in priority order?">Top 5 actions</button>
  <button class="ghost" data-q="Write new title tags and meta descriptions for the low click rate pages.">Rewrite titles &amp; metas</button>
  <button class="ghost" data-q="Why might the biggest drops have happened, and how do we check each reason?">Explain the drops</button>
  <button class="ghost" data-q="Suggest new content and internal links based on the quick wins and top searches.">Content ideas</button></div>
  <div class="row"><input id="q" placeholder="Ask anything about this data…" style="flex:1"><button id="ask">Ask</button></div>
  <div id="answers" style="margin-top:12px"></div></div></div>
</main></div>
<script>
const $=id=>document.getElementById(id);
const store={get(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};
const FIELDS=['client','source','csvUrl','sheetId','range','site','days','notes'];
let current=null,last=null;
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function showSource(){document.querySelectorAll('[data-s]').forEach(d=>d.classList.toggle('hide',d.dataset.s!==$('source').value))}
$('source').onchange=showSource;
$('file').onchange=async e=>{const f=e.target.files[0];if(f)$('csv').value=await f.text()};
function renderClients(){
  const cs=store.get('clients',[]);
  $('clients').innerHTML=cs.length?cs.map((c,i)=>'<div class="'+(c.client===current?'on':'')+'" data-i="'+i+'"><span>'+esc(c.client)+'</span><small data-del="'+i+'">✕</small></div>').join(''):'<small>Save a client to reuse its settings</small>';
}
$('clients').onclick=e=>{
  const cs=store.get('clients',[]);
  if(e.target.dataset.del!==undefined){if(confirm('Remove this client?')){cs.splice(+e.target.dataset.del,1);store.set('clients',cs);renderClients()}return}
  const el=e.target.closest('[data-i]');if(!el)return;const c=cs[+el.dataset.i];
  FIELDS.forEach(f=>$(f).value=c[f]??'');current=c.client;showSource();$('ask').onclick=async()=>{
  const q=$('q').value.trim();if(!q||!last)return;const box=$('answers');
  const el=document.createElement('div');el.className='card';el.innerHTML='<b>'+esc(q)+'</b><p>Thinking…</p>';box.prepend(el);$('q').value='';
  const res=await fetch('/api/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:q,client:last.client,findings:last.findings,summary:last.summary})});
  const d=await res.json();el.innerHTML='<b>'+esc(q)+'</b>'+(d.error?'<p>'+esc(d.error)+'</p>':marked.parse(d.answer));
};
document.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{$('q').value=b.dataset.q;$('ask').click()});
renderClients();renderHistory();
};
$('newClient').onclick=()=>{FIELDS.forEach(f=>$(f).value=f==='source'?'csv':f==='range'?'A:Z':f==='days'?28:'');$('csv').value='';current=null;showSource();renderClients();renderHistory();$('client').focus()};
$('save').onclick=()=>{
  const c=Object.fromEntries(FIELDS.map(f=>[f,$(f).value]));if(!c.client)return alert('Add a client name first');
  const cs=store.get('clients',[]).filter(x=>x.client!==c.client);cs.push(c);cs.sort((a,b)=>a.client.localeCompare(b.client));
  store.set('clients',cs);current=c.client;$('ask').onclick=async()=>{
  const q=$('q').value.trim();if(!q||!last)return;const box=$('answers');
  const el=document.createElement('div');el.className='card';el.innerHTML='<b>'+esc(q)+'</b><p>Thinking…</p>';box.prepend(el);$('q').value='';
  const res=await fetch('/api/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:q,client:last.client,findings:last.findings,summary:last.summary})});
  const d=await res.json();el.innerHTML='<b>'+esc(q)+'</b>'+(d.error?'<p>'+esc(d.error)+'</p>':marked.parse(d.answer));
};
document.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{$('q').value=b.dataset.q;$('ask').click()});
renderClients();renderHistory();
};
function renderHistory(){
  const h=store.get('history',[]).filter(r=>!current||r.client===current);
  $('history').innerHTML=h.length?h.slice(0,20).map(r=>'<div data-id="'+r.id+'"><span>'+esc(r.client||'Untitled')+'</span><small>'+new Date(r.id).toLocaleDateString()+'</small></div>').join(''):'<small>None yet</small>';
}
$('history').onclick=e=>{const el=e.target.closest('[data-id]');if(!el)return;const r=store.get('history',[]).find(x=>x.id==el.dataset.id);if(r)show(r)};
const fmt=(c,v)=>typeof v==='number'?(c==='ctr'?(v*100).toFixed(1)+'%':c==='concentration'?Math.round(v*100)+'%':String(Math.round(v*10)/10)):Array.isArray(v)?v.map(p=>p.page+' (#'+Math.round(p.position)+')').join('<br>'):esc(v);
const TABLES=[['Quick wins: ranking 4–20','strikingDistance',['page','impressions','clicks','position']],
 ['Low click rate for the ranking','lowCtr',['page','position','ctr','missed_clicks']],
 ['Biggest gains','winners',['page','clicks','prev_clicks','delta']],['Biggest drops','losers',['page','clicks','prev_clicks','delta']],
 ['Pages competing for the same search','keywordOverlap',['query','impressions','pages']],['Top searches','topSearches',['query','impressions','clicks','position','best_page']],
 ['Top converting pages','converters',['page','conversions','clicks']],['Sections','sections',['section','pages','clicks','prev_clicks','impressions']]];
const tbl=(rows,cols)=>'<div class="tw"><table><tr>'+cols.map(c=>'<th>'+c+'</th>').join('')+'</tr>'+rows.map(r=>'<tr>'+cols.map(c=>'<td>'+fmt(c,r[c])+'</td>').join('')+'</tr>').join('')+'</table></div>';
function show(r){
  last=r;const f=r.findings;$('out').classList.remove('hide');
  $('report').innerHTML='<h1>'+esc(r.client||'SEO report')+' <small style="font-size:13px;color:var(--mute)">'+new Date(r.id).toLocaleDateString()+'</small></h1>'+
   (r.summary?marked.parse(r.summary):'<p><i>Add ANTHROPIC_API_KEY to get the written client summary.</i></p>')+'<h2>Data tables</h2>'+
   TABLES.filter(([, k])=>f[k]&&f[k].length).map(([t,k,c])=>'<h3>'+t+'</h3>'+tbl(f[k],c)).join('');
}
$('go').onclick=async()=>{
  const out=$('out');out.classList.remove('hide');$('report').textContent='Analysing…';
  const body=Object.fromEntries(FIELDS.map(f=>[f,$(f).value]));body.csv=$('csv').value;body.days=+body.days||28;
  const res=await fetch('/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const d=await res.json();if(d.error){$('report').textContent=d.error;return}
  const r={id:Date.now(),client:body.client,findings:d.findings,summary:d.summary};
  const h=store.get('history',[]);h.unshift(r);store.set('history',h.slice(0,50));renderHistory();show(r);
};
$('print').onclick=()=>window.print();
$('copy').onclick=async()=>{
  if(!last)return;let t=last.summary||'';t=t.split(/\\n## Internal notes[^]*$/)[0].replace(/^#+\\s*/gm,'').replace(/\\*\\*/g,'');
  await navigator.clipboard.writeText('Hi,\\n\\nHere is your SEO update for '+(last.client||'the site')+'.\\n\\n'+t.trim()+'\\n\\nBest,\\n');$('copy').textContent='Copied ✓';setTimeout(()=>$('copy').textContent='Copy as email',1500);
};
$('dl').onclick=()=>{
  if(!last)return;const q=v=>'"'+String(Array.isArray(v)?v.map(p=>p.page).join(' | '):v??'').replace(/"/g,'""')+'"';
  const csv=TABLES.filter(([, k])=>last.findings[k]&&last.findings[k].length).map(([t,k,c])=>[q(t),c.join(','),...last.findings[k].map(r=>c.map(x=>q(r[x])).join(','))].join('\\n')).join('\\n\\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=(last.client||'seo')+'-insights.csv';a.click();
};
$('ask').onclick=async()=>{
  const q=$('q').value.trim();if(!q||!last)return;const box=$('answers');
  const el=document.createElement('div');el.className='card';el.innerHTML='<b>'+esc(q)+'</b><p>Thinking…</p>';box.prepend(el);$('q').value='';
  const res=await fetch('/api/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:q,client:last.client,findings:last.findings,summary:last.summary})});
  const d=await res.json();el.innerHTML='<b>'+esc(q)+'</b>'+(d.error?'<p>'+esc(d.error)+'</p>':marked.parse(d.answer));
};
document.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{$('q').value=b.dataset.q;$('ask').click()});
renderClients();renderHistory();
</script></body></html>`;

export const LOGIN = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>SEO Insights</title>
<style>:root{--bg:#f7f7f5;--card:#fff;--ink:#1d1d1b;--line:#e4e4df;--acc:#2f6f4f}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#1f1f1d;--ink:#ecece8;--line:#33332f;--acc:#6fbf94}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px system-ui,sans-serif}
form{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:24px;width:min(320px,90vw)}
input{width:100%;box-sizing:border-box;padding:10px;margin:12px 0;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink)}
button{width:100%;padding:10px;border:0;border-radius:6px;background:var(--acc);color:#fff;font:inherit}.err{color:#c0392b}</style></head>
<body><form method="post" action="/login"><h2>SEO Insights</h2><!--err--><input name="pass" type="password" placeholder="Passcode" autofocus><button>Enter</button></form></body></html>`;
