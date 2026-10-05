# Searchverse — take it live, step by step 🍼

The whole thing takes about 30–40 minutes once and costs ₹0. Do the steps in order and tick them off.
You need: a laptop, your **Infidigit Google account** (this will be the admin), and a free **Cloudflare** account.

---

## PART A — Install the tools on your laptop (5 min)

1. **Install Node.js**
   - Go to https://nodejs.org, click the big **LTS** button, install it (Next → Next → Finish).
   - Check it worked: open **Terminal** (Mac) or **Command Prompt** (Windows) and type:
     ```
     node -v
     ```
     You should see something like `v22.x.x`.

2. **Download the code**
   - Go to https://github.com/somildavda/rizz, switch to the branch `claude/vibrant-euler-3sxcme` (or `main` once merged).
   - Click the green **Code** button → **Download ZIP** → unzip it.
   - In Terminal, go into the folder:
     ```
     cd Downloads/rizz-claude-vibrant-euler-3sxcme/searchverse
     ```
     (Tip: type `cd ` then drag the `searchverse` folder into the terminal window and press Enter.)

3. **Install the Cloudflare tool**
   ```
   npm install
   ```

---

## PART B — Cloudflare: put the app online (10 min)

4. **Make a free Cloudflare account** at https://dash.cloudflare.com/sign-up (skip it if you have one).

5. **Log the terminal into Cloudflare**
   ```
   npx wrangler login
   ```
   A browser opens → click **Allow**. Go back to the terminal.

6. **Create the database**
   ```
   npx wrangler d1 create searchverse
   ```
   It prints something like:
   ```
   database_id = "1234abcd-....."
   ```
   Copy that long id. Open the file `wrangler.toml` (in Notepad / TextEdit / VS Code) and replace
   `REPLACE_WITH_YOUR_D1_DATABASE_ID` with it. Save.

7. **Make yourself the admin.** In the same `wrangler.toml`, change
   ```
   ADMIN_EMAILS = ""
   ```
   to your Infidigit email, e.g.
   ```
   ADMIN_EMAILS = "somil@infidigit.com"
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
   At the end it prints your link, e.g. **`https://searchverse.YOURNAME.workers.dev`**.
   📝 Write this link down. We'll call it **YOUR-LINK**. (Sign-in won't work yet; we fix that next.)

---

## PART C — Google Cloud: allow "Sign in with Google" (15 min)

10. Open https://console.cloud.google.com, signed in with your **Infidigit** account.
    - Top bar → project picker → **New Project** → name it `searchverse` → **Create** → make sure it's selected.

11. **Turn on the 3 Google APIs.** Search each one in the top search bar, open it, and click **Enable**:
    - **Google Search Console API**
    - **Google Analytics Data API**
    - **Google Analytics Admin API**

12. **Set up the consent screen.** Left menu → **APIs & Services → OAuth consent screen** (it may be called **Google Auth Platform → Branding / Audience**).
    - App name: `Searchverse`. Support email: your email. Developer email: your email. Save.
    - **Audience / User type:** pick **External**.
    - **Publishing status:** leave it on **Testing** (we keep it this way).
    - **Test users → + Add users:** add **every email that will use the tool or connect data**:
      your Infidigit email, the email(s) that own the Search Console / GA4 access, and your team members' emails. Save.
      > If someone's email isn't here, Google blocks them with "access denied". Come back and add it any time.
    - **Data access / Scopes → Add or remove scopes:** tick `.../auth/webmasters.readonly` and `.../auth/analytics.readonly`, then Update and Save.

13. **Create the login keys.** Left menu → **Credentials → + Create credentials → OAuth client ID**.
    - Application type: **Web application**. Name: `searchverse`.
    - **Authorized redirect URIs → + Add URI:**
      ```
      https://YOUR-LINK/auth/callback
      ```
      (e.g. `https://searchverse.yourname.workers.dev/auth/callback`, with no slash at the end)
    - Click **Create**. A box shows a **Client ID** and a **Client secret**. Keep it open.

---

## PART D — Give the keys to the app (5 min)

