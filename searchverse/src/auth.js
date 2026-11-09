// Login gate, analytics tracker and admin dashboard for the whole SearchVerse Worker.
//
//   /login                 sign in / request access page
//   /api/auth/*            signup, login, logout, me
//   /api/track             page views, time on page and tool clicks (from /sv/track.js)
//   /admin                 the admin's dashboard (admin only)
//   /api/admin/*           data for the dashboard, approve/reject people (admin only)
//
// Every other page, tool and API needs a signed-in, approved user.

import { LOGIN_HTML, ADMIN_HTML, TRACK_JS } from "./auth-pages.js";

const COOKIE = "sv_session";
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
const page = (html) => new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Frame-Options": "DENY" } });

function cookie(request, name) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : "";
}
const store = (env) => env.APP.get(env.APP.idFromName("main"));
const call = (env, path, body) => store(env).fetch("https://app" + path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function device(ua) {
  ua = ua || "";
  if (/bot|crawl|spider|preview/i.test(ua)) return "bot";
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone/i.test(ua)) return "phone";
  return "desktop";
}
function meta(request, extra) {
  return { country: (request.cf && request.cf.country) || "", device: device(request.headers.get("User-Agent")), visitor: cookie(request, "sv_vid"), ...extra };
}

export async function currentUser(request, env) {
  const token = cookie(request, COOKIE);
  if (!token) return null;
  const r = await call(env, "/session", { token }).then((x) => x.json()).catch(() => ({}));
  return r.user && r.user.status === "approved" ? r.user : null;
}

// Role ladder: owner > admin (team admin) > manager (project manager) > member > viewer.
export const RANK = { viewer: 1, member: 2, manager: 3, admin: 4, owner: 5 };
export const atLeast = (user, role) => !!user && (RANK[user.role] || 0) >= RANK[role];

