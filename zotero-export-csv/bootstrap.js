/* global Services, Zotero */
var ExportCSV;

function install() {}

async function startup({ id, version, rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + "export-csv.js");
  ExportCSV.init({ id, version, rootURI });
  ExportCSV.addToAllWindows();
}

function onMainWindowLoad({ window }) {
  ExportCSV.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  ExportCSV.removeFromWindow(window);
}

function shutdown() {
  ExportCSV?.shutdown();
  ExportCSV = undefined;
}

function uninstall() {}
