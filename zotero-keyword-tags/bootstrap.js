/* global Services, Zotero */
var KeywordTags;
var JournalRank;

function install() {}

async function startup({ id, version, rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + "journal-rank.js");
  Services.scriptloader.loadSubScript(rootURI + "keyword-tags.js");
  KeywordTags.init({ id, version, rootURI });
  KeywordTags.addToAllWindows();
}

function onMainWindowLoad({ window }) {
  KeywordTags.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  KeywordTags.removeFromWindow(window);
}

function shutdown() {
  KeywordTags?.shutdown();
  KeywordTags = undefined;
  JournalRank = undefined;
}

function uninstall() {}
