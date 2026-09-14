import { useEffect, useState } from "react";

const STORAGE_KEY = "ecologia-theme-v1";
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#17251e" : "#faf4eb");
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "light");
  useEffect(() => {
    const sync = (event) => {
      if (event.key !== STORAGE_KEY) return;
      const next = event.newValue === "dark" ? "dark" : "light";
      applyTheme(next);
      setTheme(next);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* También funciona sin almacenamiento. */ }
  }
  return <button type="button" className="btn theme-toggle" onClick={toggle}
    aria-label="Tema oscuro" aria-pressed={theme === "dark"}
    title={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}>
    <span aria-hidden="true">{theme === "dark" ? "☾" : "☀"}</span>
    <span>{theme === "dark" ? "Oscuro" : "Claro"}</span>
  </button>;
}
