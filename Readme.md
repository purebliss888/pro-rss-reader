# Pro RSS Reader

A private RSS, Atom, RDF and JSON Feed reader for Firefox (desktop and Android),
with feed discovery and Google News feeds for sites that publish none, and a
clean full-article reader.

## Features
- Reads RSS, Atom, RDF and JSON Feed. Given a website address it finds the site's
  feeds (advertised links, common paths, WordPress REST API) and verifies them.
- Toolbar button with a badge showing how many feeds the current page advertises.
  Clicking it opens an overlay to add them.
- Sites without a feed can be followed through a generated Google News feed, with
  option to choose language and country.
- Folders, one of which can be set as Home view that opens at start. "All items" 
  always shows everything.
- Full-article reader built on Mozilla Readability. Falls back to the article text
  in the page's structured data when the page is rendered by JavaScript.
- OPML import (merged into existing subscriptions) and export, a log viewer,
  dark and light themes, cache limits.

## Privacy
No analytics, no accounts, no external dependencies and no proxy servers. Feeds
and articles are requested directly from their own websites, without cookies or a
referrer. Subscriptions, settings and cached articles stay in this browser.
Other sites webpages are only inspected locally, to count and list the feeds they 
advertise.

## Permissions
| Permission | Why |
| --- | --- |
| `storage`, `unlimitedStorage` | Subscriptions, settings, logs and the article cache |
| `tabs` | Find and focus the reader tab; read the title and address of the current tab |
| `scripting`, `activeTab` | Read the feed links of the page the toolbar button is used on |
| `<all_urls>` (host) | Fetch feeds, articles and icons from any site; count a page's feeds |

## License
MIT, see `LICENSE`. Third-party notices are in `THIRD-PARTY-NOTICES.md`.
