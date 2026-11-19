import { groupAdvertised, readFeedLinks } from "../app/js/feeds/advertised.js";

const APP_URL = browser.runtime.getURL("app/index.html");
const PENDING_KEY = "pendingDiscovery";
const READ_TIMEOUT_MS = 2000;

const isWebUrl = (url) => typeof url === "string" && /^https?:\/\//i.test(url);

// Runs fn, ignoring both thrown errors and rejected promises.
async function safe(fn) {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

async function findAppTab() {
  return (await safe(async () => (await browser.tabs.query({ url: APP_URL + "*" }))[0])) || null;
}

// -> { url, title, links } or null when the page can't be read (browser pages, add-on store...)
async function readPage(tabId) {
  const read = safe(async () => {
    const [res] = await browser.scripting.executeScript({ target: { tabId }, func: readFeedLinks });
    return res && res.result ? res.result : null;
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), READ_TIMEOUT_MS));
  return (await Promise.race([read, timeout])) || null;
}

async function openApp() {
  const existing = await findAppTab();
  if (existing) {
    await browser.tabs.update(existing.id, { active: true });
    if (browser.windows && browser.windows.update) await safe(() => browser.windows.update(existing.windowId, { focused: true }));
  } else {
    await browser.tabs.create({ url: APP_URL });
  }
}

browser.action.onClicked.addListener(async (sourceTab) => {
  // Already on the reader: just keep it focused, nothing to discover.
  if (sourceTab && sourceTab.url && sourceTab.url.startsWith(APP_URL)) return;

  let pending = null;
  if (sourceTab && isWebUrl(sourceTab.url)) {
    const page = await readPage(sourceTab.id);
    pending = {
      tabId: sourceTab.id,
      url: sourceTab.url,
      title: sourceTab.title || "",
      links: page ? page.links : null, // null = the page could not be read
      time: Date.now(),
    };
  }

  await safe(() => (pending ? browser.storage.session.set({ [PENDING_KEY]: pending }) : browser.storage.session.remove(PENDING_KEY)));

  await openApp();
});

async function setBadge(tabId, count) {
  await safe(() => browser.action.setBadgeText({ tabId, text: count > 0 ? String(count) : "" }));
}

async function updateBadge(tabId) {
  const tab = await safe(() => browser.tabs.get(tabId));
  if (!tab) return;
  if (!isWebUrl(tab.url) || tab.url.startsWith(APP_URL)) {
    await setBadge(tabId, 0);
    return;
  }
  const page = await readPage(tabId);
  await setBadge(tabId, page ? groupAdvertised(page.links).length : 0);
}

browser.action.setBadgeBackgroundColor({ color: "#F97316" });

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") setBadge(tabId, 0);
  else if (changeInfo.status === "complete") updateBadge(tabId);
});

browser.tabs.onActivated.addListener(({ tabId }) => updateBadge(tabId));

browser.runtime.onInstalled.addListener(async () => {
  const tabs = (await safe(() => browser.tabs.query({}))) || [];
  for (const tab of tabs) updateBadge(tab.id);
});