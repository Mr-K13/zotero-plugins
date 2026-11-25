# Export CSV (Zotero 8–10 plugin)

Export the items in a collection to a CSV file, optionally only the items with certain tags.

## Usage

1. Right-click a collection, or **My Library**, then choose **Export Items to CSV…**.
2. Enter the tags to filter by, separated by commas, such as `Digital Twin, SJR:Q1`.
   Leave the box empty to export every item.
   Tick **Items must have all of the tags** to export only the items that have every tag.
   Otherwise an item with any one of the tags is exported.
3. Choose where to save the file.

When the export finishes, click **Show File** to see the file in Finder or Explorer.

## Columns

Each item is one row, sorted by title.

| Column | Content |
|---|---|
| PDF Path | The full path of the item's PDF file, such as `/Users/you/Zotero/storage/ABCD1234/Smith - 2020.pdf`. With several PDFs, the paths are joined by `; ` with the one Zotero opens first. Empty when the item has no PDF. |
| Item Type | Such as *Journal Article*, *Book Section* or *Conference Paper*. |
| Title | The item's title. |
| DOI | The **DOI** field. For item types without one, such as *Book Section*, a `DOI: …` line in **Extra**. |
| Year | The year from the **Date** field. |
| Publication | The journal, book, proceedings or website title, depending on the item type. |

## Details

- Tags are compared ignoring case.
  Only the item's own tags count, not the tags of its PDFs or notes.
- The items are the ones Zotero lists for the collection, ignoring the search box and the tag selector.
  Subcollections are included when **View → Show Items from Subcollections** is on.
- Notes and standalone attachments, which have no parent item, are skipped.
- Both stored files (in Zotero's `storage` folder) and linked files are exported.
  The summary tells you how many paths point to a file that isn't on this computer, for example because sync hasn't downloaded it yet.
- The file is UTF-8 with a byte order mark, so Excel shows accented characters correctly.
