// Parses RSS 0.9x/2.0, RSS 1.0 (RDF), Atom and JSON Feed into one shape:
// { format, title, description, siteUrl, icon,
//   items: [{ guid, url, title, summary, image, author, published }] }

import { escapeHtml, hashString, htmlToText, isHttpUrl, resolveUrl, truncate } from "../core/utils.js";

export class FeedError extends Error {
  constructor(message, code = "invalid") {
    super(message);
    this.name = "FeedError";
    this.code = code; // "html" | "empty" | "invalid"
  }
}

const NS = {
  atom: "http://www.w3.org/2005/Atom",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rss1: "http://purl.org/rss/1.0/",
  dc: "http://purl.org/dc/elements/1.1/",
  content: "http://purl.org/rss/1.0/modules/content/",
  media: "http://search.yahoo.com/mrss/",
  itunes: "http://www.itunes.com/dtds/podcast-1.0.dtd",
  xml: "http://www.w3.org/XML/1998/namespace",
};
const IMG_EXT = /\.(?:jpe?g|png|gif|webp|avif|svg)(?:[?#]|$)/i;
const SUMMARY_MAX = 400;

// ---- Small DOM helpers -----------------------------------------------------
// ns: undefined = any namespace, null = no namespace (plain RSS 2.0), string = exact.

function kids(el, local, ns) {
  const out = [];
  if (!el) return out;
  for (const c of el.children) {
    if (c.localName !== local) continue;
    if (ns !== undefined && (c.namespaceURI || null) !== ns) continue;
    out.push(c);
  }
  return out;
}
const kid = (el, local, ns) => kids(el, local, ns)[0] || null;
const text = (el) => (el ? (el.textContent || "").trim() : "");

function baseOf(el, fallback) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const b = n.getAttributeNS(NS.xml, "base");
    if (b) return resolveUrl(b, fallback) || fallback;
  }
  return fallback;
}

// Returns HTML source for an element. Only an explicit type="text" is escaped;
// everything else is treated as HTML because many feeds put markup in untyped fields.
function elementHtml(el) {
  if (!el) return "";
  const type = (el.getAttribute("type") || "").toLowerCase();
  if (type === "xhtml") {
    const ser = new XMLSerializer();
    return [...el.childNodes].map((n) => ser.serializeToString(n)).join("");
  }
  const raw = el.textContent || "";
  return type === "text" ? escapeHtml(raw) : raw;
}

export function parseDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  let t = Date.parse(s);
  if (Number.isNaN(t)) t = Date.parse(s.replace(/^[A-Za-z]{3,9},?\s+/, ""));
  if (Number.isNaN(t)) return null;
  return Math.min(t, Date.now()); // scheduled/future dates are clamped to now
}

// ---- Images ----------------------------------------------------------------

export function imageFromHtml(html, base) {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, "text/html"); // nothing is loaded or run
  for (const img of doc.querySelectorAll("img")) {
    const src =
      img.getAttribute("src") ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-lazy-src") ||
      img.getAttribute("data-original");
    if (!src || src.startsWith("data:")) continue;
    const w = Number(img.getAttribute("width"));
    const h = Number(img.getAttribute("height"));
    if ((w && w <= 2) || (h && h <= 2)) continue; // tracking pixels
    const url = resolveUrl(src, base);
    if (url && isHttpUrl(url)) return url;
  }
  return null;
}

function mediaImage(el) {
  const scopes = [el, ...kids(el, "group", NS.media)];
  for (const s of scopes) {
    for (const t of kids(s, "thumbnail", NS.media)) {
      const u = t.getAttribute("url");
      if (u) return u;
    }
  }
  for (const s of scopes) {
    for (const c of kids(s, "content", NS.media)) {
      const u = c.getAttribute("url");
      const type = (c.getAttribute("type") || "").toLowerCase();
      const medium = (c.getAttribute("medium") || "").toLowerCase();
      if (u && (medium === "image" || type.startsWith("image/") || (!type && !medium && IMG_EXT.test(u)))) return u;
      const nested = kid(c, "thumbnail", NS.media);
      if (nested && nested.getAttribute("url")) return nested.getAttribute("url");
    }
  }
  return null;
}

