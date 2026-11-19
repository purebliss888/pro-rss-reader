// Google News feed helpers: build and parse feed URLs, and detect the language /
// region ("edition") a site needs. Google News uses three parameters:
//   hl   = interface language, e.g. "en" or "en-IN"
//   gl   = region, e.g. "IN"
//   ceid = "<region>:<language>", e.g. "IN:en"
// A wrong edition can give no results or the wrong language, so the values are
// detected automatically and stay editable in the UI.

import { domainOf } from "../core/utils.js";

const GN_HOST = "news.google.com";

const ENGLISH_REGIONS = new Set(["IN", "IE", "AU", "CA", "NZ", "US", "SG", "GB", "PH", "PK", "ZA"]);
const ES_419_REGIONS = new Set(["MX", "AR", "CO", "CL", "PE", "VE", "US", "CU", "EC", "UY", "BO", "PY"]);
const GENERIC_CC_TLDS = new Set([
  "io", "ai", "tv", "me", "co", "fm", "ly", "to", "cc", "ws", "gg", "sh", "xyz", "app", "dev",
  "gl", "so", "la", "ms", "vc", "nu", "im", "ac", "tk",
]);

// Country domain -> language
const REGION_LANG = {
  IN: "en", US: "en", GB: "en", AU: "en", CA: "en", NZ: "en", IE: "en", SG: "en", ZA: "en", PH: "en", PK: "en",
  DE: "de", AT: "de", CH: "de", FR: "fr", BE: "fr", ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es",
  IT: "it", PT: "pt", BR: "pt", NL: "nl", PL: "pl", SE: "sv", NO: "no", DK: "da", FI: "fi", RU: "ru", UA: "uk",
  TR: "tr", GR: "el", CZ: "cs", HU: "hu", RO: "ro", JP: "ja", KR: "ko", CN: "zh", TW: "zh", HK: "zh",
  ID: "id", TH: "th", VN: "vi", IL: "he", EG: "ar", SA: "ar", AE: "ar",
};

// Language -> its usual Google News region
const LANG_REGION = {
  en: "US", gu: "IN", hi: "IN", mr: "IN", ta: "IN", te: "IN", kn: "IN", ml: "IN", bn: "IN", pa: "IN",
  ur: "PK", ne: "NP", de: "DE", fr: "FR", es: "ES", it: "IT", pt: "BR", nl: "NL", pl: "PL", sv: "SE",
  no: "NO", da: "DK", fi: "FI", ru: "RU", uk: "UA", tr: "TR", el: "GR", cs: "CZ", hu: "HU", ro: "RO",
  ja: "JP", ko: "KR", zh: "CN", id: "ID", th: "TH", vi: "VN", he: "IL", ar: "EG",
};

// Writing system -> candidate languages (first is the default guess)
const SCRIPTS = [
  { re: /[\u0A80-\u0AFF]/g, langs: ["gu"] },
  { re: /[\u0900-\u097F]/g, langs: ["hi", "mr", "ne"] },
  { re: /[\u0980-\u09FF]/g, langs: ["bn"] },
  { re: /[\u0A00-\u0A7F]/g, langs: ["pa"] },
  { re: /[\u0B80-\u0BFF]/g, langs: ["ta"] },
  { re: /[\u0C00-\u0C7F]/g, langs: ["te"] },
  { re: /[\u0C80-\u0CFF]/g, langs: ["kn"] },
  { re: /[\u0D00-\u0D7F]/g, langs: ["ml"] },
  { re: /[\u0E00-\u0E7F]/g, langs: ["th"] },
  { re: /[\u3040-\u30FF]/g, langs: ["ja"] },
  { re: /[\uAC00-\uD7AF]/g, langs: ["ko"] },
  { re: /[\u4E00-\u9FFF]/g, langs: ["zh", "ja"] },
  { re: /[\u0590-\u05FF]/g, langs: ["he"] },
  { re: /[\u0600-\u06FF]/g, langs: ["ar", "ur"] },
  { re: /[\u0400-\u04FF]/g, langs: ["ru", "uk"] },
];

