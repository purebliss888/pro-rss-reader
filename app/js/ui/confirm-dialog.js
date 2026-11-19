import { errorMessage } from "../core/utils.js";
import { closeModal, createModal, openModal } from "./dialog.js";
import { h } from "./dom.js";

export function openConfirmDialog({ icon, title, message, confirmLabel = "Delete", onConfirm }) {
  const dlg = createModal({ className: "modal-sm", label: title });
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const cancel = h("button", { class: "btn btn-ghost", type: "button", onClick: () => closeModal(dlg) }, "Cancel");
  const confirm = h("button", { class: "btn btn-danger", type: "button" }, confirmLabel);

  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    error.hidden = true;
    try {
      await onConfirm();
      closeModal(dlg);
    } catch (err) {
      error.textContent = errorMessage(err);
      error.hidden = false;
      confirm.disabled = false;
    }
  });

  dlg.append(
    h(
      "div",
      { class: "modal-card" },
      h("div", { class: "modal-body confirm-body" }, h("div", { class: "confirm-icon" }, icon), h("h2", {}, title), h("p", { class: "help" }, message), error),
      h("div", { class: "modal-foot" }, cancel, confirm)
    )
  );
  openModal(dlg);
  cancel.focus();
}