function rssEnclosureImage(el, rssNs) {
  for (const e of kids(el, "enclosure", rssNs)) {
    const type = (e.getAttribute("type") || "").toLowerCase();
    const u = e.getAttribute("url");
    if (u && (type.startsWith("image/") || (!type && IMG_EXT.test(u)))) return u;
  }
  return null;
}

function itunesImage(el) {
  const i = kid(el, "image", NS.itunes);
  return i ? i.getAttribute("href") : null;
}

// ---- Normalising -----------------------------------------------------------

export function finishItem(raw, base) {
  const url = raw.url && isHttpUrl(raw.url) ? raw.url : null;
  const imageUrl = raw.image ? resolveUrl(raw.image, base) : null;
  const image = imageUrl && isHttpUrl(imageUrl) ? imageUrl : null;
  const publisher = htmlToText(raw.publisher || "");

  let title = htmlToText(raw.title || "");
  // Google News appends " - Publisher" to every headline
  if (publisher && title.length > publisher.length + 3 && title.endsWith(` - ${publisher}`)) {
    title = title.slice(0, -(publisher.length + 3)).trim();
  }

  let summary = htmlToText(raw.summaryHtml || "");
  // Some feeds (Google News in particular) repeat the headline at the start of the description
  if (summary && title && summary.toLowerCase().startsWith(title.toLowerCase())) {
    summary = summary.slice(title.length).replace(/^[\s\-–—:·|]+/, "").trim();
  }
  if (publisher && summary === publisher) summary = "";
  summary = truncate(summary, SUMMARY_MAX);

  if (!title) title = truncate(summary, 90) || url || "";
  if (!title && !url) return null;
  const guid = String(raw.guid || "").trim() || url || hashString(title + (raw.published || ""));
  return { guid, url, title, summary, image, publisher, author: raw.author || "", published: raw.published || null };
}

export function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it || seen.has(it.guid)) continue;
    seen.add(it.guid);
    out.push(it);
  }
  return out;
}

function cleanAuthor(value) {
  const s = (value || "").trim();
  if (!s) return "";
  const withName = /^[^()<>\s]+@[^()<>\s]+\s*\((.+)\)$/.exec(s); // "mail@x.com (Name)"
  if (withName) return withName[1].trim();
  if (/^[^\s@]+@[^\s@]+$/.test(s)) return ""; // bare email address
  return s.replace(/\s*<[^>]+>\s*$/, "").trim(); // "Name <mail@x.com>"
}

// ---- RSS / RDF -------------------------------------------------------------

function parseRssItem(el, rssNs, base, kind) {
  const itemBase = baseOf(el, base);
  const about = el.getAttributeNS(NS.rdf, "about") || "";
  const guidEl = kid(el, "guid", rssNs);
  const guidText = text(guidEl);

  let link = text(kid(el, "link", rssNs));
  if (!link && guidText && isHttpUrl(guidText) && guidEl.getAttribute("isPermaLink") !== "false") link = guidText;
  if (!link && kind === "rdf") link = about;

  const descHtml = elementHtml(kid(el, "description", rssNs));
  const encodedHtml = elementHtml(kid(el, "encoded", NS.content));

  return finishItem(
    {
      guid: guidText || about,
      url: resolveUrl(link, itemBase),
      title: text(kid(el, "title", rssNs)),
      publisher: text(kid(el, "source", rssNs)),
      summaryHtml: descHtml || encodedHtml,
      image:
        mediaImage(el) ||
        rssEnclosureImage(el, rssNs) ||
        itunesImage(el) ||
        imageFromHtml(encodedHtml || descHtml, itemBase),
      author: cleanAuthor(
        text(kid(el, "creator", NS.dc)) || text(kid(el, "author", rssNs)) || text(kid(el, "author", NS.itunes))
      ),
      published: parseDate(
        text(kid(el, "pubDate", rssNs)) || text(kid(el, "date", NS.dc)) || text(kid(el, "date", rssNs))
      ),
    },
    itemBase
  );
}

