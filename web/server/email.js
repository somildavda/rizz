// Emails from SearchVerse, sent with Resend (free: 3,000 a month, 100 a day).
// Needs two settings on the Worker:
//   RESEND_API_KEY  secret: `npx wrangler secret put RESEND_API_KEY`
//   MAIL_FROM       e.g. "SearchVerse <hello@searchverse.in>" (set in wrangler.jsonc)
// Without a key, emails are skipped and everything else keeps working.

const SITE = (env) => env.SITE_URL || "https://searchverse.in";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function layout(env, title, bodyHtml, button) {
  return `<!doctype html><html><body style="margin:0;background:#F4F5FA;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0F172A">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;border:1px solid #E4E7F0">
<tr><td style="padding:28px 32px 8px;font-size:20px;font-weight:800">🔭 SearchVerse</td></tr>
<tr><td style="padding:8px 32px 0;font-size:22px;font-weight:800;line-height:1.3">${esc(title)}</td></tr>
<tr><td style="padding:12px 32px 8px;font-size:15px;line-height:1.6;color:#334155">${bodyHtml}</td></tr>
${button ? `<tr><td style="padding:12px 32px 8px"><a href="${esc(button.url)}" style="display:inline-block;background:#5B4BDB;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">${esc(button.label)}</a></td></tr>` : ""}
<tr><td style="padding:20px 32px 28px;font-size:12px;color:#64748B">You're getting this because of your account on <a href="${SITE(env)}" style="color:#5B4BDB">searchverse.in</a>.</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendEmail(env, to, subject, html) {
  if (!env.RESEND_API_KEY || !to || (Array.isArray(to) && !to.length)) return { skipped: true };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM || "SearchVerse <hello@searchverse.in>", to: Array.isArray(to) ? to : [to], subject, html }),
    });
    return { ok: r.ok };
  } catch (e) { return { ok: false, error: e.message }; }
}

const ROLE = { owner: "Owner", admin: "Team admin", manager: "Project manager", member: "Member", viewer: "Viewer" };

export const mails = {
  welcomeOwner: (env, u) => sendEmail(env, u.email, "Welcome to SearchVerse", layout(env, `Welcome, ${u.name}!`,
    `Your SearchVerse workspace is ready and you're its owner. Invite your team: they ask for access on the sign-in page and you approve them in the Access Center.`,
    { label: "Open SearchVerse", url: SITE(env) + "/dashboard" })),
  requestReceived: (env, u) => sendEmail(env, u.email, "We got your SearchVerse access request", layout(env, `Thanks, ${u.name}`,
    `Your request to join SearchVerse was sent to the team admins. We'll email you as soon as it's approved.`)),
  newRequest: (env, admins, u) => sendEmail(env, admins, `New access request: ${u.name}`, layout(env, "Someone wants to join SearchVerse",
    `<b>${esc(u.name)}</b> (${esc(u.email)}) asked for access.${u.note ? `<br><br>“${esc(u.note)}”` : ""}`,
    { label: "Review in Access Center", url: SITE(env) + "/access" })),
  approved: (env, u, role) => sendEmail(env, u.email, "You're in: SearchVerse access approved", layout(env, `You're in, ${u.name}!`,
    `Your SearchVerse access was approved. Your role: <b>${esc(ROLE[role] || role)}</b>.`,
    { label: "Sign in", url: SITE(env) + "/login" })),
  rejected: (env, u) => sendEmail(env, u.email, "About your SearchVerse access", layout(env, `Hi ${u.name}`,
    `Your access to SearchVerse isn't active. If you think this is a mistake, reply to your team admin.`)),
  roleChanged: (env, u, role) => sendEmail(env, u.email, "Your SearchVerse role changed", layout(env, `Hi ${u.name}`,
    `Your role in SearchVerse is now <b>${esc(ROLE[role] || role)}</b>.`,
    { label: "Open SearchVerse", url: SITE(env) + "/dashboard" })),
};
