// Allow-list HTML sanitizer for article content.

const DROP = new Set([
  "script", "style", "noscript", "template", "object", "embed", "applet", "link", "meta", "base",
  "form", "input", "select", "textarea", "button", "svg", "math", "canvas", "audio", "video",
  "frame", "frameset", "head", "title", "dialog", "slot",
]);

const ALLOWED = new Set([
  "a", "abbr", "article", "aside", "b", "blockquote", "br", "caption", "cite", "code", "dd", "del",
  "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "footer", "h1", "h2", "h3",
  "h4", "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "picture",
  "pre", "q", "s", "samp", "section", "small", "source", "span", "strong", "sub", "summary", "sup",
  "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u", "ul", "var",
]);

const ATTRS = {
  a: ["title"],
  img: ["alt", "title", "sizes"],
  source: ["sizes", "media", "type"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan", "scope"],
  ol: ["start"],
  time: ["datetime"],
  abbr: ["title"],
};

const MAX_DEPTH = 150;
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+$/i;

function safeUrl(value, baseUrl, { mailto = false, dataImage = false } = {}) {
  const v = String(value || "").trim();
  if (!v) return null;
  if (dataImage && DATA_IMAGE.test(v)) return v;
  let u;
  try {
    u = new URL(v, baseUrl);
  } catch {
    return null;
  }
  if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  if (mailto && u.protocol === "mailto:") return u.href;
  return null;
}

function safeSrcset(value, baseUrl) {
  const out = [];
  for (const candidate of String(value || "").split(/,\s+/)) {
    const [url, descriptor] = candidate.trim().split(/\s+/);
    const safe = safeUrl(url, baseUrl);
    if (safe) out.push(descriptor && /^\d+(?:\.\d+)?[wx]$/.test(descriptor) ? `${safe} ${descriptor}` : safe);
  }
  return out.join(", ");
}

function copyAttrs(src, el, tag, baseUrl) {
  for (const name of ATTRS[tag] || []) {
    const v = src.getAttribute(name);
    if (v != null && v !== "") el.setAttribute(name, v);
  }
  if (src.hasAttribute("lang")) el.setAttribute("lang", src.getAttribute("lang"));

  if (tag === "a") {
    const href = (src.getAttribute("href") || "").trim();
    const safe = href.startsWith("#") ? null : safeUrl(href, baseUrl, { mailto: true });
    if (!safe) return false; // a link without a usable address is unwrapped
    el.setAttribute("href", safe);
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noopener noreferrer");
  }

  if (tag === "img") {
    const srcAttr = safeUrl(src.getAttribute("src"), baseUrl, { dataImage: true });
    const srcset = safeSrcset(src.getAttribute("srcset"), baseUrl);
    if (!srcAttr && !srcset) return false;
    if (srcAttr) el.setAttribute("src", srcAttr);
    if (srcset) el.setAttribute("srcset", srcset);
    el.setAttribute("loading", "lazy");
    el.setAttribute("decoding", "async");
    el.setAttribute("referrerpolicy", "no-referrer");
  }

  if (tag === "source") {
    const srcset = safeSrcset(src.getAttribute("srcset"), baseUrl);
    if (!srcset) return false;
    el.setAttribute("srcset", srcset);
  }
  return true;
}

function walk(node, out, baseUrl, depth) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      out.append(document.createTextNode(child.nodeValue));
      continue;
    }
    if (child.nodeType !== 1) continue; // comments, processing instructions

    const tag = child.localName.toLowerCase();

    if (tag === "iframe") {
      const src = safeUrl(child.getAttribute("src"), baseUrl);
      if (src) {
        const p = document.createElement("p");
        const a = document.createElement("a");
        a.href = src;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "Open embedded content";
        p.append(a);
        out.append(p);
      }
      continue;
    }
    if (DROP.has(tag)) continue;

    if (depth > MAX_DEPTH) {
      out.append(document.createTextNode(child.textContent || ""));
      continue;
    }
    if (!ALLOWED.has(tag)) {
      walk(child, out, baseUrl, depth + 1); // unknown tag: keep its content, lose the tag
      continue;
    }

    const el = document.createElement(tag);
    if (!copyAttrs(child, el, tag, baseUrl)) {
      if (tag === "a") walk(child, out, baseUrl, depth + 1);
      continue; // img / source without a usable address are dropped
    }
    if (tag !== "img" && tag !== "br" && tag !== "hr" && tag !== "source") walk(child, el, baseUrl, depth + 1);
    out.append(el);
  }
}

// html: untrusted markup. baseUrl: used to resolve relative addresses.
// -> DocumentFragment owned by this document.
export function sanitizeHtml(html, baseUrl) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html"); // inert: nothing loads or runs
  const frag = document.createDocumentFragment();
  walk(doc.body, frag, baseUrl, 0);
  return frag;
}

export function serializeFragment(frag) {
  const holder = document.createElement("div");
  holder.append(frag);
  return holder.innerHTML;
}