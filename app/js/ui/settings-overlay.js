import { applyTheme, getSettings, SETTING_LIMITS, updateSettings } from "../core/settings.js";
import { reloadData } from "../core/state.js";
import { clearLogs, getLogs, logger } from "../core/logger.js";
import { getFeeds, getFolders } from "../core/storage.js";
import { errorMessage } from "../core/utils.js";
import { pruneAll } from "../feeds/articles.js";
import { buildOpml, parseOpml } from "../feeds/opml.js";
import { refreshFeeds } from "../feeds/refresh.js";
import { importSubscriptions } from "../feeds/subscriptions.js";
import { closeModal, createModal, openModal } from "./dialog.js";
import { h } from "./dom.js";
import { iconEl } from "./icons.js";
import { showToast } from "./toast.js";

const EXPORT_NAME = "pro-rss-reader-feeds.opml";

function section(title, ...children) {
  return h("section", { class: "setting-section" }, h("h3", {}, title), ...children);
}

function downloadText(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---- Import / export ----

function transferSection(dlg) {
  const status = h("p", { class: "help", role: "status" });

  const exportBtn = h("button", { class: "btn btn-ghost", type: "button" });
  exportBtn.append(iconEl("download", { size: 18 }), "Export OPML");
  exportBtn.addEventListener("click", async () => {
    try {
      const [feeds, folders] = await Promise.all([getFeeds(), getFolders()]);
      if (!feeds.length) {
        status.textContent = "There are no subscriptions to export.";
        return;
      }
      downloadText(EXPORT_NAME, buildOpml(feeds, folders), "text/x-opml+xml");
      status.textContent = `Exported ${feeds.length} ${feeds.length === 1 ? "feed" : "feeds"}.`;
    } catch (err) {
      logger.error("export", "Could not export subscriptions", err);
      status.textContent = `Export failed: ${errorMessage(err)}`;
    }
  });

  const fileInput = h("input", { type: "file", accept: ".opml,.xml,text/xml,application/xml,text/x-opml", hidden: true });
  const importBtn = h("button", { class: "btn btn-ghost", type: "button" });
  importBtn.append(iconEl("upload", { size: 18 }), "Import OPML");
  importBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    importBtn.disabled = true;
    status.textContent = "Importing…";
    try {
      const parsed = parseOpml(await file.text());
      if (!parsed.feeds.length) throw new Error("No feeds were found in this file.");
      const result = await importSubscriptions(parsed, { onChange: reloadData });
      if (result.added === 0 && result.folders === 0) {
        const n = result.skipped;
        status.textContent = `All ${n} ${n === 1 ? "feed is" : "feeds are"} already added.`;
        logger.info("import", `Nothing to import from ${file.name}: all feeds already added`);
        return;
      }
      const parts = [`Added ${result.added} ${result.added === 1 ? "feed" : "feeds"}`];
      if (result.skipped) parts.push(`${result.skipped} already subscribed`);
      if (result.folders) parts.push(`${result.folders} new ${result.folders === 1 ? "folder" : "folders"}`);
      logger.info("import", `Imported ${result.added} feeds from ${file.name}`, result);
      showToast(parts.join(", ") + ".", { type: "info" });
      closeModal(dlg);

      reloadData().catch((err) => logger.warn("import", "Could not refresh the view", err));
      if (result.feeds.length) {
        refreshFeeds(result.feeds)
          .then(reloadData)
          .catch((err) => logger.warn("import", "Could not load imported feeds", err));
      }
    } catch (err) {
      logger.error("import", `Could not import ${file.name}`, err);
      status.textContent = "";
      showToast(`Import failed: ${errorMessage(err)}`);
    } finally {
      importBtn.disabled = false;
    }
  });

  return section(
    "Import and export",
    h("div", { class: "btn-row" }, importBtn, exportBtn, fileInput),
    h("p", { class: "help" }, `Import merges an OPML file into your subscriptions: feeds you already have are skipped and folders with the same name are reused.`),
    status
  );
}

// ---- Logs ----

const formatTime = (t) => new Date(t).toLocaleString();

