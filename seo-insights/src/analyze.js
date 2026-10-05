// Turns page-level rows into structured findings. Pure functions, no I/O.

const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v).replace(/[%,]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const ALIASES = {
  page: ['page', 'page path', 'pagepath', 'url', 'landing page', 'top pages', 'path'],
  clicks: ['clicks', 'url clicks'],
  impressions: ['impressions', 'impr'],
  ctr: ['ctr', 'url ctr'],
  position: ['position', 'avg position', 'average position', 'avg. position'],
  prev_clicks: ['prev clicks', 'previous clicks', 'clicks (previous)', 'clicks prev'],
  prev_impressions: ['prev impressions', 'previous impressions', 'impressions (previous)'],
  prev_position: ['prev position', 'previous position', 'position (previous)'],
  sessions: ['sessions', 'users'],
  conversions: ['conversions', 'key events', 'leads', 'goals'],
};

export function normalizeRows(raw) {
  if (!raw.length) return [];
  const keys = Object.keys(raw[0]);
  const map = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const hit = keys.find((k) => names.includes(k.trim().toLowerCase()));
    if (hit) map[field] = hit;
  }
  if (!map.page) throw new Error('Could not find a page / page path column.');
  return raw
    .map((r) => {
      const row = { page: toPath(r[map.page]) };
      for (const f of Object.keys(ALIASES)) if (f !== 'page') row[f] = map[f] ? num(r[map[f]]) : null;
      if (row.ctr === null && row.clicks !== null && row.impressions) row.ctr = row.clicks / row.impressions;
      else if (row.ctr !== null && (String(r[map.ctr]).includes('%') || row.ctr > 1)) row.ctr /= 100;
      return row;
    })
    .filter((r) => r.page);
}

function toPath(v) {
  if (!v) return '';
  try { return new URL(v).pathname; } catch { return String(v).trim(); }
}

// Rough expected CTR by position, used to spot titles/snippets underperforming.
const EXPECTED_CTR = [0, 0.28, 0.16, 0.11, 0.08, 0.06, 0.05, 0.04, 0.03, 0.025, 0.02];
const expectedCtr = (pos) => EXPECTED_CTR[Math.min(10, Math.max(1, Math.round(pos)))] ?? 0.01;

export function analyze(rows) {
  const total = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const hasPrev = rows.some((r) => r.prev_clicks !== null);
  const clicks = total('clicks');

  const sectionMap = {};
  for (const r of rows) {
    const seg = '/' + (r.page.split('/').filter(Boolean)[0] || '');
    const s = (sectionMap[seg] ||= { section: seg, pages: 0, clicks: 0, impressions: 0, prev_clicks: 0 });
    s.pages++; s.clicks += r.clicks || 0; s.impressions += r.impressions || 0; s.prev_clicks += r.prev_clicks || 0;
  }
  if (!hasPrev) for (const s of Object.values(sectionMap)) s.prev_clicks = null;
  const sections = Object.values(sectionMap).sort((a, b) => b.clicks - a.clicks).slice(0, 10);

  const top = [...rows].sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
  const concentration = clicks ? top.slice(0, 5).reduce((s, r) => s + (r.clicks || 0), 0) / clicks : 0;

  // Page 1 bottom / page 2 with real demand: small ranking gains move the needle.
  const strikingDistance = rows
    .filter((r) => r.position >= 4 && r.position <= 20 && r.impressions >= 100)
    .sort((a, b) => b.impressions - a.impressions).slice(0, 10);

  // Ranking well but people aren't clicking: title / meta description work.
  const lowCtr = rows
    .filter((r) => r.position && r.position <= 10 && r.impressions >= 200 && r.ctr < expectedCtr(r.position) * 0.5)
    .map((r) => ({ ...r, missed_clicks: Math.round(r.impressions * expectedCtr(r.position) - (r.clicks || 0)) }))
    .sort((a, b) => b.missed_clicks - a.missed_clicks).slice(0, 10);

  const zeroClick = rows.filter((r) => r.impressions >= 500 && !r.clicks).slice(0, 10);

  let winners = [], losers = [];
  if (hasPrev) {
    const withDelta = rows.filter((r) => r.prev_clicks !== null)
      .map((r) => ({ ...r, delta: (r.clicks || 0) - r.prev_clicks }));
    winners = withDelta.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 8);
    losers = withDelta.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 8);
  }

  const converters = rows.some((r) => r.conversions)
    ? [...rows].filter((r) => r.conversions).sort((a, b) => b.conversions - a.conversions).slice(0, 8)
    : [];

  return {
    totals: { pages: rows.length, clicks, impressions: total('impressions'), prev_clicks: hasPrev ? total('prev_clicks') : null },
    topPages: top.slice(0, 10),
    concentration,
    sections,
    strikingDistance,
    lowCtr,
    zeroClick,
    winners,
    losers,
    converters,
  };
}

// Page+query rows -> keyword overlap (several pages ranking for one search) and top searches per page.
export function analyzeQueries(qrows) {
  const byQuery = {};
  for (const r of qrows) {
    if (r.impressions < 20) continue;
    let path = r.page;
    try { path = new URL(r.page).pathname; } catch {}
    (byQuery[r.query] ||= []).push({ page: path, clicks: r.clicks, impressions: r.impressions, position: r.position });
  }
  const overlap = Object.entries(byQuery)
    .filter(([, pages]) => pages.length > 1)
    .map(([query, pages]) => ({
      query,
      impressions: pages.reduce((s, p) => s + p.impressions, 0),
      pages: pages.sort((a, b) => b.impressions - a.impressions).slice(0, 4),
    }))
    .sort((a, b) => b.impressions - a.impressions).slice(0, 10);

  const topSearches = Object.entries(byQuery)
    .map(([query, pages]) => ({ query, clicks: pages.reduce((s, p) => s + p.clicks, 0),
      impressions: pages.reduce((s, p) => s + p.impressions, 0), best_page: pages[0].page,
      position: Math.min(...pages.map((p) => p.position)) }))
    .sort((a, b) => b.impressions - a.impressions).slice(0, 15);
  return { keywordOverlap: overlap, topSearches };
}