// Presets for the language / region picker: [label, lang, region]
const EDITIONS = [
  ["English (India)", "en", "IN"], ["English (United Kingdom)", "en", "GB"], ["English (Ireland)", "en", "IE"], 
  ["English (Australia)", "en", "AU"], ["English (Canada)", "en", "CA"], ["English (Singapore)", "en", "SG"],
  ["English (United States)", "en", "US"], ["English (New Zealand)", "en", "NZ"], ["English (South Africa)", "en", "ZA"],
  ["Hindi (India)", "hi", "IN"], ["Gujarati (India)", "gu", "IN"], ["Marathi (India)", "mr", "IN"],
  ["Tamil (India)", "ta", "IN"], ["Telugu (India)", "te", "IN"], ["Kannada (India)", "kn", "IN"],
  ["Malayalam (India)", "ml", "IN"], ["Bengali (India)", "bn", "IN"], ["Punjabi (India)", "pa", "IN"],
  ["German (Germany)", "de", "DE"], ["French (France)", "fr", "FR"], ["Spanish (Spain)", "es", "ES"],
  ["Spanish (Mexico)", "es", "MX"], ["Portuguese (Brazil)", "pt", "BR"], ["Portuguese (Portugal)", "pt", "PT"],
  ["Italian (Italy)", "it", "IT"], ["Dutch (Netherlands)", "nl", "NL"], ["Polish (Poland)", "pl", "PL"],
  ["Swedish (Sweden)", "sv", "SE"], ["Russian (Russia)", "ru", "RU"], ["Ukrainian (Ukraine)", "uk", "UA"],
  ["Turkish (Turkey)", "tr", "TR"], ["Arabic (Egypt)", "ar", "EG"], ["Japanese (Japan)", "ja", "JP"],
  ["Korean (South Korea)", "ko", "KR"], ["Chinese, Simplified (China)", "zh", "CN"],
  ["Chinese, Traditional (Taiwan)", "zh", "TW"], ["Indonesian (Indonesia)", "id", "ID"],
  ["Thai (Thailand)", "th", "TH"], ["Vietnamese (Vietnam)", "vi", "VN"],
];

// ---- Locale building -------------------------------------------------------

function makeLocale(lang, region) {
  lang = String(lang || "en").toLowerCase();
  region = String(region || LANG_REGION[lang] || "US").toUpperCase();
  let hl = lang;
  let ceidLang = lang;

  if (lang === "en") {
    hl = `en-${region}`;
  } else if (lang === "zh") {
    if (region === "TW" || region === "HK") {
      hl = `zh-${region}`;
      ceidLang = "zh-Hant";
    } else {
      region = "CN";
      hl = "zh-CN";
      ceidLang = "zh-Hans";
    }
  } else if (lang === "pt") {
    if (region === "PT") {
      hl = "pt-PT";
      ceidLang = "pt-150";
    } else {
      region = "BR";
      hl = "pt-BR";
      ceidLang = "pt-419";
    }
  } else if (lang === "es" && region !== "ES") {
    if (!ES_419_REGIONS.has(region)) region = "MX";
    hl = "es-419";
    ceidLang = "es-419";
  }
  return { lang, region, hl, gl: region, ceid: `${region}:${ceidLang}` };
}

export function googleNewsEditions() {
  return EDITIONS.map(([label, lang, region]) => ({ label, ...makeLocale(lang, region) }));
}

// ---- Detection -------------------------------------------------------------

function parseLangTag(tag) {
  const m = /^([a-z]{2,3})(?:[-_]([a-z]{2}|\d{3}))?/i.exec(String(tag || "").trim());
  if (!m) return null;
  let lang = m[1].toLowerCase();
  if (lang === "iw") lang = "he";
  if (lang === "nb" || lang === "nn") lang = "no";
  return { lang, region: m[2] && m[2].length === 2 ? m[2].toUpperCase() : null };
}

function scriptLanguages(title) {
  const letters = (String(title || "").match(/\p{L}/gu) || []).length;
  if (!letters) return null;
  for (const s of SCRIPTS) {
    const hits = (String(title).match(s.re) || []).length;
    if (hits / letters >= 0.3) return s.langs;
  }
  return null;
}

function tldRegion(pageUrl) {
  const host = domainOf(pageUrl);
  const tld = host.split(".").pop().toLowerCase();
  if (tld.length !== 2 || GENERIC_CC_TLDS.has(tld)) return null;
  return tld === "uk" ? "GB" : tld.toUpperCase();
}

