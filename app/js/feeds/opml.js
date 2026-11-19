import { escapeHtml } from "../core/utils.js";

function feedOutline(feed, indent) {
  const attrs = [
    'type="rss"',
    `text="${escapeHtml(feed.name)}"`,
    `title="${escapeHtml(feed.name)}"`,
    `xmlUrl="${escapeHtml(feed.url)}"`,
  ];
  if (feed.siteUrl) attrs.push(`htmlUrl="${escapeHtml(feed.siteUrl)}"`);
  return `${indent}<outline ${attrs.join(" ")}/>`;
}

export function buildOpml(feeds, folders) {
  const lines = [];
  for (const folder of folders) {
    const inside = feeds.filter((f) => f.folderId === folder.id);
    lines.push(`    <outline text="${escapeHtml(folder.name)}" title="${escapeHtml(folder.name)}">`);
    inside.forEach((f) => lines.push(feedOutline(f, "      ")));
    lines.push("    </outline>");
  }
  const known = new Set(folders.map((f) => f.id));
  feeds.filter((f) => !f.folderId || !known.has(f.folderId)).forEach((f) => lines.push(feedOutline(f, "    ")));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head>",
    "    <title>Pro RSS Reader subscriptions</title>",
    `    <dateCreated>${new Date().toUTCString()}</dateCreated>`,
    "  </head>",
    "  <body>",
    ...lines,
    "  </body>",
    "</opml>",
    "",
  ].join("\n");
}

export function parseOpml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror") || !doc.documentElement || doc.documentElement.localName.toLowerCase() !== "opml") {
    throw new Error("This file is not a valid OPML document.");
  }
  const body = [...doc.documentElement.children].find((c) => c.localName.toLowerCase() === "body");
  if (!body) throw new Error("This OPML file has no subscriptions.");

  const feeds = [];
  const walk = (node, folder) => {
    for (const el of node.children) {
      if (el.localName.toLowerCase() !== "outline") continue;
      const xmlUrl = (el.getAttribute("xmlUrl") || el.getAttribute("xmlurl") || "").trim();
      const label = (el.getAttribute("text") || el.getAttribute("title") || "").trim();
      if (xmlUrl) {
        let url = null;
        try {
          const u = new URL(xmlUrl);
          if (u.protocol === "http:" || u.protocol === "https:") url = u.href;
        } catch {
          /* not a web address: skipped below */
        }
        if (url) {
          const html = (el.getAttribute("htmlUrl") || el.getAttribute("htmlurl") || "").trim();
          let siteUrl = null;
          try {
            const u = html && new URL(html);
            if (u && (u.protocol === "http:" || u.protocol === "https:")) siteUrl = u.href;
          } catch {
            /* ignore */
          }
          feeds.push({ name: label, url, siteUrl, folder });
        }
      } else if (el.children.length) {
        walk(el, label || folder);
      }
    }
  };
  walk(body, null);
  return { feeds };
}
