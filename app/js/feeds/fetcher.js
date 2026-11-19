// Privacy-first fetch helpers: no cookies, no referrer, no third-party hosts.
// Extension pages with host permissions bypass CORS, so this reaches any site directly.

const DEFAULT_TIMEOUT = 20_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

const ACCEPT_FEED =
  "application/rss+xml, application/atom+xml, application/feed+json, application/json, " +
  "application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5";

export class FetchError extends Error {
  constructor(message, code = "network", status = 0) {
    super(message);
    this.name = "FetchError";
    this.code = code; // "http" | "timeout" | "network" | "toolarge" | "url"
    this.status = status;
  }
}

async function run(url, opts, read) {
  try {
    new URL(url);
  } catch {
    throw new FetchError(`Invalid URL: ${url}`, "url");
  }

  const {
    method = "GET",
    headers = {},
    body,
    timeout = DEFAULT_TIMEOUT,
    accept = ACCEPT_FEED,
    maxBytes = DEFAULT_MAX_BYTES,
  } = opts;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  try {
    const res = await fetch(url, {
      method,
      body,
      headers: { Accept: accept, ...headers },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "follow",
      cache: "no-cache",
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new FetchError(`HTTP ${res.status}${res.statusText ? " " + res.statusText : ""}`, "http", res.status);
    }
    return await read(res, maxBytes);
  } catch (err) {
    if (err instanceof FetchError) throw err;
    if (err && err.name === "AbortError") {
      throw new FetchError(`Timed out after ${Math.round(timeout / 1000)}s`, "timeout");
    }
    throw new FetchError("Network error: the site could not be reached (offline, blocked or invalid address)", "network");
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(res, maxBytes) {
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    throw new FetchError(`Response too large (${(declared / 1048576).toFixed(1)} MB)`, "toolarge");
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      reader.cancel();
      throw new FetchError(`Response too large (over ${(maxBytes / 1048576).toFixed(0)} MB)`, "toolarge");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function detectCharset(contentType, bytes) {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  }
  const header = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType || "");
  if (header) return header[1];

  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  const xml = /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head);
  if (xml) return xml[1];
  const meta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head);
  if (meta) return meta[1];
  return "utf-8";
}

function decodeBody(bytes, contentType = "") {
  const label = detectCharset(contentType, bytes);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// -> { text, url (final, after redirects), contentType, status }
export function fetchText(url, opts = {}) {
  return run(url, opts, async (res, maxBytes) => {
    const bytes = await readBody(res, maxBytes);
    const contentType = res.headers.get("content-type") || "";
    return { text: decodeBody(bytes, contentType), url: res.url || url, contentType, status: res.status };
  });
}

export async function fetchJson(url, opts = {}) {
  const r = await fetchText(url, { accept: "application/json, */*;q=0.5", ...opts });
  try {
    return { ...r, json: JSON.parse(r.text) };
  } catch {
    throw new FetchError("The response was not valid JSON", "invalid");
  }
}

// -> { blob, url, contentType }
export function fetchBlob(url, opts = {}) {
  return run(url, { maxBytes: 2 * 1024 * 1024, accept: "image/*,*/*;q=0.5", ...opts }, async (res, maxBytes) => {
    const bytes = await readBody(res, maxBytes);
    const contentType = (res.headers.get("content-type") || "").split(";")[0].trim();
    return { blob: new Blob([bytes], { type: contentType }), url: res.url || url, contentType };
  });
}