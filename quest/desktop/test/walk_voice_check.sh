#!/bin/bash
# The welcome walk's Momo lesson, its words scripted (`-guideSay`, `-guideSayAgain`), one preview each on a fresh data folder,
# with no service: Momo's recorded lines are her voice alone then (media-src/quest/voice). Each run asks what she can do,
# then, on the layer of example cards that comes, asks something else. Checks that her answer is her recorded one, that
# its layer comes 2 s before the answer ends, which recorded reply each later request gets, and that once card 6 is taken
# nothing more is. Exits with how many failed.
#   quest/desktop/build.sh && quest/desktop/test/walk_voice_check.sh
cd "$(dirname "$0")/.."
DATA="${TMPDIR:-/tmp}/mp-walk-voice-check"
failed=0
check() {
    local name=$1 asked=$2 want=$3
    rm -rf "$DATA" && mkdir -p "$DATA"
    local log
    log=$(./preview -mute -dataDir "$DATA" -guideDemo tour -guideStep 5 -guideHear ready -guideSayAt 18 -guideSay Hi_Momo_what_can_you_do_for_me \
        -guideSayAgainAt 38 -guideSayAgain "$asked" -shot "$DATA/shot.png" -shotAt 40 2>&1)
    local answered layer
    answered=$(echo "$log" | grep -c "her voice alone: Hey! I'm your AI thinking partner")
    layer=$(echo "$log" | sed -n 's/.*its layer comes \([0-9.]*\) s into her \([0-9.]*\) s answer.*/\1 \2/p' | head -1)
    if [ "$answered" -ge 1 ] && echo "$log" | grep -q "answered with $want\$"; then
        echo "ok     $name (layer at ${layer% *} s of ${layer#* } s)"
    else
        echo "FAILED $name: wanted $want"
        echo "$log" | grep "\[guide\]" | tail -4 | sed 's/^/         /'
        failed=$((failed + 1))
    fi
}
check "a card's own words: More like this" show_me_more_like_this momo-can-more
check "Start a tree, said loosely" Hi_Momo_start_a_tree_on_Hitchcock_camera_tricks momo-can-tree
check "Look in what you saved" do_I_have_anything_about_Kubrick momo-can-saved
check "Find new things" bring_me_some_pictures_of_Delft momo-can-find
check "Hand it off" hand_this_off_to_my_coding_agent momo-can-hand
check "the fuller match wins: more like this, over tree" show_me_more_like_this_tree momo-can-more
check "what can you do, again: her answer again" what_can_you_do momo-can
check "anything else" tell_me_about_trains momo-can-other
# Once card 6 is taken (the walk goes on by itself at -guideStep 6), the example cards no longer listen.
rm -rf "$DATA" && mkdir -p "$DATA"
log=$(./preview -mute -dataDir "$DATA" -guideDemo tour -guideStep 6 -guideHear ready -guideSayAgainAt 50 -guideSayAgain show_me_more_like_this \
    -shot "$DATA/shot.png" -shotAt 55 2>&1)
if echo "$log" | grep -q "in focus: Step 6 of 8" && ! echo "$log" | grep -q "asked of the example cards"; then
    echo "ok     on card 6, a request is not taken for the example cards"
else
    echo "FAILED on card 6, a request is not taken for the example cards"
    echo "$log" | grep "\[guide\]\|in focus" | tail -4 | sed 's/^/         /'
    failed=$((failed + 1))
fi
rm -rf "$DATA"
echo "$failed failed"
exit $failed
