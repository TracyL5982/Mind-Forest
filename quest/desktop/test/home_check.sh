#!/bin/bash
# The greeting after the walk (`-guideDemo home`) and pinches at it, scripted from the eye (`-aimX -aimY -pinchAt`), one
# preview each, on a fresh data folder:
#   - on its button before the button shows: nothing (the card stays);
#   - just below the button, where an item of the ocean stands behind the card: nothing (no peek, the card stays);
#   - a little off the button, within its reach: the button;
#   - on the button: the button;
#   - on an item away from the card: it is peeked, as the card invites.
# Exits with how many failed.
#   quest/desktop/build.sh && quest/desktop/test/home_check.sh
cd "$(dirname "$0")/.."
DATA="${TMPDIR:-/tmp}/mp-home-check"
failed=0
check() {
    local name=$1 want=$2 refuse=$3
    shift 3
    rm -rf "$DATA" && mkdir -p "$DATA"
    local log
    log=$(./preview -mute -dataDir "$DATA" -guideDemo home "$@" -shot "$DATA/shot.png" -shotAt 8 2>&1)
    if echo "$log" | grep -q "$want" && ! { [ -n "$refuse" ] && echo "$log" | grep -q "$refuse"; }; then
        echo "ok     $name"
    else
        echo "FAILED $name: wanted \"$want\"${refuse:+, not \"$refuse\"}"
        echo "$log" | grep "\[guide\]\|\[ocean\] peek" | sed 's/^/         /'
        failed=$((failed + 1))
    fi
}
# (The button is 0.27 of the window's half-height below its middle; the window is 1280 x 900.)
check "a pinch on the button before it shows does nothing" "a pinch on the greeting, off its button" "button is pinched" -aimX 0 -aimY -0.2667 -pinchAt 2.0 -releaseAt 2.15
check "a pinch just below the button does not reach the ocean behind" "a pinch on the greeting, off its button" "\[ocean\] peek" -aimX 0 -aimY -0.34 -pinchAt 6 -releaseAt 6.15
check "a pinch a little off the button is the button's" "button is pinched" "" -aimX 0 -aimY -0.311 -pinchAt 6 -releaseAt 6.15
check "a pinch on the button closes the card" "button is pinched" "" -aimX 0 -aimY -0.2667 -pinchAt 6 -releaseAt 6.15
check "a pinch on an item away from the card peeks it" "\[ocean\] peek" "a pinch on the greeting" -aimX 0.719 -aimY -0.333 -pinchAt 6 -releaseAt 6.15
rm -rf "$DATA"
echo "$failed failed"
exit $failed
