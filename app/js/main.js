import { applyTheme } from "./core/settings.js";
import { logger } from "./core/logger.js";
import { errorMessage } from "./core/utils.js";
import { emit, feedIdsForView, reloadData, setView, state, subscribe, viewTitle } from "./core/state.js";
import { deleteFeed, deleteFolder, setFolderCollapsed } from "./feeds/subscriptions.js";
import { refreshFeeds, onRefreshActivity } from "./feeds/refresh.js";
import { h } from "./ui/dom.js";
import { feedIconEl, hydrateIcons, iconEl } from "./ui/icons.js";
import { initSidebar } from "./ui/sidebar.js";
import { initMainArea } from "./ui/main-area.js";
import { createArticleList } from "./ui/article-list.js";
import { openSettings } from "./ui/settings-overlay.js";
import { openFeedDialog } from "./ui/feed-dialog.js";
import { openFolderDialog } from "./ui/folder-dialog.js";
import { openConfirmDialog } from "./ui/confirm-dialog.js";
import { showToast } from "./ui/toast.js";
import { pruneReaderCache } from "./core/db.js";
import { openReader } from "./ui/reader.js";
import { openDiscoverOverlay } from "./ui/discover-overlay.js";
import { openInfo } from "./ui/info-overlay.js";

window.addEventListener("unhandledrejection", (e) => {
  logger.error("app", `Unhandled error: ${errorMessage(e.reason)}`, e.reason);
});
window.addEventListener("error", (e) => {
  logger.error("app", `Script error: ${e.message}`);
});

const findFeed = (id) => state.feeds.find((f) => f.id === id);
const findFolder = (id) => state.folders.find((f) => f.id === id);

function confirmIcon(feed) {
  if (feed && feed.icon) return h("img", { src: feed.icon, alt: "" });
  return iconEl("delete", { size: 28 });
}

function emptyMessage(title, text) {
  return h("div", { class: "empty" }, iconEl("rss", { size: 40 }), h("h2", {}, title), h("p", {}, text));
}

function emptyState() {
  if (state.feeds.length === 0) return emptyMessage("No subscriptions yet", "Add a feed from the sidebar to get started.");
  if (state.view.type === "folder" && feedIdsForView().length === 0) {
    return emptyMessage("This folder is empty", "Open a feed's edit dialog to move it here.");
  }
  return emptyMessage("No articles yet", "Press refresh to fetch the latest articles.");
}

// The feeds the current view shows: one feed, a folder's feeds, or everything.
function feedsForView() {
  const ids = feedIdsForView();
  return ids ? state.feeds.filter((f) => ids.includes(f.id)) : state.feeds;
}

function reportFailures(results) {
  const failed = results.filter((r) => !r.ok);
  if (!failed.length) return;
  if (failed.length <= 3) {
    for (const r of failed) showToast(`${r.feed.name}: ${r.error}`);
  } else {
    showToast(`${failed.length} feeds failed to refresh. Details are in Settings → Logs.`);
  }
}

function viewIcon() {
  const { type, id } = state.view;
  if (type === "folder") return iconEl("folder", { size: 22 });
  const feed = type === "feed" ? findFeed(id) : null;
  return feed ? feedIconEl(feed, 22) : iconEl(type === "feed" ? "rss" : "layers", { size: 22 });
}

