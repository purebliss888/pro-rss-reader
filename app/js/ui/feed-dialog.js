import { errorMessage } from "../core/utils.js";
import { reloadData, state } from "../core/state.js";
import { validateFeedUrl } from "../feeds/discovery.js";
import { googleNewsEditions, parseGoogleNewsFeedUrl, withGoogleNewsParams } from "../feeds/google-news-feed.js";
import { addFeed, editFeed, findDuplicate, normalizeFeedUrl } from "../feeds/subscriptions.js";
import { closeModal, createModal, openModal } from "./dialog.js";
import { h } from "./dom.js";
import { iconEl } from "./icons.js";
import { beginRefreshActivity } from "../feeds/refresh.js";

// feed = null opens "Add feed"; a feed object opens "Edit feed".
export function openFeedDialog({ feed = null, folderId = null, url = "" } = {}) {
  const isEdit = !!feed;
  const editions = googleNewsEditions();
  const dlg = createModal({ className: "feed-modal", label: isEdit ? "Edit feed" : "Add feed" });
  let closed = false;
  let busy = false;
  let gnAcknowledged = false;
  let submitLabel = isEdit ? "Save" : "Add feed";
  dlg.addEventListener("close", () => {
    closed = true;
  });

  // ---- Fields ----
  const nameInput = h("input", {
    type: "text", id: "feed-name", autocomplete: "off",
    placeholder: isEdit ? "Feed name" : "Feed name (optional)", value: feed ? feed.name : "",
  });
  const urlInput = h("input", {
    type: "text", id: "feed-url", inputmode: "url", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    placeholder: "Feed address, or any website address", value: feed ? feed.url : url,
  });
  const folderSelect = h(
    "select",
    { id: "feed-folder" },
    h("option", { value: "" }, "No folder"),
    ...[...state.folders].sort((a, b) => a.name.localeCompare(b.name)).map((f) => h("option", { value: f.id }, f.name))
  );
  folderSelect.value = (feed ? feed.folderId : folderId) || "";
  const folderField = h("div", { class: "field" }, h("label", { for: "feed-folder" }, "Folder"), folderSelect);
  folderField.hidden = state.folders.length === 0;

  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const showError = (msg) => {
    error.textContent = msg;
    error.hidden = false;
    urlInput.setAttribute("aria-invalid", "true");
  };
  const clearError = () => {
    error.hidden = true;
    urlInput.removeAttribute("aria-invalid");
  };

  // ---- Google News language / region ----
  const gnNotice = h("p", { class: "notice", hidden: true });
  const presetSelect = h(
    "select", { id: "gn-preset" },
    h("option", { value: "" }, "Custom"),
    ...editions.map((e, i) => h("option", { value: String(i) }, e.label))
  );
  const hlInput = h("input", { type: "text", id: "gn-hl", autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
  const glInput = h("input", { type: "text", id: "gn-gl", autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
  const ceidInput = h("input", { type: "text", id: "gn-ceid", autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
  const gnBox = h(
    "div",
    { class: "gn-box", hidden: true },
    h("h3", {}, "Google News language and region"),
    gnNotice,
    h("div", { class: "field" }, h("label", { for: "gn-preset" }, "Edition"), presetSelect),
    h(
      "div",
      { class: "field-row" },
      h("div", { class: "field" }, h("label", { for: "gn-hl" }, "hl (language)"), hlInput),
      h("div", { class: "field" }, h("label", { for: "gn-gl" }, "gl (region)"), glInput),
      h("div", { class: "field" }, h("label", { for: "gn-ceid" }, "ceid"), ceidInput)
    ),
    h("p", { class: "help" }, "Regional sites often need their own language and region, for example hl=hi, gl=IN, ceid=IN:hi.")
  );

  const langOf = (hl) => String(hl).toLowerCase().split("-")[0];
  const presetFor = ({ hl = "", gl = "", ceid = "" }) => {
    const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
    const i = editions.findIndex((e) => same(e.gl, gl) && same(e.ceid, ceid) && langOf(e.hl) === langOf(hl));
    return i >= 0 ? String(i) : "";
  };
  const fillGn = (locale) => {
    hlInput.value = locale.hl || "";
    glInput.value = locale.gl || "";
    ceidInput.value = locale.ceid || "";
    presetSelect.value = presetFor(locale);
  };
  const syncGnFromUrl = () => {
    const parsed = parseGoogleNewsFeedUrl(urlInput.value.trim());
    gnBox.hidden = !parsed;
    if (parsed) fillGn(parsed);
    else {
      gnNotice.hidden = true;
      gnAcknowledged = false;
    }
  };
  const writeGnToUrl = () => {
    const next = withGoogleNewsParams(urlInput.value.trim(), {
      hl: hlInput.value.trim(), gl: glInput.value.trim(), ceid: ceidInput.value.trim(),
    });
    if (next) urlInput.value = next;
    presetSelect.value = presetFor({ hl: hlInput.value, gl: glInput.value, ceid: ceidInput.value });
  };

  urlInput.addEventListener("input", () => {
    clearError();
    syncGnFromUrl();
  });
  for (const el of [hlInput, glInput, ceidInput]) el.addEventListener("input", () => { clearError(); writeGnToUrl(); });
  presetSelect.addEventListener("change", () => {
    if (presetSelect.value === "") return;
    fillGn(editions[Number(presetSelect.value)]);
    writeGnToUrl();
  });

  // ---- Buttons ----
  const submitBtn = h("button", { class: "btn btn-primary", type: "submit" }, submitLabel);
  const setBusy = (on) => {
    busy = on;
    submitBtn.disabled = on;
    submitBtn.textContent = on ? "Checking…" : submitLabel;
  };
  const closeBtn = h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onClick: () => closeModal(dlg) });
  closeBtn.append(iconEl("close"));

  // ---- Submit ----
  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    clearError();

    const rawUrl = urlInput.value.trim();
    const name = nameInput.value.trim();
    const targetFolder = folderSelect.value || null;
    if (!rawUrl) {
      showError("Enter the feed address.");
      urlInput.focus();
      return;
    }

    const endActivity = beginRefreshActivity();

    setBusy(true);
    try {
      // Edit where only the name / folder changed: nothing to re-check.
      if (isEdit && normalizeFeedUrl(rawUrl) === normalizeFeedUrl(feed.url)) {
        await editFeed(feed.id, { name, folderId: targetFolder });
        await reloadData();
        closeModal(dlg);
        return;
      }

      const res = await validateFeedUrl(rawUrl);
      if (closed) return;

      const dup = await findDuplicate(res.url, feed ? feed.id : null);
      if (dup) throw new Error(`You are already subscribed to this feed as “${dup.name}”.`);

      if (res.googleNews && res.feed.items.length === 0) {
        urlInput.value = res.url;
        syncGnFromUrl();
        throw new Error("Google News returned no articles for this language and region. Try a different edition.");
      }

      // No native feed: offer Google News feed and let the user check language / region first.
      if (res.googleNews && res.googleNews.notice && !gnAcknowledged) {
        gnAcknowledged = true;
        urlInput.value = res.url;
        gnNotice.textContent = res.googleNews.notice;
        gnNotice.hidden = false;
        gnBox.hidden = false;
        fillGn(res.googleNews.locale);
        submitLabel = isEdit ? "Save" : "Add with Google News";
        presetSelect.focus();
        return;
      }

      if (isEdit) await editFeed(feed.id, { name, folderId: targetFolder, validation: res, onChange: reloadData });
      else await addFeed({ name, folderId: targetFolder, validation: res, onChange: reloadData });
      await reloadData();
      closeModal(dlg);
    } catch (err) {
      if (!closed) showError(errorMessage(err));
    } finally {
      endActivity();
      if (!closed) setBusy(false);
    }
  }

  dlg.append(
    h(
      "form",
      { class: "modal-card", novalidate: true, onSubmit },
      h("div", { class: "modal-head" }, h("h2", {}, isEdit ? "Edit feed" : "Add feed"), closeBtn),
      h(
        "div",
        { class: "modal-body" },
        h("div", { class: "field" }, h("label", { for: "feed-url" }, "Feed address"), urlInput, error),
        h("div", { class: "field" }, h("label", { for: "feed-name" }, "Feed name"), nameInput),
        gnBox,
        folderField
      ),
      h("div", { class: "modal-foot" }, h("button", { class: "btn btn-ghost", type: "button", onClick: () => closeModal(dlg) }, "Cancel"), submitBtn)
    )
  );

  syncGnFromUrl();
  openModal(dlg);
  if (isEdit) {
    nameInput.focus();
    nameInput.select();
  } else {
    urlInput.focus();
  }
}