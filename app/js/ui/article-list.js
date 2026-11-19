import { getArticles } from "../core/db.js";
import { createCard } from "./cards.js";
import { h } from "./dom.js";

const PAGE = 36;

// Renders the card grid for the current view and loads more cards as the user scrolls.
export function createArticleList({ container, scroller, getFeedIds, getFeedMap, renderEmpty, onOpen }) {
  let token = 0;
  let loaded = 0;
  let done = false;
  let loading = false;
  let grid = null;
  let sentinel = null;
  let observer = null;

  const cardsFor = (items) => {
    const feeds = getFeedMap();
    return items.map((a) => createCard(a, feeds.get(a.feedId), { onOpen }));
  };

  function render(items, wanted) {
    if (observer) observer.disconnect();
    loaded = items.length;
    done = items.length < wanted;
    if (!items.length) {
      grid = null;
      container.replaceChildren(renderEmpty());
      return;
    }
    grid = h("div", { class: "cards" }, ...cardsFor(items));
    sentinel = h("div", { class: "cards-end" });
    container.replaceChildren(grid, sentinel);
    if (!done) {
      observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && more(), {
        root: scroller,
        rootMargin: "700px",
      });
      observer.observe(sentinel);
    }
  }

  async function more() {
    if (loading || done || !grid) return;
    loading = true;
    const t = token;
    try {
      const items = await getArticles({ feedIds: getFeedIds(), limit: PAGE, offset: loaded });
      if (t !== token) return;
      grid.append(...cardsFor(items));
      loaded += items.length;
      if (items.length < PAGE) {
        done = true;
        observer.disconnect();
      } else {
        observer.unobserve(sentinel); // observe again so the callback re-checks visibility
        observer.observe(sentinel);
      }
    } finally {
      loading = false;
    }
  }

  // keepScroll: rebuild the list (after a refresh, for example) without jumping back to the top.
  async function reload({ keepScroll = false } = {}) {
    const t = ++token;
    const wanted = keepScroll ? Math.max(PAGE, loaded) : PAGE;
    const items = await getArticles({ feedIds: getFeedIds(), limit: wanted });
    if (t !== token) return;
    const top = scroller.scrollTop;
    loading = false;
    render(items, wanted);
    if (keepScroll) scroller.scrollTop = top;
  }

  return { reload };
}