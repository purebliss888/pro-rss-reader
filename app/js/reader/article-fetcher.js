// Extraction runs in three steps, stopping at the first one that gives a good result:
//   1. Readability on the page as served.
//   2. Readability again after un-hiding content that the page hides until its own scripts run
//      (inline display:none / visibility:hidden / the `hidden` attribute).
//   3. The article text published in the page's structured data (JSON-LD `articleBody`).


import { getReaderCache, putReaderCache } from "../core/db.js";
import { errorMessage, escapeHtml, isHttpUrl, resolveUrl } from "../core/utils.js";
import { fetchText } from "../feeds/fetcher.js";
import { isGoogleNewsUrl, resolveGoogleNewsUrl } from "../feeds/google-news.js";
import { sanitizeHtml, serializeFragment } from "./sanitize.js";

const HTML_TYPE = /(?:text\/html|application\/xhtml\+xml)/i;
const MIN_CHARS = 120;
const MIN_RETRY_CHARS = 250;
const MAX_LINK_DENSITY = 0.5;
const COMPLETE_RATIO = 0.6;
const ARTICLE_TYPES = /^(?:[A-Za-z]*Article|BlogPosting|Report|ScholarlyArticle|LiveBlogPosting)$/;

// finalUrl: where the article actually lives (after Google News / redirects), when known.
class ArticleError extends Error {
  constructor(message, finalUrl = null) {
    super(message);
    this.name = "ArticleError";
    this.finalUrl = finalUrl;
  }
}

function metaContent(doc, selector) {
  const el = doc.querySelector(selector);
  return el ? (el.getAttribute("content") || "").trim() : "";
}

// Makes relative links and images resolve against the article's address.
function setBase(doc, pageUrl) {
  const existing = doc.querySelector("base[href]");
  const href = (existing && resolveUrl(existing.getAttribute("href"), pageUrl)) || pageUrl;
  doc.querySelectorAll("base").forEach((b) => b.remove());
  const base = doc.createElement("base");
  base.href = href;
  (doc.head || doc.documentElement).prepend(base);
}

function parseDocument(text, pageUrl) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  setBase(doc, pageUrl);
  return doc;
}

// Shows content the page hides until its scripts run. used in step 2.
function unhide(doc) {
  doc.querySelectorAll("[hidden]").forEach((el) => el.removeAttribute("hidden"));
  doc.querySelectorAll("[style]").forEach((el) => {
    if (/^(?:script|style|template|noscript)$/i.test(el.localName)) return;
    const s = el.style;
    if (s.display === "none") s.removeProperty("display");
    if (s.visibility === "hidden" || s.visibility === "collapse") s.removeProperty("visibility");
  });
}

// Share of the text that sits inside links. Footers, menus and link lists score high; articles low.
function linkDensity(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  const total = (t.content.textContent || "").trim().length;
  if (!total) return 1;
  let linked = 0;
  t.content.querySelectorAll("a").forEach((a) => {
    linked += (a.textContent || "").trim().length;
  });
  return linked / total;
}

function runReadability(doc) {
  try {
    const parsed = new globalThis.Readability(doc, { charThreshold: 250 }).parse();
    if (!parsed || !parsed.content) return null;
    // Mostly links = page furniture (footer, menu), not an article
    if (linkDensity(parsed.content) > MAX_LINK_DENSITY) return null;
    return { ...parsed, length: (parsed.textContent || "").trim().length };
  } catch {
    return null;
  }
}

// ---- Structured data (JSON-LD) ----

function collectArticles(node, out, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return;
  if (Array.isArray(node)) {
    node.forEach((n) => collectArticles(n, out, depth + 1));
    return;
  }
  const types = [].concat(node["@type"] || []).map(String);
  if (typeof node.articleBody === "string" && (types.length === 0 || types.some((t) => ARTICLE_TYPES.test(t)))) {
    out.push(node);
  }
  if (node["@graph"]) collectArticles(node["@graph"], out, depth + 1);
  if (node.mainEntity) collectArticles(node.mainEntity, out, depth + 1);
}

