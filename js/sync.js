// Optional cloud sync via Supabase. Off by default. When configured (URL +
// anon key + a sync code you choose, all entered in Settings), contacts are
// also pushed to/pulled from a Supabase table you own, so the same folders
// show up on every device using the same sync code.
//
// This is NOT authenticated per-user security — anyone who has your
// Supabase URL, anon key, AND sync code could read/write that data. Treat
// the sync code like a shared password and keep your Supabase project
// private to yourself.

const SUPA_URL_KEY = "rizz_supabase_url";
const SUPA_ANON_KEY = "rizz_supabase_anon_key";
const SYNC_CODE_KEY = "rizz_sync_code";

function getSyncConfig() {
  const url = localStorage.getItem(SUPA_URL_KEY);
  const anonKey = localStorage.getItem(SUPA_ANON_KEY);
  const syncCode = localStorage.getItem(SYNC_CODE_KEY);
  if (!url || !anonKey || !syncCode) return null;
  return { url: url.replace(/\/$/, ""), anonKey, syncCode };
}

function isSyncConfigured() {
  return !!getSyncConfig();
}

function supaHeaders(cfg, extra = {}) {
  return {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${cfg.anonKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function pullRemoteContacts() {
  const cfg = getSyncConfig();
  if (!cfg) return null;
  const res = await fetch(
    `${cfg.url}/rest/v1/contacts?sync_code=eq.${encodeURIComponent(cfg.syncCode)}&select=*`,
    { headers: supaHeaders(cfg) }
  );
  if (!res.ok) throw new Error(`Pull failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function pushRemoteContact(contact) {
  const cfg = getSyncConfig();
  if (!cfg) return;
  const row = {
    id: contact.id,
    sync_code: cfg.syncCode,
    name: contact.name,
    context: contact.context,
    interests: contact.interests,
    vibe: contact.vibe,
    notes: contact.notes,
    updated_at: contact.updated_at,
  };
  const res = await fetch(`${cfg.url}/rest/v1/contacts?on_conflict=id`, {
    method: "POST",
    headers: supaHeaders(cfg, { Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Push failed: ${res.status} ${await res.text()}`);
}

async function deleteRemoteContact(id) {
  const cfg = getSyncConfig();
  if (!cfg) return;
  const res = await fetch(`${cfg.url}/rest/v1/contacts?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: supaHeaders(cfg),
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status} ${await res.text()}`);
}

// Merge remote + local by id, newest updated_at wins. Returns merged array.
function mergeContacts(local, remote) {
  const byId = new Map();
  for (const c of local) byId.set(c.id, c);
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l || new Date(r.updated_at || 0) > new Date(l.updated_at || 0)) {
      byId.set(r.id, r);
    }
  }
  return [...byId.values()];
}
