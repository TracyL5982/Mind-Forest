#!/bin/bash
# Makes the spoken clips the listener's tests hear (fixtures/voice/*.wav, 16 kHz mono 16-bit) with the Mac's own voices.
#   quest/core/agent/test/make-voice-clips.sh
set -e
OUT="$(cd "$(dirname "$0")" && pwd)/fixtures/voice"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mp-clips.XXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"
clip() {
  say -v "$2" -o "$WORK/$1.aiff" "$3"
  afconvert -f WAVE -d LEI16@16000 -c 1 "$WORK/$1.aiff" "$OUT/$1.wav"
}
clip hey-momo Samantha "Hey Momo."
clip hi-momo Daniel "Hi Momo."
clip command Samantha "Hey Momo, show me more like this."
clip more Samantha "More."
# No comma: the request runs straight on from the name, with no pause to find.
clip straight Samantha "Hey Momo show me more like this"
clip straight-hi Daniel "Hi Momo what is this painting"
clip also Samantha "and keep the first two."
clip before Samantha "I was reading about winter bread all morning."
clip talk Samantha "Hey, quick question about the trip. Are we renting a car or doing everything by train? Hi, sorry I'm late, the bus just sat there for ten minutes."
clip hey-juno Samantha "Hey Juno."
clip near Daniel "Hey mom, are you coming tonight? Did you read the memo?"
ls -l "$OUT"
