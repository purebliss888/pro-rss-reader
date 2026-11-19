import { errorMessage, domainOf } from "../core/utils.js";
import { reloadData, state } from "../core/state.js";
import { loadFeed } from "../feeds/feed-loader.js";
import { groupAdvertised } from "../feeds/advertised.js";
import { beginRefreshActivity } from "../feeds/refresh.js";
import { addFeed, findDuplicate } from "../feeds/subscriptions.js";
import { closeModal, createModal, openModal } from "./dialog.js";
import { h } from "./dom.js";
import { iconEl } from "./icons.js";
import { openFeedDialog } from "./feed-dialog.js";

const FORMAT_LABEL = { rss: "RSS", atom: "Atom", rdf: "RDF", json: "JSON" };
const GENERIC_NAME = /^(rss|atom|rdf|json|xml|feed|rss feed|atom feed|json feed|main feed|posts|all posts)$/i;

function defaultName(group, pending) {
  const t = (group.title || "").trim();
  if (t && !GENERIC_NAME.test(t)) return t;
  return (pending.title || "").trim() || domainOf(pending.url) || "Feed";
}

// pending: { url, title, links: [{ url, type, title }] | null }
export function openDiscoverOverlay(pending) {
  const host = domainOf(pending.url) || pending.url;
  const groups = pending.links ? groupAdvertised(pending.links) : [];
  const dlg = createModal({ className: "discover-modal", label: `Feeds on ${host}` });

  const closeBtn = h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onClick: () => closeModal(dlg) });
  closeBtn.append(iconEl("close"));

  const folderSelect = h(
    "select",
    { id: "discover-folder" },
    h("option", { value: "" }, "No folder"),
    ...[...state.folders].sort((a, b) => a.name.localeCompare(b.name)).map((f) => h("option", { value: f.id }, f.name))
  );
  const folderField = h("div", { class: "field" }, h("label", { for: "discover-folder" }, "Add to folder"), folderSelect);
  folderField.hidden = state.folders.length === 0 || groups.length === 0;

  const rows = [];
  let closing = false;
  function closeIfComplete() {
    if (closing || !rows.every((r) => r.isDone())) return;
    closing = true;
    setTimeout(() => closeModal(dlg), 700);
  }

  function row(group) {
    let done = false;
    const nameInput = h("input", { type: "text", value: defaultName(group, pending), "aria-label": "Feed name", autocomplete: "off" });
    const formats = group.formats.map((f) => FORMAT_LABEL[f.type] || f.type.toUpperCase()).join(" · ");
    const status = h("p", { class: "form-error", role: "alert", hidden: true });
    const addBtn = h("button", { class: "btn btn-primary", type: "button" });
    const setLabel = (text, icon) => {
      addBtn.replaceChildren(...(icon ? [iconEl(icon, { size: 18 }), text] : [text]));
    };
    setLabel("Add", "plus");

    const markSubscribed = (label) => {
      done = true;
      addBtn.disabled = true;
      nameInput.disabled = true;
      addBtn.className = "btn btn-ghost";
      setLabel(label, "check");
    };

    // Already subscribed (any of its addresses)?
    Promise.all(group.formats.map((f) => findDuplicate(f.url))).then((dups) => {
      if (dups.some(Boolean)) markSubscribed("Subscribed");
    });

    addBtn.addEventListener("click", async () => {
      status.hidden = true;
      addBtn.disabled = true;
      setLabel("Adding…");
      const endActivity = beginRefreshActivity(); // spins the refresh button meanwhile
      try {
        // Preferred format first, then the other formats of the same feed
        let loaded = null;
        let lastErr = null;
        for (const f of group.formats) {
          try {
            loaded = await loadFeed(f.url, { meta: true });
            break;
          } catch (err) {
            lastErr = err;
          }
        }
        if (!loaded) throw lastErr || new Error("This feed could not be loaded.");

        const dup = await findDuplicate(loaded.url);
        if (dup) {
          markSubscribed("Subscribed");
          closeIfComplete();
          return;
        }
        await addFeed({
          name: nameInput.value.trim(),
          folderId: folderSelect.value || null,
          validation: { url: loaded.url, feed: loaded.feed },
          onChange: reloadData,
        });
        await reloadData();
        markSubscribed("Added");
        closeIfComplete();
      } catch (err) {
        status.textContent = errorMessage(err);
        status.hidden = false;
        addBtn.disabled = false;
        setLabel("Add", "plus");
      } finally {
        endActivity();
      }
    });

    const el = h(
      "li",
      { class: "discover-row" },
      h(
        "div",
        { class: "discover-main" },
        nameInput,
        h("p", { class: "discover-meta" }, h("span", { class: "discover-formats" }, formats), group.isComments ? " · Comments" : ""),
        h("p", { class: "discover-url", title: group.url }, group.url),
        status
      ),
      addBtn
    );
    return { el, isDone: () => done };
  }

  let content;
  if (groups.length) {
    rows.push(...groups.map(row));
    content = h("ul", { class: "discover-list" }, ...rows.map((r) => r.el));
  } else {
    const searchBtn = h("button", { class: "btn btn-primary", type: "button" }, "Search this site for feeds");
    searchBtn.addEventListener("click", () => {
      closeModal(dlg);
      openFeedDialog({ url: pending.url });
    });
    content = h(
      "div",
      { class: "discover-empty" },
      iconEl("rss", { size: 36 }),
      h(
        "p",
        {},
        pending.links
          ? "This page doesn't advertise any feed."
          : "This page couldn't be checked for feeds."
      ),
      h("p", { class: "help" }, "You can still search the site for one. If it has none, it can be followed through Google News instead."),
      searchBtn
    );
  }

  const title = groups.length
    ? `${groups.length} ${groups.length === 1 ? "feed" : "feeds"} on ${host}`
    : `Feeds on ${host}`;

  dlg.append(
    h(
      "div",
      { class: "modal-card" },
      h("div", { class: "modal-head" }, h("h2", {}, title), closeBtn),
      h(
        "div",
        { class: "modal-body" },
        h("p", { class: "help discover-source" }, pending.title || pending.url),
        folderField,
        content
      ),
      h("div", { class: "modal-foot" }, h("button", { class: "btn btn-ghost", type: "button", onClick: () => closeModal(dlg) }, "Done"))
    )
  );
  openModal(dlg);
}