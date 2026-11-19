// Thin wrapper over browser.storage.local with per-key write queues, so
// concurrent read-modify-write operations (parallel feed refreshes, for
// example) can't overwrite each other.

const queues = new Map();

function enqueue(key, task) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(task);
  queues.set(key, next.catch(() => {})); // keep the chain alive after failures
  return next;
}

export async function getKey(key, fallback = null) {
  const data = await browser.storage.local.get(key);
  return data[key] === undefined ? fallback : data[key];
}

export function setKey(key, value) {
  return enqueue(key, () => browser.storage.local.set({ [key]: value }));
}

// fn receives the current value (or fallback) and returns the new value.
export function updateKey(key, fn, fallback = null) {
  return enqueue(key, async () => {
    const current = await getKey(key, fallback);
    const next = await fn(current);
    await browser.storage.local.set({ [key]: next });
    return next;
  });
}

// ---- Feeds and folders -----------------------------------------------------

const FEEDS_KEY = "feeds";
const FOLDERS_KEY = "folders";

export const getFeeds = () => getKey(FEEDS_KEY, []);
export const updateFeeds = (fn) => updateKey(FEEDS_KEY, fn, []);

export const getFolders = () => getKey(FOLDERS_KEY, []);
export const updateFolders = (fn) => updateKey(FOLDERS_KEY, fn, []);
