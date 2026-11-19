// ---- Duplicate articles ----

const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|igshid$|ref$|ref_src$|cmpid$)/i;
const MIN_TITLE_KEY = 20;

function urlKey(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    return u.hostname.toLowerCase().replace(/^www\./, "") + u.pathname.replace(/\/+$/, "") + u.search;
  } catch {
    return String(url);
  }
}

function titleKey(title) {
  const key = String(title || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return key.length >= MIN_TITLE_KEY ? key : "";
}

// Returns a function: isDuplicate(article) -> boolean. Feed it articles newest first.
export function duplicateFilter() {
  const urls = new Set();
  const titles = new Map(); // title key -> feedId that has it
  return (a) => {
    const uk = urlKey(a.url);
    const tk = titleKey(a.title);
    const dup = (uk && urls.has(uk)) || (tk && titles.has(tk) && titles.get(tk) !== a.feedId);
    if (!dup) {
      if (uk) urls.add(uk);
      if (tk && !titles.has(tk)) titles.set(tk, a.feedId);
    }
    return dup;
  };
}