/* global Zotero, Services, ChromeUtils, IOUtils, PathUtils */

/**
 * Export CSV
 *
 * Right-click a collection (or a library) and choose "Export Items to CSV…".
 * Enter tags to filter by (or leave empty for all items), then choose where to
 * save the file. Each item becomes one row with these columns:
 *
 *   PDF Path, Item Type, Title, DOI, Year, Publication
 *
 *  - PDF Path: the full path of the item's PDF file. With several PDFs, the
 *    paths are joined by "; ", best one first (as Zotero opens them). Empty
 *    when the item has no PDF.
 *  - DOI: the DOI field, or a "DOI: …" line in Extra for item types without
 *    a DOI field.
 *  - Publication: the journal, book, proceedings or website title, depending
 *    on the item type.
 *
 * Tags are compared ignoring case. An item matches when it has any of the
 * tags, or all of them if you tick the option. Only the item's own tags count,
 * not the tags of its attachments or notes.
 *
 * The items are the ones Zotero lists for the collection, ignoring any search
 * or tag filter. Subcollections are included when View → "Show Items from
 * Subcollections" is on. Notes and standalone attachments are skipped.
 */
ExportCSV = {
  id: null,
  version: null,
  rootURI: null,
  menuIDs: [],

  TITLE: "Export Items to CSV",
  PREF_LAST_TAGS: "extensions.export-csv.lastTags",
  PREF_MATCH_ALL: "extensions.export-csv.matchAll",
  PREF_LAST_DIR: "extensions.export-csv.lastDir",

  COLUMNS: ["PDF Path", "Item Type", "Title", "DOI", "Year", "Publication"],
  PATH_SEPARATOR: "; ",

  init({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    this.registerMenus();
    this.log(`started (v${version})`);
  },

  log(msg) {
    Zotero.debug("Export CSV: " + msg);
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
    window.MozXULElement.insertFTLIfNeeded("export-csv.ftl");
  },

  removeFromWindow(window) {
    window.document.querySelector('[href="export-csv.ftl"]')?.remove();
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
      menuID: "export-csv-collection-menu",
      pluginID: this.id,
      target: "main/library/collection",
      menus: [
        {
          menuType: "menuitem",
          l10nID: "export-csv-menu",
          onShowing: (event, context) => {
            context.setVisible(this.getRows(context).length > 0);
          },
          onCommand: (event, context) => {
            let window = event.target.ownerGlobal;
            this.run(this.getRows(context), window).catch((e) => {
              Zotero.logError(e);
              Services.prompt.alert(window, this.TITLE, "Error: " + (e?.message || e));
            });
          },
        },
      ],
    });
    if (menuID) this.menuIDs.push(menuID);
  },

  /** Selected collections and libraries (read-only ones too). */
  getRows(context) {
    return (context.collectionTreeRows || []).filter(row =>
      row.isCollection() || row.type == "library" || row.type == "group"
    );
  },

  // ---------------------------------------------------------------------------
  // Main flow
  // ---------------------------------------------------------------------------

  async run(rows, window) {
    if (!rows.length) return;

    let items = await this.getItems(rows);
    let scope = rows.length == 1 ? `“${rows[0].getName()}”` : `${rows.length} collections`;
    if (!items.length) {
      Services.prompt.alert(window, this.TITLE, `There are no items in ${scope}.`);
      return;
    }

    let options = this.promptOptions(window, items.length, scope);
    if (!options) return;
    let { tags, matchAll } = options;

    let matched = items.filter(item => this.matchesTags(item, tags, matchAll));
    if (!matched.length) {
      Services.prompt.alert(window, this.TITLE,
        `None of the ${items.length} item(s) in ${scope} have ${matchAll ? "all" : "any"} of these tags:\n`
        + tags.join(", "));
      return;
    }

    let defaultName = rows.length == 1 ? rows[0].getName() : "Zotero Export";
    let path = await this.pickFile(window, defaultName);
    if (!path) return;

    let progress = new Zotero.ProgressWindow({ closeOnClick: false });
    progress.changeHeadline(this.TITLE);
    let line = new progress.ItemProgress(null, `Reading ${matched.length} item(s)…`);
    progress.show();

    let records = [];
    let noPDF = 0;
    let missingFiles = 0;
    try {
      for (let [i, item] of matched.entries()) {
        if (i % 25 == 0) {
          line.setText(`(${i + 1}/${matched.length}) ${this.shorten(item.getDisplayTitle(), 50)}`);
          line.setProgress(Math.round(i / matched.length * 100));
        }
        let paths = await this.getPDFPaths(item);
        if (!paths.length) noPDF++;
        for (let p of paths) {
          if (!(await IOUtils.exists(p))) missingFiles++;
        }
        records.push(this.toRecord(item, paths));
      }
      line.setProgress(100);
      records.sort((a, b) => a[2].localeCompare(b[2], undefined, { sensitivity: "base" }));
      await IOUtils.writeUTF8(path, this.toCSV([this.COLUMNS, ...records]));
    }
    finally {
      progress.close();
    }
    this.log(`wrote ${records.length} row(s) to ${path}`);

    let msg = `Exported ${records.length} of the ${items.length} item(s) in ${scope}`
      + (tags.length ? ` (${matchAll ? "all" : "any"} of: ${tags.join(", ")})` : "")
      + `.\n\n${path}`;
    if (noPDF) msg += `\n\n• ${noPDF} item(s) have no PDF, so their PDF Path is empty.`;
    if (missingFiles) {
      msg += `\n• ${missingFiles} PDF path(s) point to a file that isn't on this computer, `
        + "for example because it hasn't been downloaded by sync yet.";
    }
    let ps = Services.prompt;
    let flags = ps.BUTTON_TITLE_OK * ps.BUTTON_POS_0
      + ps.BUTTON_TITLE_IS_STRING * ps.BUTTON_POS_1
      + ps.BUTTON_POS_0_DEFAULT;
    let button = ps.confirmEx(window, this.TITLE, msg, flags, null, "Show File", null, null, {});
    if (button == 1) Zotero.File.reveal(path);
  },

  /**
   * Regular items (not notes or attachments) in the given collections or
   * libraries, as Zotero lists them, ignoring the search box and tag filter.
   */
  async getItems(rows) {
    let ids = new Set();
    for (let row of rows) {
      for (let id of await row.getSearchResults(false, { unfiltered: true })) ids.add(id);
    }
    let items = await Zotero.Items.getAsync([...ids]);
    return items.filter(item => item.isRegularItem() && !item.deleted);
  },

  /**
   * Ask for comma-separated tags to filter by and whether all must match.
   * Returns { tags, matchAll }, or null if cancelled.
   */
  promptOptions(window, count, scope) {
    let input = { value: Zotero.Prefs.get(this.PREF_LAST_TAGS, true) || "" };
    let matchAll = { value: Zotero.Prefs.get(this.PREF_MATCH_ALL, true) ?? false };
    let text = `Export the ${count} item(s) in ${scope} to a CSV file.\n\n`
      + "Only export items with these tags, separated by commas (ignoring case).\n"
      + "Leave empty to export all items.";
    let check = "Items must have all of the tags (otherwise any one is enough)";
    if (!Services.prompt.prompt(window, this.TITLE, text, input, check, matchAll)) return null;
    Zotero.Prefs.set(this.PREF_LAST_TAGS, input.value, true);
    Zotero.Prefs.set(this.PREF_MATCH_ALL, matchAll.value, true);
    return { tags: this.parseTags(input.value), matchAll: matchAll.value };
  },

  parseTags(value) {
    let seen = new Set();
    let tags = [];
    for (let part of String(value || "").split(",")) {
      let tag = part.trim();
      let folded = tag.toLowerCase();
      if (tag && !seen.has(folded)) {
        tags.push(tag);
        seen.add(folded);
      }
    }
    return tags;
  },

  matchesTags(item, tags, matchAll) {
    if (!tags.length) return true;
    let own = new Set(item.getTags().map(t => t.tag.trim().toLowerCase()));
    let has = tag => own.has(tag.toLowerCase());
    return matchAll ? tags.every(has) : tags.some(has);
  },

  /** Ask where to save the CSV file. Returns the path, or null if cancelled. */
  async pickFile(window, defaultName) {
    let { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
    let fp = new FilePicker();
    fp.init(window, this.TITLE, fp.modeSave);
    fp.appendFilter("CSV", "*.csv");
    fp.defaultExtension = "csv";
    fp.defaultString = Zotero.File.getValidFileName(defaultName) + ".csv";
    let lastDir = Zotero.Prefs.get(this.PREF_LAST_DIR, true);
    if (lastDir) fp.displayDirectory = lastDir;

    let result = await fp.show();
    if (result != fp.returnOK && result != fp.returnReplace) return null;
    let path = fp.file;
    if (!/\.csv$/i.test(path)) path += ".csv";
    Zotero.Prefs.set(this.PREF_LAST_DIR, PathUtils.parent(path), true);
    return path;
  },

  // ---------------------------------------------------------------------------
  // Item data
  // ---------------------------------------------------------------------------

  /** Paths of the item's PDF attachments (stored or linked), best one first. */
  async getPDFPaths(item) {
    let attachments = await item.getBestAttachments();
    return attachments
      .filter(att => att.isPDFAttachment())
      .map(att => att.getFilePath())
      .filter(Boolean);
  },

  /** One CSV row, in the order of COLUMNS. */
  toRecord(item, paths) {
    return [
      paths.join(this.PATH_SEPARATOR),
      Zotero.ItemTypes.getLocalizedString(item.itemType),
      item.getField("title", false, true),
      this.getDOI(item),
      item.getField("year"),
      item.getField("publicationTitle", false, true),
    ];
  },

  /** The DOI field, or a "DOI: …" line in Extra (for types without a DOI field). */
  getDOI(item) {
    let doi = item.getField("DOI");
    if (!doi) {
      let match = item.getField("extra").match(/^\s*DOI:\s*(\S+)/im);
      doi = match ? match[1] : "";
    }
    return (doi && Zotero.Utilities.cleanDOI(doi)) || doi;
  },

  // ---------------------------------------------------------------------------
  // CSV
  // ---------------------------------------------------------------------------

  /**
   * RFC 4180 CSV with CRLF line endings. Starts with a UTF-8 byte order mark so
   * that Excel reads accented characters correctly.
   */
  toCSV(rows) {
    return "﻿" + rows.map(row => row.map(cell => this.csvCell(cell)).join(",")).join("\r\n") + "\r\n";
  },

  csvCell(value) {
    let s = String(value ?? "");
    return /[",\r\n]/.test(s) || s != s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
  },

  shorten(s, n) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  },
};
