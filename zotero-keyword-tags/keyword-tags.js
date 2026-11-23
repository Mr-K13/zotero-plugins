/* global Zotero, Services, JournalRank */

/**
 * Keyword Tags
 *
 * Right-click a collection (or a library) and choose "Add Keyword and Rank Tags…".
 *
 *  - Keyword tags: enter tags separated by commas. Each tag is added to every
 *    item whose Title or Abstract contains the tag text, ignoring case.
 *  - Rank tags (optional): add "Rank:Q1"–"Rank:Q4" from the journal's SCImago
 *    best quartile, or "Rank:NA" when the journal has no quartile or isn't
 *    listed. Items that already have a "Rank:" tag are skipped. See journal-rank.js.
 *
 * Existing tags are never removed or duplicated (compared ignoring case).
 *
 * The items are the ones Zotero lists for the collection, ignoring any search
 * or tag filter. Subcollections are included when View → "Show Items from
 * Subcollections" is on. Notes and standalone attachments are skipped.
 */
KeywordTags = {
  id: null,
  version: null,
  rootURI: null,
  menuIDs: [],

  TITLE: "Add Keyword and Rank Tags",
  RANK_PREFIX: "Rank:",
  PREF_LAST_TAGS: "extensions.keyword-tags.lastTags",
  PREF_ADD_RANK: "extensions.keyword-tags.addRank",

  init({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    this.registerMenus();
    this.log(`started (v${version})`);
  },

  log(msg) {
    Zotero.debug("Keyword Tags: " + msg);
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
    window.MozXULElement.insertFTLIfNeeded("keyword-tags.ftl");
  },

  removeFromWindow(window) {
    window.document.querySelector('[href="keyword-tags.ftl"]')?.remove();
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
      menuID: "keyword-tags-collection-menu",
      pluginID: this.id,
      target: "main/library/collection",
      menus: [
        {
          menuType: "menuitem",
          l10nID: "keyword-tags-menu",
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

  /** Selected collections and libraries that can be edited. */
  getRows(context) {
    return (context.collectionTreeRows || []).filter(row =>
      (row.isCollection() || row.type == "library" || row.type == "group")
      && row.editable
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
    let { tags, addRank } = options;

    let progress = new Zotero.ProgressWindow({ closeOnClick: false });
    progress.changeHeadline(this.TITLE);
    let line = new progress.ItemProgress(null, `Checking ${items.length} item(s)…`);
    progress.show();

    let rankData = null;
    let changed = 0;
    let keywordCounts = new Map(tags.map(tag => [tag, 0])); // tag -> items it was added to
    let rankCounts = new Map(); // "Q1"… -> items
    let alreadyRanked = 0;
    let unranked = []; // items without a rank, with the reason
    let failures = [];
    try {
      if (addRank) {
        rankData = await JournalRank.ensureIndex(window, text => line.setText(text));
        if (!rankData) {
          Services.prompt.alert(window, this.TITLE, "No ranking data, so no rank tags will be added.");
          if (!tags.length) return;
          addRank = false;
        }
      }

      for (let [i, item] of items.entries()) {
        line.setText(`(${i + 1}/${items.length}) ${this.shorten(item.getDisplayTitle(), 50)}`);
        line.setProgress(Math.round(i / items.length * 100));
        let title = this.shorten(item.getDisplayTitle(), 60);
        try {
          let newTags = this.tagsToAdd(item, tags);

          let rank = "";
          if (addRank) {
            if (this.hasRankTag(item)) {
              alreadyRanked++;
            }
            else {
              let result = await JournalRank.rankItem(item);
              rank = result.rank;
              if (!rank) unranked.push(`${title}: ${result.message}`);
              this.log(`${item.libraryKey}: rank ${rank || "none"}`
                + (result.journal ? ` (${result.journal})` : "") + (result.message ? ` — ${result.message}` : ""));
            }
          }

          if (!newTags.length && !rank) continue;
          for (let tag of newTags) item.addTag(tag);
          if (rank) item.addTag(this.RANK_PREFIX + rank);
          await item.saveTx();
          changed++;
          for (let tag of newTags) keywordCounts.set(tag, keywordCounts.get(tag) + 1);
          if (rank) rankCounts.set(rank, (rankCounts.get(rank) || 0) + 1);
          this.log(`${item.libraryKey}: added ${[...newTags, rank && this.RANK_PREFIX + rank].filter(Boolean).join(", ")}`);
        }
        catch (e) {
          Zotero.logError(e);
          failures.push(`${title}: ${e?.message || e}`);
        }
      }
      line.setProgress(100);
    }
    finally {
      progress.close();
    }

    Services.prompt.alert(window, this.TITLE, this.summary({
      items, scope, changed, keywordCounts, addRank, rankData, rankCounts, alreadyRanked, unranked, failures,
    }));
  },

  summary({ items, scope, changed, keywordCounts, addRank, rankData, rankCounts, alreadyRanked, unranked, failures }) {
    let list = (lines, max = 10) => lines.slice(0, max).map(l => `• ${l}`).join("\n")
      + (lines.length > max ? `\n• … and ${lines.length - max} more (see Help → Debug Output Logging)` : "");

    let msg = `Checked ${items.length} item(s) in ${scope}. Added tags to ${changed} item(s).`;
    if (keywordCounts.size) {
      msg += "\n\nKeyword tags:\n" + list([...keywordCounts].map(([tag, n]) => `${tag}: ${n} item(s)`), 50);
    }
    if (addRank) {
      let ranks = ["Q1", "Q2", "Q3", "Q4", "NA"].map(r => `${this.RANK_PREFIX}${r}: ${rankCounts.get(r) || 0} item(s)`);
      msg += `\n\nRank tags (SCImago ${rankData.year}):\n` + list(ranks);
      if (alreadyRanked) msg += `\n• Already had a Rank tag: ${alreadyRanked} item(s)`;
      if (unranked.length) msg += `\n\nNo rank found (${unranked.length}):\n` + list(unranked);
    }
    if (failures.length) {
      msg += `\n\nFailed (${failures.length}):\n` + list(failures);
    }
    return msg;
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
   * Ask for comma-separated keyword tags and whether to add rank tags.
   * Returns { tags, addRank }, or null if cancelled.
   */
  promptOptions(window, count, scope) {
    let input = { value: Zotero.Prefs.get(this.PREF_LAST_TAGS, true) || "" };
    let addRank = { value: Zotero.Prefs.get(this.PREF_ADD_RANK, true) ?? true };
    let text = `Tags to add to the ${count} item(s) in ${scope}, separated by commas.\n`
      + "Each tag is added only to items whose Title or Abstract contains it (ignoring case).\n"
      + "Leave empty to add only rank tags.";
    let check = "Also add journal rank tags (Rank:Q1–Q4, or Rank:NA) from SCImago";
    while (true) {
      if (!Services.prompt.prompt(window, this.TITLE, text, input, check, addRank)) return null;
      let tags = this.parseTags(input.value);
      if (tags.length || addRank.value) {
        Zotero.Prefs.set(this.PREF_LAST_TAGS, input.value, true);
        Zotero.Prefs.set(this.PREF_ADD_RANK, addRank.value, true);
        return { tags, addRank: addRank.value };
      }
      Services.prompt.alert(window, this.TITLE, "Enter at least one tag, or tick the journal rank option.");
    }
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

  /** Requested tags found in the item's Title or Abstract that it doesn't have yet. */
  tagsToAdd(item, tags) {
    if (!tags.length) return [];
    let searchable = (item.getField("title", false, true) + "\n" + item.getField("abstractNote")).toLowerCase();
    let existing = new Set(item.getTags().map(t => t.tag.trim().toLowerCase()));
    return tags.filter(tag => searchable.includes(tag.toLowerCase()) && !existing.has(tag.toLowerCase()));
  },

  hasRankTag(item) {
    let prefix = this.RANK_PREFIX.toLowerCase();
    return item.getTags().some(t => t.tag.trim().toLowerCase().startsWith(prefix));
  },

  shorten(s, n) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  },
};
