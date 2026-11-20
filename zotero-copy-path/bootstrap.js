/* global Services, Zotero */
var CopyPath;

function install() {}

async function startup({ id, version, rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + "copy-path.js");
  CopyPath.init({ id, version, rootURI });
  CopyPath.addToAllWindows();
}

function onMainWindowLoad({ window }) {
  CopyPath.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  CopyPath.removeFromWindow(window);
}

function shutdown() {
  CopyPath?.shutdown();
  CopyPath = undefined;
}

function uninstall() {}
