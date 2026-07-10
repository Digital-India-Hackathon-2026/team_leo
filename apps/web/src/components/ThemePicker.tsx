import { useEffect, useState } from "react";

type ThemeVars = Record<string, string>;
type ThemeDef = { name: string; vars: ThemeVars };

const BUILTIN_THEMES: ThemeDef[] = [
  {
    name: "Dark (default)",
    vars: {
      "--bg": "#0c0e14", "--panel": "#12141d", "--panel2": "#171a25",
      "--line": "#242a3a", "--line2": "#2f3648", "--text": "#e7e9f1",
      "--dim": "#878da0", "--faint": "#5b6076", "--accent": "#7c5cff", "--accent2": "#00d4a6",
    },
  },
  {
    name: "Light",
    vars: {
      "--bg": "#f5f6f8", "--panel": "#ffffff", "--panel2": "#eef0f4",
      "--line": "#d8dbe4", "--line2": "#c8ccd8", "--text": "#1a1d28",
      "--dim": "#5c6070", "--faint": "#8b90a1", "--accent": "#6b46e5", "--accent2": "#0ab98a",
    },
  },
  {
    name: "Ocean",
    vars: {
      "--bg": "#0a1628", "--panel": "#0f1e38", "--panel2": "#142848",
      "--line": "#1e3a5f", "--line2": "#2a4d78", "--text": "#e0eaf8",
      "--dim": "#7a9cc0", "--faint": "#4d7aaa", "--accent": "#3b8bff", "--accent2": "#00e6b8",
    },
  },
  {
    name: "Sunset",
    vars: {
      "--bg": "#1a0e1e", "--panel": "#221428", "--panel2": "#2c1a32",
      "--line": "#3d2845", "--line2": "#4e3558", "--text": "#f0e4f4",
      "--dim": "#b08ec0", "--faint": "#7a5a8a", "--accent": "#e05eff", "--accent2": "#ff6b9d",
    },
  },
];

function applyTheme(vars: ThemeVars) {
  const root = document.documentElement;
  for (const [key, val] of Object.entries(vars)) {
    root.style.setProperty(key, val);
  }
}

export default function ThemePicker() {
  const [active, setActive] = useState(() => {
    return localStorage.getItem("personacode-theme") ?? "Dark (default)";
  });

  useEffect(() => {
    const theme = BUILTIN_THEMES.find((t) => t.name === active);
    if (theme) applyTheme(theme.vars);
  }, [active]);

  function select(name: string) {
    setActive(name);
    localStorage.setItem("personacode-theme", name);
  }

  return (
    <div className="theme-picker">
      <div className="theme-label">Theme</div>
      <div className="theme-swatches">
        {BUILTIN_THEMES.map((t) => (
          <button
            key={t.name}
            className={`theme-swatch ${active === t.name ? "on" : ""}`}
            onClick={() => select(t.name)}
            title={t.name}
          >
            <span className="swatch-color" style={{ background: t.vars["--accent"] }} />
            <span className="swatch-color" style={{ background: t.vars["--accent2"] }} />
            <span className="swatch-name">{t.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
