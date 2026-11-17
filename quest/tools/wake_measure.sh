#!/bin/bash
# Measures the wake phrase through the whole listener (core/agent/listener.*, with the real spotter) on spoken clips:
# how often "hi Momo" / "hey Momo" is heard, alone, before a request after a comma, and with the request said
# straight on with no pause, at an ordinary pace and fast; and how often near misses and ordinary talk wake it.
# The clips are the Mac's own voices (`say`): every English one, and the other languages' voices reading English as a
# rough stand-in for accents. They are made once into <clips dir> (about 2,100 clips, 190 MB, 10 minutes) and kept.
#   quest/tools/wake_measure.sh <clips dir> [-v] [-dump <dir>]
# -v prints each clip. -dump writes the sound of every wake into <dir>, for agents/scripts/wake-verify.ts to try the
# service's check on.
# Numbers and what they led to: agents/DECISIONS.md 69.
set -e
[ -n "$1" ] || { echo "usage: wake_measure.sh <clips dir> [-v] [-dump <dir>]"; exit 2; }
QUEST="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$QUEST/.." && pwd)"
"$QUEST/tools/fetch-voice.sh"
VOICE="$QUEST/vendor/sherpa-onnx"
mkdir -p "$1"
OUT="$(cd "$1" && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mp-wake.XXXX")"
trap 'rm -rf "$WORK"' EXIT

# name, voice, speaking rate (0 for the voice's own), words
clip() {
  [ -s "$OUT/$1.wav" ] && return
  printf '%s' "$4" > "$WORK/$1.txt"    # read from a file: words that begin with a dash are not an option
  if [ "$3" = 0 ]; then say -v "$2" -o "$WORK/$1.aiff" -f "$WORK/$1.txt"; else say -v "$2" -r "$3" -o "$WORK/$1.aiff" -f "$WORK/$1.txt"; fi
  afconvert -f WAVE -d LEI16@16000 -c 1 "$WORK/$1.aiff" "$OUT/$1.wav" && rm -f "$WORK/$1.aiff"
}

# Voices that speak like people, one per language and name: not the novelty voices.
say -v '?' | sed -E 's/ +#.*//' | grep -E " (en_US|en_GB|en_AU|en_IE|en_IN|en_ZA|zh_CN|zh_TW|zh_HK|fr_FR|de_DE|es_ES|it_IT|ja_JP|ko_KR|hi_IN)$" \
  | grep -vE "Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Zarvox|Albert" \
  | grep -vE "\((German|Spanish|French|Italian|Japanese|Korean|Chinese \(Taiwan)" > "$WORK/voices.txt"

REQUESTS=("what is this painting" "show me more like this" "undo that" "find films by Stanley Kubrick" "tell me something surprising about Rembrandt" "start a tree on Hitchcock's camera tricks" "more" "can you bring me some pictures of Delft")
NEAR=("Hey mama." "Hi mom." "Hey mom, are you coming tonight?" "Hi mom, I miss you." "Did you read the memo?" "We lost all our momentum this week." "Hey Moe." "Hi Moe, good to see you." "Let's grab coffee at Mo Mo's bakery." "I had steamed momos for lunch." "My cat is called Momo." "Hey, no more." "Hey Nemo." "Hi Tomo." "Hey homie." "Hey mommy." "Hi Mo." "Hey Mo, more!" "Hey Bobo." "Hi Coco." "Hey Jojo." "Hi, more of that please." "Hey, move over." "Hi, my mother is here." "Hey, moments ago I saw it." "High motivation matters." "Hey, most of them are fine." "Hi Monica." "Hey Mona, more tea?" "Hi Maureen." "He moved home on Monday." "Hi, mobile phones are banned here.")
MANIFEST="$WORK/manifest.tsv"
: > "$MANIFEST"
row() { printf '%s\t%s\t%s\t%s\t%s\n' "$@" >> "$MANIFEST"; }

