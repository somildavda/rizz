"use client";
import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [t, setT] = useState("dark");
  useEffect(() => { setT(document.documentElement.getAttribute("data-theme") || "dark"); }, []);
  const flip = () => {
    const n = t === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", n);
    try { localStorage.setItem("sv-theme", n); } catch (_) {}
    setT(n);
  };
  return <button type="button" className="btn sm ghost" onClick={flip} aria-label={t === "dark" ? "Switch to light mode" : "Switch to dark mode"}>{t === "dark" ? "☀️" : "🌙"}</button>;
}
