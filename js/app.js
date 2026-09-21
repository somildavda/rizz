// All contact data lives only in this browser's localStorage.
// Nothing is scraped, collected automatically, or sent anywhere
// except the optional direct call to Anthropic's API when the user
// clicks "Sharpen with AI" (using a key they provide themselves).

const STORAGE_KEY = "rizz_contacts_v1";
const API_KEY_STORAGE = "rizz_api_key_v1";

let state = {
  contacts: loadContacts(),
  activeContactId: null,
};

function loadContacts() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveContacts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.contacts));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- Navigation ----------

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

document.getElementById("btn-open-settings").onclick = () => {
  const key = localStorage.getItem(API_KEY_STORAGE) || "";
  document.getElementById("field-api-key").value = key;
  document.getElementById("key-status").textContent = key ? "A key is saved in this browser." : "";

  document.getElementById("field-supabase-url").value = localStorage.getItem(SUPA_URL_KEY) || "";
  document.getElementById("field-supabase-key").value = localStorage.getItem(SUPA_ANON_KEY) || "";
  document.getElementById("field-sync-code").value = localStorage.getItem(SYNC_CODE_KEY) || "";
  document.getElementById("sync-status").textContent = isSyncConfigured() ? "Sync is on." : "Sync is off — fill in all three fields to enable.";

  showScreen("screen-settings");
};
document.getElementById("btn-settings-back").onclick = () => showScreen("screen-contacts");

document.getElementById("btn-save-key").onclick = () => {
  const val = document.getElementById("field-api-key").value.trim();
  if (val) {
    localStorage.setItem(API_KEY_STORAGE, val);
    document.getElementById("key-status").textContent = "Saved.";
  } else {
    localStorage.removeItem(API_KEY_STORAGE);
    document.getElementById("key-status").textContent = "Cleared.";
  }
};

document.getElementById("btn-save-sync").onclick = async () => {
  const url = document.getElementById("field-supabase-url").value.trim();
  const key = document.getElementById("field-supabase-key").value.trim();
  const code = document.getElementById("field-sync-code").value.trim();
  const statusEl = document.getElementById("sync-status");

  if (url) localStorage.setItem(SUPA_URL_KEY, url); else localStorage.removeItem(SUPA_URL_KEY);
  if (key) localStorage.setItem(SUPA_ANON_KEY, key); else localStorage.removeItem(SUPA_ANON_KEY);
  if (code) localStorage.setItem(SYNC_CODE_KEY, code); else localStorage.removeItem(SYNC_CODE_KEY);

  if (!isSyncConfigured()) {
    statusEl.textContent = "Sync is off — fill in all three fields to enable.";
    return;
  }

  statusEl.textContent = "Saved. Syncing...";
  try {
    await syncNow();
    statusEl.textContent = "Sync is on and up to date.";
  } catch (e) {
    statusEl.textContent = "Saved, but sync failed: " + e.message;
  }
};

document.getElementById("btn-sync-now").onclick = async () => {
  const statusEl = document.getElementById("sync-status");
  if (!isSyncConfigured()) {
    statusEl.textContent = "Fill in and save sync settings first.";
    return;
  }
  statusEl.textContent = "Syncing...";
  try {
    await syncNow();
    statusEl.textContent = "Sync is on and up to date.";
  } catch (e) {
    statusEl.textContent = "Sync failed: " + e.message;
  }
};

async function syncNow() {
  const remote = await pullRemoteContacts();
  state.contacts = mergeContacts(state.contacts, remote);
  saveContacts();
  renderContactList();
  // Push any local contacts the remote didn't have yet (e.g. made offline).
  const remoteIds = new Set(remote.map(r => r.id));
  const toPush = state.contacts.filter(c => !remoteIds.has(c.id));
  for (const c of toPush) {
    await pushRemoteContact(c);
  }
}

document.getElementById("btn-back").onclick = () => {
  renderContactList();
  showScreen("screen-contacts");
};

document.getElementById("btn-add-contact").onclick = openNewContact;
document.getElementById("btn-add-contact-2").onclick = openNewContact;

function openNewContact() {
  state.activeContactId = null;
  fillContactForm({ name: "", context: "", interests: "", vibe: "playful", notes: "" });
  document.getElementById("contact-name-header").textContent = "New person";
  document.getElementById("suggestions").innerHTML = "";
  document.getElementById("field-their-message").value = "";
  switchTab("notes");
  showScreen("screen-contact");
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});
function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("tab-" + tab).classList.add("active");
}

// ---------- Contact list ----------

function renderContactList() {
  const list = document.getElementById("contact-list");
  const empty = document.getElementById("empty-state");
  list.innerHTML = "";
  if (state.contacts.length === 0) {
    empty.classList.add("show");
    return;
  }
  empty.classList.remove("show");
  state.contacts.forEach(c => {
    const card = document.createElement("div");
    card.className = "contact-card";
    card.innerHTML = `<h3>${escapeHtml(c.name || "Unnamed")}</h3><p>${escapeHtml(c.context || "No notes yet")}</p>`;
    card.onclick = () => openContact(c.id);
    list.appendChild(card);
  });
}

function openContact(id) {
  const c = state.contacts.find(x => x.id === id);
  if (!c) return;
  state.activeContactId = id;
  fillContactForm(c);
  document.getElementById("contact-name-header").textContent = c.name || "Person";
  document.getElementById("suggestions").innerHTML = "";
  document.getElementById("field-their-message").value = "";
  switchTab("notes");
  showScreen("screen-contact");
}

