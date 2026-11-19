import { h } from "./dom.js";

// Creates an empty modal <dialog>.
export function createModal({ className = "", label = "" } = {}) {
  const dlg = h("dialog", { class: `modal ${className}`.trim(), "aria-label": label });

  // Close on a backdrop click, but not when a drag started inside the dialog
  // (for example selecting text in an input) and ended outside it.
  let pressedOnBackdrop = false;
  dlg.addEventListener("mousedown", (e) => {
    pressedOnBackdrop = e.target === dlg;
  });
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg && pressedOnBackdrop) dlg.close();
  });
  dlg.addEventListener("close", () => dlg.remove());

  document.body.appendChild(dlg);
  return dlg;
}

export function openModal(dlg) {
  if (!dlg.open) dlg.showModal();
}

export function closeModal(dlg) {
  if (dlg.open) dlg.close();
}