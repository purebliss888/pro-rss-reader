// Feed discovery. Given a page URL (and optionally the open tab), finds feeds the
// site offers, verifies each one by actually loading it, and falls back to the
// WordPress REST API and finally a Google News search feed.

import { fetchText } from "./fetcher.js";
import { FeedError } from "./parser.js";
import { loadFeed, wpPostsAltUrl, wpPostsUrl } from "./feed-loader.js";
import { domainOf, errorMessage } from "../core/utils.js";
import { logger } from "../core/logger.js";
import {
  buildGoogleNewsSearchUrl,
  detectGoogleNewsLocale,
  googleNewsLocaleCandidates,
  parseGoogleNewsFeedUrl,
} from "./google-news-feed.js";

// ---- Page signal extraction -------------------------------------------------
// IMPORTANT: this function is serialised and injected into the page with
// scripting.executeScript({ func }), so it must stay self-contained: no imports,
// no references to anything outside its own body.
function extractSignals(doc = document, base = doc.baseURI) {
  const abs = (h) => {
    try {
      return new URL(h, base).href;
    } catch {
      return null;
    }
  };
  const out = {
    url: base,
    title: (doc.title || "").trim(),
    links: [],
    anchors: [],
    generator: "",
    wpApi: null,
    lang: "",
    ogLocale: "",
  };

  for (const l of doc.querySelectorAll("link[href]")) {
    const relRaw = (l.getAttribute("rel") || "").trim();
    const rel = relRaw.toLowerCase().split(/\s+/);
    const href = abs(l.getAttribute("href"));
    if (!href) continue;
    if (rel.includes("alternate") || rel.includes("feed")) {
      out.links.push({
        href,
        type: (l.getAttribute("type") || "").toLowerCase().split(";")[0].trim(),
        title: (l.getAttribute("title") || "").trim(),
      });
    } else if (relRaw === "https://api.w.org/") {
      out.wpApi = href;
    }
  }

  const gen = doc.querySelector('meta[name="generator"]');
  out.generator = gen ? (gen.getAttribute("content") || "").trim() : "";
  const root = doc.documentElement;
  out.lang = ((root && (root.getAttribute("lang") || root.getAttribute("xml:lang"))) || "").trim();
  const og = doc.querySelector('meta[property="og:locale"]');
  out.ogLocale = og ? (og.getAttribute("content") || "").trim() : "";

  let host = "";
  try {
    host = new URL(base).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  const rootDomain = host.split(".").slice(-2).join(".");
  const feedish = /(^|[/._-])(rss|atom|feed|feeds)([/._?#-]|$)|\.(rss|atom|xml)([?#]|$)|[?&]feed=/i;
  const seen = new Set();

  for (const a of doc.querySelectorAll("a[href]")) {
    if (out.anchors.length >= 40) break;
    const href = abs(a.getAttribute("href"));
    if (!href || !/^https?:/i.test(href) || seen.has(href)) continue;
    let ah = "";
    try {
      ah = new URL(href).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (!(ah === host || ah.endsWith("." + rootDomain) || ah === "feeds.feedburner.com")) continue;
    const text = (a.textContent || a.getAttribute("aria-label") || a.getAttribute("title") || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80);
    if (feedish.test(href) || (/\b(rss|atom|feed|subscribe)\b/i.test(text) && /xml|rss|atom|feed/i.test(href))) {
      seen.add(href);
      out.anchors.push({ href, text });
    }
  }
  return out;
}

// ---- Input handling ---------------------------------------------------------

function normalizeUrlInput(input) {
  let s = String(input || "").trim();
  if (!s) return null;
  s = s.replace(/^feed:(\/\/)?/i, "");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.href;
  } catch {
    return null;
  }
}

const keyOf = (url) => url.replace(/#.*$/, "").replace(/\/+$/, "");

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---- Collecting page signals ------------------------------------------------

function sameDocument(a, b) {
  try {
    const x = new URL(a);
    const y = new URL(b);
    x.hash = "";
    y.hash = "";
    return x.href === y.href;
  } catch {
    return false;
  }
}

async function collectSignals({ url, tabId, signals }) {
  if (signals) return { signals, via: "provided" };

  if (tabId != null) {
    try {
      const tab = await browser.tabs.get(tabId);
      if (tab && sameDocument(tab.url, url)) {
        const [res] = await browser.scripting.executeScript({ target: { tabId }, func: extractSignals });
        if (res && res.result) return { signals: res.result, via: "tab" };
      }
    } catch {
      // tab closed, navigated away, or not scriptable: fetch the page instead
    }
  }

  try {
    const page = await fetchText(url, {
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      timeout: 12_000,
      maxBytes: 2_500_000,
    });
    const doc = new DOMParser().parseFromString(page.text, "text/html");
    return { signals: extractSignals(doc, page.url), via: "fetch" };
  } catch {
    return { signals: null, via: "none" };
  }
}

// ---- Candidate builders -----------------------------------------------------

const TYPE_MAP = {
  "application/rss+xml": "rss",
  "application/atom+xml": "atom",
  "application/rdf+xml": "rdf",
  "application/feed+json": "json",
  "application/json": "json",
  "application/xml": "xml",
  "text/xml": "xml",
};
const FEEDISH = /(^|[/._-])(rss|atom|feed|feeds)([/._?#-]|$)|\.(rss|atom|xml|json)([?#]|$)|[?&]feed=/i;
const isCommentsFeed = (c) => /comment/i.test(c.url) || /comment/i.test(c.title || "");

function declaredCandidates(sig) {
  const out = [];
  for (const l of sig.links) {
    if (/oembed/i.test(l.type) || /oembed/i.test(l.href)) continue;
    if (/\/wp-json\/wp\/v2\/(pages|posts|media)\/\d+/.test(l.href)) continue;
    const kind = TYPE_MAP[l.type];
    if (!kind) continue;
    if ((kind === "json" || kind === "xml") && !(FEEDISH.test(l.href) || /feed|rss|atom/i.test(l.title))) continue;
    out.push({ url: l.href, title: l.title, source: "declared" });
  }
  for (const a of sig.anchors) out.push({ url: a.href, title: a.text, source: "link" });
  return out
    .map((c) => ({ ...c, isComments: isCommentsFeed(c) }))
    .sort((a, b) => Number(a.isComments) - Number(b.isComments));
}

function siteRuleCandidates(pageUrl) {
  let u;
  try {
    u = new URL(pageUrl);
  } catch {
    return [];
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  const out = [];
  const add = (url, title, group = null) => out.push({ url, title, group, source: "site-rule" });

  if (host === "github.com" && parts[0]) {
    if (parts[1]) {
      add(`https://github.com/${parts[0]}/${parts[1]}/releases.atom`, `${parts[0]}/${parts[1]} releases`);
      add(`https://github.com/${parts[0]}/${parts[1]}/tags.atom`, `${parts[0]}/${parts[1]} tags`);
    } else {
      add(`https://github.com/${parts[0]}.atom`, `${parts[0]} activity`);
    }
  } else if (host === "medium.com" && parts[0]) {
    add(`https://medium.com/feed/${parts[0]}`, `Medium ${parts[0]}`);
  } else if (host === "youtube.com" || host === "m.youtube.com") {
    if (parts[0] === "channel" && parts[1]) {
      add(`https://www.youtube.com/feeds/videos.xml?channel_id=${parts[1]}`, "YouTube channel");
    }
    const list = u.searchParams.get("list");
    if (list) add(`https://www.youtube.com/feeds/videos.xml?playlist_id=${list}`, "YouTube playlist");
  }

  // Mastodon-style profile pages: https://host/@user -> https://host/@user.rss
  if (/^@[\w.-]+$/.test(parts[0] || "") && parts.length === 1 && host !== "medium.com") {
    add(`${u.origin}/${parts[0]}.rss`, `${parts[0]}`);
  }
  return out;
}

function commonPathCandidates(pageUrl) {
  let u;
  try {
    u = new URL(pageUrl);
  } catch {
    return [];
  }
  const o = u.origin;
  const out = [
    "/feed",
    "/rss",
    "/rss.xml",
    "/atom.xml",
    "/feed.xml",
    "/index.xml",
    "/feed.json",
    "/feeds/posts/default",
    "/?feed=rss2",
  ].map((p) => ({ url: o + p, title: "", source: "common-path" }));

  const seg = u.pathname.split("/").filter(Boolean)[0];
  if (seg && !seg.includes(".")) {
    for (const p of ["feed", "rss.xml", "atom.xml", "feed.xml", "index.xml"]) {
      out.push({ url: `${o}/${seg}/${p}`, title: "", source: "common-path" });
    }
  }
  return out;
}

function wpBase(sig, pageUrl) {
  try {
    if (sig && sig.wpApi) {
      const u = new URL(sig.wpApi);
      const idx = u.pathname.indexOf("/wp-json");
      return u.origin + (idx >= 0 ? u.pathname.slice(0, idx) : u.pathname.replace(/\/$/, ""));
    }
    return new URL(pageUrl).origin;
  } catch {
    return null;
  }
}

async function discoverViaGoogleNews(pageUrl, sig, failures) {
  const host = domainOf(pageUrl);
  const detected = detectGoogleNewsLocale(sig, pageUrl);
  if (!host) return { locale: detected, feed: null };

  for (const cand of googleNewsLocaleCandidates(detected)) {
    const url = buildGoogleNewsSearchUrl({ site: host, hl: cand.hl, gl: cand.gl, ceid: cand.ceid });
    const [res] = await verify(
      [{ url, title: `Google News: ${host}`, titleOverride: true, source: "google-news" }],
      { max: 1, timeout: 12_000, wpFallback: false, failures }
    );
    if (res && res.itemCount > 0) return { locale: cand, detected, feed: res };
  }
  return { locale: detected, feed: null };
}

// ---- Verification -----------------------------------------------------------

async function verify(candidates, { max = 12, concurrency = 4, timeout = 10_000, wpFallback = true, failures = null } = {}) {
  const seen = new Set();
  const unique = [];
  for (const c of candidates) {
    const k = keyOf(c.url);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(c);
    if (unique.length >= max) break;
  }

  const results = await mapLimit(unique, concurrency, async (c) => {
    try {
      const r = await loadFeed(c.url, { timeout, meta: true, wpFallback });
      return {
        // Google News addresses stay exactly as built: Google redirects them to its own canonical form
        url: c.source === "google-news" ? c.url : r.url,
        title: c.titleOverride ? c.title : (r.feed.title || c.title || domainOf(r.url)).trim(),
        type: r.feed.format,
        source: c.source,
        group: c.group || null,
        siteUrl: r.feed.siteUrl,
        icon: r.feed.icon,
        itemCount: r.feed.items.length,
        isComments: !!c.isComments || isCommentsFeed({ url: r.url, title: r.feed.title }),
        feed: r.feed, // already parsed: lets the caller cache items without a second request
      };
    } catch (err) {
      // Probing common paths fails all the time; failures of real candidates are worth reporting
      if (failures && c.source !== "common-path") {
        failures.push({ url: c.url, source: c.source, message: errorMessage(err) });
      }
      return null;
    }
  });

  const groups = new Set();
  return results.filter(Boolean).filter((r) => {
    if (!r.group) return true;
    if (groups.has(r.group)) return false;
    groups.add(r.group);
    return true;
  });
}

// ---- Public API -------------------------------------------------------------

// -> { pageUrl, siteUrl, siteTitle, via, wordpress, googleNewsOnly, googleNews, feeds: [...] }
// googleNews: { locale, found } when Google News was tried (no native feed was found).
// -> { pageUrl, siteUrl, siteTitle, via, wordpress, googleNewsOnly, googleNews, failures, feeds: [...] }
// failures: candidates that looked promising but could not be loaded: [{ url, source, message }]
async function discoverFeeds({ url, tabId = null, signals = null } = {}) {
  const pageUrl = normalizeUrlInput(url);
  if (!pageUrl) throw new FeedError("Not a valid web address.");

  const collected = await collectSignals({ url: pageUrl, tabId, signals });
  const sig = collected.signals;
  const failures = [];

  const found = [];
  const seen = new Set();
  const add = (list) => {
    for (const f of list) {
      const k = keyOf(f.url);
      if (seen.has(k)) continue;
      seen.add(k);
      found.push(f);
    }
  };
  const hasPrimary = () => found.some((f) => !f.isComments);

  if (sig) add(await verify(declaredCandidates(sig), { failures }));
  add(await verify(siteRuleCandidates(pageUrl), { max: 4, failures }));

  if (!hasPrimary()) {
    add(await verify(commonPathCandidates(pageUrl), { max: 14, timeout: 8000, wpFallback: false }));
  }

  let wordpress = !!(sig && (sig.wpApi || /wordpress/i.test(sig.generator || "")));
  if (!hasPrimary()) {
    const base = wpBase(sig, pageUrl);
    if (base) {
      const wp = await verify(
        [
          { url: wpPostsUrl(base), title: "", source: "wordpress" },
          { url: wpPostsAltUrl(base), title: "", source: "wordpress" },
        ],
        { max: 2, timeout: 10_000, wpFallback: false }
      );
      if (wp.length) {
        wordpress = true;
        add(wp.slice(0, 1));
      }
    }
  }

  // No native feed: build one through Google News.
  let googleNews = null;
  if (!hasPrimary()) {
    const gn = await discoverViaGoogleNews(pageUrl, sig, failures);
    if (gn.feed) add([gn.feed]);
    googleNews = { locale: gn.locale, found: !!gn.feed };
  }

  for (const f of failures) logger.warn("discovery", `Could not load ${f.url} (${f.source}): ${f.message}`);

  return {
    pageUrl,
    siteUrl: (sig && sig.url) || pageUrl,
    siteTitle: (sig && sig.title) || "",
    via: collected.via,
    wordpress,
    googleNewsOnly: found.length > 0 && found.every((f) => f.source === "google-news"),
    googleNews,
    failures,
    feeds: found,
  };
}

const GOOGLE_NEWS_NOTICE =
  "This site does not publish a feed of its own. You can still follow it through Google News, which builds " +
  "a feed from the site's articles. Check the language and region below: the wrong ones can return no " +
  "results, or articles in the wrong language.";

const NO_FEED_NOTICE =
  "No feed was found for this address, and Google News returned no articles for it either. You can try a " +
  "Google News feed manually, for example https://news.google.com/rss/search?q=site:example.com " +
  "(then set the language and region), or paste the feed URL directly.";

// Checks an address typed into the Add / Edit feed dialog.
// A feed URL is used as-is. A web page URL is searched for feeds and the best one is used.
// If none found feed gneration using Google News is offered.
export async function validateFeedUrl(input) {
  const url = normalizeUrlInput(input);
  if (!url) throw new FeedError("Enter a valid web address starting with http:// or https://");

  try {
    const r = await loadFeed(url, { meta: true });
    const gn = parseGoogleNewsFeedUrl(url);
    return {
      // Google redirects its own addresses to a canonical form: keep what the user entered
      url: gn ? url : r.url,
      feed: r.feed,
      discovered: false,
      source: gn ? "google-news" : "direct",
      alternatives: [],
      googleNews: gn ? { locale: { hl: gn.hl, gl: gn.gl, ceid: gn.ceid } } : null,
    };
  } catch (err) {
    if (!(err instanceof FeedError && err.code === "html")) throw err;
  }

  const found = await discoverFeeds({ url });
  const best = found.feeds.find((f) => !f.isComments) || found.feeds[0];
  if (!best) {
    const why = found.failures.find((f) => f.source === "site-rule" || f.source === "declared") || found.failures[0];
    throw new FeedError(why ? `${NO_FEED_NOTICE} Details: ${why.message} (${why.url}).` : NO_FEED_NOTICE);
  }

  const isGn = best.source === "google-news";
  return {
    url: best.url,
    feed: best.feed,
    discovered: true,
    source: best.source,
    alternatives: found.feeds,
    googleNews: isGn ? { notice: GOOGLE_NEWS_NOTICE, locale: found.googleNews.locale } : null,
  };
}