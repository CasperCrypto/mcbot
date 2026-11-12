#!/bin/sh
# McBot installer for macOS and Linux:
#
#   curl -fsSL https://caspercrypto.github.io/mcbot/install.sh | sh
#
# Downloads the newest McBot release from GitHub and installs it: McBot.app in /Applications on
# a Mac, the AppImage in ~/.local/bin on Linux. Windows: use the installer from the releases page.
# It only ever talks to github.com; read it first if you like, it is short.
set -eu

REPO="CasperCrypto/mcbot"
say() { printf '%s\n' "$*"; }
fail() { say "McBot: $*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl is needed"
os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Darwin) if [ "$arch" = "arm64" ]; then want='_aarch64\.dmg$'; else want='_x64\.dmg$'; fi ;;
  Linux) [ "$arch" = "x86_64" ] || fail "only x86_64 Linux builds exist so far"; want='_amd64\.AppImage$' ;;
  *) fail "on Windows, download the installer from https://github.com/$REPO/releases/latest" ;;
esac

say "Finding the newest McBot…"
url=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o '"browser_download_url": *"[^"]*"' | sed 's/^.*"\(https[^"]*\)"$/\1/' | grep -E "$want" | head -n 1)
[ -n "$url" ] || fail "no download for this computer in the newest release yet"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
say "Downloading $(basename "$url")…"
curl -fL --progress-bar -o "$tmp/pkg" "$url"

if [ "$os" = "Darwin" ]; then
  hdiutil attach -nobrowse -quiet -mountpoint "$tmp/mnt" "$tmp/pkg"
  app=$(find "$tmp/mnt" -maxdepth 1 -name '*.app' | head -n 1)
  [ -n "$app" ] || { hdiutil detach -quiet "$tmp/mnt"; fail "the download holds no app"; }
  if [ -d /Applications/McBot.app ]; then
    osascript -e 'tell application "McBot" to quit' >/dev/null 2>&1 || true
    rm -rf /Applications/McBot.app
  fi
  cp -R "$app" /Applications/
  hdiutil detach -quiet "$tmp/mnt"
  say "McBot is in your Applications folder. Opening it…"
  open /Applications/McBot.app
else
  mkdir -p "$HOME/.local/bin"
  mv "$tmp/pkg" "$HOME/.local/bin/McBot.AppImage"
  chmod +x "$HOME/.local/bin/McBot.AppImage"
  say "McBot is installed: $HOME/.local/bin/McBot.AppImage"
  say "Start it with: ~/.local/bin/McBot.AppImage"
fi
