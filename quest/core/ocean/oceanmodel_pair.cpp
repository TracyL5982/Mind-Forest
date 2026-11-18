// AGENT (WS99): pairing the headset with a Telegram chat, on the hosted service.
//
// The user, 2026-11-18: "I notice that now tap on 'share with friends' will prompt user to 'pair with telegram first', we
// need to do the same for 'send to agent' because send to agent also won't work without telegram connection. When the text
// change to 'pair with telegram first', if user click on that again, we show a pop-up panel that show user instructions to
// connect, there need to be a 'X' to dismiss this popup panel if user decides to not do it. Similarly, when user ask momo,
// that popup panel will also show up, and can be dismissed when user wants to. make sure the panel has consistent style as
// the rest of our UI"
//
// What happens when:
//   Send, no chat paired      The service has said so after its hello (`telegram`). Nothing is sent (no one would get it):
//                             Send says "Pair Telegram first", not filled, at least `pairFirstSay` s and while the buttons
//                             stay. Share says the same on the service's answer to `share` (`unpaired`).
//   that button, pinched      The pairing panel opens, on the side away from the tree, and asks the service for the bot and
//                             a code (`pair`): the one Momo gave, if it still has a while to run.
//   Momo, "connect my Telegram"
//                             The service sends the code she reads out to the headset too: the panel opens with it, or
//                             shows it if it is open.
//   the code runs out         The panel asks for a new one, and says it is getting one meanwhile.
//   the chat pairs            The panel says "Telegram connected", and goes a moment after. The buttons say what they say
//                             again.
//   its X                     It goes. Nothing else closes it: it does not time out.
// The panel is the Gestures sheet's kind: lines on ink bars, a small heading on its colour, a dark ground behind them all;
// its X is a guide button (shown pressed, the 1 s rule, `OceanModel::pinchEnded`). The code is a secret while it works:
// it is drawn, never logged.
#include "oceanmodel.h"

#include <cmath>

#include "../agent/bridge.h"

namespace {

/// Where the panel stands: degrees to the side of ahead (away from the tree that asked), degrees above the line of sight,
/// and m from the eyes; opened with no tree's buttons showing, it stands in the middle. Above the trees' crowns and the buttons on them (a tree's buttons are about level with the eyes),
/// well above Momo (28 degrees under the line of sight), and nearer than the forest (1.6 m and more), so nothing in the
/// room stands in front of it.
constexpr float panelAside = 9, panelUp = 12, panelFar = 0.85f;
/// The panel's measures, m on it: its left edge, its width, the room between its lines, and the code's letters, large to
/// be read seated.
constexpr float panelLeft = -0.16f, panelWide = 0.32f, linePitch = 0.034f, codeType = 0.034f, closeSize = 0.03f;
/// s between asking for a code and asking again, when none comes.
constexpr double askAgain = 8;

}  // namespace

void OceanModel::sayPairFirst(Shelved& s, int which) {
    if (which < 0 || which > 1) return;
    // One tree shows its buttons at a time: another's go.
    for (Shelved& other : shelf) {
        if (&other == &s || !other.buttons) continue;
        if (sharing.list && sharing.uid == other.uid) closePeople(false);
        for (const EntityRef& b : other.buttons->children) picks.erase(b.get());
        other.tilts.erase(std::remove(other.tilts.begin(), other.tilts.end(), other.buttons), other.tilts.end());
        fadeOut(other.buttons, 0.2f);
        other.buttons = nullptr;
        other.pills = {};
        other.buttonsUntil = -1;
        other.pairFirst = {false, false};
    }
    s.pairFirst[size_t(which)] = true;
    s.buttonsUntil = std::max(s.buttonsUntil, time + pairFirstSay);
    showButtons(s, -1);
    touch(time + 0.3);
    logLine(fmt("[ocean] %s over %s says: Pair Telegram first, at least %.0f s and while the buttons stay; a pinch on it opens the pairing panel",
                which == 0 ? "Send" : "Share", s.tree ? s.tree->title.c_str() : "a tree", pairFirstSay));
}