function fillContactForm(c) {
  document.getElementById("field-name").value = c.name || "";
  document.getElementById("field-context").value = c.context || "";
  document.getElementById("field-interests").value = c.interests || "";
  document.getElementById("field-vibe").value = c.vibe || "playful";
  document.getElementById("field-notes").value = c.notes || "";
}

document.getElementById("btn-save-contact").onclick = () => {
  const data = {
    name: document.getElementById("field-name").value.trim(),
    context: document.getElementById("field-context").value.trim(),
    interests: document.getElementById("field-interests").value.trim(),
    vibe: document.getElementById("field-vibe").value,
    notes: document.getElementById("field-notes").value.trim(),
  };
  if (!data.name) {
    alert("Give them a name so you can find the folder later.");
    return;
  }
  data.updated_at = new Date().toISOString();
  let savedContact;
  if (state.activeContactId) {
    const c = state.contacts.find(x => x.id === state.activeContactId);
    Object.assign(c, data);
    savedContact = c;
  } else {
    const c = { id: uid(), ...data };
    state.contacts.push(c);
    state.activeContactId = c.id;
    savedContact = c;
  }
  saveContacts();
  document.getElementById("contact-name-header").textContent = data.name;
  renderContactList();
  showScreen("screen-contacts");

  if (isSyncConfigured()) {
    pushRemoteContact(savedContact).catch(e => console.warn("Sync push failed:", e.message));
  }
};

document.getElementById("btn-delete-contact").onclick = () => {
  if (!state.activeContactId) { showScreen("screen-contacts"); return; }
  if (!confirm("Delete this folder? This removes it from your browser" + (isSyncConfigured() ? " and your synced cloud storage." : "."))) return;
  const deletedId = state.activeContactId;
  state.contacts = state.contacts.filter(c => c.id !== deletedId);
  saveContacts();
  renderContactList();
  showScreen("screen-contacts");

  if (isSyncConfigured()) {
    deleteRemoteContact(deletedId).catch(e => console.warn("Sync delete failed:", e.message));
  }
};

// ---------- Suggestions (local library) ----------

document.getElementById("btn-suggest").onclick = () => {
  const c = getActiveContact();
  if (!c) return;
  const pool = RIZZ_LIBRARY[c.vibe] || RIZZ_LIBRARY.playful;
  const picks = shuffle(pool).slice(0, 4);
  renderSuggestions(picks.map(text => ({ vibe: c.vibe, text: fillPlaceholders(text, c) })));
};

function getActiveContact() {
  const c = state.contacts.find(x => x.id === state.activeContactId);
  if (!c) { alert("Save this person's notes first."); switchTab("notes"); }
  return c;
}

function fillPlaceholders(text, c) {
  const interest = (c.interests || "").split(",")[0]?.trim() || "that thing you mentioned";
  return text.replace(/\[interest\]/g, interest)
             .replace(/\[topic\]/g, interest)
             .replace(/\[thing\]/g, interest)
             .replace(/\[detail from bio\/profile\]/g, interest)
             .replace(/\[detail\]/g, interest)
             .replace(/\[shared interest\]/g, interest)
             .replace(/\[thing they mentioned\]/g, interest);
}

function renderSuggestions(items) {
  const box = document.getElementById("suggestions");
  box.innerHTML = "";
  items.forEach(item => {
    const card = document.createElement("div");
    card.className = "suggestion-card";
    card.innerHTML = `<span class="vibe-tag">${VIBE_LABELS[item.vibe] || item.vibe}</span><div>${escapeHtml(item.text)}</div><button class="copy-btn">Copy</button>`;
    card.querySelector(".copy-btn").onclick = () => {
      navigator.clipboard?.writeText(item.text);
      card.querySelector(".copy-btn").textContent = "Copied!";
      setTimeout(() => card.querySelector(".copy-btn").textContent = "Copy", 1200);
    };
    box.appendChild(card);
  });
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// ---------- AI-sharpened suggestions (optional, direct to Anthropic) ----------

document.getElementById("btn-ai-suggest").onclick = async () => {
  const c = getActiveContact();
  if (!c) return;
  const key = localStorage.getItem(API_KEY_STORAGE);
  if (!key) {
    alert("Add your Anthropic API key in Settings (gear icon) first.");
    return;
  }
  const theirMessage = document.getElementById("field-their-message").value.trim();
  if (!theirMessage) {
    alert("Paste the message they sent you first.");
    return;
  }

  const box = document.getElementById("suggestions");
  box.innerHTML = `<p class="hint">Thinking...</p>`;

  const prompt = `You are helping ME (the user) write a reply to a message from someone I'm texting.
Here is what I've noted about them myself:
- Name: ${c.name}
- How I know them: ${c.context || "not specified"}
- Interests / things they've mentioned: ${c.interests || "not specified"}
- Preferred vibe: ${c.vibe}
- My notes: ${c.notes || "none"}

Their message to me: "${theirMessage}"

Give me 3 short reply options I could send back, matching the ${c.vibe} vibe. Keep each under 2 sentences. Return them as a numbered list, no extra commentary.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API error ${res.status}: ${err}`);
    }
    const json = await res.json();
    const textOut = json.content?.[0]?.text || "No response.";
    const lines = textOut.split("\n").map(l => l.replace(/^\d+[\.\)]\s*/, "").trim()).filter(Boolean);
    renderSuggestions(lines.map(text => ({ vibe: c.vibe, text })));
  } catch (e) {
    box.innerHTML = `<p class="hint">Couldn't get AI suggestions: ${escapeHtml(e.message)}</p>`;
  }
};

// ---------- Utils ----------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

renderContactList();
if (isSyncConfigured()) {
  syncNow().catch(e => console.warn("Startup sync failed:", e.message));
}
