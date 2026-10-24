#!/bin/sh
# Downloads the official texlab release for Intel and Apple Silicon, checks the published
# SHA-256 digests, and merges them into one universal binary at resources/bin/texlab.
set -e
cd "$(dirname "$0")/.."
VERSION=5.26.0
SHA_X86_64=6091611f756b28e1a57612b130c196df4b0bb6e22dde5cf5d890578513397daf
SHA_AARCH64=af7972ffd230711ba04ada9b69cc32ce9111d9196ba69538062872faefdbee56
OUT=resources/bin
mkdir -p "$OUT"

if [ -x "$OUT/texlab" ] && [ "$("$OUT/texlab" --version 2>/dev/null)" = "texlab $VERSION" ]; then
  echo "texlab $VERSION is up to date"
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
for arch in x86_64 aarch64; do
  url="https://github.com/latex-lsp/texlab/releases/download/v$VERSION/texlab-$arch-macos.tar.gz"
  curl -fsSL "$url" -o "$TMP/$arch.tar.gz"
  expected=$([ "$arch" = x86_64 ] && echo "$SHA_X86_64" || echo "$SHA_AARCH64")
  actual=$(shasum -a 256 "$TMP/$arch.tar.gz" | cut -d' ' -f1)
  if [ "$actual" != "$expected" ]; then
    echo "Checksum mismatch for $url" >&2
    exit 1
  fi
  mkdir -p "$TMP/$arch"
  tar -xzf "$TMP/$arch.tar.gz" -C "$TMP/$arch"
done
lipo -create "$TMP/x86_64/texlab" "$TMP/aarch64/texlab" -output "$OUT/texlab"
chmod +x "$OUT/texlab"
echo "bundled $("$OUT/texlab" --version) ($(lipo -archs "$OUT/texlab"))"
