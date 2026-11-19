import { timeAgo } from "../core/utils.js";
import { h } from "./dom.js";
import { iconEl } from "./icons.js";

function sourceIcon(feed) {
  if (feed && feed.icon) return h("img", { class: "feed-icon", src: feed.icon, alt: "", width: 16, height: 16 });
  return iconEl("rss", { size: 16 });
}

// onOpen(article, feed): called on a plain left click. Modified clicks (new tab, etc.) are
// left to the browser because the card is a real link.
export function createCard(article, feed, { onOpen } = {}) {
  const publisher = article.publisher || (feed && feed.name) || "";
  const valid = Number.isFinite(article.date);
  const when = valid ? new Date(article.date) : null;

  const parts = [];

  if (article.image) {
    const img = h("img", {
      src: article.image,
      alt: "",
      loading: "lazy",
      decoding: "async",
      referrerpolicy: "no-referrer",
    });
    const wrap = h("div", { class: "card-image" }, img);
    img.addEventListener("error", () => wrap.remove());
    parts.push(wrap);
  }

  const body = h(
    "div",
    { class: "card-body" },
    h(
      "div",
      { class: "card-meta" },
      sourceIcon(feed),
      h("span", { class: "card-source", title: publisher }, publisher),
      when && h("time", { class: "card-time", datetime: when.toISOString(), title: when.toLocaleString() }, timeAgo(article.date))
    ),
    h("h3", { class: "card-title" }, article.title),
    article.author && article.author !== publisher ? h("p", { class: "card-author" }, `By ${article.author}`) : null,
    article.summary ? h("p", { class: "card-summary" }, article.summary) : null
  );
  parts.push(body);

  if (!article.url) return h("article", { class: "card" }, ...parts);

  const card = h("a", { class: "card", href: article.url, target: "_blank", rel: "noopener noreferrer" }, ...parts);
  if (onOpen) {
    card.addEventListener("click", (e) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      onOpen(article, feed);
    });
  }
  return card;
}