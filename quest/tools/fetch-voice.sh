#!/bin/bash
# Puts what the headset and the Mac preview need to listen for the agent's name into quest/vendor/sherpa-onnx/,
# which git ignores: sherpa-onnx's C API for Android (arm64-v8a) and for this Mac (arm64), its header, and the
# keyword model. Each archive comes from sherpa-onnx's GitHub releases and is checked against its checksum.
#   quest/tools/fetch-voice.sh          does nothing when the folder is complete
# The model is the regular gigaspeech 3.3M one: its -mobile variant fails on every decode in 1.13.8.
set -euo pipefail
QUEST="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$QUEST/vendor/sherpa-onnx"
RELEASE=https://github.com/k2-fsa/sherpa-onnx/releases/download
ANDROID_URL=$RELEASE/v1.13.8/sherpa-onnx-v1.13.8-android.tar.bz2
ANDROID_SHA=2ff63469a71cb6009aa2e3ed5f4a670f8abdcbe4bb9ffd23776afc792a6b4f44
MAC_URL=$RELEASE/v1.13.8/sherpa-onnx-v1.13.8-osx-arm64-shared-no-tts.tar.bz2
MAC_SHA=91b96512c4fa1960f8a9ed5360a6c8dda53a4b5015d0590244f14086a234557a
MODEL_URL=$RELEASE/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2
MODEL_SHA=f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a
MODEL_FILES=(encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx decoder-epoch-12-avg-2-chunk-16-left-64.onnx
  joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx tokens.txt bpe.model)

[ -f "$VENDOR/versions.json" ] && exit 0
free_kb=$(df -k "$QUEST" | awk 'NR == 2 { print $4 }')
if [ "$free_kb" -lt $((2 * 1024 * 1024)) ]; then
  echo "fetch-voice: under 2 GB free on this disk; not downloading" >&2
  exit 1
fi
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mp-voice.XXXX")"
trap 'rm -rf "$WORK"' EXIT

# fetch <url> <sha256> <name>: downloads into its own empty folder and unpacks it there.
fetch() {
  mkdir "$WORK/$3"
  echo "fetch-voice: $1"
  curl -fsSL -o "$WORK/$3.tar.bz2" "$1"
  local got
  got=$(shasum -a 256 "$WORK/$3.tar.bz2" | cut -d' ' -f1)
  if [ "$got" != "$2" ]; then
    echo "fetch-voice: $1 has checksum $got, not $2" >&2
    exit 1
  fi
  tar -xjf "$WORK/$3.tar.bz2" -C "$WORK/$3" --exclude '*/bin/*' --exclude '*/test_wavs/*'
  rm "$WORK/$3.tar.bz2"
}
fetch "$ANDROID_URL" "$ANDROID_SHA" android
fetch "$MAC_URL" "$MAC_SHA" mac
fetch "$MODEL_URL" "$MODEL_SHA" model

rm -rf "$VENDOR"
mkdir -p "$VENDOR/include/sherpa-onnx/c-api" "$VENDOR/android/arm64-v8a" "$VENDOR/mac" "$VENDOR/assets/kws"
MAC="$WORK/mac/sherpa-onnx-v1.13.8-osx-arm64-shared-no-tts"
cp "$MAC/include/sherpa-onnx/c-api/c-api.h" "$VENDOR/include/sherpa-onnx/c-api/"
cp "$MAC/lib/libsherpa-onnx-c-api.dylib" "$MAC/lib/libonnxruntime.dylib" "$VENDOR/mac/"
cp "$WORK/android/jniLibs/arm64-v8a/libsherpa-onnx-c-api.so" "$WORK/android/jniLibs/arm64-v8a/libonnxruntime.so" "$VENDOR/android/arm64-v8a/"
for f in "${MODEL_FILES[@]}"; do cp "$WORK/model/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01/$f" "$VENDOR/assets/kws/"; done
cat >"$VENDOR/versions.json" <<EOF
{
 "sherpaOnnx": "v1.13.8",
 "android": {"url": "$ANDROID_URL", "sha256": "$ANDROID_SHA"},
 "mac": {"url": "$MAC_URL", "sha256": "$MAC_SHA"},
 "model": {"url": "$MODEL_URL", "sha256": "$MODEL_SHA"}
}
EOF
echo "fetch-voice: $(du -sh "$VENDOR" | cut -f1) in $VENDOR"
