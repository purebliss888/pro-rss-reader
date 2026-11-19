// Runs synchronously before first paint so a saved light theme doesn't flash dark.
// (Inline scripts are blocked by the extension CSP, so this lives in its own file.)
try {
  if (localStorage.getItem("theme") === "light") {
    document.documentElement.dataset.theme = "light";
  }
} catch {
  // storage unavailable: keep the default dark theme
}