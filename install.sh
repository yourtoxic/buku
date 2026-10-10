#!/usr/bin/env bash
set -e
UUID="butu@toxic"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
SRC="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DEST"
cp -r "$SRC"/extension.js "$SRC"/prefs.js "$SRC"/metadata.json "$SRC"/stylesheet.css "$SRC"/src "$SRC"/schemas "$DEST"/
glib-compile-schemas "$DEST/schemas"
echo "Installed to $DEST"
echo "GNOME 50 = Wayland only: log out and log in, then run:"
echo "  gnome-extensions enable $UUID"
