import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVideo, buildReports, isoDurationToSeconds, analyzeCta, similarity, keywords } from '../public/analysis.js';

const NOW = Date.parse('2026-10-01T00:00:00Z');
const vid = (id, title, desc, days, views, dur = 'PT8M10S', thumbs = { maxres: { url: 'https://i.ytimg.com/vi/x/maxresdefault.jpg' } }) => ({
  id, snippet: { title, description: desc, publishedAt: new Date(NOW - days * 864e5).toISOString(), tags: ['seo', 'youtube'], thumbnails: thumbs },
  statistics: { viewCount: String(views), likeCount: String(Math.round(views * 0.03)), commentCount: String(Math.round(views * 0.002)) },
  contentDetails: { duration: dur },
});
const own = { id: 'UCown', title: 'Our Brand', type: 'Own', subscribers: 12000 };
const comp = { id: 'UCcomp', title: 'Rival', type: 'Competitor', subscribers: 90000 };

test('duration parsing', () => {
  assert.equal(isoDurationToSeconds('PT1H2M3S'), 3723);
  assert.equal(isoDurationToSeconds('P1DT1S'), 86401);
  assert.equal(isoDurationToSeconds('PT45S'), 45);
});

test('CTA detection and above-the-fold', () => {
  const a = analyzeCta('Book a free demo: https://x.com/demo\nmore text');
  assert.ok(a.types.includes('Lead'));
  assert.equal(a.aboveFold, true);
  assert.equal(analyzeCta('just a description').score, 0);
});

test('shorts classification', () => {
  assert.equal(normalizeVideo(vid('a', 'Quick tip', '', 3, 100, 'PT45S'), own, NOW).type, 'Shorts');
  assert.equal(normalizeVideo(vid('b', 'Tip #shorts', '', 3, 100, 'PT2M30S'), own, NOW).type, 'Shorts');
  assert.equal(normalizeVideo(vid('c', 'Tip', '', 3, 100, 'PT2M30S'), own, NOW).type, 'Long Form');
});

test('similarity uses title keywords', () => {
  assert.ok(similarity(keywords('Keyword research for YouTube SEO'), keywords('YouTube SEO keyword research tutorial')) > 0.5);
  assert.equal(similarity(keywords('Shopify store setup'), keywords('Instagram reels ideas')), 0);
});

test('reports build end to end', () => {
  const videos = [
    normalizeVideo(vid('o1', 'How to do keyword research for YouTube SEO in 2026', 'Subscribe for more. In this video ' + 'x'.repeat(200) + ' #seo #youtube', 40, 5000), own, NOW),
    normalizeVideo(vid('o2', 'Hi', '', 100, 50, 'PT3M', {}), own, NOW),
    normalizeVideo(vid('c1', 'YouTube SEO keyword research tutorial', 'Learn more https://r.com', 30, 90000), comp, NOW),
    normalizeVideo(vid('c2', 'Shopify store conversion rate tips', 'shop now', 20, 40000), comp, NOW),
  ];
  const reports = buildReports([own, comp], videos, NOW);
  const ids = reports.map((r) => r.id);
  for (const id of ['dashboard', 'publishing', 'length', 'theme', 'format', 'intent', 'thumbnails', 'top', 'under', 'gap', 'seo', 'reco']) assert.ok(ids.includes(id), id);
  for (const r of reports) for (const s of r.sections) for (const row of s.rows) assert.equal(row.length, s.columns.length, `${r.id}/${s.title}`);
  const dash = reports.find((r) => r.id === 'dashboard');
  assert.equal(dash.kpis[0][1], '12.0K');
  const gap = reports.find((r) => r.id === 'gap');
  assert.equal(gap.sections[0].rows.length, 1); // c1 matches o1
  assert.ok(gap.sections[1].rows.some((r) => r[1].startsWith('Shopify')));
  const reco = reports.find((r) => r.id === 'reco').sections[0].rows;
  assert.ok(reco.some((r) => r[0].endsWith('o2') && r[1] === 'Title'));
});
