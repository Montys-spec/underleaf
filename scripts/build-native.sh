#!/bin/sh
# Builds the native spell-check helper as a universal (Intel + Apple Silicon) binary.
set -e
cd "$(dirname "$0")/.."
OUT=resources/bin
mkdir -p "$OUT"
if [ "$OUT/underleaf-spell" -nt native/spell.swift ]; then
  echo "underleaf-spell is up to date"
  exit 0
fi
TMP=$(mktemp -d)
for arch in x86_64 arm64; do
  swiftc -O -target "$arch-apple-macos11" native/spell.swift -o "$TMP/underleaf-spell-$arch"
done
lipo -create "$TMP/underleaf-spell-x86_64" "$TMP/underleaf-spell-arm64" -output "$OUT/underleaf-spell"
rm -rf "$TMP"
echo "built $OUT/underleaf-spell ($(lipo -archs "$OUT/underleaf-spell"))"
