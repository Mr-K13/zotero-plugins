# Link Article to Book (Zotero 8–10 plugin)

Right-click an article or chapter (A) that has an ISBN, then choose **Link to Page in Book (by ISBN)**. The plugin then:

1. Finds another item in your library with the same ISBN (B), preferring items of type *Book*.
   ISBN-10 and ISBN-13 are treated as equal, and hyphens are ignored.
   Any ISBN listed in the ISBN field counts.
2. Reads the text of B's PDF page by page and finds the page with A's title.
   The title usually also appears in the table of contents and sometimes in page headers.
   To find the chapter's first page, each matching page is scored on:
   - whether "Abstract" follows the title
   - whether the title is near the top of the page
   - whether the author names appear
   - whether A's start page number appears
   - whether the page looks like a table of contents (this lowers the score)
3. Attaches a page link to A: `zotero://open-pdf/library/items/<PDF_KEY>?page=<N>`.
   If A already links to that PDF, the existing link is updated instead.

Search order, stopping as soon as a confident match is found:

1. Zotero's full-text index cache (`.zotero-ft-cache`), when it is up to date.
   Reading it takes milliseconds.
   By default Zotero indexes only the first 100 pages of a PDF.
2. About 40 pages starting at A's printed start page (from A's *Pages* field).
   The front matter of a book pushes PDF pages forward, so the chapter usually starts a little after its printed page number.
3. The whole PDF, as a last resort.
   This takes about 1 second per 130 pages.

With one item selected, the plugin shows the page it found, and any other matching pages, so you can correct it before the link is created.
With several items selected, it links them all and then shows a summary.

The links use the same format as the **Page Link** plugin, so its features work on them too:

- Double-clicking A opens the linked page when A has no file of its own.
- **Change Linked Page…** lets you change the page.

Double-clicking the link attachment itself works in Zotero with no plugin needed.

## Limits

- The book's PDF must contain a text layer. A scanned PDF needs OCR first.
- Pages are physical PDF pages (first page = 1).
- The ISBN is read from A's ISBN field or from an `ISBN: …` line in Extra.
  A *Journal Article* has no ISBN field, so put the ISBN in Extra.

## Development install

Create `<profile>/extensions/link-article-to-book@zotero-plugins.local` containing this folder's absolute path.
Delete the `extensions.lastApp*` lines from `prefs.js`.
Start Zotero and enable the plugin in **Tools → Plugins**.

Build an .xpi: run `./build.sh` from the repository root (writes `dist/*.xpi`).