// signals: { lang, ogLocale, title } from discovery's page scan (may be null).
// -> { lang, region, hl, gl, ceid, langSource, regionSource, confident }
export function detectGoogleNewsLocale(signals, pageUrl, browserLang = navigator.language) {
  const sig = signals || {};
  const declared = parseLangTag(sig.lang);
  const og = parseLangTag(sig.ogLocale);
  const browser = parseLangTag(browserLang);
  const tld = tldRegion(pageUrl);

  // Language
  let lang = null;
  let langSource = "";
  const byScript = scriptLanguages(sig.title);
  if (byScript) {
    const match = [declared, og].find((d) => d && byScript.includes(d.lang));
    lang = match ? match.lang : byScript[0];
    langSource = "page title";
  } else if (declared) {
    lang = declared.lang;
    langSource = "page language";
  } else if (og) {
    lang = og.lang;
    langSource = "page locale";
  } else if (tld && REGION_LANG[tld]) {
    lang = REGION_LANG[tld];
    langSource = "site domain";
  } else if (browser) {
    lang = browser.lang;
    langSource = "browser language";
  } else {
    lang = "en";
    langSource = "default";
  }

  // Region
  const okForLang = (r) => r && (lang !== "en" || ENGLISH_REGIONS.has(r));
  let region = null;
  let regionSource = "";
  for (const [candidate, source] of [
    [declared && declared.lang === lang ? declared.region : null, "page language"],
    [og && og.lang === lang ? og.region : null, "page locale"],
    [tld, "site domain"],
  ]) {
    if (okForLang(candidate)) {
      region = candidate;
      regionSource = source;
      break;
    }
  }
  if (!region) {
    if (lang === "en") {
      region = browser && ENGLISH_REGIONS.has(browser.region) ? browser.region : "US";
      regionSource = browser && browser.region ? "browser region" : "default";
    } else {
      region = LANG_REGION[lang] || (browser && browser.region) || "US";
      regionSource = "language";
    }
  }

  const locale = makeLocale(lang, region);
  const weak = ["browser language", "default"];
  return { ...locale, langSource, regionSource, confident: !weak.includes(langSource) && regionSource !== "default" };
}

// Editions to try, in order, until one returns articles.
export function googleNewsLocaleCandidates(locale) {
  const list = [locale];
  if (locale.lang !== "en") {
    list.push({ ...locale, hl: `${locale.lang}-${locale.region}` }); // e.g. hl=gu-IN
    list.push(makeLocale("en", ENGLISH_REGIONS.has(locale.region) ? locale.region : "US"));
  }
  list.push(makeLocale("en", "US"));
  const seen = new Set();
  return list.filter((l) => {
    const k = `${l.hl}|${l.gl}|${l.ceid}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---- URLs ------------------------------------------------------------------

export function buildGoogleNewsSearchUrl({ query, site, hl, gl, ceid }) {
  const u = new URL(`https://${GN_HOST}/rss/search`);
  u.searchParams.set("q", query != null && query !== "" ? query : `site:${site}`);
  if (hl) u.searchParams.set("hl", hl);
  if (gl) u.searchParams.set("gl", gl);
  if (ceid) u.searchParams.set("ceid", ceid);
  return u.href;
}

function isGoogleNewsFeedUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === GN_HOST && u.pathname.startsWith("/rss");
  } catch {
    return false;
  }
}

// -> { path, query, site, hl, gl, ceid } or null
export function parseGoogleNewsFeedUrl(url) {
  if (!isGoogleNewsFeedUrl(url)) return null;
  const u = new URL(url);
  const q = u.searchParams.get("q") || "";
  const site = /(?:^|\s)site:([^\s]+)/i.exec(q);
  return {
    path: u.pathname,
    query: q,
    site: site ? site[1] : "",
    hl: u.searchParams.get("hl") || "",
    gl: u.searchParams.get("gl") || "",
    ceid: u.searchParams.get("ceid") || "",
  };
}

// Returns the same Google News feed URL with new hl / gl / ceid, or null.
export function withGoogleNewsParams(url, { hl, gl, ceid }) {
  if (!isGoogleNewsFeedUrl(url)) return null;
  const u = new URL(url);
  if (hl) u.searchParams.set("hl", hl);
  if (gl) u.searchParams.set("gl", gl);
  if (ceid) u.searchParams.set("ceid", ceid);
  return u.href;
}