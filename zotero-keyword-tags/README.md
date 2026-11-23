# Keyword Tags (Zotero 8–10 plugin)

Tag the items in a collection by keywords in their title or abstract, and by their journal's SCImago rank.

## Usage

1. Right-click a collection, then choose **Add Keyword and Rank Tags…**.
   This also works on **My Library** and group libraries.
2. Enter the keyword tags, separated by commas, for example `Digital Twin, BIM, IoT`.
   Leave the box empty to add only rank tags.
3. Leave **Also add journal rank tags** ticked to add a rank tag to each item, or untick it.
   The dialog remembers your tags and this choice for next time.
4. When it finishes, a summary shows how many items got each tag, and which items got no rank and why.

### Keyword tags

Each tag is added to every item whose **Title** or **Abstract** contains the tag's text, ignoring case.
For example, `BIM` is added to an item whose abstract mentions "bim-based models".
The match is plain text, not whole words: `IoT` also matches "idiot".

### Rank tags

Each item gets one tag from the [SCImago Journal Rank](https://www.scimagojr.com/) (SJR) of its journal:

| Tag | Meaning |
|---|---|
| `Rank:Q1` … `Rank:Q4` | The journal's best quartile across its subject categories |
| `Rank:NA` | The journal isn't in SCImago, or has no quartile that year |

The quartile belongs to the journal, not to the paper itself.

- Items that already have a tag starting with `Rank:` are skipped.
  To re-rank an item, delete its `Rank:` tag first.
- The journal is found from the item's **ISSN** and **Publication** fields first, without going online.
  If that fails and the item has a DOI (in **DOI**, **URL** or **Extra**), the journal title and ISSNs are looked up on Crossref.
  DOAJ and then Semantic Scholar are tried for DOIs that Crossref doesn't know.
- Items with no DOI, journal title or ISSN, such as most books, get no rank tag.
  An item also gets no rank tag if the online lookup fails, for example when you're offline, so you can just run it again later.
- The first run downloads SCImago's ranking table (about 11 MB) for last year's edition and saves it in a `keyword-tags` folder in your Zotero data directory.
  Later runs reuse it, and a newer edition is downloaded once it's available.
  If the download fails, you're asked to download the CSV yourself from [scimagojr.com](https://www.scimagojr.com/journalrank.php) and choose it.

### Which items are checked

- All items in the collection are checked, even if the search box or tag selector is filtering the list.
- Items in subcollections are included only if **View → Show Items from Subcollections** is on.
- Notes and standalone attachments are skipped.
- Existing tags are never removed.
  A tag isn't added again if the item already has it, even in a different case.