// -> { text, title } for the longest article body found in the page, or null.
function structuredArticle(doc) {
  const found = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      collectArticles(JSON.parse(s.textContent), found);
    } catch {
      /* malformed JSON-LD: ignore */
    }
  });
  let best = null;
  for (const node of found) {
    const text = node.articleBody.replace(/\r/g, "").trim();
    if (text && (!best || text.length > best.text.length)) {
      best = { text, title: typeof node.headline === "string" ? node.headline.trim() : "" };
    }
  }
  return best;
}

function structuredToResult(sd) {
  const paragraphs = sd.text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  return {
    content: paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join(""),
    textContent: sd.text,
    length: sd.text.length,
    title: sd.title,
    byline: "",
    siteName: "",
  };
}

// -> { url, finalUrl, html (sanitized), title, byline, siteName, image, fetched }
// Throws ArticleError with a message suitable for showing to the user.
export async function loadArticle(url) {
  if (!isHttpUrl(url)) throw new ArticleError("This item has no web address.");
  if (typeof globalThis.Readability !== "function") {
    throw new ArticleError("The Readability library is missing (lib/readability.js).");
  }

  const cached = await getReaderCache(url).catch(() => null);
  if (cached && cached.html) return cached;

  let target = url;
  if (isGoogleNewsUrl(url)) {
    try {
      target = await resolveGoogleNewsUrl(url);
    } catch (err) {
      throw new ArticleError(`Could not open the Google News link: ${errorMessage(err)}`);
    }
  }

  let page;
  try {
    page = await fetchText(target, { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", timeout: 20_000 });
  } catch (err) {
    throw new ArticleError(errorMessage(err), target);
  }
  const finalUrl = page.url || target;

  if (page.contentType && !HTML_TYPE.test(page.contentType)) {
    throw new ArticleError(`This link is not a web page (${page.contentType.split(";")[0].trim()}).`, finalUrl);
  }

  // Read page metadata first: Readability modifies the document while parsing
  const doc = parseDocument(page.text, finalUrl);
  const image = resolveUrl(metaContent(doc, 'meta[property="og:image"], meta[name="twitter:image"]'), finalUrl);
  const siteName = metaContent(doc, 'meta[property="og:site_name"]');
  const structured = structuredArticle(doc);
  const expected = structured ? structured.text.length : 0;
  const isComplete = (r) => r && r.length >= MIN_CHARS && (!expected || r.length >= expected * COMPLETE_RATIO);

  // 1. The page as served
  let best = runReadability(doc);

  // 2. The page with its hidden content shown
  if (!isComplete(best)) {
    const retryDoc = parseDocument(page.text, finalUrl);
    unhide(retryDoc);
    const retry = runReadability(retryDoc);
    if (retry && retry.length >= MIN_RETRY_CHARS && (!best || retry.length > best.length)) best = retry;
  }

  // 3. The article text from the page's structured data
  if (!isComplete(best) && structured && structured.text.length >= MIN_CHARS) {
    if (!best || structured.text.length > best.length) {
      const fallback = structuredToResult(structured);
      best = { ...fallback, title: fallback.title || (best && best.title) || doc.title || "" };
    }
  }

  if (!best || best.length < MIN_CHARS) {
    throw new ArticleError("No readable article text was found on this page.", finalUrl);
  }

  const html = serializeFragment(sanitizeHtml(best.content, finalUrl));
  if (!html.trim()) throw new ArticleError("No readable article text was found on this page.", finalUrl);

  const entry = {
    url,
    finalUrl,
    html,
    title: best.title || "",
    byline: best.byline || "",
    siteName: best.siteName || siteName,
    image: image || null,
    fetched: Date.now(),
  };
  putReaderCache(entry).catch(() => {});
  return entry;
}
