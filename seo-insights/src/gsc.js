// Google Search Console + Google Sheets access via a service account (WebCrypto JWT, no deps).

const b64url = (buf) =>
  btoa(typeof buf === 'string' ? buf : String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function accessToken(saJson, scope) {
  const sa = JSON.parse(saJson);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
    iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))}`;
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${b64url(sig)}`,
  });
  const json = await res.json();
  if (!json.access_token) throw new Error('Google auth failed: ' + JSON.stringify(json));
  return json.access_token;
}

const iso = (d) => d.toISOString().slice(0, 10);

async function queryPages(token, site, start, end) {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ startDate: iso(start), endDate: iso(end), dimensions: ['page'], rowLimit: 5000 }),
    },
  );
  const json = await res.json();
  if (json.error) throw new Error('GSC: ' + json.error.message);
  return json.rows || [];
}

// Last `days` days vs the period before it, merged per page.
export async function fetchGsc(env, site, days = 28) {
  const token = await accessToken(env.GSC_SERVICE_ACCOUNT, 'https://www.googleapis.com/auth/webmasters.readonly');
  const end = new Date(Date.now() - 3 * 864e5); // GSC data lags ~2-3 days
  const start = new Date(end - (days - 1) * 864e5);
  const prevEnd = new Date(start - 864e5);
  const prevStart = new Date(prevEnd - (days - 1) * 864e5);
  const [cur, prev] = await Promise.all([queryPages(token, site, start, end), queryPages(token, site, prevStart, prevEnd)]);
  const prevBy = Object.fromEntries(prev.map((r) => [r.keys[0], r]));
  return cur.map((r) => ({
    page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    'prev clicks': prevBy[r.keys[0]]?.clicks ?? 0,
    'prev impressions': prevBy[r.keys[0]]?.impressions ?? 0,
    'prev position': prevBy[r.keys[0]]?.position ?? '',
  }));
}

// Private sheet (shared with the service account email). Range like "Sheet1!A:Z".
export async function fetchSheet(env, sheetId, range = 'A:Z') {
  const token = await accessToken(env.GSC_SERVICE_ACCOUNT, 'https://www.googleapis.com/auth/spreadsheets.readonly');
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const json = await res.json();
  if (json.error) throw new Error('Sheets: ' + json.error.message);
  const [head, ...rest] = json.values || [];
  return rest.map((v) => Object.fromEntries(head.map((h, i) => [h, v[i]])));
}