14. In the terminal, run these one by one. Each one asks you to paste a value and press Enter:
    ```
    npx wrangler secret put GOOGLE_CLIENT_ID
    ```
    → paste the **Client ID**
    ```
    npx wrangler secret put GOOGLE_CLIENT_SECRET
    ```
    → paste the **Client secret**
    ```
    npx wrangler secret put APP_SECRET
    ```
    → type any long random password (e.g. smash 40 keys). It locks the saved Google tokens. **Never change it later.**

15. **Free Gemini AI key**
    - Open https://aistudio.google.com/apikey → **Create API key** → copy it.
    - ```
      npx wrangler secret put GEMINI_API_KEY
      ```
      → paste it. (Alternatively, each person can paste their own key on the Settings page.)

16. **Publish again** so everything is picked up:
    ```
    npm run deploy
    ```

🎉 **The tool is live at YOUR-LINK.**

---

## PART E — First use (5 min)

17. Open **YOUR-LINK** → **Sign in with Google** → pick your **Infidigit** account.
    If Google says *"Google hasn't verified this app"*, click **Continue**. That's normal in Testing mode.
18. You'll see a **Get started** checklist. Click **Connect**:
    - On Google's screen, choose the **email that actually has Search Console / GA4 access** (it can be a different one from your Infidigit login).
    - **Tick both boxes** (Search Console + Analytics) → Continue.
    - Need another account's data too? Click **Connect a Google account** again with that email.
19. **Create a project** → pick the account → pick the Search Console property and the GA4 property → **Create project**.
20. Click **▶ Start analysis**. Wait 1–3 minutes and keep the tab open. Done: scores, page audits, opportunities and AI recommendations.

---

## PART F — Add your team

21. Top menu → **Users → + Add user** → type their email → Role **Member** → for each project choose **Can run analysis** (or **View only**) → **Add user**.
22. Also add their email to **Google Cloud → Test users** (step 12), or Google blocks their sign-in.
23. Send them **YOUR-LINK**. They sign in with that email and only see the projects you gave them. They can run analyses but **can't** connect accounts, create, edit or delete projects, or manage users.

---

## Every 7 days (because we stay in Testing mode)

Google switches off the data connection 7 days after you connect it. You'll see a red **Reconnect** banner on the home page (and "expires in N days" in Settings).
**Click Reconnect → pick the same account → tick both boxes.** That takes 10 seconds, and nothing is lost.

## Updating the app later
Download the new code, put your `database_id` and `ADMIN_EMAILS` back in `wrangler.toml`, then run `npm run deploy`. Your data stays.

## Problems?
| You see | Do this |
|---|---|
| `redirect_uri_mismatch` | The redirect URI in step 13 must be exactly `https://YOUR-LINK/auth/callback` |
| `access_denied` / "app is in testing" | Add that email to **Test users** (step 12) |
| "doesn't have access yet" | Admin adds that email on the **Users** page |
| No properties in the dropdown | You connected the wrong Google account. Connect the one that sees the site in Search Console |
| "Google access … expired" | Settings → **Reconnect** |
| AI step failed / 429 | Gemini free limit hit. Wait a minute → Insights tab → **Regenerate** |

---

## More storage (free, up to 5 GB)
The free plan gives you up to 10 databases of 500 MB. Each command adds one:
```
npm run add-storage
npm run deploy
```
Run it again whenever Settings → Storage gets full (max 9 extra = 5 GB). Searchverse automatically saves new runs to the database with the most room.
⚠️ After this, when updating the app **don't download `wrangler.toml` again** — it now holds your extra databases.

## Automatic invite emails (free)
Without setup, adding a teammate opens your own mail app with the invite ready. For automatic emails:
1. Sign up free at https://www.brevo.com (no card) → **Senders** → add & verify the sender email.
2. **SMTP & API → API keys** → generate a key.
3. In Terminal: `npx wrangler secret put BREVO_API_KEY` (paste key), `npx wrangler secret put MAIL_FROM` (sender email), then `npm run deploy`.
