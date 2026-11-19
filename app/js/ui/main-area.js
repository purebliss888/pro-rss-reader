import { $ } from "./dom.js";
import { bindScrollToTop } from "./scroll-top.js";

export function initMainArea() {
  const title = $("#content-title");
  const titleIcon = $("#content-icon");
  const titleName = $("#content-name");
  const refreshBtn = $("#refresh-btn");
  const scroller = $("#content-scroll");
  let refreshHandler = null;

  bindScrollToTop(scroller, $("#to-top"));

  refreshBtn.addEventListener("click", () => {
    if (refreshHandler) refreshHandler();
  });

  return {
    scroller,
    articles: $("#articles"),
    setTitle(text, icon) {
      titleName.textContent = text;
      titleIcon.replaceChildren(icon);
      title.title = text;
    },
    onRefresh(handler) {
      refreshHandler = handler;
    },
    setRefreshing(on) {
      refreshBtn.classList.toggle("is-spinning", !!on);
      refreshBtn.setAttribute("aria-busy", String(!!on));
    },
  };
}