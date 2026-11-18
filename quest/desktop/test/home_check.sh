#!/bin/bash
# Pinches at the guide's cards, scripted from the eye (`-aimX -aimY -pinchAt -releaseAt`, and `-releaseAimX -releaseAimY`
# for a ray that moves while the pinch is held), one preview each, on a fresh data folder. Exits with how many failed.
#   The greeting after the walk (`-guideDemo home`):
#   - on its button before the button shows: nothing (the card stays);
#   - just below the button, where an item of the ocean stands behind the card: nothing (no peek);
#   - a little off the button, within its reach: the button, shown pressed;
#   - on the button: the button;
#   - on the button, the ray moving well past stillness but still on it as the pinch lets go: the button;
#   - on the button, the ray moving off it onto the card: nothing;
#   - on an item away from the card: it is peeked, as the card invites.
#   The Gestures sheet (`-guideDemo sheet`): between its names and the gesture: nothing; a little off Close, and on
#   Close with the ray moving but on it as the pinch lets go: Close; the ray moving off it: nothing.
#   Off the walk (`-guideDemo tour -guideStep 2 -guideOff 14`): on the panel's words: nothing; on "Skip the tutorial":
#   the walk ends.
#   quest/desktop/build.sh && quest/desktop/test/home_check.sh
cd "$(dirname "$0")/.."
DATA="${TMPDIR:-/tmp}/mp-home-check"
failed=0
check() {
    local name=$1 want=$2 refuse=$3 until=$4
    shift 4
    rm -rf "$DATA" && mkdir -p "$DATA"
    local log
    log=$(./preview -mute -dataDir "$DATA" "$@" -shot "$DATA/shot.png" -shotAt "$until" 2>&1)
    if echo "$log" | grep -q "$want" && ! { [ -n "$refuse" ] && echo "$log" | grep -q "$refuse"; }; then
        echo "ok     $name"
    else
        echo "FAILED $name: wanted \"$want\"${refuse:+, not \"$refuse\"}"
        echo "$log" | grep "\[guide\]\|\[ocean\] peek" | sed 's/^/         /'
        failed=$((failed + 1))
    fi
}
OFF="a pinch on the guide's card, off its buttons"
HOME=(-guideDemo home)
# (The window is 1280 x 900; the greeting's button is 0.27 of its half-height below the middle.)
check "greeting: a pinch on the button before it shows does nothing" "$OFF" "button is pinched" 8 "${HOME[@]}" -aimX 0 -aimY -0.2667 -pinchAt 2.0 -releaseAt 2.15
check "greeting: a pinch just below the button does not reach the ocean behind" "$OFF" "\[ocean\] peek" 8 "${HOME[@]}" -aimX 0 -aimY -0.34 -pinchAt 6 -releaseAt 6.15
check "greeting: a pinch a little off the button is the button's, shown pressed" "button is pinched" "" 8 "${HOME[@]}" -aimX 0 -aimY -0.311 -pinchAt 6 -releaseAt 6.15
check "greeting: a pinch on the button closes the card" "a button shows pressed (108)" "" 8 "${HOME[@]}" -aimX 0 -aimY -0.2667 -pinchAt 6 -releaseAt 6.15
check "greeting: the ray moves about 6 degrees while held, still on the button: it counts" "button is pinched" "" 8 "${HOME[@]}" -aimX 0 -aimY -0.2667 -releaseAimX 0.094 -releaseAimY -0.2667 -pinchAt 6 -releaseAt 6.5
check "greeting: the ray moves off the button onto the card while held: nothing" "a button shows pressed (108)" "button is pinched" 8 "${HOME[@]}" -aimX 0 -aimY -0.2667 -releaseAimX 0.31 -releaseAimY -0.2667 -pinchAt 6 -releaseAt 6.5
check "greeting: a pinch on an item away from the card peeks it" "\[ocean\] peek" "$OFF" 8 "${HOME[@]}" -aimX 0.719 -aimY -0.333 -pinchAt 6 -releaseAt 6.15
SHEET=(-guideDemo sheet)
check "sheet: a pinch between its names and the gesture does nothing" "$OFF" "\[ocean\] peek" 4 "${SHEET[@]}" -aimX -0.078 -aimY -0.111 -pinchAt 2.5 -releaseAt 2.65
check "sheet: a pinch a little off Close is Close's" "the sheet is closed" "$OFF" 4 "${SHEET[@]}" -aimX -0.309 -aimY -0.271 -pinchAt 2.5 -releaseAt 2.65
check "sheet: Close, the ray moving about 5 degrees while held but on it as it lets go" "the sheet is closed" "$OFF" 4 "${SHEET[@]}" -aimX -0.355 -aimY -0.249 -releaseAimX -0.280 -releaseAimY -0.249 -pinchAt 2.5 -releaseAt 2.9
check "sheet: Close, the ray moving off it onto the sheet while held: nothing" "a button shows pressed (101)" "the sheet is closed" 4 "${SHEET[@]}" -aimX -0.309 -aimY -0.249 -releaseAimX -0.309 -releaseAimY -0.10 -pinchAt 2.5 -releaseAt 2.9
TOUR=(-guideDemo tour -guideStep 2 -guideOff 14)
check "off the walk: a pinch on the panel's words does nothing" "$OFF" "the walk ends" 17 "${TOUR[@]}" -aimX 0 -aimY 0.264 -pinchAt 16 -releaseAt 16.15
check "off the walk: \"Skip the tutorial\" ends the walk" "the walk ends: the walk was skipped" "" 17 "${TOUR[@]}" -aimX 0.05 -aimY 0.218 -pinchAt 16 -releaseAt 16.15
rm -rf "$DATA"
echo "$failed failed"
exit $failed
