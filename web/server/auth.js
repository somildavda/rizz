// Sign-in, sessions and the Access Center API for searchverse.in.
//
// Public:   /, /login, /privacy, /terms, static files, /api/auth/*
// Signed in (approved): /dashboard, /topic-planner/, /api/*
// Team admins and the owner: /access, /api/access/*
//
// The first account created becomes the owner. Everyone else requests access and
// is approved in the Access Center. Emails go out on each step (see email.js).

import { mails } from "./email.js";

const COOKIE = "sv_session";
export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

function cookie(request, name) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : "";
}
const store = (env) => env.APP.get(env.APP.idFromName("main"));
const call = (env, path, body) => store(env).fetch("https://app" + path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const users = (env) => store(env).fetch("https://app/admin/users").then((r) => r.json()).catch(() => []);

export async function currentUser(request, env) {
  const token = cookie(request, COOKIE);
  if (!token) return null;
  const r = await call(env, "/session", { token }).then((x) => x.json()).catch(() => ({}));
  return r.user && r.user.status === "approved" ? r.user : null;
}

export const RANK = { viewer: 1, member: 2, manager: 3, admin: 4, owner: 5 };
const atLeast = (user, role) => !!user && (RANK[user.role] || 0) >= RANK[role];
const setSession = (token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const PUBLIC = [/^\/$/, /^\/login\/?$/, /^\/privacy\/?$/, /^\/terms\/?$/, /^\/_next\//, /^\/sv\//, /^\/favicon/, /^\/og\./, /^\/robots\.txt$/, /^\/sitemap\.xml$/, /^\/icon/];

// Returns a Response (auth route, redirect or refusal) or { user } to carry on.
export async function gate(request, env, url, ctx) {
  const p = url.pathname, ip = request.headers.get("CF-Connecting-IP") || "";
  const later = (promise) => (ctx && ctx.waitUntil ? ctx.waitUntil(promise) : promise);

  if (p === "/api/auth/signup" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const r = await call(env, "/signup", { ...b, ip, meta: { path: "/login" } }); const d = await r.json();
    const who = { name: String(b.name || "").trim(), email: String(b.email || "").trim().toLowerCase(), note: String(b.note || "") };
    if (d.token) later(mails.welcomeOwner(env, who));
    if (d.pending) later((async () => {
      await mails.requestReceived(env, who);
      const admins = (await users(env)).filter((u) => u.status === "approved" && ["owner", "admin"].includes(u.role)).map((u) => u.email);
      await mails.newRequest(env, admins, who);
    })());
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
  // Signed-in people skip the sign-in page.
  if (p === "/login" && user) return new Response(null, { status: 302, headers: { Location: "/dashboard" } });
  if (PUBLIC.some((re) => re.test(p))) return { user };

  if (!user) {
    const wantsHtml = (request.headers.get("Accept") || "").includes("text/html");
    if (p.startsWith("/api/") || !wantsHtml) return json({ error: "Please sign in." }, 401);
    return new Response(null, { status: 302, headers: { Location: "/login?next=" + encodeURIComponent(p + url.search) } });
  }

  if (p === "/access" || p.startsWith("/api/access/")) {
    if (!atLeast(user, "admin")) return p === "/access" ? new Response(null, { status: 302, headers: { Location: "/dashboard" } }) : json({ error: "Team admins only" }, 403);
    if (p === "/access") return { user };
    const sub = { "/api/access/users": "/admin/users", "/api/access/user": "/admin/user", "/api/access/remove": "/admin/remove" }[p];
    if (!sub) return json({ error: "Not found" }, 404);
    if (request.method !== "POST") { const r = await store(env).fetch("https://app" + sub); return new Response(r.body, r); }
    const b = await request.json().catch(() => ({}));
    const before = sub === "/admin/user" ? (await users(env)).find((u) => u.id === Number(b.id)) : null;
    const r = await call(env, sub, { ...b, by: { id: user.id, role: user.role } });
    if (r.ok && before) {
      const role = b.role || before.role;
      if (b.status === "approved" && before.status !== "approved") later(mails.approved(env, before, role));
      else if (b.status === "rejected" && before.status !== "rejected") later(mails.rejected(env, before));
      else if (b.role && b.role !== before.role && before.status === "approved") later(mails.roleChanged(env, before, b.role));
    }
    return new Response(r.body, r);
  }
  return { user };
}
