/* global Zotero, Services */

/**
 * Page Link: lets item A carry a child "linked URL" attachment that points to
 * a specific page of item B's PDF, using Zotero's built-in URL scheme
 *
 *   zotero://open-pdf/library/items/<PDF_KEY>?page=<N>
 *   zotero://open-pdf/groups/<GROUP_ID>/items/<PDF_KEY>?page=<N>
 *
 * Zotero natively opens these links in its PDF reader at the given page, so
 * the links keep working (and sync) even if this plugin is removed.
 * The plugin adds:
 *   - item context menu: "Add Page Link to Another Article…" / "Change Linked Page…"
 *   - reader context menu: "Link This Page from Another Article…"
 *   - double-clicking a parent item that has no file of its own but has a
 *     page link opens the linked page.
 */
PageLink = {
  id: null,
  version: null,
  rootURI: null,
  menuIDs: [],
  readerHandler: null,

  URL_PREFIX: "zotero://open-pdf/",

  init({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    this.registerItemMenus();
    this.registerReaderMenu();
    this.log(`started (v${version})`);
  },

  log(msg) {
    Zotero.debug("Page Link: " + msg);
  },

  // ---------------------------------------------------------------------------
  // Window lifecycle
  // ---------------------------------------------------------------------------

  addToAllWindows() {
    for (let win of Zotero.getMainWindows()) {
      if (win.ZoteroPane) this.addToWindow(win);
    }
  },

  addToWindow(window) {
    window.MozXULElement.insertFTLIfNeeded("page-link.ftl");
    this.patchViewItems(window);
  },

  removeFromWindow(window) {
    window.document.querySelector('[href="page-link.ftl"]')?.remove();
    this.unpatchViewItems(window);
  },

  shutdown() {
    for (let win of Zotero.getMainWindows()) {
      this.removeFromWindow(win);
    }
    for (let menuID of this.menuIDs) {
      Zotero.MenuManager.unregisterMenu(menuID);
    }
    this.menuIDs = [];
    if (this.readerHandler) {
      Zotero.Reader.unregisterEventListener("createViewContextMenu", this.readerHandler);
      this.readerHandler = null;
    }
  },

  // ---------------------------------------------------------------------------
  // Double-click handling
  // ---------------------------------------------------------------------------

  /**
   * Double-clicking a page-link attachment already works natively (Zotero opens
   * the zotero://open-pdf URL). Here we additionally make double-clicking the
   * *parent* item A open the linked page when A has no file attachment of its
   * own (normally Zotero would fall back to A's URL/DOI field instead).
   */
  patchViewItems(window) {
    let zp = window.ZoteroPane;
    if (!zp || zp.__pageLinkOrigViewItems) return;
    let original = zp.viewItems;
    zp.__pageLinkOrigViewItems = original;
    zp.viewItems = async function (items, event, options = {}) {
      let remaining = [];
      for (let item of items) {
        try {
          if (item.isRegularItem() && !(await item.getBestAttachment())) {
            let link = PageLink.getPageLinks(item)[0];
            if (link) {
              PageLink.openLink(link, window, event);
              continue;
            }
          }
        }
        catch (e) {
          Zotero.logError(e);
        }
        remaining.push(item);
      }
      if (remaining.length) {
        return original.call(zp, remaining, event, options);
      }
    };
  },

  unpatchViewItems(window) {
    let zp = window.ZoteroPane;
    if (!zp || !zp.__pageLinkOrigViewItems) return;
    zp.viewItems = zp.__pageLinkOrigViewItems;
    delete zp.__pageLinkOrigViewItems;
  },

  openLink(linkItem, window, event) {
    window.ZoteroPane.loadURI(linkItem.getField("url"), event);
  },

  // ---------------------------------------------------------------------------
  // Menus
  // ---------------------------------------------------------------------------

  registerItemMenus() {
    let menuID = Zotero.MenuManager.registerMenu({
      menuID: "page-link-item-menu",
      pluginID: this.id,
      target: "main/library/item",
      menus: [
        {
          menuType: "menuitem",
          l10nID: "page-link-add",
          onShowing: (event, context) => {
            let items = context.items || [];
            context.setVisible(items.length == 1 && items[0].isRegularItem());
          },
          onCommand: (event, context) => {
            let window = event.target.ownerGlobal;
            this.addLinkFromSourceItem(context.items[0], window).catch(e => this.reportError(e, window));
          },
        },
        {
          menuType: "menuitem",
          l10nID: "page-link-edit",
          onShowing: (event, context) => {
            let items = context.items || [];
            context.setVisible(items.length == 1 && this.isPageLink(items[0]));
          },
          onCommand: (event, context) => {
            let window = event.target.ownerGlobal;
            this.editLink(context.items[0], window).catch(e => this.reportError(e, window));
          },
        },
      ],
    });
    if (menuID) this.menuIDs.push(menuID);
  },

  registerReaderMenu() {
    this.readerHandler = (event) => {
      let { reader, append } = event;
      let pdfItem = Zotero.Items.get(reader.itemID);
      if (!pdfItem || !pdfItem.isPDFAttachment()) return;
      append({
        label: "Link This Page from Another Article…",
        onCommand: () => {
          let window = Zotero.getMainWindow();
          this.addLinkFromReader(reader, pdfItem, window).catch(e => this.reportError(e, window));
        },
      });
    };
    Zotero.Reader.registerEventListener("createViewContextMenu", this.readerHandler, this.id);
  },

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /** From the item list: A is selected; choose B, its PDF, and a page. */
  async addLinkFromSourceItem(sourceItem, window) {
    let target = this.selectItem(window);
    if (!target) return;
    if (target.id == sourceItem.id) {
      Services.prompt.alert(window, "Page Link", "Please choose a different article than the one you are linking from.");
      return;
    }
    let pdf = this.choosePDF(window, target);
    if (!pdf) return;
    let page = this.promptPage(window, 1, `Page number in “${this.itemTitle(target)}”:`);
    if (!page) return;
    await this.createLink(sourceItem, pdf, page);
  },

  /** From the reader: B's PDF is open at some page; choose A. */
  async addLinkFromReader(reader, pdfItem, window) {
    let currentPage = this.getReaderPage(reader, pdfItem);
    let page = this.promptPage(window, currentPage, `Page number in “${this.itemTitle(pdfItem.parentItem || pdfItem)}”:`);
    if (!page) return;
    let source = this.selectItem(window);
    if (!source) return;
    if (source.id == pdfItem.parentItemID) {
      Services.prompt.alert(window, "Page Link", "Please choose a different article than the one you are linking to.");
      return;
    }
    await this.createLink(source, pdfItem, page);
  },

  async editLink(linkItem, window) {
    let url = linkItem.getField("url");
    let current = parseInt(new URL(url.replace(/^zotero:/, "http:")).searchParams.get("page")) || 1;
    let page = this.promptPage(window, current, "New page number:");
    if (!page || page == current) return;
    linkItem.setField("url", this.replacePageInURL(url, page));
    let title = linkItem.getField("title");
    if (/^p\. \d+/.test(title)) {
      linkItem.setField("title", title.replace(/^p\. \d+/, `p. ${page}`));
    }
    await linkItem.saveTx();
  },

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  isPageLink(item) {
    return !!item
      && item.isAttachment()
      && item.attachmentLinkMode == Zotero.Attachments.LINK_MODE_LINKED_URL
      && (item.getField("url") || "").startsWith(this.URL_PREFIX);
  },

  getPageLinks(item) {
    if (!item.isRegularItem()) return [];
    return Zotero.Items.get(item.getAttachments()).filter(att => this.isPageLink(att));
  },

  buildURL(pdfItem, page) {
    let prefix = "library";
    let library = Zotero.Libraries.get(pdfItem.libraryID);
    if (library.libraryType == "group") {
      prefix = "groups/" + Zotero.Groups.getGroupIDFromLibraryID(pdfItem.libraryID);
    }
    return `${this.URL_PREFIX}${prefix}/items/${pdfItem.key}?page=${page}`;
  },

  replacePageInURL(url, page) {
    if (/[?&]page=\d+/.test(url)) {
      return url.replace(/([?&]page=)\d+/, `$1${page}`);
    }
    return url + (url.includes("?") ? "&" : "?") + "page=" + page;
  },

  async createLink(sourceItem, pdfItem, page) {
    let targetTitle = this.itemTitle(pdfItem.parentItem || pdfItem);
    let title = `p. ${page} – ${targetTitle}`;
    let url = this.buildURL(pdfItem, page);
    this.log(`Linking ${sourceItem.libraryKey} -> ${url}`);
    return Zotero.Attachments.linkFromURL({
      url,
      parentItemID: sourceItem.id,
      title,
    });
  },

  itemTitle(item) {
    let title = item.getDisplayTitle ? item.getDisplayTitle() : item.getField("title");
    return title.length > 80 ? title.slice(0, 77) + "…" : title;
  },

  /** Opens Zotero's standard item picker; returns a regular item or null. */
  selectItem(window) {
    let io = {
      dataIn: null,
      dataOut: null,
      itemTreeID: "page-link-select-item-dialog",
      singleSelection: true,
      onlyRegularItems: true,
      hideCollections: ["duplicates", "trash", "feeds", "retracted"],
    };
    window.openDialog(
      "chrome://zotero/content/selectItemsDialog.xhtml",
      "",
      "chrome,dialog=no,modal,centerscreen,resizable=yes",
      io
    );
    if (!io.dataOut || !io.dataOut.length) return null;
    let item = Zotero.Items.get(io.dataOut[0]);
    return item && item.isRegularItem() ? item : null;
  },

  /** Picks the PDF attachment of a regular item (asks if there are several). */
  choosePDF(window, item) {
    let pdfs = Zotero.Items.get(item.getAttachments()).filter(att => att.isPDFAttachment());
    if (!pdfs.length) {
      Services.prompt.alert(window, "Page Link", `“${this.itemTitle(item)}” has no PDF attachment.`);
      return null;
    }
    if (pdfs.length == 1) return pdfs[0];
    let labels = pdfs.map(p => p.getField("title") || p.attachmentFilename);
    let selected = {};
    let ok = Services.prompt.select(window, "Page Link", "This article has several PDFs. Choose one:", labels, selected);
    return ok ? pdfs[selected.value] : null;
  },

  promptPage(window, defaultPage, text) {
    while (true) {
      let value = { value: String(defaultPage || 1) };
      let ok = Services.prompt.prompt(window, "Page Link", text + "\n(physical page in the PDF, first page = 1)", value, null, {});
      if (!ok) return null;
      let page = parseInt(value.value.trim(), 10);
      if (Number.isInteger(page) && page >= 1 && String(page) == value.value.trim()) {
        return page;
      }
      Services.prompt.alert(window, "Page Link", "Please enter a whole number, 1 or greater.");
    }
  },

  getReaderPage(reader, pdfItem) {
    try {
      let index = reader._internalReader?._state?.primaryViewStats?.pageIndex;
      if (Number.isInteger(index)) return index + 1;
    }
    catch (e) {
      Zotero.logError(e);
    }
    let last = pdfItem.getAttachmentLastPageIndex();
    return Number.isInteger(last) ? last + 1 : 1;
  },

  reportError(e, window) {
    Zotero.logError(e);
    try {
      Services.prompt.alert(window, "Page Link", "Error: " + (e?.message || e));
    }
    catch (_) {}
  },
};
