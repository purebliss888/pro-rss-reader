import { logger } from "../core/logger.js";
import { domainOf, errorMessage } from "../core/utils.js";
import { loadArticle } from "../reader/article-fetcher.js";
import { sanitizeHtml } from "../reader/sanitize.js";
import { closeModal, createModal, openModal } from "./dialog.js";
import { h } from "./dom.js";
import { iconEl } from "./icons.js";
import { bindScrollToTop } from "./scroll-top.js";

const isGoogleHost = (host) => /(^|\.)google\.[a-z.]+$/i.test(host);
const withoutQuery = (u) => String(u || "").split(/[?#]/)[0];

function metaLine(article, feed, result) {
  const publisher = article.publisher || (feed && feed.name) || "";
  const author = article.author || (result && result.byline) || "";
  const date = article.published
    ? new Date(article.published).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : "";
  return [publisher, author && author !== publisher ? author : "", date].filter(Boolean).join(" · ");
}

function leadImage(src) {
  const img = h("img", { class: "reader-lead", src, alt: "", referrerpolicy: "no-referrer", decoding: "async" });
  img.addEventListener("error", () => img.remove());
  return img;
}

export function openReader(article, feed) {
  const dlg = createModal({ className: "reader-modal", label: article.title || "Article" });
  let closed = false;
  dlg.addEventListener("close", () => {
    closed = true;
  });

  // ---- Floating buttons: back, open in new tab, scroll to top ----
  const back = h("button", { class: "icon-btn fab fab-left", type: "button", "aria-label": "Back", title: "Back", onClick: () => closeModal(dlg) });
  back.append(iconEl("back"));

  // Feed icon and domain: the first line of the scrolling page
  const siteIcon =
    feed && feed.icon ? h("img", { class: "feed-icon", src: feed.icon, alt: "", width: 20, height: 20 }) : iconEl("rss", { size: 20 });

  const host = article.url ? domainOf(article.url) : "";
  const siteLabel = h(
    "span",
    { class: "reader-site" },
    !host || isGoogleHost(host) ? article.publisher || (feed && feed.name) || host : host
  );

  const openLink = h("a", {
    class: "icon-btn fab fab-right",
    href: article.url || "#",
    target: "_blank",
    rel: "noopener noreferrer",
    "aria-label": "Open in new tab",
    title: "Open in new tab",
  });
  openLink.append(iconEl("external"));
  if (!article.url) openLink.style.visibility = "hidden";

  const toTop = h("button", { class: "icon-btn fab to-top", type: "button", "aria-label": "Scroll to top", title: "Scroll to top" });
  toTop.append(iconEl("arrow-up"));

  // ---- Article: feed data first, full content once it arrives ----
  const title = h("h1", { class: "reader-title" }, article.title);
  const meta = h("p", { class: "reader-meta" }, metaLine(article, feed, null));
  let lead = article.image ? leadImage(article.image) : null;
  const body = h(
    "div",
    { class: "reader-content" },
    h("p", { class: "reader-loading" }, h("span", { class: "spinner" }), "Loading full article…")
  );
  const articleEl = h("article", { class: "reader-article" }, title, meta, lead, body);
  const scroll = h("div", { class: "reader-scroll", tabindex: "-1" }, h("div", { class: "reader-source" }, siteIcon, siteLabel), articleEl);
  bindScrollToTop(scroll, toTop);

  dlg.append(h("div", { class: "reader" }, back, openLink, scroll, toTop));
  openModal(dlg);
  scroll.focus();

  const setSite = (url) => {
    if (!url) return;
    const d = domainOf(url);
    if (d) siteLabel.textContent = d;
    openLink.href = url;
  };

  function showArticle(result) {
    setSite(result.finalUrl);
    if (!article.title && result.title) title.textContent = result.title;
    meta.textContent = metaLine(article, feed, result);
    body.replaceChildren(sanitizeHtml(result.html, result.finalUrl));

    const contentImages = [...body.querySelectorAll("img")].map((i) => withoutQuery(i.getAttribute("src")));
    if (lead && contentImages.includes(withoutQuery(article.image))) {
      lead.remove(); // the article already shows this picture
      lead = null;
    } else if (!lead && result.image && !contentImages.length) {
      lead = leadImage(result.image);
      body.before(lead);
    }
  }

  function showFailure(err) {
    setSite(err && err.finalUrl);
    const reason = errorMessage(err);
    logger.warn("reader", `Could not load the full article: ${reason}`, {
      url: article.url,
      finalUrl: (err && err.finalUrl) || null,
    });
    const message = h("p", { class: "reader-failure", title: reason }, "Failed to fetch full article. ");
    if (article.url) {
      message.append(
        "To open original page ",
        h("a", { href: openLink.href, target: "_blank", rel: "noopener noreferrer" }, "click here")
      );
    } else {
      message.append(" ", reason);
    }
    body.replaceChildren(...[article.summary ? h("p", { class: "reader-summary" }, article.summary) : null, message].filter(Boolean));
  }

  if (!article.url) {
    showFailure(new Error("This item has no web address."));
    return;
  }
  loadArticle(article.url).then(
    (result) => !closed && showArticle(result),
    (err) => !closed && showFailure(err)
  );
}