// Tools and which paths belong to them. Owner and team admins can open every tool.
export const TOOLS = ["performance", "workspace", "speed", "content-gap", "youtube"];
export function toolsFor(user) {
  if (!user) return [];
  if (atLeast(user, "admin")) return TOOLS.slice();
  try { const t = JSON.parse(user.tools || "null"); return Array.isArray(t) ? t : TOOLS.slice(); } catch (_) { return TOOLS.slice(); }
}
function toolOf(url, request) {
  const first = url.pathname.split("/")[1];
  if (first === "api" && url.pathname.startsWith("/api/cg/")) return "content-gap";
  if (["performance", "speed", "youtube", "content-gap"].includes(first)) return first;
  const ref = request.headers.get("Referer");       // scripts inside a proxied tool call root paths
  if (ref) { try { const r = new URL(ref); const id = r.pathname.split("/")[1]; if (r.host === url.host && ["performance", "speed", "youtube"].includes(id) && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/sv/")) return id; } catch (_) {} }
  return null;
}
const NO_TOOL_HTML = (name) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No access</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#06070D;color:#EDEFFA;font-family:Inter,system-ui,sans-serif;text-align:center;padding:24px">
<div><div style="font-size:48px">🔒</div><h1 style="font-size:26px;margin:12px 0 8px">You don't have access to ${name} yet</h1>
<p style="color:#9097B5;max-width:420px;margin:0 auto 20px">Ask your team admin to turn it on for you from the dashboard.</p>
<a href="/" target="_top" style="display:inline-block;padding:12px 20px;border-radius:12px;background:linear-gradient(90deg,#7C5CFF,#22D3EE);color:#fff;font-weight:700;text-decoration:none">Back to SearchVerse</a></div></body>`;
const TOOL_NAMES = { performance: "Performance Explorer", workspace: "Search Workspace", speed: "PageSpeed Lab", "content-gap": "Topic Planner", youtube: "Video Visibility" };

const setSession = (token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// Handles auth/admin/tracking routes. Returns a Response, or null when the request
// should continue to the page (with `user` filled in) — or a redirect to /login.
export async function gate(request, env, url) {
  const p = url.pathname, ip = request.headers.get("CF-Connecting-IP") || "";
  if (!env.APP) return null; // not configured: leave the site open

  if (p === "/login") return page(LOGIN_HTML);
  // Shared theme files are needed before sign-in (by the sign-in page itself).
  if (p.startsWith("/sv/") && p !== "/sv/track.js") return null;
  if (p === "/sv/track.js") return new Response(TRACK_JS, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } });

  // The public launch page and its video: open to everyone, views and shares counted anonymously.
  if (p === "/launch" || p === "/launch/" || p === "/launch/index.html") {
    const ref = request.headers.get("Referer") || "";
    await call(env, "/track", meta(request, { type: "view", path: "/launch", title: "Launch page", referrer: ref && !ref.includes(url.host) ? new URL(ref).hostname : "" })).catch(() => {});
    return null;
  }
  if (p.startsWith("/launch/")) return null;
  // The homepage is public too (tools behind it still need an approved sign-in).
  if (p === "/" || p === "/index.html") {
    const ref = request.headers.get("Referer") || "";
    if (!(await currentUser(request, env))) await call(env, "/track", meta(request, { type: "view", path: "/", title: "Homepage (visitor)", referrer: ref && !ref.includes(url.host) ? new URL(ref).hostname : "" })).catch(() => {});
    return null;
  }
  if (p === "/api/launch-share" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    await call(env, "/track", meta(request, { type: "click", path: "/launch", tool: "launch-share:" + String(b.via || "").slice(0, 20) }));
    return json({ ok: true });
  }

  if (p === "/api/auth/signup" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const r = await call(env, "/signup", { ...b, ip, meta: meta(request, { path: "/login" }) }); const d = await r.json();
    return json(d.token ? { ok: true, admin: !!d.admin } : d, r.status, d.token ? { "Set-Cookie": setSession(d.token, d.maxAge) } : {});
  }
  if (p === "/api/auth/login" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const r = await call(env, "/login", { ...b, ip, meta: meta(request, { path: "/login" }) }); const d = await r.json();
    return json(d.token ? { ok: true } : d, r.status, d.token ? { "Set-Cookie": setSession(d.token, d.maxAge) } : {});
  }
  if (p === "/logout" || p === "/api/auth/logout") {
    await call(env, "/logout", { token: cookie(request, COOKIE) });
    return new Response(null, { status: 302, headers: { Location: "/login", "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } });
  }

  const user = await currentUser(request, env);
  if (p === "/api/auth/me") return json({ user: user ? { name: user.name, email: user.email, role: user.role, tools: toolsFor(user) } : null });

  if (!user) {
    const wantsHtml = (request.headers.get("Accept") || "").includes("text/html");
    if (p.startsWith("/api/") || !wantsHtml) return json({ error: "Please sign in." }, 401);
    return new Response(null, { status: 302, headers: { Location: "/login?next=" + encodeURIComponent(p + url.search) } });
  }

  if (p === "/api/track" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    await call(env, "/track", { ...meta(request), ...b, user_id: user.id, country: (request.cf && request.cf.country) || "" });
    return json({ ok: true });
  }

  // Per-tool access
  const tool = toolOf(url, request);
  if (tool && !toolsFor(user).includes(tool)) {
    if (p.startsWith("/api/") || !(request.headers.get("Accept") || "").includes("text/html")) return json({ error: "You don't have access to " + TOOL_NAMES[tool] + " yet." }, 403);
    return new Response(NO_TOOL_HTML(TOOL_NAMES[tool]), { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }

  if (p === "/admin" || p.startsWith("/api/admin/")) {
    if (!atLeast(user, "admin")) return p === "/admin" ? new Response(null, { status: 302, headers: { Location: "/" } }) : json({ error: "Team admins only" }, 403);
    if (p === "/admin") return page(ADMIN_HTML);
    const sub = p.replace("/api/admin", "/admin");
    const r = request.method === "POST" ? await call(env, sub, { ...(await request.json().catch(() => ({}))), by: { id: user.id, role: user.role } }) : await store(env).fetch("https://app" + sub + url.search);
    return new Response(r.body, r);
  }

  return { user }; // signed in: carry on to the page
}

// Adds the tracker to every HTML page a signed-in user sees (hub, Topic Planner and
// the proxied tools), plus a visitor id cookie.
export function withTracking(response) {
  const type = response.headers.get("Content-Type") || "";
  if (!type.includes("text/html")) return response;
  return new HTMLRewriter().on("head", { element(el) { el.append('<script src="/sv/track.js" defer></script>', { html: true }); } }).transform(response);
}
