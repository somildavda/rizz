import "./globals.css";

export const metadata = {
  metadataBase: new URL("https://searchverse.in"),
  title: { default: "SearchVerse: SEO suite for audits, speed, rankings and content", template: "%s · SearchVerse" },
  description: "SearchVerse puts your site audit, page speed, Search Console rankings and content gap planning in one place, for your whole team.",
  openGraph: { siteName: "SearchVerse", type: "website", images: ["/og.png"] },
  icons: { icon: "/icon.svg" },
};

// Sets the saved light/dark theme before the page paints (same key as the tools).
const THEME = `try{document.documentElement.setAttribute("data-theme",localStorage.getItem("sv-theme")==="light"?"light":"dark")}catch(e){document.documentElement.setAttribute("data-theme","dark")}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/sv/app.css" />
        <link rel="stylesheet" href="/sv/theme.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
