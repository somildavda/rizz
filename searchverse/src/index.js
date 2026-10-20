// Serves the hub page and proxies each module under the same address,
// e.g. /speed/... -> https://searchverse-psi.shred-app.workers.dev/...
const MODULES = {
  performance: "https://searchverse.somildavda.workers.dev",
  speed: "https://searchverse-psi.shred-app.workers.dev",
  youtube: "https://searchverse-youtube.searchverse-infidigit.workers.dev",
};

// Which module a request belongs to: by path prefix, or (for root-relative
// calls made by a module's own scripts, like fetch("/api/x")) by its Referer.
function resolve(url, request) {
  const first = url.pathname.split("/")[1];
  if (MODULES[first]) return { id: first, path: url.pathname.slice(first.length + 1) || "/" };
  const ref = request.headers.get("Referer");
  if (ref) {
    try {
      const r = new URL(ref);
      const id = r.pathname.split("/")[1];
      if (r.host === url.host && MODULES[id]) return { id, path: url.pathname };
    } catch (_) {}
  }
  return null;
}

class PrefixPaths {
  constructor(attr, prefix) { this.attr = attr; this.prefix = prefix; }
  element(el) {
    const v = el.getAttribute(this.attr);
    if (v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith(this.prefix + "/")) {
      el.setAttribute(this.attr, this.prefix + v);
    }
  }
}

async function proxy(request, url, mod) {
  const origin = MODULES[mod.id], prefix = "/" + mod.id;
  if (url.pathname === prefix) return Response.redirect(url.origin + prefix + "/" + url.search, 301);

  const target = new URL(mod.path + url.search, origin);
  const headers = new Headers(request.headers);
  headers.delete("Referer");
  headers.set("X-Forwarded-Host", url.host);
  const res = await fetch(target, {
    method: request.method, headers, redirect: "manual",
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
  });

  const out = new Response(res.body, res);
  const loc = out.headers.get("Location");
  if (loc) {
    const l = new URL(loc, target);
    if (l.origin === origin) out.headers.set("Location", prefix + l.pathname + l.search + l.hash);
  }
  out.headers.delete("X-Frame-Options");
  out.headers.delete("Content-Security-Policy");
  out.headers.set("X-Robots-Tag", "noindex, nofollow");

  if (!(out.headers.get("Content-Type") || "").includes("text/html")) return out;
  return new HTMLRewriter()
    .on("a[href], link[href]", new PrefixPaths("href", prefix))
    .on("script[src], img[src], iframe[src], source[src]", new PrefixPaths("src", prefix))
    .on("form[action]", new PrefixPaths("action", prefix))
    .transform(out);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const mod = resolve(url, request);
    if (mod) return proxy(request, url, mod);
    return env.ASSETS.fetch(request);
  },
};
