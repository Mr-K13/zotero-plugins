# Zotero Plugins

Small Zotero plugins for linking items to specific pages of PDFs in your library, and for working with attachment files.

| Plugin | What it does |
|---|---|
| [Page Link](zotero-page-link/) | Attach a link to item A that opens item B's PDF at a chosen page. You set it up from the item list or from inside the PDF reader. |
| [Link Article to Book](zotero-link-article-to-book/) | For a chapter or paper with an ISBN, find the book with the same ISBN in your library, locate the page where the chapter's title appears in the book's PDF, and attach a page link to that page. |
| [Copy Path](zotero-copy-path/) | Right-click a file attachment, such as a PDF, and choose **Copy Path** to copy the full path of its file to the clipboard. |

Page Link and Link Article to Book create the same kind of link: a standard Zotero *linked URL* attachment like this one.

```
zotero://open-pdf/library/items/<PDF_KEY>?page=<N>
```

Zotero itself opens these links in its PDF reader at page N.
So the links sync like any other attachment, and they keep working on computers without the plugins and after you uninstall them.
The plugins work well together, but each one works without the other.

**Requirements:** Zotero 8, 9 or 10 (tested on Zotero 10.0.9).

## Installation

### Option 1: Install an .xpi file (recommended)

1. Download the `.xpi` file of each plugin you want (`page-link.xpi`, `link-article-to-book.xpi`, `copy-path.xpi`) from the [latest release](https://github.com/Mr-K13/zotero-plugins/releases/latest).
   In Firefox, right-click the link and choose **Save Link As…**, because clicking it would try to install the file into Firefox.
2. In Zotero, open **Tools → Plugins**.
3. Click the gear icon, then **Install Plugin From File…**.
4. Select the `.xpi` file, and repeat for each other plugin you want.
5. Restart Zotero if it asks you to.

To build the `.xpi` files yourself, run `./build.sh` from the root of this repository.
It writes them to `dist/` and needs only `zip`.
Without `zip`, put these items from a plugin's folder into a zip file and rename it to end in `.xpi`:

- `manifest.json`
- the `.js` files
- the `locale` folder

The files must sit at the top level of the zip file, not inside a folder.

### Option 2: Run from source (for development)

This makes Zotero load the plugin directly from this folder, so code changes need no rebuilding.

1. Quit Zotero.
2. Find your Zotero profile folder. See [Zotero's guide to the profile directory](https://www.zotero.org/support/kb/profile_directory).
   - macOS: `~/Library/Application Support/Zotero/Profiles/<random>.default`
   - Windows: `%APPDATA%\Zotero\Zotero\Profiles\<random>.default`
   - Linux: `~/.zotero/zotero/<random>.default`
3. In the profile's `extensions` folder, create the folder if it doesn't exist.
   Then create a text file named after the plugin ID.
   Its only content is the absolute path of the plugin folder in this repository.

   | File name | Content (example) |
   |---|---|
   | `page-link@zotero-plugins.local` | `/path/to/zotero-plugins/zotero-page-link` |
   | `link-article-to-book@zotero-plugins.local` | `/path/to/zotero-plugins/zotero-link-article-to-book` |
   | `copy-path@zotero-plugins.local` | `/path/to/zotero-plugins/zotero-copy-path` |

4. Open `prefs.js` in the profile folder.
   Delete the lines that contain `extensions.lastAppBuildId` and `extensions.lastAppVersion`.
5. Start Zotero. Then open **Tools → Plugins** and **enable** the plugins.
   Zotero disables plugins installed this way until you enable them.

After you change the code, restart Zotero with the `-purgecaches` flag, or turn the plugin off and on again in **Tools → Plugins**.
To see the plugins' debug messages, start Zotero with `-ZoteroDebugText`.
On macOS, for example:

```sh
/Applications/Zotero.app/Contents/MacOS/zotero -purgecaches -ZoteroDebugText
```

The plugins log their messages with the prefixes `Page Link:`, `Link Article to Book:` and `Copy Path:`.

## Usage

### Page Link

- **From the item list:** right-click item A, then choose **Add Page Link to Another Article…**.
  Pick item B, pick its PDF if it has more than one, then enter the page number.
- **From the PDF reader:** open B's PDF, right-click the page, then choose **Link This Page from Another Article…**.
  The current page is filled in for you. Then pick item A.
- **Change the page:** right-click a page link, then choose **Change Linked Page…**.
- **Open the link:** double-click the link attachment.
  You can also double-click item A itself if A has no PDF or other file of its own.

### Link Article to Book

Select one or more chapters or papers that have an ISBN.
Right-click them, then choose **Link to Page in Book (by ISBN)**.

- The ISBN comes from the item's **ISBN** field, or from an `ISBN: …` line in **Extra**.
  Journal articles have no ISBN field in Zotero.
- ISBN-10 and ISBN-13 are treated as equal, and hyphens are ignored.
  When several items share the ISBN, items of type *Book* are preferred.
- The title is searched in this order, stopping at the first confident match:
  1. Zotero's full-text index of the PDF, which is instant.
  2. About 40 pages starting at the item's printed start page (from its **Pages** field).
     This usually takes under half a second.
  3. The whole PDF, as a last resort.
- Matching pages are scored so that the chapter's opening page wins over the table of contents and running headers.
- With one item selected, the plugin shows the page it found so you can correct it.
  With several selected, it links them all and shows a summary.
- If the item already has a link to that PDF, the plugin updates it instead of adding another.

**Limits:**

- The book's PDF needs a text layer, so a scanned PDF needs OCR first.
- Page numbers are physical PDF pages (first page = 1), not the numbers printed on the pages.

### Copy Path

Right-click a file attachment, such as a PDF, then choose **Copy Path**.
The full path of the file is copied to the clipboard.
With several attachments selected, choose **Copy Paths** to copy them one per line.

## Using the links on iPad and iPhone

Plugins don't run in Zotero for iOS, but the page links sync there, and the app can open them at the right page.
You need to change one setting:

> **Settings → General → Open Links in External Browser**: turn **on**.

With the setting off (the default), the app opens link attachments in its built-in browser.
That browser can't handle `zotero://` links, so you get a blank web page instead of the PDF.
With the setting on, iOS passes the link back to Zotero, which opens the PDF at the linked page.

- Ordinary web links in Zotero then open in Safari instead of inside the app.
- The linked PDF must be downloaded on the device.
  If it isn't, Zotero shows the item instead.
  Tap the PDF once to download it, then tap the page link again.

## Releasing a new version

Zotero checks [`updates.json`](updates.json) on the `main` branch for plugin updates.
Each plugin's `manifest.json` points to that file through its `update_url`.
To publish an update:

1. Raise `version` in the plugin's `manifest.json`.
   Update `strict_max_version` too if you've tested a newer Zotero.
2. Build the files and generate `updates.json` for the new tag:

   ```sh
   ./build.sh
   ./make-updates-json.py v1.1.0
   ```

3. Create the release with the **same** `.xpi` files, because `updates.json` records their checksums:

   ```sh
   gh release create v1.1.0 dist/page-link.xpi dist/link-article-to-book.xpi dist/copy-path.xpi
   ```

4. Commit and push `updates.json`.
   Installed copies pick up the update the next time Zotero checks, or when a user chooses **Check for Updates** in **Tools → Plugins**.

## License

[MIT](LICENSE)
