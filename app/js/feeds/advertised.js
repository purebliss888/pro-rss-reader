// Feeds a web page advertises through <link rel="alternate"> tags, grouped so the same feed
// offered in several formats (RSS and JSON, for example) counts once.

// IMPORTANT: this function is serialised and injected into the page with
// scripting.executeScript({ func }), so it must stay self-contained: no imports,
// no references to anything outside its own body.
export function readFeedLinks() {
  const TYPES = {
    "application/rss+xml": "rss",
    "application/atom+xml": "atom",
    "application/rdf+xml": "rdf",
    "application/feed+json": "json",
    "application/json": "json",
    "application/xml": "xml",
    "text/xml": "xml",
  };
  const FEEDISH = /(^|[/._-])(rss|atom|feed|feeds)([/._?#-]|$)|\.(rss|atom|xml|json)([?#]|$)|[?&]feed=/i;
  const STRONG = new Set(["rss", "atom", "rdf"]);
  const links = [];
  const seen = new Set();

  for (const l of document.querySelectorAll("link[href]")) {
    const rel = (l.getAttribute("rel") || "").toLowerCase().split(/\s+/);
    if (!rel.includes("alternate") && !rel.includes("feed")) continue;
    let href;
    try {
      href = new URL(l.getAttribute("href"), document.baseURI).href;
    } catch {
      continue;
    }
    if (!/^https?:/i.test(href) || seen.has(href)) continue;
    const mime = (l.getAttribute("type") || "").toLowerCase().split(";")[0].trim();
    const type = TYPES[mime];
    if (!type) continue;
    const title = (l.getAttribute("title") || "").trim();
    if (/oembed/i.test(mime) || /oembed/i.test(href)) continue;
    if (/\/wp-json\/wp\/v2\/(pages|posts|media)\/\d+/.test(href)) continue;
    // Generic types only count when the address or title looks like a feed
    if (!STRONG.has(type) && mime !== "application/feed+json" && !(FEEDISH.test(href) || /feed|rss|atom/i.test(title))) continue;
    seen.add(href);
    links.push({ url: href, type: type === "xml" ? "rss" : type, title });
  }
  return { url: document.baseURI, title: (document.title || "").trim(), links };
}

// ---- Grouping ----

const FORMAT_ORDER = { rss: 0, atom: 1, rdf: 2, json: 3 };
const family = (t) => (t === "json" ? "json" : "xml");

function titleKey(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\b(rss|atom|rdf|json\s*feed|json|xml|feed)\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function stemKey(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\.(xml|rss|atom|rdf|json)$/i, "").replace(/\/+$/, "");
    u.searchParams.delete("format");
    u.searchParams.delete("type");
    const q = [...u.searchParams.entries()].map(([k, v]) => `${k}=${v}`).sort().join("&");
    return `${u.hostname.replace(/^www\./, "")}${path}${q ? "?" + q : ""}`.toLowerCase();
  } catch {
    return url;
  }
}

const isComments = (l) => /comment/i.test(l.url) || /comment/i.test(l.title || "");

export function groupAdvertised(links) {
  const groups = [];
  for (const link of links || []) {
    const tk = titleKey(link.title);
    const sk = stemKey(link.url);
    // Same feed in another format: a different format family with the same title or address stem
    const match = groups.find(
      (g) => !g.members.some((m) => family(m.type) === family(link.type)) && ((tk && g.tk === tk) || g.sk === sk)
    );
    if (match) match.members.push(link);
    else groups.push({ tk, sk, members: [link] });
  }

  return groups
    .map((g) => {
      const members = [...g.members].sort((a, b) => (FORMAT_ORDER[a.type] ?? 9) - (FORMAT_ORDER[b.type] ?? 9));
      const best = members[0];
      return {
        url: best.url,
        type: best.type,
        title: best.title || (members.find((m) => m.title) || {}).title || "",
        formats: members.map((m) => ({ url: m.url, type: m.type })),
        isComments: members.every(isComments),
      };
    })
    .sort((a, b) => Number(a.isComments) - Number(b.isComments));
}
