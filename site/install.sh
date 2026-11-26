#!/bin/sh
# McBot installer for macOS and Linux:
#
#   curl -fsSL https://mcbot.studio/install.sh | sh
#
# Downloads the newest McBot release from GitHub and installs it: McBot.app in /Applications on
# a Mac, the AppImage in ~/.local/bin on Linux. Windows: use the installer from the releases page.
# It only ever talks to github.com; read it first if you like, it is short.
set -eu

REPO="CasperCrypto/mcbot"
say() { printf '%s\n' "$*"; }
fail() { say "McBot Studio: $*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl is needed"
os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Darwin) if [ "$arch" = "arm64" ]; then want='_aarch64\.dmg$'; else want='_x64\.dmg$'; fi ;;
  Linux) [ "$arch" = "x86_64" ] || fail "only x86_64 Linux builds exist so far"; want='_amd64\.AppImage$' ;;
  *) fail "on Windows, download the installer from https://github.com/$REPO/releases/latest" ;;
esac

say "Finding the newest McBot Studio…"
urls=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o '"browser_download_url": *"[^"]*"' | sed 's/^.*"\(https[^"]*\)"$/\1/')
url=$(printf '%s\n' "$urls" | grep -E "$want" | head -n 1)
[ -n "$url" ] || fail "no download for this computer in the newest release yet"
case "$url" in "https://github.com/$REPO/releases/download/"*) ;; *) fail "unexpected download address: $url" ;; esac
sums_url=$(printf '%s\n' "$urls" | grep -E '/SHA256SUMS\.txt$' | head -n 1)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
file=$(basename "$url")
say "Downloading $file…"
curl -fL --progress-bar -o "$tmp/pkg" "$url"

# The release lists every installer's SHA256 (publish-release.yml): a download that differs is not installed.
if [ -n "$sums_url" ]; then
  curl -fsSL -o "$tmp/sums" "$sums_url" || fail "could not download the release's checksums"
  expected=$(awk -v f="$file" '$2 == f { print $1 }' "$tmp/sums" | head -n 1)
  [ -n "$expected" ] || fail "the release's checksums do not list $file"
  if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$tmp/pkg" | cut -d' ' -f1); else got=$(shasum -a 256 "$tmp/pkg" | cut -d' ' -f1); fi
  [ "$got" = "$expected" ] || fail "the download does not match the release's checksum (got $got, expected $expected); nothing was installed"
  say "Checksum matches."
else
  say "This release has no checksum list yet; installing without that check."
fi

if [ "$os" = "Darwin" ]; then
  hdiutil attach -nobrowse -quiet -mountpoint "$tmp/mnt" "$tmp/pkg"
  app=$(find "$tmp/mnt" -maxdepth 1 -name '*.app' | head -n 1)
  [ -n "$app" ] || { hdiutil detach -quiet "$tmp/mnt"; fail "the download holds no app"; }
  name=$(basename "$app")
  # Up to 0.4 the app was McBot.app; from 0.5 it is McBot Studio.app. Replace either.
  for old in "/Applications/McBot.app" "/Applications/$name"; do
    if [ -d "$old" ]; then
      osascript -e "tell application \"$(basename "$old" .app)\" to quit" >/dev/null 2>&1 || true
      rm -rf "$old"
    fi
  done
  cp -R "$app" /Applications/
  hdiutil detach -quiet "$tmp/mnt"
  say "McBot Studio is in your Applications folder. Opening it…"
  open "/Applications/$name"
else
  mkdir -p "$HOME/.local/bin"
  mv "$tmp/pkg" "$HOME/.local/bin/McBot.AppImage"
  chmod +x "$HOME/.local/bin/McBot.AppImage"
  say "McBot Studio is installed: $HOME/.local/bin/McBot.AppImage"
  say "Start it with: ~/.local/bin/McBot.AppImage"
fi