function parseRss(root, feedUrl, kind) {
  const rssNs = kind === "rdf" ? NS.rss1 : null;
  const channel = kid(root, "channel", rssNs);
  if (!channel) throw new FeedError("The feed has no <channel> element.");
  const base = baseOf(channel, feedUrl);

  const siteRaw = resolveUrl(text(kid(channel, "link", rssNs)), base);
  const imgEl = kid(channel, "image", rssNs) || (kind === "rdf" ? kid(root, "image", rssNs) : null);
  const icon =
    (imgEl && resolveUrl(text(kid(imgEl, "url", rssNs)), base)) ||
    resolveUrl(itunesImage(channel), base) ||
    null;

  const itemEls = kind === "rdf" ? kids(root, "item", rssNs) : kids(channel, "item", rssNs);

  return {
    format: kind === "rdf" ? "rdf" : "rss",
    title: htmlToText(text(kid(channel, "title", rssNs))),
    description: htmlToText(text(kid(channel, "description", rssNs))),
    siteUrl: siteRaw && isHttpUrl(siteRaw) ? siteRaw : null,
    icon: icon && isHttpUrl(icon) ? icon : null,
    items: dedupe(itemEls.map((el) => parseRssItem(el, rssNs, base, kind))),
  };
}

// ---- Atom ------------------------------------------------------------------

function atomLinks(el, base) {
  return kids(el, "link", NS.atom)
    .map((l) => ({
      rel: (l.getAttribute("rel") || "alternate").toLowerCase(),
      type: (l.getAttribute("type") || "").toLowerCase(),
      href: resolveUrl(l.getAttribute("href"), baseOf(l, base)),
    }))
    .filter((l) => l.href);
}

function atomAlternate(links) {
  const alt =
    links.find((l) => l.rel === "alternate" && (!l.type || l.type.includes("html"))) ||
    links.find((l) => l.rel === "alternate");
  return alt ? alt.href : null;
}

function parseAtomEntry(el, base, feedAuthor) {
  const entryBase = baseOf(el, base);
  const links = atomLinks(el, entryBase);
  const id = text(kid(el, "id", NS.atom));
  const url = atomAlternate(links) || (isHttpUrl(id) ? id : null);

  const summaryHtml = elementHtml(kid(el, "summary", NS.atom));
  const contentEl = kid(el, "content", NS.atom);
  const contentHtml = contentEl && !contentEl.getAttribute("src") ? elementHtml(contentEl) : "";

  const enclosure = links.find((l) => l.rel === "enclosure" && l.type.startsWith("image/"));
  const authorName = text(kid(kid(el, "author", NS.atom), "name", NS.atom));

  return finishItem(
    {
      guid: id,
      url,
      title: elementHtml(kid(el, "title", NS.atom)),
      summaryHtml: summaryHtml || contentHtml,
      image: mediaImage(el) || (enclosure && enclosure.href) || imageFromHtml(contentHtml || summaryHtml, entryBase),
      author: authorName || text(kid(el, "creator", NS.dc)) || feedAuthor,
      published: parseDate(
        text(kid(el, "published", NS.atom)) || text(kid(el, "updated", NS.atom)) || text(kid(el, "date", NS.dc))
      ),
    },
    entryBase
  );
}

function parseAtom(root, feedUrl) {
  const base = baseOf(root, feedUrl);
  const links = atomLinks(root, base);
  const iconRaw = text(kid(root, "logo", NS.atom)) || text(kid(root, "icon", NS.atom));
  const icon = iconRaw ? resolveUrl(iconRaw, base) : null;
  const feedAuthor = text(kid(kid(root, "author", NS.atom), "name", NS.atom));
  const site = atomAlternate(links);

  return {
    format: "atom",
    title: htmlToText(elementHtml(kid(root, "title", NS.atom))),
    description: htmlToText(elementHtml(kid(root, "subtitle", NS.atom))),
    siteUrl: site && isHttpUrl(site) ? site : null,
    icon: icon && isHttpUrl(icon) ? icon : null,
    items: dedupe(kids(root, "entry", NS.atom).map((el) => parseAtomEntry(el, base, feedAuthor))),
  };
}

// ---- JSON Feed -------------------------------------------------------------

