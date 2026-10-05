# SEO Insights: guide for Claude Code

A Cloudflare Worker that turns page-level SEO data (GSC, Google Sheets, CSV) into client-ready insights.

- `src/analyze.js` holds the rule-based findings (quick wins, low CTR, gains/drops, sections). Add new rules here.
- `src/prompt.js` holds the client voice. Keep the "no robotic phrasing" rules.
- `src/gsc.js` handles Google auth through a service account (`GSC_SERVICE_ACCOUNT` secret).

To analyse a CSV by hand in a session, read it, run the same checks as `analyze.js`, and then write
the summary using the sections and style rules in `src/prompt.js`.
Test locally with: `node test.mjs`.
