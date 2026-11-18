/* global Services, Zotero */
var PageLink;

function install() {}

async function startup({ id, version, rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + "page-link.js");
  PageLink.init({ id, version, rootURI });
  PageLink.addToAllWindows();
}

function onMainWindowLoad({ window }) {
  PageLink.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  PageLink.removeFromWindow(window);
}

function shutdown() {
  PageLink?.shutdown();
  PageLink = undefined;
}

function uninstall() {}
