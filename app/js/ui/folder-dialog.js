import { errorMessage } from "../core/utils.js";
import { reloadData, state } from "../core/state.js";
import { addFolder, editFolder } from "../feeds/subscriptions.js";
import { closeModal, createModal, openModal } from "./dialog.js";
import { h } from "./dom.js";
import { iconEl } from "./icons.js";

export function openFolderDialog({ folder = null } = {}) {
  const isEdit = !!folder;
  const dlg = createModal({ className: "modal-sm", label: isEdit ? "Edit folder" : "Add folder" });

  const nameInput = h("input", { type: "text", id: "folder-name", autocomplete: "off", placeholder: "Folder name", value: folder ? folder.name : "" });
  const homeInput = h("input", {
    type: "checkbox",
    role: "switch",
    id: "folder-home",
    checked: !!(folder && state.settings && state.settings.homeFolderId === folder.id),
  });
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const submit = h("button", { class: "btn btn-primary", type: "submit" }, isEdit ? "Save" : "Add folder");

  const closeBtn = h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onClick: () => closeModal(dlg) });
  closeBtn.append(iconEl("close"));

  const form = h(
    "form",
    { class: "modal-card", novalidate: true },
    h("div", { class: "modal-head" }, h("h2", {}, isEdit ? "Edit folder" : "Add folder"), closeBtn),
    h(
      "div",
      { class: "modal-body" },
      h("div", { class: "field" }, h("label", { for: "folder-name" }, "Folder name"), nameInput),
      h(
        "div",
        { class: "setting-row" },
        h("label", { for: "folder-home" }, "Open this folder on start"),
        h("span", { class: "switch" }, homeInput, h("span", { class: "switch-track" }))
      ),
      error
    ),
    h("div", { class: "modal-foot" }, h("button", { class: "btn btn-ghost", type: "button", onClick: () => closeModal(dlg) }, "Cancel"), submit)
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      error.textContent = "Enter a folder name.";
      error.hidden = false;
      nameInput.focus();
      return;
    }
    submit.disabled = true;
    try {
      if (isEdit) await editFolder(folder.id, { name, isHome: homeInput.checked });
      else await addFolder({ name, isHome: homeInput.checked });
      await reloadData();
      closeModal(dlg);
    } catch (err) {
      error.textContent = errorMessage(err);
      error.hidden = false;
      submit.disabled = false;
    }
  });

  dlg.append(form);
  openModal(dlg);
  nameInput.focus();
  nameInput.select();
}