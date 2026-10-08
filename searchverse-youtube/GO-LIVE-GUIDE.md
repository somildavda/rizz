# Searchverse Channel Audit: take it live, step by step 🍼

This guide works the same way as the GSC/GA tool's guide: Cloudflare + Sign in with Google + Team + invite emails.
It takes about 30 minutes once and costs ₹0. Do the steps in order and tick them off.
You need: a laptop, your **Infidigit Google account** (this will be the admin), and the **new Cloudflare account**.

---

## PART A: Install the tools on your laptop (5 min)

1. **Node.js**: if you already installed it for the GSC tool, skip this. Otherwise go to https://nodejs.org → **LTS** → install.
   Check: open Terminal and type `node -v`. You should see `v22.x.x` or similar.

2. **Download the code**
   - Go to https://github.com/somildavda/rizz, switch to the branch **`claude/vibrant-curie-taum1m`**.
   - Click the green **Code** button → **Download ZIP** → unzip it.
   - In Terminal, type `cd ` (with a space), drag the **`searchverse-youtube`** folder into the window, then press Enter.

3. **Install**
   ```
   npm install
   ```

---

## PART B: Cloudflare: put the app online (10 min)

4. **New Cloudflare account**: sign up at https://dash.cloudflare.com/sign-up with the new email and verify it.

5. **Log the terminal into the NEW account**
   ```
   npx wrangler logout
   npx wrangler login
   ```
   The browser opens. **Make sure you're signed in to the new Cloudflare account** (sign out of the old one first if needed), then click **Allow**.
   Check that it's the right account:
   ```
   npx wrangler whoami
   ```

6. **Create the database**
   ```
   npx wrangler d1 create searchverse-youtube
   ```
   Copy the printed `database_id = "…"`. Open `wrangler.toml` and replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with it. Save.

7. **Make yourself the admin.** In the same `wrangler.toml`, set:
   ```
   ADMIN_EMAILS = "you@infidigit.com"
   ```
   Save.

8. **Create the tables**
   ```
   npm run db:init
   ```
   Type `y` if it asks.

9. **Publish the first version**
   ```
   npm run deploy
   ```
   It prints your link, e.g. **`https://searchverse-audit.YOURNAME.workers.dev`**. 📝 We'll call it **YOUR-LINK**.

---

## PART C: Google Cloud: "Sign in with Google" + YouTube (10 min)

You can **reuse the same Google Cloud project as the GSC tool** (easiest). Open https://console.cloud.google.com and select the `searchverse` project.

10. **Turn on 3 more APIs** (search each one in the top search bar → **Enable**):
    - **YouTube Data API v3**
    - **YouTube Analytics API**
    - **Gmail API** (already on if you set up invite emails for the GSC tool)

