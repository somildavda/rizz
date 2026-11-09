// Google PageSpeed Insights (free). Set the PSI_KEY secret for a higher quota.
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
export async function psi(url, env) {
  const target = url.searchParams.get("url"), strategy = url.searchParams.get("strategy") === "desktop" ? "desktop" : "mobile";
  try { const u = new URL(target); if (!/^https?:$/.test(u.protocol)) throw 0; } catch (_) { return json({ error: "Enter a full URL, like https://example.com/" }, 400); }
  const q = new URLSearchParams({ url: target, strategy });
  ["performance", "accessibility", "best-practices", "seo"].forEach((c) => q.append("category", c));
  if (env.PSI_KEY) q.set("key", env.PSI_KEY);
  const r = await fetch("https://www.googleapis.com/pagespeedonline/v5/runPagespeed?" + q, { signal: AbortSignal.timeout(90000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: (d.error && d.error.message) || "PageSpeed HTTP " + r.status }, 502);
  const lh = d.lighthouseResult || {}, cats = lh.categories || {}, au = lh.audits || {}, fe = (d.loadingExperience || {}).metrics || {};
  const score = (k) => cats[k] && cats[k].score != null ? Math.round(cats[k].score * 100) : null;
  const field = (k) => fe[k] ? { p75: fe[k].percentile, category: fe[k].category } : null;
  const lab = (k) => au[k] ? { value: au[k].displayValue || "", score: au[k].score } : null;
  return json({
    url: target, strategy, fetched: Date.now(),
    scores: { performance: score("performance"), accessibility: score("accessibility"), bestPractices: score("best-practices"), seo: score("seo") },
    field: { lcp: field("LARGEST_CONTENTFUL_PAINT_MS"), inp: field("INTERACTION_TO_NEXT_PAINT"), cls: field("CUMULATIVE_LAYOUT_SHIFT_SCORE"), fcp: field("FIRST_CONTENTFUL_PAINT_MS"), ttfb: field("EXPERIMENTAL_TIME_TO_FIRST_BYTE") },
    lab: { fcp: lab("first-contentful-paint"), lcp: lab("largest-contentful-paint"), tbt: lab("total-blocking-time"), cls: lab("cumulative-layout-shift"), si: lab("speed-index") },
    opportunities: Object.values(au).filter((a) => a.details && a.details.type === "opportunity" && a.score != null && a.score < 0.9)
      .map((a) => ({ title: a.title, savings: a.details.overallSavingsMs || 0, value: a.displayValue || "" }))
      .sort((x, y) => y.savings - x.savings).slice(0, 8),
  });
}
