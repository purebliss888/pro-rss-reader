
const SHOW_AFTER = 400; // px scrolled

export function bindScrollToTop(scroller, button) {
  scroller.addEventListener(
    "scroll",
    () => button.classList.toggle("is-visible", scroller.scrollTop > SHOW_AFTER),
    { passive: true }
  );
  button.addEventListener("click", () => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });
}
