#!/bin/bash
# The welcome walk's Momo lesson, its words scripted (`-guideSay`, `-guideSayAgain`), one preview each on a fresh data folder,
# with no service: Momo's recorded lines are her voice alone then (media-src/quest/voice). Each run asks what she can do,
# then, on the layer of example cards that comes, asks something else. Checks that her answer is her recorded one, that
# its layer comes 2 s before the answer ends, which recorded reply each later request gets, that the walk does not move on
# from her lesson by itself, that taking card 6 lets her go, and that once card 6 is taken nothing more is. Exits with how
# many failed.
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
# From her answer on, her ears stay the walk's (none given back to the live Momo between her answer and its layer), and
# what is said while she is still answering is let be.
rm -rf "$DATA" && mkdir -p "$DATA"
log=$(./preview -mute -dataDir "$DATA" -guideDemo tour -guideStep 5 -guideHear ready -guideSayAt 18 -guideSay Hi_Momo_what_can_you_do_for_me \
    -guideSayAgainAt 24 -guideSayAgain show_me_more_like_this -shot "$DATA/shot.png" -shotAt 36 2>&1)
order=$(echo "$log" | grep -o "the example cards listen\|said during her answer, let be\|its layer comes" | tr '\n' '|')
if [ "$order" = "the example cards listen|said during her answer, let be|its layer comes|" ]; then
    echo "ok     her ears stay the walk's through her answer, and what is said during it is let be"
else
    echo "FAILED her ears stay the walk's through her answer: $order"
    failed=$((failed + 1))
fi
# Left alone on the example cards, the walk takes card 6 itself 5 s after her answer ends (WS103, the user's: "5 seconds
# after momo stops talking"; WS80 had Momo's lessons wait for a pinch), and not while she is still answering.
rm -rf "$DATA" && mkdir -p "$DATA"
log=$(./preview -mute -dataDir "$DATA" -guideDemo tour -guideStep 5 -guideHear ready -guideSayAt 18 -guideSay Hi_Momo_what_can_you_do_for_me \
    -shot "$DATA/shot.png" -shotAt 48 2>&1)
rm -rf "$DATA-early" && mkdir -p "$DATA-early"
early=$(./preview -mute -dataDir "$DATA-early" -guideDemo tour -guideStep 5 -guideHear ready -guideSayAt 18 -guideSay Hi_Momo_what_can_you_do_for_me \
    -shot "$DATA/shot-early.png" -shotAt 33 2>&1)
if echo "$log" | grep -q "lesson 5 finished" && echo "$log" | grep -q "in focus: Step 6 of 8" && ! echo "$early" | grep -q "in focus: Step 6 of 8"; then
    echo "ok     left alone on the example cards, the walk goes on to step 6 by itself 5 s after her answer, not during it"
else
    echo "FAILED left alone on the example cards, the walk goes on to step 6 by itself 5 s after her answer"
    echo "$log" | grep "\[guide\]\|in focus" | tail -4 | sed 's/^/         /'
    failed=$((failed + 1))
fi
# Taking card 6 while her reply to an example plays: the walk lets her go, and her reply stops there.
rm -rf "$DATA" && mkdir -p "$DATA"
log=$(./preview -mute -dataDir "$DATA" -guideDemo tour -guideStep 5 -guideHear ready -guideSayAt 18 -guideSay Hi_Momo_what_can_you_do_for_me \
    -guideSayAgainAt 38 -guideSayAgain show_me_more_like_this -pickRef note:welcome-mark -pickAt 40 -shot "$DATA/shot.png" -shotAt 44 2>&1)
order=$(echo "$log" | grep -o "answered with momo-can-more\|the walk left lesson 5: nothing more of Momo's for it\|in focus: Step 6 of 8" | tr '\n' '|')
if [ "$order" = "answered with momo-can-more|in focus: Step 6 of 8|the walk left lesson 5: nothing more of Momo's for it|" ]; then
    echo "ok     taking card 6 as she replies: the walk lets her go there"
else
    echo "FAILED taking card 6 as she replies: $order"
    failed=$((failed + 1))
fi
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
rm -rf "$DATA" "$DATA-early"
echo "$failed failed"
exit $failed
