import { getKey, updateKey } from "./storage.js";

const SETTINGS_KEY = "settings";

const DEFAULT_SETTINGS = Object.freeze({
  theme: "dark",
  maxItemsPerFeed: 100,
  cacheDays: 30,
  homeFolderId: null,
  googleNewsTabFallback: true,
});

const LIMITS = {
  maxItemsPerFeed: [10, 1000],
  cacheDays: [1, 365],
};

function clampInt(value, [min, max], fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalize(raw = {}) {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  s.theme = s.theme === "light" ? "light" : "dark";
  s.maxItemsPerFeed = clampInt(s.maxItemsPerFeed, LIMITS.maxItemsPerFeed, DEFAULT_SETTINGS.maxItemsPerFeed);
  s.cacheDays = clampInt(s.cacheDays, LIMITS.cacheDays, DEFAULT_SETTINGS.cacheDays);
  s.homeFolderId = s.homeFolderId || null;
  s.googleNewsTabFallback = s.googleNewsTabFallback !== false;
  return s;
}

export async function getSettings() {
  return normalize(await getKey(SETTINGS_KEY, {}));
}

export function updateSettings(patch) {
  return updateKey(SETTINGS_KEY, (current) => normalize({ ...current, ...patch }), {});
}

export function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("theme", t);
  } catch {
  }
}

export const SETTING_LIMITS = LIMITS;