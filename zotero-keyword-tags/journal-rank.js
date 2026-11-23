/* global Zotero, Services, ChromeUtils, IOUtils, PathUtils */

/**
 * Journal rank lookup (SCImago Journal Rank best quartile).
 *
 * For an item, find its journal in the SCImago ranking export and return
 * "Q1"–"Q4", or "NA" when the journal is known but has no quartile or isn't
 * listed. Matching follows this order:
 *
 *   1. The item's own ISSN and Publication fields, with no network access.
 *   2. If that finds nothing and the item has a DOI, the journal title and
 *      ISSNs from Crossref (or DOAJ, then Semantic Scholar, when Crossref
 *      doesn't know the DOI).
 *
 * Within the export, an ISSN match is preferred (and, among ISSN matches, one
 * whose title also matches); otherwise an exact normalized title match is used.
 *
 * The SCImago CSV (~11 MB) is downloaded once per edition into
 * <Zotero data directory>/keyword-tags/ and reused after that.
 */
JournalRank = {
  CROSSREF_BASE: "https://api.crossref.org",
  DOAJ_BASE: "https://doaj.org/api",
  SEMANTIC_SCHOLAR_BASE: "https://api.semanticscholar.org/graph/v1",
  SCIMAGO_OFFICIAL_URL: "https://www.scimagojr.com/journalrank.php?year={year}&type=all&out=xls",
  SCIMAGO_MIRRORS: [
    "https://raw.githubusercontent.com/bastianaravenaulagos/DATOS_SCIMAGO_REVISTAS/main/scimagojr%20{year}.csv",
    "https://raw.githubusercontent.com/flonat/flonat-research/main/.context/resources/venue-rankings/scimagojr-{year}.csv",
    "https://raw.githubusercontent.com/LukasRoeseler/openjournals/main/scimagojr_{year}.csv",
  ],
  // Milliseconds between web lookups, to be polite to the APIs
  REQUEST_DELAY: 100,
  TIMEOUT: 30000,

  DOI_RE: /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i,
  ISSN_RE: /\b\d{4}-?\d{3}[\dX]\b/gi,

  index: null, // { year, source, byISSN, byTitle }
  failedYears: new Set(), // editions that couldn't be downloaded this session
  lastRequest: 0,

  log(msg) {
    Zotero.debug("Keyword Tags: " + msg);
  },

  // ---------------------------------------------------------------------------
  // Normalisation
  // ---------------------------------------------------------------------------

  normalizeDOI(value) {
    let text = String(value || "");
    try {
      text = decodeURIComponent(text);
    }
    catch (e) {}
    text = text.trim().replace(/^doi\s*:\s*/i, "");
    let match = text.match(this.DOI_RE);
    return match ? match[0].replace(/[.,;:!?"']+$/, "").toLowerCase() : "";
  },

  normalizeISSN(value) {
    return String(value || "").toUpperCase().replace(/[^0-9X]/g, "");
  },

  extractISSNs(value) {
    return [...new Set((String(value || "").match(this.ISSN_RE) || []).map(v => this.normalizeISSN(v)))];
  },

  normalizeTitle(value) {
    return String(value || "").normalize("NFKD").replace(/\p{M}/gu, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "");
  },

  unescapeHTML(value) {
    let text = String(value || "");
    if (!text.includes("&")) return text.trim();
    return Zotero.Utilities.unescapeHTML(text).trim();
  },

  // ---------------------------------------------------------------------------
  // SCImago ranking data
  // ---------------------------------------------------------------------------

  /** Editions to try, newest first. An edition is named after its metrics year. */
  candidateYears() {
    let year = new Date().getFullYear();
    return [year - 1, year - 2];
  },

  cacheDir() {
    return PathUtils.join(Zotero.DataDirectory.dir, "keyword-tags");
  },

  cachePath(year) {
    return PathUtils.join(this.cacheDir(), `scimagojr_${year}.csv`);
  },

  /**
   * Load the newest available SCImago edition: from the cache, by download, or
   * (when both fail) from a CSV file the user picks. Returns null if cancelled.
   */
  async ensureIndex(window, onStatus) {
    for (let year of this.candidateYears()) {
      if (this.index?.year == year) return this.index;

      let path = this.cachePath(year);
      if (await IOUtils.exists(path)) {
        try {
          return this.setIndex(year, await IOUtils.readUTF8(path), `cached file ${path}`);
        }
        catch (e) {
          this.log(`ignoring invalid cache ${path}: ${e.message}`);
          await IOUtils.remove(path, { ignoreAbsent: true });
        }
      }

      if (this.failedYears.has(year)) continue;
      onStatus?.(`Downloading SCImago ${year} ranking data…`);
      let errors = [];
      for (let url of [this.SCIMAGO_OFFICIAL_URL, ...this.SCIMAGO_MIRRORS].map(u => u.replace("{year}", year))) {
        try {
          let xhr = await Zotero.HTTP.request("GET", url, {
            responseType: "text",
            timeout: 120000,
            successCodes: [200],
            errorDelayMax: 0,
          });
          let text = xhr.responseText.replace(/^﻿/, "");
          let index = this.setIndex(year, text, url);
          await IOUtils.makeDirectory(this.cacheDir(), { ignoreExisting: true });
          await IOUtils.writeUTF8(path, text);
          this.log(`downloaded SCImago ${year} from ${url}`);
          return index;
        }
        catch (e) {
          errors.push(`${url}: ${e.status ? "HTTP " + e.status : e.message || e}`);
        }
      }
      this.log(`couldn't download SCImago ${year}:\n` + errors.join("\n"));
      this.failedYears.add(year);
    }

    // Nothing cached or downloadable: let the user supply the file
    return this.pickFile(window);
  },

  async pickFile(window) {
    let year = this.candidateYears()[0];
    let { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
    let message = "The SCImago journal ranking data couldn't be downloaded.\n\n"
      + "Download the CSV yourself from https://www.scimagojr.com/journalrank.php "
      + "(the “Download data” button), then choose it in the next window.";
    if (!Services.prompt.confirm(window, "Journal Ranks", message)) return null;
    let fp = new FilePicker();
    fp.init(window, "Choose the SCImago journal ranking CSV", fp.modeOpen);
    fp.appendFilter("CSV", "*.csv");
    fp.appendFilters(fp.filterAll);
    if ((await fp.show()) != fp.returnOK) return null;

    let bytes = await IOUtils.read(fp.file);
    let text = this.decode(bytes);
    // Guess the edition from the file's "Total Docs. (YYYY)" column
    let headerYear = text.slice(0, 2000).match(/Total Docs\. \((\d{4})\)/);
    if (headerYear) year = Number(headerYear[1]);
    let index = this.setIndex(year, text, fp.file);
    await IOUtils.makeDirectory(this.cacheDir(), { ignoreExisting: true });
    await IOUtils.writeUTF8(this.cachePath(year), text);
    return index;
  },

  decode(bytes) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
    }
    catch (e) {
      return new TextDecoder("windows-1252").decode(bytes);
    }
  },

  setIndex(year, text, source) {
    let rows = this.parseCSV(text);
    let byISSN = new Map();
    let byTitle = new Map();
    for (let row of rows) {
      for (let issn of this.extractISSNs(row.Issn)) {
        if (!byISSN.has(issn)) byISSN.set(issn, []);
        byISSN.get(issn).push(row);
      }
      let key = this.normalizeTitle(row.Title);
      if (key) {
        if (!byTitle.has(key)) byTitle.set(key, []);
        byTitle.get(key).push(row);
      }
    }
    this.index = { year, source, byISSN, byTitle };
    this.log(`loaded SCImago ${year} (${rows.length} journals) from ${source}`);
    return this.index;
  },

  /** Parse the SCImago CSV (semicolon-separated, double-quoted fields) into row objects. */
  parseCSV(text) {
    let firstLine = text.slice(0, text.indexOf("\n") >>> 0);
    for (let field of ["Title", "Issn", "SJR Best Quartile"]) {
      if (!firstLine.toLowerCase().includes(field.toLowerCase())) {
        throw new Error(`not a SCImago journal ranking CSV (header was “${firstLine.slice(0, 120)}”)`);
      }
    }
    let counts = [";", ",", "\t"].map(d => [d, firstLine.split(d).length]);
    let delimiter = counts.sort((a, b) => b[1] - a[1])[0][0];

    let records = [];
    let record = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      let c = text[i];
      if (inQuotes) {
        if (c == '"') {
          if (text[i + 1] == '"') {
            field += '"';
            i++;
          }
          else {
            inQuotes = false;
          }
        }
        else {
          field += c;
        }
      }
      else if (c == '"') {
        inQuotes = true;
      }
      else if (c == delimiter) {
        record.push(field);
        field = "";
      }
      else if (c == "\n" || c == "\r") {
        if (c == "\r" && text[i + 1] == "\n") i++;
        record.push(field);
        records.push(record);
        record = [];
        field = "";
      }
      else {
        field += c;
      }
    }
    if (field || record.length) {
      record.push(field);
      records.push(record);
    }

    let header = records.shift().map(h => h.trim());
    let rows = [];
    for (let values of records) {
      let row = {};
      header.forEach((name, i) => {
        // Keep the first of duplicate column names (SCImago has two "Publisher" columns)
        if (name && !(name in row)) row[name] = (values[i] || "").trim();
      });
      if (row.Title) rows.push(row);
    }
    if (!rows.length) throw new Error("no journal records found in the SCImago CSV");
    return rows;
  },

  /** Find a journal in the index by ISSNs, then by exact normalized title. */
  find(issns, journal) {
    let titleKey = this.normalizeTitle(journal);
    for (let issn of issns) {
      let matches = this.index.byISSN.get(this.normalizeISSN(issn));
      if (matches?.length) {
        return matches.find(row => this.normalizeTitle(row.Title) == titleKey) || matches[0];
      }
    }
    return (titleKey && this.index.byTitle.get(titleKey)?.[0]) || null;
  },

  quartileOf(row) {
    let value = String(row["SJR Best Quartile"] || row["Best Quartile"] || row.Quartile || "").toUpperCase();
    return /^Q[1-4]$/.test(value) ? value : "";
  },

  // ---------------------------------------------------------------------------
  // Ranking an item
  // ---------------------------------------------------------------------------

  /**
   * @return {Promise<{rank: string, journal: string, message: string}>}
   *   rank is "Q1"–"Q4", "NA", or "" when no rank could be determined.
   */
  async rankItem(item) {
    let journal = item.getField("publicationTitle", false, true);
    let issns = this.extractISSNs(item.getField("ISSN"));
    let doi = this.itemDOI(item);

    if (journal || issns.length) {
      let row = this.find(issns, journal);
      if (row) return this.resultFor(row);
    }

    if (doi) {
      let metadata;
      try {
        metadata = await this.fetchMetadata(doi);
      }
      catch (e) {
        return { rank: "", journal, message: `Journal lookup for DOI ${doi} failed: ${e.message || e}` };
      }
      let row = this.find(metadata.issns, metadata.journal);
      if (row) return this.resultFor(row);
      return {
        rank: "NA",
        journal: metadata.journal,
        message: "Journal isn't in the SCImago ranking",
      };
    }

    if (journal || issns.length) {
      return { rank: "NA", journal, message: "Journal isn't in the SCImago ranking" };
    }
    return { rank: "", journal: "", message: "No DOI, journal title or ISSN" };
  },

  resultFor(row) {
    let quartile = this.quartileOf(row);
    return {
      rank: quartile || "NA",
      journal: row.Title,
      message: quartile ? "" : "Journal is in SCImago but has no quartile this year",
    };
  },

  itemDOI(item) {
    for (let value of [item.getField("DOI"), item.getField("url")]) {
      let doi = this.normalizeDOI(value);
      if (doi) return doi;
    }
    let extra = item.getField("extra").match(/^\s*DOI\s*:\s*(\S+)/im);
    return extra ? this.normalizeDOI(extra[1]) : "";
  },

  // ---------------------------------------------------------------------------
  // Web lookups
  // ---------------------------------------------------------------------------

  async getJSON(url) {
    let wait = this.lastRequest + this.REQUEST_DELAY - Date.now();
    if (wait > 0) await Zotero.Promise.delay(wait);
    this.lastRequest = Date.now();
    let xhr = await Zotero.HTTP.request("GET", url, {
      responseType: "json",
      headers: { Accept: "application/json" },
      timeout: this.TIMEOUT,
      successCodes: false,
      errorDelayMax: 0,
    });
    if (xhr.status != 200) {
      let error = new Error(`HTTP ${xhr.status} for ${url}`);
      error.status = xhr.status;
      throw error;
    }
    return xhr.response;
  },

  /** Journal title and ISSNs for a DOI: Crossref, then DOAJ, then Semantic Scholar. */
  async fetchMetadata(doi) {
    try {
      let payload = await this.getJSON(`${this.CROSSREF_BASE}/works/${encodeURIComponent(doi)}`);
      let item = payload.message || {};
      let journal = this.unescapeHTML((item["container-title"] || [])[0]);
      if (!journal) throw new Error(`Crossref has no journal title for ${doi}`);
      let issns = [...new Set((item.ISSN || []).map(v => this.normalizeISSN(v)).filter(Boolean))];
      return { journal, issns };
    }
    catch (e) {
      // A few valid DOIs are missing from Crossref
      if (e.status != 404) throw e;
    }
    try {
      return await this.fetchDOAJ(doi);
    }
    catch (e) {
      return this.fetchSemanticScholar(doi);
    }
  },

  async fetchDOAJ(doi) {
    let payload = await this.getJSON(`${this.DOAJ_BASE}/search/articles/doi:${encodeURIComponent(doi)}`);
    let bibjson = (payload.results || [])[0]?.bibjson;
    if (!bibjson) throw new Error(`DOAJ has no record for ${doi}`);
    let journalData = bibjson.journal || {};
    let journal = this.unescapeHTML(journalData.title);
    if (!journal) throw new Error(`DOAJ has no journal title for ${doi}`);
    let issns = [...new Set((journalData.issns || []).map(v => this.normalizeISSN(v)).filter(Boolean))];
    return { journal, issns };
  },

  async fetchSemanticScholar(doi) {
    let fields = "title,venue,year,externalIds,journal";
    let payload = await this.getJSON(
      `${this.SEMANTIC_SCHOLAR_BASE}/paper/DOI:${encodeURIComponent(doi)}?fields=${fields}`
    );
    let journal = this.unescapeHTML(payload.journal?.name || payload.venue);
    if (!journal) throw new Error(`no journal found for ${doi}`);
    return { journal, issns: [] };
  },
};
