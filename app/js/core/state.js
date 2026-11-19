// Shared app state with a tiny subscribe/emit mechanism. The UI re-renders from here.

import { getFeeds, getFolders } from "./storage.js";
import { countArticlesByFeed } from "./db.js";
import { getSettings } from "./settings.js";

export const state = {
  feeds: [],
  folders: [],
  counts: new Map(),
  settings: null,
  view: { type: "all", id: null }, // "all" | "feed" | "folder"
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(reason = "data") {
  for (const fn of listeners) fn(state, reason);
}

export async function reloadData() {
  const [feeds, folders, counts, settings] = await Promise.all([
    getFeeds(),
    getFolders(),
    countArticlesByFeed(),
    getSettings(),
  ]);
  Object.assign(state, { feeds, folders, counts, settings });

  // The viewed feed or folder may have been deleted
  const { type, id } = state.view;
  if ((type === "feed" && !feeds.some((f) => f.id === id)) || (type === "folder" && !folders.some((f) => f.id === id))) {
    state.view = { type: "all", id: null };
  }
  emit("data");
}

export function setView(view) {
  state.view = view;
  emit("view");
}

// null = every feed
export function feedIdsForView(view = state.view) {
  if (view.type === "feed") return [view.id];
  if (view.type === "folder") return state.feeds.filter((f) => f.folderId === view.id).map((f) => f.id);
  return null;
}

export function viewTitle(view = state.view) {
  if (view.type === "feed") return (state.feeds.find((f) => f.id === view.id) || {}).name || "Feed";
  if (view.type === "folder") return (state.folders.find((f) => f.id === view.id) || {}).name || "Folder";
  return "All items";
}