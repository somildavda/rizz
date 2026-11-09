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
  if (p === "/api/auth/me") return json({ user: user ? { name: user.name, email: user.email, role: user.role } : null });

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
