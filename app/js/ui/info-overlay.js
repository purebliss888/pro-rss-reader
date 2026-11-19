// Info overlay: what the extension is, how to use it, and where to get help.

import { closeModal, createModal, openModal } from "./dialog.js";
import { h } from "./dom.js";
import { iconEl } from "./icons.js";

const SOURCE_URL = "https://github.com/purebliss888/pro-rss-reader";
const ISSUES_URL = "https://github.com/purebliss888/pro-rss-reader/issues";

const section = (title, ...children) => h("section", { class: "setting-section info-section" }, h("h3", {}, title), ...children);
const p = (...children) => h("p", { class: "info-text" }, ...children);
const code = (text) => h("code", {}, text);
const steps = (...items) => h("ol", { class: "info-steps" }, ...items.map((i) => h("li", {}, i)));
const bullets = (...items) => h("ul", { class: "info-bullets" }, ...items.map((i) => h("li", {}, i)));
const link = (href, text) => h("a", { href, target: "_blank", rel: "noopener noreferrer" }, text);
const kbd = (text) => h("kbd", {}, text);

function shortcuts(rows) {
  return h(
    "dl",
    { class: "info-keys" },
    ...rows.flatMap(([keys, what]) => [h("dt", {}, ...keys), h("dd", {}, what)])
  );
}

function appAddress() {
  try {
    return browser.runtime.getURL("app/index.html");
  } catch {
    return "";
  }
}

function copyButton(text) {
  const btnText = "Copy address"
  const btn = h("button", { class: "btn btn-ghost", type: "button" }, btnText);
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Select and copy it instead";
    }
    setTimeout(() => (btn.textContent = btnText), 2000);
  });
  return btn;
}

function version() {
  try {
    return browser.runtime.getManifest().version;
  } catch {
    return "";
  }
}

export function openInfo() {
  const dlg = createModal({ className: "info-modal", label: "About Pro RSS Reader" });
  const closeBtn = h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onClick: () => closeModal(dlg) });
  closeBtn.append(iconEl("close"));

  const v = version();

  dlg.append(
    h(
      "div",
      { class: "modal-card" },
      h("div", { class: "modal-head" }, h("h2", {}, "Pro RSS Reader"), closeBtn),
      h(
        "div",
        { class: "modal-body" },
        section(
          "About",
          p(
            `Pro RSS Reader discover and reads RSS, Atom, RDF and JSON feeds from the websites and shows full articles in a clean reading view.`
          ),
          p(
            "Pro RSS Reader respect user's privacy. Subscriptions and cached articles stay in this browser. There is no account, no tracking, no analytics and no proxy server. Feeds and articles are fetched directly from their own websites."
          ),
          p("Bookmark this address to open Pro RSS Reader straight from the bookmarks bar:"),
          h("pre", { class: "info-code" }, appAddress()),
          h("div", { class: "btn-row" }, copyButton(appAddress())),
          p(
            "The long code in the address is private to this browser and installation. A bookmark keeps working across updates, but it must be made again if the extension is removed and installed again, or in another browser."
          )
        ),

        section(
          "Adding a feed",
          steps(
            ["Click ", h("strong", {}, "Add feed"), " in the sidebar."],
            "Type a feed address or the address of any website. For a website, the extension looks for its feeds and uses the best one.",
            "Optionally set a name and a folder, then click Add feed."
          ),
          p("Feeds can also be imported from, and exported to, an OPML file in ", h("strong", {}, "Settings"), "."),
          p(
            "Many sites don't send feed, so extension offers to add their feed via Google News. To generate feed for any website using Google News, url format is:"
          ),
          h("pre", { class: "info-code" }, "https://news.google.com/rss/search?q=site:example.com&hl=en-IN&gl=IN&ceid=IN:en"),
          p("Replace ", code("example.com"), " with the site address. Choose the language and region parameter for the site:"),
          bullets(
            [code("hl"), " is the language, for example ", code("en-IN"), " or just ", code("en"), " for English."],
            [code("gl"), " is the country, for example ", code("IN"), " for India."],
            [code("ceid"), " combines country and language, for example ", code("IN:en"), "."]
          ),
          p(
            "The extension guesses them from the site. If a feed shows no articles, try changing them, or pick a different edition from the list."
          ),
          p(
            "Article link from Google News url is resolved to the publisher's page. Resolving a link normally needs no page at all. If that fails, a background tab may open the link briefly to find the real address.")
        ),

        section(
          "Folders and refreshing",
          bullets(
            "Use Add folder to group feeds. Choose a folder in a feed's edit dialog to move it there.",
            "Any folder can be set as Home. The app opens on it and refreshes only its feeds when it starts. If no folder is set as Home, all feeds are shown.",
            "Opening a feed or folder refreshes it. The refresh button at the top of the list refreshes what you are viewing, or everything on All items.",
          ),
          p("A feed may fail to refresh sometime. Common causes:"),
          h(
            "dl",
            { class: "info-keys info-errors" },
            ...[
              ["429 Too Many Requests", "The site is rate limiting you: too many requests in a short time. Wait for some time and try again."],
              ["403 Forbidden", "The site refuses to answer this request. Some sites block anything that isn't a normal browser session, or block automated readers and certain networks. Trying again later or from another network may help. Otherwise the site may simply not allow readers."],
              ["401 Unauthorized", "The feed needs a login. Feeds that require an account or a private token in the address are only supported if the token is part of the feed address."],
              ["404 or 410", "The feed address no longer exists. Open the website, find its current feed address, and edit the feed to use the new address."],
              ["500, 502, 503, 504", "The site's server is having trouble. This is usually temporary. Try again later."],
              ["Timeout or network error", "The site was too slow or couldn't be reached. Check your connection, then try again. Sites that are down or blocked in your region fail this way too."],
              ["Not a feed / could not be parsed", "The address returns a web page or broken data instead of a feed. Use the website's address and let the extension look for the feed, or edit the feed's address."],
            ].flatMap(([code, text]) => [h("dt", {}, code), h("dd", {}, text)])
          ),
          p("Nothing is sent to anyone but the feed's own website. No cookies or referrer are included, which is good for privacy but can make a few strict sites refuse the request.")
        ),

        section(
          "Keyboard and mouse shortcuts",
          shortcuts([
            [["Click"], "Open an article in the reader."],
            [[kbd("Ctrl"), " + Click or Middle click"], "Open an article's page in a new tab."],
            [[kbd("Esc")], "Close the reader, a dialog or Settings."],
            [[kbd("↑"), " ", kbd("↓"), " ", kbd("Page Up"), " ", kbd("Page Down"), " ", kbd("Space")], "Scroll the article in the reader."],
            [[kbd("Tab"), " / ", kbd("Shift"), " + ", kbd("Tab")], "Move between buttons, links and fields."],
            [[kbd("Enter")], "Submit the open dialog."],
            [["Toolbar button badge"], "Show the feeds of the website you are on."]
          ])
        ),

        section(
          "Help and source",
          bullets(
            ["Source code: ", link(SOURCE_URL, SOURCE_URL)],
            ["Report a problem or suggest an improvement: ", link(ISSUES_URL, ISSUES_URL)],
            "When reporting a problem, include the entries from Settings → Logs."
          ),
          p("Article cleaning uses Mozilla's Readability.js (Apache License 2.0). See THIRD_PARTY_NOTICES.md in the extension files.")
        )
      ),
      h("div", { class: "modal-foot" }, h("button", { class: "btn btn-primary", type: "button", onClick: () => closeModal(dlg) }, "Close"))
    )
  );
  openModal(dlg);
}