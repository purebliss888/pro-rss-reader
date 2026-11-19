import { fetchBlob, fetchText } from "./fetcher.js";
import { isHttpUrl, resolveUrl } from "../core/utils.js";

const MAX_STORED_BYTES = 150 * 1024;
const DOWNSCALE_ABOVE = 40 * 1024;
const MAX_CANDIDATES = 4;

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function scoreLink(link) {
  const href = link.getAttribute("href") || "";
  const size = parseInt((link.getAttribute("sizes") || "").split(/[x\s]/i)[0], 10);
  if (/\.svg(?:[?#]|$)/i.test(href) || (link.getAttribute("type") || "").includes("svg")) return 300;
  if (!size) return 100;
  return size >= 32 ? 200 - Math.abs(size - 64) / 2 : 50 + size;
}

function iconLinksFromHtml(html, base) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const links = [...doc.querySelectorAll("link[rel][href]")].filter((l) =>
    /(^|\s)(icon|shortcut|apple-touch-icon(-precomposed)?)(\s|$)/i.test(l.getAttribute("rel"))
  );
  return links
    .sort((a, b) => scoreLink(b) - scoreLink(a))
    .map((l) => resolveUrl(l.getAttribute("href"), base))
    .filter((u) => u && isHttpUrl(u));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function downscale(blob, size = 64) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    if (typeof OffscreenCanvas !== "undefined") {
      const c = new OffscreenCanvas(w, h);
      c.getContext("2d").drawImage(bmp, 0, 0, w, h);
      return await c.convertToBlob({ type: "image/png" });
    }
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    return await new Promise((res) => c.toBlob(res, "image/png"));
  } catch {
    return null;
  }
}

async function iconToDataUrl(url) {
  const { blob, contentType, url: finalUrl } = await fetchBlob(url, { timeout: 8000 });
  let type = (contentType || blob.type || "").toLowerCase();
  if (!type.startsWith("image/")) {
    if (/\.ico(?:[?#]|$)/i.test(finalUrl)) type = "image/x-icon";
    else if (/\.png(?:[?#]|$)/i.test(finalUrl)) type = "image/png";
    else throw new Error("Not an image");
  }
  if (!blob.size) throw new Error("Empty image");

  let out = blob.type === type ? blob : blob.slice(0, blob.size, type);
  if (out.size > DOWNSCALE_ABOVE && type !== "image/svg+xml") {
    out = (await downscale(out)) || out;
  }
  if (out.size > MAX_STORED_BYTES) throw new Error("Icon too large");
  return blobToDataUrl(out);
}

// opts.feedIcon: icon URL declared by the feed. opts.html: site HTML if already fetched.
export async function getFavicon(siteUrl, { feedIcon = null, html = null } = {}) {
  const candidates = [];
  const origin = originOf(siteUrl);

  if (origin) {
    let page = html;
    if (page == null) {
      try {
        page = (await fetchText(siteUrl, { timeout: 10_000, maxBytes: 1_500_000, accept: "text/html,*/*;q=0.5" })).text;
      } catch {
        page = "";
      }
    }
    if (page) candidates.push(...iconLinksFromHtml(page, siteUrl));
    candidates.push(`${origin}/favicon.ico`);
  }
  if (feedIcon && isHttpUrl(feedIcon)) candidates.push(feedIcon);

  for (const url of [...new Set(candidates)].slice(0, MAX_CANDIDATES)) {
    try {
      return await iconToDataUrl(url);
    } catch {
      // try the next option
    }
  }
  return null;
}