# Page Link (Zotero 8–10 plugin)

Add a child attachment to article **A** that points to a specific page of article **B**'s PDF.
Double-clicking the link opens B's PDF in Zotero's reader at that page.

The link is a standard Zotero "linked URL" attachment with Zotero's built-in URL scheme:

```
zotero://open-pdf/library/items/<PDF_KEY>?page=<N>
zotero://open-pdf/groups/<GROUP_ID>/items/<PDF_KEY>?page=<N>
```

Links sync like any other attachment and keep working even if the plugin is uninstalled.

## Usage

- **From the item list:** right-click article A, then choose **Add Page Link to Another Article…**.
  Pick article B, pick its PDF if it has more than one, and enter the page number.
- **From the PDF reader:** open B's PDF, right-click the page, then choose **Link This Page from Another Article…**.
  The current page is pre-filled. Then pick article A.
- **Change the page:** right-click the link attachment, then choose **Change Linked Page…**.
- **Open the link:** double-click the link attachment.
  You can also double-click article A itself if A has no PDF or other file of its own.
  If A has its own file, double-clicking A opens that file, which is Zotero's default.

Page numbers are physical PDF pages (first page = 1), not printed page labels.

**iPad and iPhone:** the links sync to Zotero for iOS and open there at the linked page once you turn on **Settings → General → Open Links in External Browser**.
Without that setting, the app opens them as a blank web page.
See [Using the links on iPad and iPhone](../README.md#using-the-links-on-ipad-and-iphone).

## Development install

1. Quit Zotero.
2. Create the file `<profile>/extensions/page-link@zotero-plugins.local`.
   Its content is the absolute path of this folder.
3. Delete the `extensions.lastAppBuildId` and `extensions.lastAppVersion` lines from `<profile>/prefs.js`.
4. Start Zotero and enable **Page Link** in **Tools → Plugins**.

After you edit the code, disable and re-enable the plugin, or restart Zotero.

## Build an .xpi

From the repository root, run the following. It writes `dist/page-link.xpi`.

```
./build.sh
```
