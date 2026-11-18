/* global Services, Zotero */
var LinkArticleToBook;

function install() {}

async function startup({ id, version, rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + "link-article-to-book.js");
  LinkArticleToBook.init({ id, version, rootURI });
  LinkArticleToBook.addToAllWindows();
}

function onMainWindowLoad({ window }) {
  LinkArticleToBook.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  LinkArticleToBook.removeFromWindow(window);
}

function shutdown() {
  LinkArticleToBook?.shutdown();
  LinkArticleToBook = undefined;
}

function uninstall() {}
