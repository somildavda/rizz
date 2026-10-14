/* ===== SearchVerse modules — add a new tool by adding one object here
   and a folder public/tools/<id>/index.html (copy an existing one). ===== */
window.SV_TOOLS = [
  {
    id: "performance", icon: "📊", name: "Performance Explorer", tag: "Analytics",
    tagline: "See exactly where your search visibility comes from.",
    desc: "Impressions, clicks, CTR and position trends broken down by line of business, so every team sees its own story.",
    url: "https://searchverse.somildavda.workers.dev/#/p/c9a1ceb992e94e6cba34417b06f261bc/lob?metric=impressions",
    features: [
      ["Line-of-business views", "Split performance by product line, category or market."],
      ["Metric switching", "Flip between impressions, clicks, CTR and average position."],
      ["Trend spotting", "Catch rises and drops early, before they hit the monthly report."]
    ],
    steps: ["Open the explorer", "Pick a line of business and metric", "Share the view with your team"]
  },
  {
    id: "workspace", icon: "🗂️", name: "Search Workspace", tag: "Workspace",
    tagline: "Your team's reporting and automation hub.",
    desc: "A shared workspace for running reports and automations against your organisation's search data.",
    url: "https://script.google.com/a/macros/infidigit.com/s/AKfycbwBVzrOdMxxjUvouiIrFUm2p-Res919oq2CgCgVk0IkNupDR3FU8Pa5Z0VbIhaxbYHwYw/exec",
    newTab: true, note: "Requires sign-in with your organisation Google account.",
    features: [
      ["Automated reports", "Generate recurring reports without manual exports."],
      ["Organisation sign-in", "Access is limited to your company Google accounts."],
      ["Sheets-native", "Output lands where your team already works."]
    ],
    steps: ["Sign in with your work account", "Choose a report or automation", "Run it and collect the output"]
  },
  {
    id: "speed", icon: "🚀", name: "PageSpeed Lab", tag: "Core Web Vitals",
    tagline: "Bulk page-speed checks in one run.",
    desc: "Test many URLs at once for Core Web Vitals and performance scores on mobile and desktop.",
    url: "https://searchverse-psi.shred-app.workers.dev/",
    features: [
      ["Bulk URL testing", "Paste a list and test every page in one go."],
      ["Core Web Vitals", "LCP, INP and CLS at a glance, with pass/fail status."],
      ["Mobile & desktop", "Compare both strategies side by side."]
    ],
    steps: ["Paste your URLs", "Run the test", "Export results for your audit"]
  },
  {
    id: "youtube", icon: "▶️", name: "Video Visibility", tag: "YouTube",
    tagline: "Know how your videos show up in search.",
    desc: "Track YouTube search presence, rankings and video-level insights for your brand and competitors.",
    url: "https://searchverse-youtube.searchverse-infidigit.workers.dev/",
    features: [
      ["Search presence", "See which queries surface your videos."],
      ["Competitor view", "Benchmark against other channels in your space."],
      ["Video insights", "Spot the videos worth optimising first."]
    ],
    steps: ["Enter a channel or keyword", "Review visibility and rankings", "Act on the top opportunities"]
  }
];
