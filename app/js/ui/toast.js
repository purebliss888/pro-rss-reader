import { h } from "./dom.js";
import { iconEl } from "./icons.js";

const MAX_TOASTS = 4;
let container = null;

function ensureContainer() {
  if (!container) {
    container = h("div", { class: "toasts", popover: "manual", role: "status", "aria-live": "polite" });
  }
  const dialogs = document.querySelectorAll("dialog[open]");
  const dialog = dialogs.length ? dialogs[dialogs.length - 1] : null;
  const host = dialog || document.body;
  if (container.parentNode !== host) {
    host.appendChild(container);
    if (dialog) {
      // A closing dialog removes itself; take the toasts back to the page first.
      dialog.addEventListener(
        "close",
        () => {
          if (container.parentNode === dialog || !container.isConnected) {
            document.body.appendChild(container);
            if (container.children.length) raise(container);
          }
        },
        { once: true }
      );
    }
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