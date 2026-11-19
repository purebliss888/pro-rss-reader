// One entry point for loading any feed: fetch, detect the format, parse.
// Handles RSS / Atom / RDF / JSON Feed (via parser.js) and WordPress REST API
// responses, and falls back to the WordPress REST API when a WordPress /feed
// URL fails.

import { fetchJson, fetchText, FetchError } from "./fetcher.js";
import { FeedError, dedupe, finishItem, imageFromHtml, parseDate, parseFeed } from "./parser.js";

const WP_PER_PAGE = 30;

export function wpPostsUrl(base) {
  return `${base.replace(/\/+$/, "")}/wp-json/wp/v2/posts?_embed=1&per_page=${WP_PER_PAGE}`;
}

// Works on sites where pretty permalinks (and therefore /wp-json/) are unavailable.
export function wpPostsAltUrl(base) {
  return `${base.replace(/\/+$/, "")}/?rest_route=/wp/v2/posts&_embed=1&per_page=${WP_PER_PAGE}`;
}

function isWpRestUrl(url) {
  try {
    const u = new URL(url);
    return (
      /\/wp-json\/wp\/v2\/posts\/?$/i.test(u.pathname) ||
      /^\/wp\/v2\/posts/i.test(u.searchParams.get("rest_route") || "")
    );
  } catch {
    return false;
  }
}

function isWpPosts(json) {
  if (!Array.isArray(json)) return false;
  if (!json.length) return true;
  const p = json[0];
  return !!p && typeof p === "object" && "link" in p && p.title !== undefined;
}

// ---- WordPress parsing -----------------------------------------------------

function wpImage(post) {
  const embedded = post._embedded;
  const media = embedded && embedded["wp:featuredmedia"] && embedded["wp:featuredmedia"][0];
  if (media && !media.code) {
    const sizes = media.media_details && media.media_details.sizes;
    const pick = sizes && (sizes.medium_large || sizes.large || sizes.full);
    return (pick && pick.source_url) || media.source_url || null;
  }
  return null;
}

function wpAuthor(post) {
  const a = post._embedded && post._embedded.author && post._embedded.author[0];
  return a && !a.code && a.name ? String(a.name) : "";
}

function wpDate(post) {
  const gmt = post.date_gmt;
  if (!gmt) return parseDate(post.date);
  return parseDate(/[zZ]|[+-]\d\d:?\d\d$/.test(gmt) ? gmt : gmt + "Z");
}

function parseWpPosts(posts, feedUrl, meta) {
  const items = posts.map((p) => {
    const content = (p.content && p.content.rendered) || "";
    const excerpt = (p.excerpt && p.excerpt.rendered) || "";
    return finishItem(
      {
        guid: p.link || (p.id != null ? `wp:${p.id}` : ""),
        url: p.link,
        title: (p.title && p.title.rendered) || "",
        summaryHtml: excerpt || content,
        image: wpImage(p) || imageFromHtml(content, p.link || feedUrl),
        author: wpAuthor(p),
        published: wpDate(p),
      },
      p.link || feedUrl
    );
  });

  const first = posts.find((p) => p && p.link);
  let siteUrl = (meta && (meta.home || meta.url)) || "";
  if (!siteUrl && first) {
    try {
      siteUrl = new URL(first.link).origin;
    } catch {
      siteUrl = "";
    }
  }

  return {
    format: "wp-json",
    title: (meta && meta.name) || "",
    description: (meta && meta.description) || "",
    siteUrl: siteUrl || null,
    icon: null,
    items: dedupe(items),
  };
}

async function fetchWpSiteMeta(restUrl) {
  try {
    const u = new URL(restUrl);
    const idx = u.pathname.indexOf("/wp-json");
    const base = u.origin + (idx >= 0 ? u.pathname.slice(0, idx) : u.pathname.replace(/\/$/, ""));
    for (const candidate of [`${base}/wp-json/`, `${base}/?rest_route=/`]) {
      try {
        const { json } = await fetchJson(candidate, { timeout: 6000 });
        if (json && typeof json === "object" && json.name) return json;
      } catch {
        // try the next one
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function wpFromText(text, url, opts) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new FeedError("The WordPress API did not return valid JSON.");
  }
  if (!isWpPosts(json)) throw new FeedError("This is not a WordPress posts response.");
  const meta = opts.meta ? await fetchWpSiteMeta(url) : null;
  return { feed: parseWpPosts(json, url, meta), url, kind: "wp-json" };
}

// ---- Loading ---------------------------------------------------------------

async function loadDirect(url, opts) {
  const res = await fetchText(url, { timeout: opts.timeout });
  const head = res.text.replace(/^\uFEFF/, "").trimStart();
  if (head[0] === "[") return wpFromText(head, res.url, opts);
  const feed = parseFeed(head, res.url);
  return { feed, url: res.url, kind: feed.format };
}

// A WordPress /feed (or ?feed=) URL that is not a comments feed -> bases to try.
function wpFallbackBases(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  if (isWpRestUrl(url)) return [];
  if (/comment/i.test(u.pathname) || /comment/i.test(u.search)) return [];
  const tail = /\/(feed|rss)(\/(atom|rdf|rss2?))?\/?$/i;
  if (!tail.test(u.pathname) && !u.searchParams.has("feed")) return [];
  const prefix = u.pathname.replace(tail, "").replace(/\/$/, "");
  const bases = [u.origin + prefix];
  if (prefix) bases.push(u.origin);
  return bases;
}

// -> { feed, url (final), kind: "rss"|"atom"|"rdf"|"json"|"wp-json", fallbackFrom? }
// opts: { timeout, meta (fetch WordPress site title), wpFallback }
export async function loadFeed(url, opts = {}) {
  const o = { timeout: 20_000, meta: false, wpFallback: true, ...opts };
  try {
    return await loadDirect(url, o);
  } catch (err) {
    const retryable = err instanceof FeedError || (err instanceof FetchError && err.code === "http");
    if (o.wpFallback && retryable) {
      for (const base of wpFallbackBases(url)) {
        for (const candidate of [wpPostsUrl(base), wpPostsAltUrl(base)]) {
          try {
            const res = await fetchText(candidate, { timeout: o.timeout });
            const result = await wpFromText(res.text.trimStart(), res.url, o);
            result.fallbackFrom = url;
            return result;
          } catch {
            // try the next candidate
          }
        }
      }
    }
    throw err;
  }
}