echo "making the clips that are not in $OUT yet"
v=0
n=0
while IFS= read -r line; do
  voice="$(echo "$line" | sed -E 's/ +[a-z]{2}_[A-Z]{2}$//')"
  language="$(echo "$line" | grep -oE '[a-z]{2}_[A-Z]{2}$')"
  v=$((v + 1))
  for greeting in Hi Hey; do
    row "v${v}_alone_$greeting" alone "$language" "$voice" "$greeting Momo."
    clip "v${v}_alone_$greeting" "$voice" 0 "$greeting Momo." &
  done
  r=0
  for request in "${REQUESTS[@]}"; do
    r=$((r + 1))
    if [ $((r % 2)) = 1 ]; then greeting=Hi; else greeting=Hey; fi
    row "v${v}_comma_$r" comma "$language" "$voice" "$greeting Momo, $request."
    clip "v${v}_comma_$r" "$voice" 0 "$greeting Momo, $request." &
    row "v${v}_straight_$r" straight "$language" "$voice" "$greeting Momo $request"
    clip "v${v}_straight_$r" "$voice" 0 "$greeting Momo $request" &
    row "v${v}_fast_$r" fast "$language" "$voice" "$greeting Momo $request"
    clip "v${v}_fast_$r" "$voice" 230 "$greeting Momo $request" &
  done
  wait
  case "$language" in en_*) ;; *) continue ;; esac
  n=$((n + 1))
  m=0
  for miss in "${NEAR[@]}"; do
    m=$((m + 1))
    row "n${n}_near_$m" near "$language" "$voice" "$miss"
    clip "n${n}_near_$m" "$voice" 0 "$miss" &
  done
  wait
done < "$WORK/voices.txt"

# Ordinary talk: this repository's documents read aloud, without the lines that name the phrase, and a few everyday lines.
cat "$REPO/agents/README.md" "$REPO/quest/README.md" "$REPO/agents/docs/protocol.md" "$REPO/quest/agent-plan.md" "$REPO/agents/DECISIONS.md" \
  | grep -viE "(hey|hi|high),? ?mo" | sed -E 's/[`*#|_>]//g; s/\[([^]]*)\]\([^)]*\)/\1/g' | tr '\n' ' ' | tr -s ' ' | fold -s -w 800 | head -150 > "$WORK/talk.txt"
cat >> "$WORK/talk.txt" <<'TALK'
Hey, quick question about the trip. Are we renting a car or doing everything by train? Hi, sorry I'm late, the bus just sat there for ten minutes. I told my mom we would come on Monday, and she said more people are coming than last year. Honestly, most of the movies he mentioned were made a moment before sound came in.
Hi, how are you doing today? I moved most of my things home already. My mother said hi, by the way. Hey, more coffee? No more for me, thanks. He might move to Monaco in a month or more, who knows. Hi, Maureen, hey, Mona, good morning to both of you.
TALK
TALKERS=("Samantha" "Daniel" "Karen" "Moira" "Rishi" "Tessa" "Fred" "Kathy")
t=0
while IFS= read -r words; do
  t=$((t + 1))
  row "t${t}_talk" talk en "${TALKERS[$((t % 8))]}" "(talk)"
  clip "t${t}_talk" "${TALKERS[$((t % 8))]}" 0 "$words" &
  [ $((t % 8)) = 0 ] && wait
done < "$WORK/talk.txt"
wait
cp "$MANIFEST" "$OUT/manifest.tsv"

CORE="$QUEST/core"
xcrun clang++ -std=c++20 -O2 -Wall -Wextra -Werror -I"$CORE" -I"$VOICE/include" -L"$VOICE/mac" -lsherpa-onnx-c-api -Wl,-rpath,"$VOICE/mac" \
  "$CORE/agent/test/wake_measure.cpp" "$CORE/agent/listener.cpp" "$CORE/agent/spotter.cpp" -o "$WORK/wake_measure"
# The folder -dump names is made if it is not there.
before=""
for arg in "${@:2}"; do
  [ "$before" = "-dump" ] && mkdir -p "$arg"
  before="$arg"
done
"$WORK/wake_measure" "$VOICE/assets/kws" "$OUT" "${@:2}" 2>/dev/null
