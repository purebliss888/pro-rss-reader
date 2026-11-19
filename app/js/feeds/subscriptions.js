// Add / edit / delete for feeds and folders.

import { getFeeds, getFolders, updateFeeds, updateFolders } from "../core/storage.js";
import { deleteArticlesByFeed } from "../core/db.js";
import { getSettings, updateSettings } from "../core/settings.js";
import { logger } from "../core/logger.js";
import { domainOf, uid } from "../core/utils.js";
import { getFavicon } from "./favicon.js";
import { parseGoogleNewsFeedUrl } from "./google-news-feed.js";
import { storeItems } from "./articles.js";

export function normalizeFeedUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href.replace(/\/+$/, "");
  } catch {
    return String(url || "").trim();
  }
}

export async function findDuplicate(url, exceptId = null) {
  const key = normalizeFeedUrl(url);
  const feeds = await getFeeds();
  return feeds.find((f) => f.id !== exceptId && normalizeFeedUrl(f.url) === key) || null;
}

function iconSource(url, parsed) {
  const gn = parseGoogleNewsFeedUrl(url);
  if (gn) return gn.site ? `https://${gn.site}` : null;
  if (parsed && parsed.siteUrl) return parsed.siteUrl;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function defaultName(url, parsed) {
  const gn = parseGoogleNewsFeedUrl(url);
  if (gn && gn.site) return gn.site;
  return (parsed && parsed.title) || domainOf(url) || "Feed";
}

// Runs in the background; onChange fires once the icon is saved.
function loadIcon(feedId, source, feedIcon, onChange) {
  if (!source && !feedIcon) return;
  getFavicon(source || feedIcon, { feedIcon })
    .then(async (icon) => {
      if (!icon) return;
      await updateFeeds((list) => list.map((f) => (f.id === feedId ? { ...f, icon } : f)));
      if (onChange) onChange();
    })
    .catch((err) => logger.warn("favicon", "Could not load a feed icon", err));
}

// validation: the result of validateFeedUrl()
export async function addFeed({ name, folderId = null, validation, onChange }) {
  const { url, feed: parsed } = validation;
  const siteUrl = iconSource(url, parsed);
  const now = Date.now();
  const feed = {
    id: uid("f_"),
    name: name || defaultName(url, parsed),
    url,
    siteUrl,
    folderId: folderId || null,
    icon: null,
    type: parsed.format,
    addedAt: now,
    lastFetched: now,
    lastError: null,
  };
  await updateFeeds((list) => [...list, feed]);
  await storeItems(feed.id, parsed.items);
  loadIcon(feed.id, siteUrl, parsed.icon, onChange);
  return feed;
}

// validation is null when only the name / folder changed.
export async function editFeed(id, { name, folderId = null, validation = null, onChange }) {
  const parsed = validation && validation.feed;
  const siteUrl = validation ? iconSource(validation.url, parsed) : null;

  await updateFeeds((list) =>
    list.map((f) => {
      if (f.id !== id) return f;
      const next = { ...f, name: name || f.name, folderId: folderId || null };
      if (validation) {
        Object.assign(next, {
          url: validation.url,
          siteUrl,
          type: parsed.format,
          icon: null,
          lastFetched: Date.now(),
          lastError: null,
        });
      }
      return next;
    })
  );

  if (validation) {
    await deleteArticlesByFeed(id); // the old address's items no longer apply
    await storeItems(id, parsed.items);
    loadIcon(id, siteUrl, parsed.icon, onChange);
  }
}

export async function deleteFeed(id) {
  await updateFeeds((list) => list.filter((f) => f.id !== id));
  await deleteArticlesByFeed(id);
}

// ---- Folders ---------------------------------------------------------------

export async function addFolder({ name, isHome = false }) {
  const folder = { id: uid("d_"), name, collapsed: false };
  await updateFolders((list) => [...list, folder]);
  if (isHome) await updateSettings({ homeFolderId: folder.id });
  return folder;
}

export async function editFolder(id, { name, isHome }) {
  await updateFolders((list) => list.map((f) => (f.id === id ? { ...f, name } : f)));
  const { homeFolderId } = await getSettings();
  if (isHome) await updateSettings({ homeFolderId: id });
  else if (homeFolderId === id) await updateSettings({ homeFolderId: null });
}

// Feeds inside the folder are kept: they move to the top level.
export async function deleteFolder(id) {
  await updateFeeds((list) => list.map((f) => (f.folderId === id ? { ...f, folderId: null } : f)));
  await updateFolders((list) => list.filter((f) => f.id !== id));
  const { homeFolderId } = await getSettings();
  if (homeFolderId === id) await updateSettings({ homeFolderId: null });
}

export function setFolderCollapsed(id, collapsed) {
  return updateFolders((list) => list.map((f) => (f.id === id ? { ...f, collapsed } : f)));
}

export async function importSubscriptions({ feeds: items }, { onChange } = {}) {
  const [existingFeeds, existingFolders] = await Promise.all([getFeeds(), getFolders()]);
  const seen = new Set(existingFeeds.map((f) => normalizeFeedUrl(f.url)));
  const folderByName = new Map(existingFolders.map((f) => [f.name.trim().toLowerCase(), f]));
  const newFolders = [];
  const newFeeds = [];
  let skipped = 0;
  const now = Date.now();

  for (const item of items) {
    const key = normalizeFeedUrl(item.url);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);

    let folderId = null;
    if (item.folder) {
      const name = item.folder.trim();
      let folder = folderByName.get(name.toLowerCase());
      if (!folder) {
        folder = { id: uid("d_"), name, collapsed: false };
        folderByName.set(name.toLowerCase(), folder);
        newFolders.push(folder);
      }
      folderId = folder.id;
    }

    newFeeds.push({
      id: uid("f_"),
      name: item.name || defaultName(item.url, null),
      url: item.url,
      siteUrl: iconSource(item.url, { siteUrl: item.siteUrl }),
      folderId,
      icon: null,
      type: "rss",
      addedAt: now,
      lastFetched: 0,
      lastError: null,
    });
  }

  if (newFolders.length) await updateFolders((list) => [...list, ...newFolders]);
  if (newFeeds.length) await updateFeeds((list) => [...list, ...newFeeds]);

  // Icons load in the background, a few at a time
  const queue = [...newFeeds];
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      loadIcon(f.id, f.siteUrl, null, onChange);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  Array.from({ length: Math.min(4, queue.length) }, worker);

  return { added: newFeeds.length, skipped, folders: newFolders.length, feeds: newFeeds };
}