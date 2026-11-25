#!/bin/sh
# Build installable .xpi packages for each plugin into dist/
set -e
cd "$(dirname "$0")"
mkdir -p dist
for dir in zotero-page-link zotero-link-article-to-book zotero-copy-path zotero-keyword-tags zotero-export-csv; do
  name=${dir#zotero-}
  rm -f "dist/$name.xpi"
  (cd "$dir" && zip -qr "../dist/$name.xpi" manifest.json ./*.js locale)
  echo "Built dist/$name.xpi"
done
