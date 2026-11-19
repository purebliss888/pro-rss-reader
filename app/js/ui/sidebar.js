import { $, h } from "./dom.js";
import { feedIconEl, iconEl } from "./icons.js";

const NARROW = "(max-width: 800px)";
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

function actionBtn(name, label, onClick) {
  const b = h("button", {
    class: `icon-btn sm row-action row-action-${name}`,
    type: "button",
    title: label,
    "aria-label": label,
    onClick: (e) => {
      e.stopPropagation();
      onClick();
    },
  });
  b.append(iconEl(name, { size: 16 }));
  return b;
}

// handlers: onSelectAll, onSelectFeed(id), onSelectFolder(id), onAddFeed, onAddFolder, onSettings, onInfo,
// onEditFeed(id), onDeleteFeed(id), onEditFolder(id), onDeleteFolder(id), onToggleFolder(id, isOpen)
export function initSidebar(handlers) {
  const menuBtn = $("#menu-btn");
  const allBtn = $("#all-btn");
  const list = $("#subscriptions");
  const subsCount = $("#subs-count");
  const isOpen = () => document.body.classList.contains("sidebar-open");

  const setOpen = (open) => {
    document.body.classList.toggle("sidebar-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };

  $("#scrim").addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen() && !document.querySelector("dialog[open]")) setOpen(false);
  });
  matchMedia(NARROW).addEventListener("change", (e) => {
    if (!e.matches) setOpen(false);
  });

  allBtn.addEventListener("click", () => handlers.onSelectAll());
  $("#add-feed-btn").addEventListener("click", () => handlers.onAddFeed());
  $("#add-folder-btn").addEventListener("click", () => handlers.onAddFolder());
  $("#settings-btn").addEventListener("click", () => handlers.onSettings());
  $("#info-btn").addEventListener("click", () => handlers.onInfo());
  menuBtn.addEventListener("click", () => setOpen(!isOpen()));

  function feedRow(feed, state) {
    const active = state.view.type === "feed" && state.view.id === feed.id;
    const count = state.counts.get(feed.id) || 0;
    const main = h(
      "button",
      {
        class: "row-main",
        type: "button",
        title: feed.name,
        "aria-current": active ? "true" : null,
        onClick: () => handlers.onSelectFeed(feed.id),
      },
      feedIconEl(feed),
      h("span", { class: "nav-label" }, feed.name)
    );
    return h(
      "div",
      { class: `nav-row${active ? " active" : ""}` },
      main,
      actionBtn("edit", `Edit ${feed.name}`, () => handlers.onEditFeed(feed.id)),
      actionBtn("delete", `Delete ${feed.name}`, () => handlers.onDeleteFeed(feed.id)),
      h("span", { class: "count" }, count ? String(count) : "")
    );
  }

  function folderBlock(folder, feeds, state) {
    const open = !folder.collapsed;
    const active = state.view.type === "folder" && state.view.id === folder.id;
    const isHome = state.settings && state.settings.homeFolderId === folder.id;
    const count = feeds.reduce((sum, f) => sum + (state.counts.get(f.id) || 0), 0);

    const chevron = h("button", {
      class: `icon-btn sm chevron${open ? " open" : ""}`,
      type: "button",
      title: open ? "Collapse folder" : "Expand folder",
      "aria-label": open ? `Collapse ${folder.name}` : `Expand ${folder.name}`,
      "aria-expanded": String(open),
      onClick: (e) => {
        e.stopPropagation();
        handlers.onToggleFolder(folder.id, open);
      },
    });
    chevron.append(iconEl("chevron-right", { size: 16 }));

    const main = h(
      "button",
      {
        class: "row-main",
        type: "button",
        title: folder.name,
        "aria-current": active ? "true" : null,
        onClick: () => handlers.onSelectFolder(folder.id),
      },
      iconEl("folder"),
      h("span", { class: "nav-label" }, folder.name)
    );
    if (isHome) {
      const badge = iconEl("home", { size: 14, className: "home-badge" });
      badge.setAttribute("title", "Opens when the extension starts");
      main.append(badge);
    }

    const row = h(
      "div",
      { class: `nav-row${active ? " active" : ""}` },
      chevron,
      main,
      actionBtn("edit", `Edit folder ${folder.name}`, () => handlers.onEditFolder(folder.id)),
      actionBtn("delete", `Delete folder ${folder.name}`, () => handlers.onDeleteFolder(folder.id)),
      h("span", { class: "count" }, count ? String(count) : "")
    );

    let inner = null;
    if (open) {
      inner = h(
        "div",
        { class: "folder-feeds" },
        feeds.length ? feeds.map((f) => feedRow(f, state)) : h("p", { class: "empty-folder" }, "Empty folder")
      );
    }
    return h("div", { class: "folder" }, row, inner);
  }

  function render(state) {
    allBtn.classList.toggle("active", state.view.type === "all");
    subsCount.textContent = state.feeds.length.toLocaleString();
    if (!state.feeds.length && !state.folders.length) {
      list.replaceChildren(h("p", { class: "muted" }, "No subscriptions yet. Use “Add feed” to get started."));
      return;
    }
    const folders = [...state.folders].sort(byName);
    const loose = state.feeds.filter((f) => !f.folderId || !state.folders.some((d) => d.id === f.folderId));
    list.replaceChildren(
      ...folders.map((d) => folderBlock(d, state.feeds.filter((f) => f.folderId === d.id).sort(byName), state)),
      ...loose.sort(byName).map((f) => feedRow(f, state))
    );
  }

  return {
    render,
    // Closes the drawer on phones after a navigation; does nothing on desktop.
    closeIfDrawer: () => {
      if (matchMedia(NARROW).matches) setOpen(false);
    },
  };
}