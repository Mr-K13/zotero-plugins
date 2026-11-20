/* global Zotero, Services */

/**
 * Copy Path
 *
 * Right-click a file attachment (PDF, EPUB, …) in the item list and choose
 * "Copy Path" to copy the file's full path to the clipboard. With several
 * attachments selected, the paths are copied one per line.
 */
CopyPath = {
  id: null,
  version: null,
  rootURI: null,
  menuIDs: [],

  TITLE: "Copy Path",

  init({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    this.registerMenus();
    this.log(`started (v${version})`);
  },

  log(msg) {
    Zotero.debug("Copy Path: " + msg);
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
    window.MozXULElement.insertFTLIfNeeded("copy-path.ftl");
  },

  removeFromWindow(window) {
    window.document.querySelector('[href="copy-path.ftl"]')?.remove();
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
      menuID: "copy-path-item-menu",
      pluginID: this.id,
      target: "main/library/item",
      menus: [
        {
          menuType: "menuitem",
          l10nID: "copy-path-menu",
          onShowing: (event, context) => {
            context.setVisible(this.getFileAttachments(context.items).length == 1);
          },
          onCommand: (event, context) => this.copy(context.items, event.target.ownerGlobal),
        },
        {
          menuType: "menuitem",
          l10nID: "copy-paths-menu",
          onShowing: (event, context) => {
            context.setVisible(this.getFileAttachments(context.items).length > 1);
          },
          onCommand: (event, context) => this.copy(context.items, event.target.ownerGlobal),
        },
      ],
    });
    if (menuID) this.menuIDs.push(menuID);
  },

  // ---------------------------------------------------------------------------
  // Copying
  // ---------------------------------------------------------------------------

  /** Selected attachments that point to a file (stored or linked), not URLs. */
  getFileAttachments(items) {
    return (items || []).filter(item => item.isFileAttachment());
  },

  copy(items, window) {
    try {
      let paths = this.getFileAttachments(items)
        .map(item => item.getFilePath())
        .filter(Boolean);
      if (!paths.length) {
        Services.prompt.alert(window, this.TITLE, "The selected attachment has no file path.");
        return;
      }
      Zotero.Utilities.Internal.copyTextToClipboard(paths.join("\n"));
      this.log(`copied ${paths.length} path(s)`);
      this.notify(paths);
    }
    catch (e) {
      Zotero.logError(e);
      Services.prompt.alert(window, this.TITLE, "Error: " + (e?.message || e));
    }
  },

  notify(paths) {
    let progress = new Zotero.ProgressWindow({ closeOnClick: true });
    progress.changeHeadline(paths.length == 1 ? "Path copied" : `${paths.length} paths copied`);
    progress.addDescription(paths.length == 1 ? paths[0] : paths.map(p => p.split(/[\\/]/).pop()).join(", "));
    progress.show();
    progress.startCloseTimer(2500);
  },
};
