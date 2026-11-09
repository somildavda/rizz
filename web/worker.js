// searchverse.in — the Cloudflare Worker entry.
// Sign-in gate and APIs are handled here; every page is rendered by Next.js
// (built by OpenNext into .open-next/worker.js).
import nextHandler from "./.open-next/worker.js";
import { gate, json } from "./server/auth.js";
import { handleDb } from "./server/db.js";
import { handleContentGap } from "./server/content-gap.js";
import { psi } from "./server/psi.js";

export { ProjectStore } from "./server/db.js";
export { AppStore } from "./server/app-store.js";

const SECURITY = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Frame-Options": "DENY",
};
function secure(res) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // One address: www and the workers.dev name redirect to the main domain.
    if (env.CANONICAL_HOST && url.hostname !== env.CANONICAL_HOST && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      url.hostname = env.CANONICAL_HOST; url.port = ""; url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    const g = await gate(request, env, url, ctx);
    if (g instanceof Response) return secure(g);
    const p = url.pathname;
    if (p === "/api/suite/psi") return secure(await psi(url, env));
    if (p.startsWith("/api/cg/db/")) return secure(await handleDb(request, env, g.user));
    if (p.startsWith("/api/cg/")) return secure(await handleContentGap(request, url));
    if (p.startsWith("/api/") && !p.startsWith("/api/auth/")) return secure(json({ error: "Not found" }, 404));
    if (p === "/topic-planner") return Response.redirect(url.origin + "/topic-planner/", 301);
    if (p === "/topic-planner/") return secure(await env.ASSETS.fetch(new Request(new URL("/topic-planner/index.html", url), request)));
    // Static files (Next.js chunks, Topic Planner, icons). Every request runs through the
    // sign-in check above first (run_worker_first), so private files stay private.
    if ((request.method === "GET" || request.method === "HEAD") && (p.startsWith("/_next/static/") || /\.[a-z0-9]+$/i.test(p))) {
      const a = await env.ASSETS.fetch(request);
      if (a.status !== 404) return secure(a);
    }
    return secure(await nextHandler.fetch(request, env, ctx));
  },
};