function detailsText(details) {
  if (details == null) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

function logsSection() {
  const list = h("div", { class: "log-list", tabindex: "0", "aria-label": "Logs" });
  const count = h("p", { class: "help" });
  const clearBtn = h("button", { class: "btn btn-ghost", type: "button" }, "Clear logs");

  async function render() {
    const logs = (await getLogs()).slice().reverse();
    count.textContent = logs.length ? `${logs.length} ${logs.length === 1 ? "entry" : "entries"}` : "";
    clearBtn.disabled = !logs.length;
    if (!logs.length) {
      list.replaceChildren(h("p", { class: "log-empty" }, "No log entries."));
      return;
    }
    list.replaceChildren(
      ...logs.map((entry) => {
        const text = detailsText(entry.details);
        const head = h(
          "div",
          { class: "log-head" },
          h("span", { class: `log-level log-${entry.level}` }, entry.level),
          h("span", { class: "log-scope" }, entry.scope),
          h("time", { class: "log-time" }, formatTime(entry.time))
        );
        const msg = h("div", { class: "log-message" }, entry.message);
        if (!text) return h("div", { class: "log-entry" }, head, msg);
        return h("details", { class: "log-entry" }, h("summary", {}, head, msg), h("pre", { class: "log-details" }, text));
      })
    );
  }

  clearBtn.addEventListener("click", async () => {
    await clearLogs();
    await render();
  });
  render().catch(() => list.replaceChildren(h("p", { class: "log-empty" }, "Could not load logs.")));

  return section("Logs", count, list, h("div", { class: "btn-row" }, clearBtn));
}

export async function openSettings() {
  const settings = await getSettings();
  const dlg = createModal({ className: "settings-modal", label: "Settings" });

  // Appearance
  const themeInput = h("input", { type: "checkbox", role: "switch", id: "set-dark", checked: settings.theme !== "light" });
  themeInput.addEventListener("change", async () => {
    const theme = themeInput.checked ? "dark" : "light";
    applyTheme(theme);
    await updateSettings({ theme });
  });
  const themeRow = h(
    "div",
    { class: "setting-row" },
    h("label", { for: "set-dark" }, "Dark theme"),
    h("span", { class: "switch" }, themeInput, h("span", { class: "switch-track" }))
  );

  // Feed cache
  const numberField = (id, label, key, help) => {
    const [min, max] = SETTING_LIMITS[key];
    const input = h("input", { type: "number", id, min, max, step: 1, inputmode: "numeric", value: settings[key] });
    input.addEventListener("change", async () => {
      const next = await updateSettings({ [key]: input.value });
      input.value = next[key]; // shows the clamped value
      await pruneAll();
      await reloadData();
    });
    return h("div", { class: "field" }, h("label", { for: id }, label), input, h("p", { class: "help" }, `${help} (${min}–${max})`));
  };

  // Google News links
  const tabInput = h("input", { type: "checkbox", role: "switch", id: "set-gn-tab", checked: settings.googleNewsTabFallback });
  tabInput.addEventListener("change", () => updateSettings({ googleNewsTabFallback: tabInput.checked }));
  const tabRow = h(
    "div",
    { class: "setting-row" },
    h("label", { for: "set-gn-tab" }, "Allow a background tab for Google News links"),
    h("span", { class: "switch" }, tabInput, h("span", { class: "switch-track" }))
  );

  const closeBtn = h("button", { class: "icon-btn", type: "button", "aria-label": "Close settings", onClick: () => closeModal(dlg) });
  closeBtn.append(iconEl("close"));

  dlg.append(
    h(
      "div",
      { class: "modal-card" },
      h("div", { class: "modal-head" }, h("h2", {}, "Settings"), closeBtn),
      h(
        "div",
        { class: "modal-body" },
        section("Appearance", themeRow),
        section(
          "Feed cache",
          numberField("set-max-items", "Maximum items to cache per feed", "maxItemsPerFeed", "Older items beyond this are removed"),
          numberField("set-cache-days", "Keep cached items for (days)", "cacheDays", "Items older than this are removed")
        ),
        section(
          "Google News",
          tabRow,
          h(
            "p",
            { class: "help" },
            "Google News links are first resolved without opening any page. If that fails, a background tab can open the link briefly to learn the article's real address."
          )
        ),
        transferSection(dlg),
        logsSection()
      )
    )
  );

  openModal(dlg);
}
