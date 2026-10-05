export const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>SEO Insights</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<style>
:root{--bg:#f7f7f5;--card:#fff;--ink:#1d1d1b;--mute:#6b6b66;--acc:#2f6f4f;--line:#e4e4df}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#1f1f1d;--ink:#ecece8;--mute:#9a9a94;--acc:#6fbf94;--line:#33332f}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,sans-serif}
main{max-width:900px;margin:0 auto;padding:24px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:16px}
label{display:block;font-size:13px;color:var(--mute);margin:10px 0 4px}
input,textarea,select{width:100%;box-sizing:border-box;padding:9px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font:inherit}
textarea{min-height:120px;font-family:ui-monospace,monospace;font-size:12px}
button{margin-top:14px;background:var(--acc);color:#fff;border:0;border-radius:6px;padding:10px 18px;font:inherit;cursor:pointer}
.hide{display:none}#out h2{border-bottom:1px solid var(--line);padding-bottom:4px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:4px 6px;border-bottom:1px solid var(--line);text-align:left}
</style></head><body><main>
<h1>SEO Insights</h1>
<div class="card">
<label>Data source</label>
<select id="source"><option value="csv">Paste CSV (export from Sheets / GSC)</option>
<option value="sheet">Google Sheet</option><option value="gsc">Search Console (live)</option></select>
<div data-s="csv"><label>CSV with columns like Page, Clicks, Impressions, CTR, Position (optional: Prev Clicks, Prev Position, Conversions)</label><textarea id="csv"></textarea></div>
<div data-s="sheet" class="hide"><label>Published CSV link (File → Share → Publish to web → CSV)</label><input id="csvUrl">
<label>…or private Sheet ID (share the sheet with the service account email)</label><input id="sheetId"><label>Range</label><input id="range" value="A:Z"></div>
<div data-s="gsc" class="hide"><label>Property (e.g. sc-domain:example.com)</label><input id="site"><label>Days per period</label><input id="days" type="number" value="28"></div>
<label>Client name</label><input id="client">
<label>Context for the write-up (launches, migrations, seasonality…)</label><input id="notes">
<label>Access token (if set)</label><input id="tok" type="password">
<button id="go">Generate insights</button>
</div>
<div id="out" class="card hide"></div>
</main><script>
const $=id=>document.getElementById(id);
$('source').onchange=e=>document.querySelectorAll('[data-s]').forEach(d=>d.classList.toggle('hide',d.dataset.s!==e.target.value));
const tbl=(rows,cols)=>rows.length?'<table><tr>'+cols.map(c=>'<th>'+c+'</th>').join('')+'</tr>'+rows.map(r=>'<tr>'+cols.map(c=>'<td>'+(typeof r[c]==='number'?(c==='ctr'?(r[c]*100).toFixed(1)+'%':Math.round(r[c]*10)/10):(r[c]??''))+'</td>').join('')+'</tr>').join('')+'</table>':'<p>None.</p>';
$('go').onclick=async()=>{
  const out=$('out');out.classList.remove('hide');out.innerHTML='Analysing…';
  const body={source:$('source').value,csv:$('csv').value,csvUrl:$('csvUrl').value,sheetId:$('sheetId').value,range:$('range').value,site:$('site').value,days:+$('days').value,client:$('client').value,notes:$('notes').value};
  const r=await fetch('/api/analyze',{method:'POST',headers:{'content-type':'application/json','x-access-token':$('tok').value},body:JSON.stringify(body)});
  const d=await r.json();if(d.error){out.textContent=d.error;return}
  const f=d.findings;
  out.innerHTML=(d.summary?marked.parse(d.summary):'<p><i>Set ANTHROPIC_API_KEY to get the written client summary.</i></p>')+
  '<h2>Data tables</h2><h3>Quick wins: ranking 4–20</h3>'+tbl(f.strikingDistance,['page','impressions','clicks','position'])+
  '<h3>Low click rate for the ranking</h3>'+tbl(f.lowCtr,['page','position','ctr','missed_clicks'])+
  '<h3>Biggest gains</h3>'+tbl(f.winners,['page','clicks','prev_clicks','delta'])+
  '<h3>Biggest drops</h3>'+tbl(f.losers,['page','clicks','prev_clicks','delta'])+
  '<h3>Sections</h3>'+tbl(f.sections,['section','pages','clicks','prev_clicks','impressions']);
};
</script></body></html>`;
