// IndexedDB: article cache and reader (full-article) cache.
import { duplicateFilter } from "./dedupe.js";

const DB_NAME = "pro-rss-reader";
const DB_VERSION = 1;
const DAY_MS = 86_400_000;

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("articles")) {
          const s = db.createObjectStore("articles", { keyPath: "id" });
          s.createIndex("feedId", "feedId");
          s.createIndex("date", "date");
          s.createIndex("feedId_date", ["feedId", "date"]);
        }
        if (!db.objectStoreNames.contains("reader")) {
          const s = db.createObjectStore("reader", { keyPath: "url" });
          s.createIndex("fetched", "fetched");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Walks a cursor request; fn(cursor) returns false to stop early.
function walk(cursorRequest, fn) {
  return new Promise((resolve, reject) => {
    cursorRequest.onerror = () => reject(cursorRequest.error);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return resolve();
      if (fn(cursor) === false) return resolve();
      cursor.continue();
    };
  });
}

// ---- Articles --------------------------------------------------------------

export async function putArticles(articles) {
  if (!articles.length) return;
  const db = await openDb();
  const tx = db.transaction("articles", "readwrite");
  const store = tx.objectStore("articles");
  for (const a of articles) store.put(a);
  await txDone(tx);
}

export async function getArticlesByFeed(feedId) {
  const db = await openDb();
  return request(
    db.transaction("articles").objectStore("articles").index("feedId").getAll(IDBKeyRange.only(feedId))
  );
}

// Newest first. feedIds: array of feed ids, or null for every feed.
export async function getArticles({ feedIds = null, limit = 200, offset = 0 } = {}) {
  const db = await openDb();
  const wanted = feedIds ? new Set(feedIds) : null;
  const isDuplicate = duplicateFilter();
  const out = [];
  let skipped = 0;
  const cursorReq = db.transaction("articles").objectStore("articles").index("date").openCursor(null, "prev");
  await walk(cursorReq, (cursor) => {
    const a = cursor.value;
    if (wanted && !wanted.has(a.feedId)) return true;
    if (isDuplicate(a)) return true;
    if (skipped < offset) {
      skipped++;
      return true;
    }
    out.push(a);
    return out.length < limit;
  });
  return out;
}

export async function deleteArticlesByFeed(feedId) {
  const db = await openDb();
  const tx = db.transaction("articles", "readwrite");
  const store = tx.objectStore("articles");
  const keys = await request(store.index("feedId").getAllKeys(IDBKeyRange.only(feedId)));
  for (const k of keys) store.delete(k);
  await txDone(tx);
}

export async function countArticlesByFeed() {
  const db = await openDb();
  const counts = new Map();
  const cursorReq = db.transaction("articles").objectStore("articles").index("feedId").openKeyCursor();
  await walk(cursorReq, (cursor) => {
    counts.set(cursor.key, (counts.get(cursor.key) || 0) + 1);
    return true;
  });
  return counts;
}

export async function pruneArticles(feedIds, { maxPerFeed, days }) {
  const db = await openDb();
  const cutoff = Date.now() - days * DAY_MS;
  const known = new Set(feedIds);
  const tx = db.transaction("articles", "readwrite");
  const store = tx.objectStore("articles");

  const jobs = feedIds.map((feedId) => {
    let kept = 0;
    const range = IDBKeyRange.bound([feedId, 0], [feedId, Infinity]);
    return walk(store.index("feedId_date").openCursor(range, "prev"), (cursor) => {
      kept++;
      if (kept > maxPerFeed || cursor.value.fetched < cutoff) cursor.delete();
      return true;
    });
  });

  jobs.push(
    walk(store.index("feedId").openCursor(), (cursor) => {
      if (!known.has(cursor.value.feedId)) cursor.delete();
      return true;
    })
  );

  await Promise.all(jobs);
  await txDone(tx);
}

// ---- Reader cache (full article results) -----------------------------------

export async function getReaderCache(url) {
  const db = await openDb();
  return (await request(db.transaction("reader").objectStore("reader").get(url))) || null;
}

export async function putReaderCache(entry) {
  const db = await openDb();
  const tx = db.transaction("reader", "readwrite");
  tx.objectStore("reader").put({ ...entry, fetched: entry.fetched || Date.now() });
  await txDone(tx);
}

export async function pruneReaderCache(days) {
  const db = await openDb();
  const tx = db.transaction("reader", "readwrite");
  const range = IDBKeyRange.upperBound(Date.now() - days * DAY_MS);
  await walk(tx.objectStore("reader").index("fetched").openCursor(range), (cursor) => {
    cursor.delete();
    return true;
  });
  await txDone(tx);
}
