// Sign-in and the Access Center for the Topic Planner Worker.
//
//   /login            sign in / request access
//   /api/auth/*       signup, login, logout, me
//   /access           Access Center: approve people, set roles, remove (team admins and the owner)
//   /api/access/*     data for the Access Center
//
// Every other page and API needs a signed-in, approved user. The first account
// created becomes the owner.

import { LOGIN_HTML, ACCESS_HTML } from "./pages.js";

const COOKIE = "tp_session";
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
const page = (html) => new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Frame-Options": "DENY" } });

function cookie(request, name) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : "";
}
const store = (env) => env.APP.get(env.APP.idFromName("main"));
const call = (env, path, body) => store(env).fetch("https://app" + path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

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

// Returns a Response for auth routes (or a redirect to /login), else { user }.
export async function gate(request, env, url) {
  const p = url.pathname, ip = request.headers.get("CF-Connecting-IP") || "";
  if (p === "/login") return page(LOGIN_HTML);
  if (p.startsWith("/sv/")) return null; // theme files, needed by the sign-in page

  if (p === "/api/auth/signup" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const r = await call(env, "/signup", { ...b, ip, meta: { path: "/login" } }); const d = await r.json();
    return json(d.token ? { ok: true, admin: !!d.admin } : d, r.status, d.token ? { "Set-Cookie": setSession(d.token, d.maxAge) } : {});
  }
  if (p === "/api/auth/login" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const r = await call(env, "/login", { ...b, ip, meta: { path: "/login" } }); const d = await r.json();
    return json(d.token ? { ok: true } : d, r.status, d.token ? { "Set-Cookie": setSession(d.token, d.maxAge) } : {});
  }
  if (p === "/logout" || p === "/api/auth/logout") {
    await call(env, "/logout", { token: cookie(request, COOKIE) });
    return new Response(null, { status: 302, headers: { Location: "/login", "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } });
  }

  const user = await currentUser(request, env);
  if (p === "/api/auth/me") return json({ user: user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null });

  if (!user) {
    const wantsHtml = (request.headers.get("Accept") || "").includes("text/html");
    if (p.startsWith("/api/") || !wantsHtml) return json({ error: "Please sign in." }, 401);
    return new Response(null, { status: 302, headers: { Location: "/login?next=" + encodeURIComponent(p + url.search) } });
  }

  if (p === "/access" || p.startsWith("/api/access/")) {
    if (!atLeast(user, "admin")) return p === "/access" ? new Response(null, { status: 302, headers: { Location: "/" } }) : json({ error: "Team admins only" }, 403);
    if (p === "/access") return page(ACCESS_HTML);
    const sub = { "/api/access/users": "/admin/users", "/api/access/user": "/admin/user", "/api/access/remove": "/admin/remove" }[p];
    if (!sub) return json({ error: "Not found" }, 404);
    const r = request.method === "POST"
      ? await call(env, sub, { ...(await request.json().catch(() => ({}))), by: { id: user.id, role: user.role } })
      : await store(env).fetch("https://app" + sub);
    return new Response(r.body, r);
  }
  return { user };
}
