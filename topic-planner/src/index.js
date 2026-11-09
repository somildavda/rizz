// Topic Planner — its own Cloudflare Worker, with its own sign-in, Access Center
// and project database (separate from the SearchVerse hub).
import { handleContentGap } from "./content-gap.js";
import { handleDb } from "./db.js";
import { gate } from "./auth.js";

export { ProjectStore } from "./db.js";
export { AppStore } from "./app-store.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const g = await gate(request, env, url);
    if (g instanceof Response) return g;
    if (url.pathname.startsWith("/api/cg/db/")) return handleDb(request, env, g && g.user);
    if (url.pathname.startsWith("/api/cg/")) return handleContentGap(request, url);
    return env.ASSETS.fetch(request);
  },
};
