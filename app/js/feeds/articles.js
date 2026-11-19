// Converts parsed feed items into cached article records and stores them.

import { getArticlesByFeed, pruneArticles, putArticles } from "../core/db.js";
import { getFeeds } from "../core/storage.js";
import { getSettings } from "../core/settings.js";
import { hashString } from "../core/utils.js";

const articleId = (feedId, guid) => hashString(`${feedId}\n${guid}`);

// existing: Map(id -> record). An article keeps its original `date` across refreshes,
// so ordering stays stable. New items without a date are stamped in feed order.
function buildArticleRecords(feedId, items, existing = new Map(), now = Date.now()) {
  return items.map((it, index) => {
    const id = articleId(feedId, it.guid);
    const prev = existing.get(id);
    return {
      id,
      feedId,
      guid: it.guid,
      url: it.url,
      title: it.title,
      summary: it.summary,
      image: it.image,
      publisher: it.publisher || "",
      author: it.author,
      published: it.published,
      date: prev ? prev.date : it.published || now - index,
      fetched: now, // "last seen in the feed": cache expiry counts from here
    };
  });
}

export async function pruneAll() {
  const [settings, feeds] = await Promise.all([getSettings(), getFeeds()]);
  await pruneArticles(
    feeds.map((f) => f.id),
    { maxPerFeed: settings.maxItemsPerFeed, days: settings.cacheDays }
  );
}

export async function storeItems(feedId, items, { prune = true } = {}) {
  const existing = new Map((await getArticlesByFeed(feedId)).map((a) => [a.id, a]));
  await putArticles(buildArticleRecords(feedId, items, existing));
  if (prune) await pruneAll();
  return items.length;
}