11. **Scopes**: go to **Google Auth Platform → Data Access → Add or remove scopes** and tick or add:
    - `.../auth/youtube.readonly`
    - `.../auth/yt-analytics.readonly`
    - `https://www.googleapis.com/auth/gmail.send` (if it's not there already)

    Click **Update** → **Save**.

12. **Test users**: go to **Audience → Test users** and add every email that will sign in or connect a channel. Leave the app in **Testing**.

13. **Redirect link**: go to **Clients / Credentials**, open the existing OAuth client (the GSC one is fine) → **Authorized redirect URIs → + Add URI**:
    ```
    https://YOUR-LINK/auth/callback
    ```
    No slash at the end. Click **Save**. Keep the **Client ID** and **Client secret** handy. They're the same as for the GSC tool.

14. **YouTube API key** (used to read public competitor data): go to **Credentials → + Create credentials → API key**. Then click **Edit**, set **API restrictions** to **YouTube Data API v3**, and click **Save**. Copy the key.

---

## PART D: Give the keys to the app (5 min)

15. Run these one by one. Each one asks you to paste a value:
    ```
    npx wrangler secret put GOOGLE_CLIENT_ID
    npx wrangler secret put GOOGLE_CLIENT_SECRET
    npx wrangler secret put APP_SECRET
    npx wrangler secret put YT_API_KEY
    ```
    - `APP_SECRET`: type any long random password. It locks the saved Google tokens. **Never change it later.**
    - Optional: `npx wrangler secret put GEMINI_API_KEY` (free key from https://aistudio.google.com/apikey). The AI already works without it, using the open-source models.

16. **Publish again**
    ```
    npm run deploy
    ```

🎉 **The tool is live at YOUR-LINK.**

---

## PART E: First use (5 min)

17. Open YOUR-LINK → **Sign in with Google** → pick your Infidigit account.
    If Google says *"Google hasn't verified this app"*, click **Continue**. That's normal in Testing mode.
18. **Connect YouTube** (top right) → choose the Google account that **owns the YouTube channel** (it can be different from your login) → **tick both boxes** → Continue.
    Your channel is now pre-selected, and the audit gets the **Owner Analytics** tab.
19. Add competitors (**+ Add competitor**) and click **Run audit**.
    No access to a channel? Just paste any channel's URL. Everything works except Owner Analytics.

---

## PART F: Add your team + invite emails

20. **Team** (top bar) → type their email → **Member** or **Admin** → keep **Send invite email** ticked → **Add user**.
21. Also add their email to **Google Cloud → Audience → Test users** (step 12), or Google blocks their sign-in.
22. **How the invite email is sent:**
    - **Recommended: from your own mailbox.** Click **Team → Connect my mailbox** → pick your account → allow "Send email on your behalf". Invites now go out from your address and show in your Sent folder.
    - Or **Brevo** (free, 300/day): sign up at https://www.brevo.com → verify a sender → **SMTP & API → API keys** → then run `npx wrangler secret put BREVO_API_KEY` and `npx wrangler secret put MAIL_FROM` → `npm run deploy`.
    - With neither set up, **Add user** opens your own mail app with the invite ready. Just press Send.
23. Members can run audits and connect their own YouTube channel. Only admins can manage the Team.

---

## Every 7 days (because the app stays in Testing mode)
Google switches off the **YouTube connection** and the **mailbox connection** 7 days after you connect them. The top bar shows "N days left", then a **Reconnect** button. Click it, pick the same account and tick the boxes. That takes 10 seconds and nothing is lost. Signing in itself is not affected.

## Updating the app later (one command)
`wrangler.toml` already contains your database id and admin email, so updating is:
1. Download the new ZIP from GitHub (branch `claude/vibrant-curie-taum1m`) and unzip it.
2. In Terminal, go into the new `searchverse-youtube` folder and run:
   ```
   npm run update
   ```
   This installs, adds any new database tables (safe to re-run; nothing is deleted) and deploys. Your secrets stay in Cloudflare.
⚠️ If you ran `npm run add-storage`, copy your current `wrangler.toml` into the new folder first, because it holds the extra databases.

## Daily limits & storage
- **Today's limits** (on the home page) shows the YouTube units used out of 9,500 (Google gives 10,000 a day; 500 are kept as a safety margin), the AI calls per feature, and the saved data. Everything resets at midnight US Pacific (12:30 PM IST, or 1:30 PM IST in winter).
- One channel at 200 videos costs about 10 units, so about 900 channel fetches a day. **✨ Suggest competitors** costs about 410 units. Any channel fetched by anyone in the last 24 hours costs 0, and suggestions are reused for 7 days.
- When a limit is reached the tool stops and tells you when it resets. Saved audits still open.
- Change the limits in `wrangler.toml` (`YT_DAILY_LIMIT`, `AI_*_DAILY`) and run `npm run deploy`. For more YouTube quota, ask Google (free): https://support.google.com/youtube/contact/yt_api_form
- **Saved audits**: every audit is saved automatically, compressed (about 1 MB per large audit), and can be reopened any time. Use 💾 Save after an AI review to keep the AI results too.
- **More storage (free, up to 5 GB):** `npm run add-storage`, then `npm run deploy`. Each run adds a 500 MB database (maximum 9 extra). New audits go to the database with the most room.

## Problems?
| You see | Do this |
|---|---|
| `redirect_uri_mismatch` | Step 13: the URI must be exactly `https://YOUR-LINK/auth/callback` |
| `access_denied` / "app is in testing" | Add that email to **Test users** (step 12) |
| "doesn't have access yet" | An admin adds that email on the **Team** page |
| Owner Analytics missing | Click **Connect YouTube** and choose the account that owns the channel |
| "YouTube API 403 / quota" | The daily free quota (10,000 units) is used up. It resets at midnight Pacific time |
| `wrangler` deployed to the wrong account | `npx wrangler logout` → `npx wrangler login` with the new account (step 5) |