function parseJsonFeed(raw, feedUrl) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new FeedError("The response looks like JSON but could not be parsed.");
  }
  const isJsonFeed =
    data && Array.isArray(data.items) && (String(data.version || "").includes("jsonfeed") || data.title);
  if (!isJsonFeed) throw new FeedError("This JSON document is not a JSON Feed.");

  const feedAuthor = (data.authors && data.authors[0] && data.authors[0].name) || (data.author && data.author.name) || "";
  const items = data.items.map((it) => {
    const html = it.content_html || "";
    const plain = it.content_text || "";
    const attachmentImage =
      Array.isArray(it.attachments) &&
      it.attachments.find((a) => a && a.url && String(a.mime_type || "").startsWith("image/"));
    return finishItem(
      {
        guid: it.id != null ? String(it.id) : "",
        url: resolveUrl(it.url || it.external_url, feedUrl),
        title: it.title || "",
        summaryHtml: it.summary || (plain ? escapeHtml(plain) : html),
        image: it.image || it.banner_image || (attachmentImage && attachmentImage.url) || imageFromHtml(html, feedUrl),
        author: (it.authors && it.authors[0] && it.authors[0].name) || (it.author && it.author.name) || feedAuthor,
        published: parseDate(it.date_published || it.date_modified),
      },
      feedUrl
    );
  });

  const site = resolveUrl(data.home_page_url, feedUrl);
  const icon = resolveUrl(data.icon || data.favicon, feedUrl);
  return {
    format: "json",
    title: String(data.title || "").trim(),
    description: String(data.description || "").trim(),
    siteUrl: site && isHttpUrl(site) ? site : null,
    icon: icon && isHttpUrl(icon) ? icon : null,
    items: dedupe(items),
  };
}

// ---- XML parsing with repair ----------------------------------------------

const XML_ENTITIES = new Set(["amp", "lt", "gt", "quot", "apos"]);
const HTML_ENTITIES = {
  nbsp: 160, copy: 169, reg: 174, trade: 8482, hellip: 8230, mdash: 8212, ndash: 8211,
  lsquo: 8216, rsquo: 8217, ldquo: 8220, rdquo: 8221, laquo: 171, raquo: 187, bull: 8226,
  middot: 183, euro: 8364, pound: 163, yen: 165, cent: 162, deg: 176, times: 215,
  eacute: 233, egrave: 232, agrave: 224, uuml: 252, ouml: 246, auml: 228, szlig: 223,
};

function repairXml(src) {
  return src
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => {
      if (XML_ENTITIES.has(name)) return m;
      return HTML_ENTITIES[name] !== undefined ? `&#${HTML_ENTITIES[name]};` : `&amp;${name};`;
    })
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");
}

const hasParserError = (doc) => doc.getElementsByTagName("parsererror").length > 0;

function parseXml(src) {
  let doc = new DOMParser().parseFromString(src, "application/xml");
  if (!hasParserError(doc)) return doc;
  doc = new DOMParser().parseFromString(repairXml(src), "application/xml");
  if (!hasParserError(doc)) return doc;
  const detail = (doc.getElementsByTagName("parsererror")[0].textContent || "").trim().split("\n")[0];
  throw new FeedError(`The feed is not valid XML (${detail}).`);
}

// ---- Public API ------------------------------------------------------------

function isHtmlDocument(src) {
  const s = src.trimStart();
  if (/^<!doctype\s+html/i.test(s) || /^<html[\s>]/i.test(s)) return true;
  const head = s.slice(0, 1500);
  return s.startsWith("<") && /<html[\s>]/i.test(head) && !/<(rss|feed|rdf:RDF)[\s>]/i.test(head);
}

export function parseFeed(src, feedUrl) {
  const trimmed = String(src || "").replace(/^\uFEFF/, "").trimStart();
  if (!trimmed) throw new FeedError("The response was empty.", "empty");
  if (trimmed[0] === "{") return parseJsonFeed(trimmed, feedUrl);
  if (isHtmlDocument(trimmed)) throw new FeedError("This URL returned a web page, not a feed.", "html");

  const doc = parseXml(trimmed);
  const root = doc.documentElement;
  switch (root.localName.toLowerCase()) {
    case "rss":
      return parseRss(root, feedUrl, "rss");
    case "rdf":
      return parseRss(root, feedUrl, "rdf");
    case "feed":
      return parseAtom(root, feedUrl);
    default:
      throw new FeedError(`Unsupported document type <${root.localName}>.`);
  }
}