void OceanModel::openPairing(const char* why, float side) {
    if (!art) return;
    if (!pairing.holder) {
        pairing.side = side < 0 ? -1.f : side > 0 ? 1.f : 0.f;
        pairing.connectedAt = -1;
        pairing.notReady = false;
        pairing.holder = guideHolder(pairing.side * panelAside, -panelUp, panelFar);
        drawPairing();
        fadeIn(pairing.holder, 0, 0.25f);
        touch(time + 0.35);
        logLine(fmt("[ocean] the pairing panel opens (%s), %s", why, pairing.side > 0 ? "on the right" : pairing.side < 0 ? "on the left" : "in the middle"));
    }
    // (The code it has, while that still works; else it asks, and says it is getting one meanwhile.)
    if ((pairing.code.empty() || time >= pairing.codeUntil) && agentBridge && time - pairing.askedAt > 0.5) {
        pairing.askedAt = time;
        agentBridge->askPairing();
    }
}

void OceanModel::drawPairing() {
    const EntityRef& holder = pairing.holder;
    if (!holder || !art) return;
    for (const Entity* e : pairing.picks) picks.erase(e);
    pairing.picks.clear();
    if (teach.pressed && teach.pressed->parent == holder.get()) releaseButton();
    while (!holder->children.empty()) holder->children.back()->removeFromParent();

    float top = 0.09f, y = top;
    auto line = [&](const std::optional<Piece>& piece, float x, float at) {
        if (!piece) return;
        EntityRef e = art->quad(*piece);
        e->position = {x + piece->size.x / 2, at, 0};
        holder->addChild(e);
    };
    line(art->heading("Connect Telegram", Tone::note), panelLeft, y);
    // Its X, at the top corner: a guide button, taking a pinch a little round it too.
    if (std::optional<Piece> x = art->iconButton("x", closeSize, Art::ink, Color::white())) {
        EntityRef close = art->quad(*x);
        close->position = {panelLeft + panelWide - x->size.x / 2, y, 0};
        float reach = guideReach(panelFar);
        reachOut(close, x->size, reach, reach, reach, reach);
        close->inputTarget = true;
        close->hover = Art::hover();
        close->name = "pairing panel's X";
        picks[close.get()] = Pick::guide(pairClose);
        pairing.picks.push_back(close.get());
        holder->addChild(close);
    }
    y -= 0.05f;
    auto step = [&](const std::string& words) {
        line(art->line(words, Art::Size::label, Font::Weight::medium, Color::white(), Art::ink, Art::buttonPad), panelLeft, y);
        y -= linePitch;
    };
    if (pairing.connectedAt >= 0) {
        // Done: said as a button that has done its work is (Kai's square buttons, filled with their colour).
        line(art->action("Telegram connected", Art::Size::lead, color(Tone::craft), ink(Tone::craft), true), panelLeft, y);
        y -= linePitch;
    } else {
        step("1   Open Telegram on your phone.");
        step(pairing.bot.empty() ? std::string("2   Search for the Mind Forest bot and press Start.") : "2   Search for @" + pairing.bot + " and press Start.");
        step("3   Send it this code:");
        y -= 0.012f;
        if (!pairing.code.empty()) {
            // The six digits in two threes, as Momo says them, large.
            std::string shown = pairing.code.size() == 6 ? pairing.code.substr(0, 3) + " " + pairing.code.substr(3) : pairing.code;
            line(art->line(shown, codeType, Font::Weight::semibold, Color::white(), Art::ink, Art::buttonPad), panelLeft + 0.02f, y);
            y -= 0.058f;
            line(art->line("It works once, for ten minutes.", Art::Size::label, Font::Weight::medium, Color::white(1, 0.75f), Art::ink, Art::buttonPad), panelLeft, y);
        } else {
            line(art->line(pairing.notReady ? "Telegram is not answering yet. Try again in a minute." : "Getting a code…", Art::Size::label, Font::Weight::medium,
                           Color::white(1, 0.75f), Art::ink, Art::buttonPad),
                 panelLeft + 0.02f, y);
        }
        y -= linePitch;
    }
    // A dark ground behind it all, as the guide's cards have, that takes a pinch off the X and does nothing with it.
    auto [lo, hi] = guideExtent(holder);
    if (lo.x <= hi.x) {
        const float margin = 0.02f;
        Vec2 size{std::max(hi.x - lo.x, panelWide) + 2 * margin, hi.y - lo.y + 2 * margin};
        EntityRef ground = art->swatch(Art::panel, size, 0.94f);
        ground->position = {(lo.x + std::max(hi.x, panelLeft + panelWide)) / 2, (lo.y + hi.y) / 2, -0.012f};
        ground->collision = {Shape::generateBox({size.x, size.y, 0.01f})};
        ground->inputTarget = true;
        picks[ground.get()] = Pick::guide(pairPanel);
        pairing.picks.push_back(ground.get());
        holder->addChild(ground);
    }
    touch(time + 0.2);
}

