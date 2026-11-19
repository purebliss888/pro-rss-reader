import { h } from "./dom.js";
import { iconEl } from "./icons.js";

const MAX_TOASTS = 4;
let container = null;

function ensureContainer() {
  if (!container || !container.isConnected) {
    container = h("div", { class: "toasts", popover: "manual", role: "status", "aria-live": "polite" });
    document.body.appendChild(container);
  }
  return container;
}

// Re-showing the popover moves it above any modal dialog that opened later.
function raise(el) {
  try {
    if (el.matches(":popover-open")) el.hidePopover();
    el.showPopover();
  } catch {
    // popover API unavailable: the toast still renders inline
  }
}

// type: "error" | "info". Failed refreshes use "error"; successes are not toasted.
export function showToast(message, { type = "error", timeout = 7000 } = {}) {
  const box = ensureContainer();
  while (box.children.length >= MAX_TOASTS) box.firstElementChild.remove();

  const toast = h("div", { class: `toast toast-${type}` });
  const remove = () => {
    toast.remove();
    if (!box.children.length) {
      try {
        box.hidePopover();
      } catch {
        // ignore
      }
    }
  };
  const close = h("button", { class: "icon-btn", type: "button", "aria-label": "Dismiss", onClick: remove });
  close.append(iconEl("close", { size: 16 }));
  toast.append(iconEl(type === "error" ? "alert" : "info", { size: 18 }), h("div", { class: "toast-msg" }, message), close);

  box.append(toast);
  raise(box);
  if (timeout) setTimeout(remove, timeout);
  return remove;
}