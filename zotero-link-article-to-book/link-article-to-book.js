/* global Zotero, Services */

/**
 * Link Article to Book
 *
 * For an article/chapter A that has an ISBN:
 *   1. find book B in the library with the same ISBN (ISBN-10/13 and hyphens normalised)
 *   2. extract the text of B's PDF page by page and find the page containing A's title
 *   3. attach a page link to A:  zotero://open-pdf/library/items/<PDF_KEY>?page=<N>
 *
 * The link uses the same format as the "Page Link" plugin, so that plugin's
 * double-click and "Change Linked Page…" features work on these links too.
 * Double-clicking the link attachment itself works natively in Zotero.
 */
LinkArticleToBook = {
  id: null,
  version: null,
  rootURI: null,
  menuIDs: [],

  URL_PREFIX: "zotero://open-pdf/",
  TITLE: "Link Article to Book",
  // Don't consider more than this many candidate PDFs per article
  MAX_PDFS_PER_ARTICLE: 5,

  init({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    this.registerMenus();
    this.log(`started (v${version})`);
  },

  log(msg) {
    Zotero.debug("Link Article to Book: " + msg);
  },

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  addToAllWindows() {
    for (let win of Zotero.getMainWindows()) {
      if (win.ZoteroPane) this.addToWindow(win);
    }
  },

  addToWindow(window) {
    window.MozXULElement.insertFTLIfNeeded("link-article-to-book.ftl");
  },

  removeFromWindow(window) {
    window.document.querySelector('[href="link-article-to-book.ftl"]')?.remove();
  },

  shutdown() {
    for (let win of Zotero.getMainWindows()) {
      this.removeFromWindow(win);
    }
    for (let menuID of this.menuIDs) {
      Zotero.MenuManager.unregisterMenu(menuID);
    }
    this.menuIDs = [];
  },

  registerMenus() {
    let menuID = Zotero.MenuManager.registerMenu({
      menuID: "link-article-to-book-item-menu",
      pluginID: this.id,
      target: "main/library/item",
      menus: [
        {
          menuType: "menuitem",
          l10nID: "link-article-to-book-menu",
          onShowing: (event, context) => {
            let items = (context.items || []).filter(i => i.isRegularItem());
            context.setVisible(items.some(i => this.getISBNs(i).length));
          },
          onCommand: (event, context) => {
            let window = event.target.ownerGlobal;
            let items = (context.items || []).filter(i => i.isRegularItem() && this.getISBNs(i).length);
            this.run(items, window).catch((e) => {
              Zotero.logError(e);
              Services.prompt.alert(window, this.TITLE, "Error: " + (e?.message || e));
            });
          },
        },
      ],
    });
    if (menuID) this.menuIDs.push(menuID);
  },

  // ---------------------------------------------------------------------------
  // Main flow
  // ---------------------------------------------------------------------------

  async run(articles, window) {
    if (!articles.length) return;
    let interactive = articles.length == 1;
    let textCache = new Map(); // pdf item id -> string[] (page texts)
    let results = [];

    let progress = new Zotero.ProgressWindow({ closeOnClick: true });
    progress.changeHeadline(this.TITLE);
    let line = new progress.ItemProgress(null, `Processing ${articles.length} item(s)…`);
    progress.show();

    try {
      for (let [i, article] of articles.entries()) {
        line.setText(`(${i + 1}/${articles.length}) ${this.shorten(article.getDisplayTitle(), 60)}`);
        line.setProgress(Math.round(i / articles.length * 100));
        try {
          results.push(await this.processArticle(article, window, interactive, textCache));
        }
        catch (e) {
          Zotero.logError(e);
          results.push({ article, status: "error", message: e?.message || String(e) });
        }
      }
      line.setProgress(100);
    }
    finally {
      progress.close();
    }

    // Single item: report problems only (success is visible in the item list)
    if (interactive) {
      let r = results[0];
      if (r.status != "linked" && r.status != "cancelled") {
        Services.prompt.alert(window, this.TITLE, r.message);
      }
      return;
    }
    let linked = results.filter(r => r.status == "linked");
    let failed = results.filter(r => r.status != "linked");
    let msg = `Linked ${linked.length} of ${results.length} item(s).`;
    if (failed.length) {
      msg += "\n\nNot linked:\n" + failed.map(r => `• ${this.shorten(r.article.getDisplayTitle(), 60)}: ${r.message}`).join("\n");
    }
    Services.prompt.alert(window, this.TITLE, msg);
  },

  async processArticle(article, window, interactive, textCache) {
    let isbns = this.getISBNs(article);
    if (!isbns.length) {
      return { article, status: "skipped", message: "No valid ISBN." };
    }
    let title = article.getField("title");
    if (!title) {
      return { article, status: "skipped", message: "Item has no title." };
    }

    let books = await this.findBooksByISBN(isbns, article);
    if (!books.length) {
      return { article, status: "notfound", message: `No other item in the library has ISBN ${isbns.join(" / ")}.` };
    }

    let pdfs = [];
    for (let book of books) {
      for (let att of Zotero.Items.get(book.getAttachments())) {
        if (att.isPDFAttachment() && await att.fileExists()) pdfs.push({ book, pdf: att });
      }
    }
    if (!pdfs.length) {
      return {
        article,
        status: "nopdf",
        message: `Found “${this.shorten(books[0].getDisplayTitle(), 60)}” with the same ISBN, but it has no PDF file available.`,
      };
    }

    for (let { book, pdf } of pdfs.slice(0, this.MAX_PDFS_PER_ARTICLE)) {
      let t = Date.now();
      let found = await this.findTitlePage(pdf, article, textCache);
      this.log(`Search in ${pdf.libraryKey} took ${Date.now() - t} ms`);
      if (!found) continue;

      let page = found.page;
      if (interactive) {
        let others = found.alternatives.filter(p => p != page);
        let text = `Found the title on page ${page} of “${this.shorten(book.getDisplayTitle(), 70)}”.`;
        if (others.length) {
          text += `\nThe title also appears on page(s): ${others.slice(0, 10).join(", ")}${others.length > 10 ? ", …" : ""}.`;
        }
        text += "\n\nPage to link (physical PDF page, first page = 1):";
        page = this.promptPage(window, page, text);
        if (!page) return { article, status: "cancelled", message: "Cancelled." };
      }
      let { updated } = await this.createOrUpdateLink(article, book, pdf, page);
      return {
        article,
        status: "linked",
        message: `${updated ? "Updated link to" : "Linked to"} page ${page}.`,
      };
    }

    let bookTitle = this.shorten(pdfs[0].book.getDisplayTitle(), 60);
    let message = `Found “${bookTitle}”, but couldn't find the article title in its PDF text`
      + " (if the PDF is a scan, it needs OCR first).";
    if (interactive) {
      let page = this.promptPage(window, "", message + "\n\nEnter a page number to link anyway, or Cancel:");
      if (!page) return { article, status: "cancelled", message: "Cancelled." };
      await this.createOrUpdateLink(article, pdfs[0].book, pdfs[0].pdf, page);
      return { article, status: "linked", message: `Linked to page ${page}.` };
    }
    return { article, status: "notext", message };
  },

  // ---------------------------------------------------------------------------
  // ISBN handling
  // ---------------------------------------------------------------------------

  /** All valid ISBNs of an item (ISBN field + "ISBN:" lines in Extra), as ISBN-13. */
  getISBNs(item) {
    let sources = [];
    try {
      sources.push(item.getField("ISBN") || "");
    }
    catch (_) {}
    let extra = item.getField("extra") || "";
    for (let m of extra.matchAll(/^\s*ISBN\s*:\s*(.+)$/gim)) {
      sources.push(m[1]);
    }
    return this.parseISBNs(sources.join(" "));
  },

  parseISBNs(str) {
    let result = new Set();
    if (!str) return [];
    let cleaned = str.toUpperCase().replace(/[\x2D\xAD‐-―⁃−]+/g, "");
    for (let m of cleaned.matchAll(/(?<![0-9X])(97[89]\d{10}|\d{9}[\dX])(?![0-9X])/g)) {
      let valid = Zotero.Utilities.cleanISBN(m[1]);
      if (valid) result.add(Zotero.Utilities.toISBN13(valid));
    }
    return [...result];
  },

  /** Regular items (other than `article`) sharing an ISBN; books and same-library items first. */
  async findBooksByISBN(isbns, article) {
    let fieldID = Zotero.ItemFields.getID("ISBN");
    let rows = await Zotero.DB.queryAsync(
      "SELECT itemID, value FROM itemData JOIN itemDataValues USING (valueID) "
        + "WHERE fieldID=? AND itemID NOT IN (SELECT itemID FROM deletedItems)",
      [fieldID]
    );
    let wanted = new Set(isbns);
    let ids = [];
    for (let row of rows) {
      if (row.itemID == article.id) continue;
      if (this.parseISBNs(row.value).some(isbn => wanted.has(isbn))) ids.push(row.itemID);
    }
    let items = (await Zotero.Items.getAsync(ids)).filter(i => i && i.isRegularItem());
    let rank = item => (item.itemType == "book" ? 0 : 2) + (item.libraryID == article.libraryID ? 0 : 1);
    return items.sort((a, b) => rank(a) - rank(b));
  },

  // ---------------------------------------------------------------------------
  // Finding the page
  // ---------------------------------------------------------------------------

  normalize(s) {
    return (s || "")
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "");
  },

  // Accept a match without scanning further when its score reaches this
  // (a chapter opening page: title near the top + "Abstract" after it, or similar)
  CONFIDENT_SCORE: 5,
  // Pages to scan after the printed start page (front matter shifts physical pages forward)
  WINDOW_PAGES: 40,

  /**
   * Per-PDF page text store. `pages[i]` is the text of page i, or undefined if
   * not loaded yet. Text comes from Zotero's full-text index cache when it is
   * up to date (instant), otherwise from the PDF worker, page ranges on demand.
   */
  async getPageStore(pdf, textCache) {
    if (textCache.has(pdf.id)) return textCache.get(pdf.id);
    let store = { pdf, pages: [], total: null, normCache: [] };
    try {
      let row = await Zotero.DB.rowQueryAsync(
        "SELECT indexedPages, totalPages FROM fulltextItems WHERE itemID=?", [pdf.id]
      );
      if (row && row.totalPages) store.total = row.totalPages;
      let cacheFile = Zotero.Fulltext.getItemCacheFile(pdf).path;
      let pdfPath = await pdf.getFilePathAsync();
      if (row && row.indexedPages && await IOUtils.exists(cacheFile)) {
        let [cacheStat, pdfStat] = await Promise.all([IOUtils.stat(cacheFile), IOUtils.stat(pdfPath)]);
        if (cacheStat.lastModified >= pdfStat.lastModified) {
          let parts = (await Zotero.File.getContentsAsync(cacheFile)).split("\f");
          // Only trust the cache if its page count matches what was indexed
          if (parts.length == row.indexedPages) {
            parts.forEach((text, i) => (store.pages[i] = text));
            this.log(`Using full-text cache for ${pdf.libraryKey} (${parts.length}/${store.total} pages)`);
          }
        }
      }
    }
    catch (e) {
      Zotero.logError(e);
    }
    textCache.set(pdf.id, store);
    return store;
  },

  /** Make sure pages [from, to) are loaded (to = null: until the end). */
  async loadPages(store, from, to) {
    from = Math.max(0, from);
    if (store.total != null) to = Math.min(to ?? store.total, store.total);
    let missing = [];
    if (to == null) {
      // Total page count unknown: extract everything from `from`
      let t = Date.now();
      let r = await Zotero.PDFWorker.getFullText(store.pdf.id, null, true);
      store.total = r.totalPages;
      this.log(`Extracted all ${r.totalPages} pages in ${Date.now() - t} ms`);
      if (!this.assignPages(store, [...Array(r.totalPages).keys()], r.text)) {
        await this.loadPages(store, from, store.total);
      }
      return;
    }
    for (let i = from; i < to; i++) {
      if (store.pages[i] === undefined) missing.push(i);
    }
    if (!missing.length) return;
    let t = Date.now();
    let r = await Zotero.PDFWorker.getFullText(store.pdf.id, missing, true);
    store.total = r.totalPages;
    missing = missing.filter(i => i < r.totalPages);
    if (!this.assignPages(store, missing, r.text)) {
      // getFullText() trims its output, so blank pages at the start/end of the
      // requested range can shift the page boundaries; extract those one by one
      this.log("Page boundary mismatch; extracting pages individually");
      for (let i of missing) {
        let single = await Zotero.PDFWorker.getFullText(store.pdf.id, [i], true);
        store.pages[i] = single.text || "";
      }
    }
    this.log(`Extracted ${missing.length} page(s) (${missing[0] + 1}–${missing[missing.length - 1] + 1}) in ${Date.now() - t} ms`);
  },

  assignPages(store, indexes, text) {
    let parts = (text || "").split("\f");
    if (parts.length != indexes.length) return false;
    indexes.forEach((pageIndex, i) => (store.pages[pageIndex] = parts[i]));
    return true;
  },

  normPage(store, i) {
    if (store.normCache[i] === undefined) store.normCache[i] = this.normalize(store.pages[i]);
    return store.normCache[i];
  },

  /**
   * Returns { page, alternatives } (1-based physical pages) or null.
   *
   * Search order, stopping as soon as a confident match is found:
   *   1. pages already available (Zotero's full-text cache) — no extraction
   *   2. a window starting at the article's printed start page ("pages" field)
   *   3. the whole PDF
   * The title often also appears in the table of contents and in running
   * headers, so matching pages are scored to find the chapter's first page.
   */
  async findTitlePage(pdf, article, textCache) {
    let title = article.getField("title");
    let keys = [];
    let full = this.normalize(title);
    keys.push(full.length > 90 ? full.slice(0, 90) : full);
    let main = this.normalize(title.split(/[:?.!]\s/)[0]);
    if (main.length >= 15 && main != full) keys.push(main);
    keys = keys.filter(k => k.length >= 8);
    if (!keys.length) return null;

    let ctx = {
      title,
      keys,
      authors: article.getCreators()
        .map(c => this.normalize(c.lastName || c.name || ""))
        .filter(n => n.length >= 3),
      startPage: parseInt(String(article.getField("pages") || "").match(/\d+/)?.[0]),
    };

    let store = await this.getPageStore(pdf, textCache);
    let best = this.scoreLoadedPages(store, ctx);
    if (best && best.score >= this.CONFIDENT_SCORE) return best.result;

    if (Number.isInteger(ctx.startPage) && ctx.startPage > 0) {
      await this.loadPages(store, ctx.startPage - 1, ctx.startPage - 1 + this.WINDOW_PAGES);
      best = this.scoreLoadedPages(store, ctx);
      if (best && best.score >= this.CONFIDENT_SCORE) return best.result;
    }

    this.log("No confident match yet; scanning the whole PDF");
    await this.loadPages(store, 0, null);
    best = this.scoreLoadedPages(store, ctx);
    return best ? best.result : null;
  },

  scoreLoadedPages(store, ctx) {
    let { pages } = store;
    let matches = [];
    for (let key of ctx.keys) {
      for (let i = 0; i < pages.length; i++) {
        if (pages[i] === undefined) continue;
        let pos = this.normPage(store, i).indexOf(key);
        if (pos != -1) matches.push({ index: i, pos });
      }
      if (matches.length) break; // full title matched; don't fall back to main title
    }
    if (!matches.length) return null;

    let matchedSet = new Set(matches.map(m => m.index));
    let scored = matches.map(({ index, pos }) => {
      let norm = this.normPage(store, index);
      let raw = pages[index].toLowerCase();
      let score = 0;
      // Chapter opening pages usually have the title near the top
      if (pos < norm.length * 0.35) score += 2;
      // "Abstract" shortly after the title is the strongest cue;
      // keywords/introduction anywhere on the page is a weaker one
      if (norm.slice(pos, pos + 1200).includes("abstract")) score += 4;
      else if (/\bkeywords?\b|\bintroduction\b/.test(raw)) score += 1;
      score += Math.min(2, ctx.authors.filter(a => norm.includes(a)).length);
      // The printed start page number appears in the page header/footer
      if (Number.isInteger(ctx.startPage) && new RegExp(`(^|\\D)${ctx.startPage}(\\D|$)`).test(pages[index])) score += 1;
      // Followed by running-header pages that repeat the title
      if (matchedSet.has(index + 1) || matchedSet.has(index + 2)) score += 1;
      // Table of contents
      if (/\b(table of )?contents\b/.test(raw.slice(0, 300))) score -= 4;
      let pageNumberLines = (pages[index].match(/\s\d{1,4}\s*(\n|$)/g) || []).length;
      if (pageNumberLines >= 8) score -= 2;
      return { index, score };
    });
    // Highest score; ties go to the later page (tables of contents come first)
    scored.sort((a, b) => b.score - a.score || b.index - a.index);
    this.log(`Matches for "${ctx.title}": ` + scored.map(s => `p${s.index + 1}:${s.score}`).join(", "));
    return {
      score: scored[0].score,
      result: {
        page: scored[0].index + 1,
        alternatives: [...matchedSet].sort((a, b) => a - b).map(i => i + 1),
      },
    };
  },

  // ---------------------------------------------------------------------------
  // Creating the link (same format as the Page Link plugin)
  // ---------------------------------------------------------------------------

  buildURL(pdf, page) {
    let prefix = "library";
    if (Zotero.Libraries.get(pdf.libraryID).libraryType == "group") {
      prefix = "groups/" + Zotero.Groups.getGroupIDFromLibraryID(pdf.libraryID);
    }
    return `${this.URL_PREFIX}${prefix}/items/${pdf.key}?page=${page}`;
  },

  async createOrUpdateLink(article, book, pdf, page) {
    let url = this.buildURL(pdf, page);
    let title = `p. ${page} – ${this.shorten(book.getDisplayTitle(), 80)}`;
    let pdfPart = url.split("?")[0];

    // If A already links to this PDF, update that link instead of adding another
    let existing = Zotero.Items.get(article.getAttachments()).find(att =>
      att.attachmentLinkMode == Zotero.Attachments.LINK_MODE_LINKED_URL
      && (att.getField("url") || "").split("?")[0] == pdfPart
    );
    if (existing) {
      existing.setField("url", url);
      existing.setField("title", title);
      await existing.saveTx();
      this.log(`Updated ${existing.libraryKey} -> ${url}`);
      return { item: existing, updated: true };
    }
    let item = await Zotero.Attachments.linkFromURL({ url, parentItemID: article.id, title });
    this.log(`Linked ${article.libraryKey} -> ${url}`);
    return { item, updated: false };
  },

  // ---------------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------------

  promptPage(window, defaultPage, text) {
    while (true) {
      let value = { value: String(defaultPage ?? "") };
      if (!Services.prompt.prompt(window, this.TITLE, text, value, null, {})) return null;
      let s = value.value.trim();
      let page = parseInt(s, 10);
      if (Number.isInteger(page) && page >= 1 && String(page) == s) return page;
      Services.prompt.alert(window, this.TITLE, "Please enter a whole number, 1 or greater.");
    }
  },

  shorten(s, n) {
    s = s || "";
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  },
};
