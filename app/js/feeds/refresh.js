import { updateFeeds } from "../core/storage.js";
import { logger, serializeError } from "../core/logger.js";
import { errorMessage } from "../core/utils.js";
import { loadFeed } from "./feed-loader.js";
import { pruneAll, storeItems } from "./articles.js";

const FLUSH_EVERY = 25; // feed records saved after this many feeds finish
const inflight = new Map(); // feedId -> Promise

// ---- Activity: drives the refresh button's spinner ----

const listeners = new Set();
let active = 0;

// cb(busy: boolean) is called when the app starts or stops loading feeds.
export function onRefreshActivity(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// -> end(): call it when the work is done (calling it twice is harmless)
export function beginRefreshActivity() {
  active++;
  if (active === 1) listeners.forEach((cb) => cb(true));
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    active--;
    if (active === 0) listeners.forEach((cb) => cb(false));
  };
}

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---- Saving feed records ----

// patches: [{ id, patch }] -> one write for all of them
async function applyPatches(patches) {
  if (!patches.length) return;
  const byId = new Map(patches.map((p) => [p.id, p.patch]));
  await updateFeeds((list) => list.map((f) => (byId.has(f.id) ? { ...f, ...byId.get(f.id) } : f)));
}

// -> { feed, ok, count, patch } | { feed, ok: false, error, patch }
async function doRefresh(feed) {
  try {
    const r = await loadFeed(feed.url);
    await storeItems(feed.id, r.feed.items, { prune: false });
    return {
      feed,
      ok: true,
      count: r.feed.items.length,
      patch: {
        id: feed.id,
        patch: {
          type: r.feed.format,
          lastFetched: Date.now(),
          lastError: null,
          // a WordPress /feed that fell back to the REST API: use that address from now on
          ...(r.fallbackFrom ? { url: r.url } : {}),
        },
      },
    };
  } catch (err) {
    const message = errorMessage(err);
    await logger.error("refresh", `${feed.name}: ${message}`, {
      feedId: feed.id,
      url: feed.url,
      code: (err && err.code) || null,
      status: (err && err.status) || null,
      error: serializeError(err),
    });
    return { feed, ok: false, error: message, patch: { id: feed.id, patch: { lastError: message } } };
  }
}

function refreshOne(feed) {
  if (inflight.has(feed.id)) return inflight.get(feed.id);
  const promise = doRefresh(feed).finally(() => inflight.delete(feed.id));
  inflight.set(feed.id, promise);
  return promise;
}

// -> [{ feed, ok, count } | { feed, ok: false, error }]
export async function refreshFeeds(feeds, { concurrency = 4 } = {}) {
  const end = beginRefreshActivity();
  try {
    const results = new Array(feeds.length);
    let pending = [];
    let next = 0;

    const flush = async () => {
      const batch = pending;
      pending = [];
      try {
        await applyPatches(batch);
      } catch (err) {
        await logger.warn("refresh", "Could not save feed status", err);
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, feeds.length) }, async () => {
      while (next < feeds.length) {
        const i = next++;
        const result = await refreshOne(feeds[i]);
        results[i] = result;
        pending.push(result.patch);
        if (pending.length >= FLUSH_EVERY) await flush();
        await yieldToBrowser(); // let the page draw and respond to clicks
      }
    });
    await Promise.all(workers);
    await flush();

    try {
      await pruneAll();
    } catch (err) {
      await logger.warn("refresh", "Could not apply cache limits", err);
    }
    return results;
  } finally {
    end();
  }
}