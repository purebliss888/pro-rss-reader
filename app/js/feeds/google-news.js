// Resolves Google News article links (news.google.com/rss/articles/...) to the
// publisher's real URL, so Readability can fetch the actual article.
//
// Order of attempts:
//   1. Decode the address from the link itself (older links)    - no network
//   2. Ask Google's own endpoint, from the extension            - no tab, no cookies
//   3. Open the link in a background tab, wait for Google's redirect to the
//      publisher, then close the tab.

import { fetchText } from "./fetcher.js";
import { isHttpUrl } from "../core/utils.js";
import { getSettings } from "../core/settings.js";

class GoogleNewsError extends Error {
  constructor(message, code = "failed") {
    super(message);
    this.name = "GoogleNewsError";
    this.code = code; // "failed" | "consent"
  }
}

const ARTICLE_ID = /\/articles\/([^/?#]+)/;
const cache = new Map();

export function isGoogleNewsUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === "news.google.com" && ARTICLE_ID.test(u.pathname);
  } catch {
    return false;
  }
}

const isGoogleHost = (host) => /(^|\.)google\.[a-z.]+$/i.test(host) || /(^|\.)gstatic\.com$/i.test(host);

// ---- 1. Local decoding -----------------------------------------------------

function base64UrlToBytes(id) {
  const b64 = id.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// Legacy format: 0x08 0x13 0x22 <varint length> <url> 0xd2 0x01 0x00
function decodeLegacy(id) {
  let bytes;
  try {
    bytes = base64UrlToBytes(id);
  } catch {
    return null;
  }
  if (bytes[0] === 0x08 && bytes[1] === 0x13 && bytes[2] === 0x22) bytes = bytes.subarray(3);
  const n = bytes.length;
  if (n >= 3 && bytes[n - 3] === 0xd2 && bytes[n - 2] === 0x01 && bytes[n - 1] === 0x00) {
    bytes = bytes.subarray(0, n - 3);
  }
  if (!bytes.length) return null;

  let length = bytes[0];
  let start = 1;
  if (length >= 0x80) {
    length = (bytes[0] & 0x7f) | (bytes[1] << 7);
    start = 2;
  }
  const decoded = new TextDecoder().decode(bytes.subarray(start, start + length));
  if (decoded.startsWith("AU_yqL")) return null; // new format, needs Google's endpoint
  return isHttpUrl(decoded) ? decoded : null;
}

// ---- 2. Google's endpoint --------------------------------------------------

async function resolveViaGoogle(id) {
  const pageUrl = `https://news.google.com/rss/articles/${id}?hl=en-US&gl=US&ceid=US:en`;
  const page = await fetchText(pageUrl, { accept: "text/html,*/*;q=0.5", timeout: 15_000, maxBytes: 2_000_000 });

  if (/(^|\.)consent\.google\./i.test(new URL(page.url).hostname)) {
    throw new GoogleNewsError("Google showed a cookie-consent page instead of the article link.", "consent");
  }
  const doc = new DOMParser().parseFromString(page.text, "text/html");
  const el = doc.querySelector("[data-n-a-sg][data-n-a-ts]");
  if (!el) throw new GoogleNewsError("Google News page was not in the expected format.");

  const signature = el.getAttribute("data-n-a-sg");
  const timestamp = Number(el.getAttribute("data-n-a-ts"));

  const inner = JSON.stringify([
    "garturlreq",
    [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id,
    timestamp,
    signature,
  ]);
  const body = new URLSearchParams({ "f.req": JSON.stringify([[["Fbv4je", inner, null, "generic"]]]) }).toString();

  const res = await fetchText("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    accept: "*/*",
    timeout: 15_000,
  });

  try {
    const outer = JSON.parse(res.text.split("\n\n")[1]);
    const row = outer.find((e) => Array.isArray(e) && e[0] === "wrb.fr");
    const url = JSON.parse(row[2])[1];
    if (isHttpUrl(url)) return url;
  } catch {
    // fall through
  }
  throw new GoogleNewsError("Could not read the article address from Google's response.");
}

// ---- 3. Background tab fallback --------------------------------------------

let tabChain = Promise.resolve();
function queueTab(task) {
  const run = tabChain.then(task, task);
  tabChain = run.catch(() => {});
  return run;
}

function resolveByTab(url, timeout = 25_000) {
  return queueTab(async () => {
    const tab = await browser.tabs.create({ url, active: false });
    return new Promise((resolve, reject) => {
      let finished = false;
      let lastHost = "";
      let timer = null;

      const finish = (err, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(listener);
        browser.tabs.remove(tab.id).catch(() => {});
        if (err) reject(err);
        else resolve(value);
      };
      const check = (u) => {
        if (!u || !isHttpUrl(u)) return;
        const host = new URL(u).hostname;
        lastHost = host;
        if (!isGoogleHost(host)) finish(null, u);
      };
      const listener = (tabId, changeInfo, t) => {
        if (tabId === tab.id) check(changeInfo.url || (t && t.url));
      };

      timer = setTimeout(() => {
        finish(
          lastHost.startsWith("consent.")
            ? new GoogleNewsError(
                "Google is asking for cookie consent. Open news.google.com once in Firefox, accept, then try again.",
                "consent"
              )
            : new GoogleNewsError("Timed out waiting for Google News to redirect to the article.")
        );
      }, timeout);

      browser.tabs.onUpdated.addListener(listener);
      browser.tabs.get(tab.id).then((t) => check(t.url)).catch(() => {
        finish(new GoogleNewsError("The helper tab was closed before the redirect finished."));
      });
    });
  });
}

// ---- Public API ------------------------------------------------------------

export async function resolveGoogleNewsUrl(url) {
  if (cache.has(url)) return cache.get(url);
  const match = ARTICLE_ID.exec(new URL(url).pathname);
  if (!match) throw new GoogleNewsError("Not a Google News article link.");
  const id = match[1];

  let target = decodeLegacy(id);
  if (!target) {
    try {
      target = await resolveViaGoogle(id);
    } catch (err) {
      const { googleNewsTabFallback } = await getSettings();
      if (!googleNewsTabFallback) throw err;
      try {
        target = await resolveByTab(url);
      } catch (tabErr) {
        throw tabErr.code === "consent" || !(err instanceof GoogleNewsError) ? tabErr : err;
      }
    }
  }
  cache.set(url, target);
  return target;
}