async function boot() {
  hydrateIcons();
  await reloadData();
  applyTheme(state.settings.theme);

  const home = state.settings.homeFolderId;
  if (home && findFolder(home)) state.view = { type: "folder", id: home };

  const main = initMainArea();

  onRefreshActivity((busy) => main.setRefreshing(busy));

  async function runRefresh(feeds) {
    if (!feeds.length) return;
    const results = await refreshFeeds(feeds);
    await reloadData();
    reportFailures(results);
  }

  // Opening a feed or folder refreshes it, unless it was fetched in the last 60 seconds
  function refreshOnOpen() {
    const stale = feedsForView().filter((f) => Date.now() - (f.lastFetched || 0) > 60_000);
    runRefresh(stale);
  }

  const sidebar = initSidebar({
    onSelectAll() {
      setView({ type: "all", id: null });
      main.scroller.scrollTop = 0;
      sidebar.closeIfDrawer();
    },
    onSelectFeed(id) {
      setView({ type: "feed", id });
      main.scroller.scrollTop = 0;
      refreshOnOpen();
      sidebar.closeIfDrawer();
    },
    onSelectFolder(id) {
      setView({ type: "folder", id });
      main.scroller.scrollTop = 0;
      refreshOnOpen();
      sidebar.closeIfDrawer();
    },
    onAddFeed() {
      openFeedDialog({ folderId: state.view.type === "folder" ? state.view.id : null });
      sidebar.closeIfDrawer();
    },
    onAddFolder() {
      openFolderDialog();
      sidebar.closeIfDrawer();
    },
    onSettings() {
      openSettings();
      sidebar.closeIfDrawer();
    },
    onInfo() {
      openInfo();
      sidebar.closeIfDrawer();
    },
    onEditFeed(id) {
      const feed = findFeed(id);
      if (feed) openFeedDialog({ feed });
    },
    onDeleteFeed(id) {
      const feed = findFeed(id);
      if (!feed) return;
      openConfirmDialog({
        icon: confirmIcon(feed),
        title: `Delete ${feed.name}`,
        message: "This will delete this feed and its articles.",
        onConfirm: async () => {
          await deleteFeed(id);
          await reloadData();
        },
      });
    },
    onEditFolder(id) {
      const folder = findFolder(id);
      if (folder) openFolderDialog({ folder });
    },
    onDeleteFolder(id) {
      const folder = findFolder(id);
      if (!folder) return;
      openConfirmDialog({
        icon: iconEl("folder", { size: 28 }),
        title: `Delete folder ${folder.name}`,
        message: "The folder will be deleted. Feeds inside it are kept and move out of the folder.",
        onConfirm: async () => {
          await deleteFolder(id);
          await reloadData();
        },
      });
    },
    async onToggleFolder(id, isOpen) {
      await setFolderCollapsed(id, isOpen);
      await reloadData();
    },
  });

  const articleList = createArticleList({
    container: main.articles,
    scroller: main.scroller,
    getFeedIds: feedIdsForView,
    getFeedMap: () => new Map(state.feeds.map((f) => [f.id, f])),
    renderEmpty: emptyState,
    onOpen: (article, feed) => openReader(article, feed),
  });

  main.onRefresh(() => runRefresh(feedsForView()));

  let firstRender = null;
  subscribe((st, reason) => {
    sidebar.render(st);
    main.setTitle(viewTitle(), viewIcon());
    firstRender = articleList.reload({ keepScroll: reason === "data" });
  });

  emit("data");
  await firstRender; // reveal the UI only once real content is ready
  pruneReaderCache(state.settings.cacheDays).catch((err) => logger.warn("cache", "Could not clean the article cache", err));

  // Toolbar button used on a web page: offer that site's feeds.
  const PENDING_KEY = "pendingDiscovery";
  async function takePending() {
    const data = await browser.storage.session.get(PENDING_KEY);
    const pending = data[PENDING_KEY];
    if (!pending) return;
    await browser.storage.session.remove(PENDING_KEY);
    openDiscoverOverlay(pending);
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && changes[PENDING_KEY] && changes[PENDING_KEY].newValue) takePending();
  });
  takePending().catch((err) => logger.warn("discovery", "Could not show the feed overlay", err));
  document.body.classList.remove("booting");

  // On start only the home folder is refreshed (everything, when no home folder is set)
  runRefresh(feedsForView());
}

boot().catch((err) => {
  console.error(err);
  document.body.classList.remove("booting");
  document.body.textContent = `Failed to start: ${errorMessage(err)}`;
});