void OceanModel::closePairing(const char* why) {
    if (!pairing.holder) return;
    for (const Entity* e : pairing.picks) picks.erase(e);
    pairing.picks.clear();
    if (teach.pressed && teach.pressed->parent == pairing.holder.get()) releaseButton();
    for (const EntityRef& child : pairing.holder->children) child->inputTarget = false;
    fadeOut(pairing.holder, 0.2f);
    pairing.holder = nullptr;
    pairing.connectedAt = -1;
    touch(time + 0.3);
    logLine(std::string("[ocean] the pairing panel closes: ") + why);
}

void OceanModel::pairingCode(const std::string& bot, const std::string& code, int seconds) {
    pairing.bot = bot;
    pairing.code = code;
    pairing.codeUntil = time + std::max(1, seconds);
    pairing.notReady = false;
    // (Momo gave it: the panel opens with it, away from a tree that shows its buttons, or in the middle; she is well below.)
    if (!pairing.holder) {
        float side = 0;
        for (const Shelved& s : shelf) {
            if (!s.buttons) continue;
            Vec3 at = s.mover->entity->convertTo(Vec3::zero(), root_.get());
            side = dot(at - stage.origin, stage.r) > 0 ? -1.f : 1.f;
        }
        openPairing("a code came, as Momo gives one", side);
        return;
    }
    if (pairing.connectedAt >= 0) return;
    drawPairing();
    logLine(fmt("[ocean] the pairing panel shows the code for @%s, working %d s", bot.c_str(), seconds));
}

void OceanModel::telegramPaired() {
    for (Shelved& s : shelf) {
        if (!s.pairFirst[0] && !s.pairFirst[1]) continue;
        s.pairFirst = {false, false};
        if (s.buttons) showButtons(s, -1);
    }
    pairing.code.clear();
    pairing.codeUntil = -1;
    if (!pairing.holder || pairing.connectedAt >= 0) return;
    pairing.connectedAt = time;
    drawPairing();
    touch(time + pairingConnectedSay + 0.3);
    logLine(fmt("[ocean] the pairing panel says Telegram is connected, and goes in %.1f s", pairingConnectedSay));
}

void OceanModel::pairingNotReady() {
    pairing.notReady = true;
    if (pairing.holder && pairing.connectedAt < 0) drawPairing();
}

void OceanModel::tendPairing(double now) {
    if (!pairing.holder) return;
    if (pairing.connectedAt >= 0) {
        if (now - pairing.connectedAt >= pairingConnectedSay) closePairing("Telegram is connected");
        return;
    }
    // A code that has run out is not shown: a new one is asked for, and comes in its place.
    if (!pairing.code.empty() && now >= pairing.codeUntil) {
        pairing.code.clear();
        drawPairing();
        logLine("[ocean] the pairing panel's code has run out: it asks for a new one");
    }
    if (pairing.code.empty() && agentBridge && now - pairing.askedAt > (pairing.askedAt < 0 ? 0 : askAgain)) {
        pairing.askedAt = now;
        agentBridge->askPairing();
    }
}
