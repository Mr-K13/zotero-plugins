#!/usr/bin/env python3
"""Generate updates.json (Zotero's plugin update manifest) for a GitHub release.

Usage: ./build.sh && ./make-updates-json.py v1.2.0

Reads each plugin's manifest.json and hashes dist/<name>.xpi, so run it on the
exact .xpi files you upload to the release with that tag.
"""
import hashlib
import json
import pathlib
import sys

REPO = "Mr-K13/zotero-plugins"
PLUGINS = ["zotero-page-link", "zotero-link-article-to-book", "zotero-copy-path"]
root = pathlib.Path(__file__).resolve().parent

if len(sys.argv) != 2:
    sys.exit(__doc__)
tag = sys.argv[1]

addons = {}
for folder in PLUGINS:
    manifest = json.loads((root / folder / "manifest.json").read_text())
    zotero = manifest["applications"]["zotero"]
    name = folder.removeprefix("zotero-")
    xpi = root / "dist" / f"{name}.xpi"
    digest = hashlib.sha256(xpi.read_bytes()).hexdigest()
    addons[zotero["id"]] = {
        "updates": [
            {
                "version": manifest["version"],
                "update_link": f"https://github.com/{REPO}/releases/download/{tag}/{name}.xpi",
                "update_hash": f"sha256:{digest}",
                "applications": {
                    "zotero": {
                        "strict_min_version": zotero["strict_min_version"],
                        "strict_max_version": zotero["strict_max_version"],
                    }
                },
            }
        ]
    }

out = root / "updates.json"
out.write_text(json.dumps({"addons": addons}, indent=2) + "\n")
print(f"Wrote {out.name} for {tag}")
