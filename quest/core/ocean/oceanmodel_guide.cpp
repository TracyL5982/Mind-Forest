// The guide: what teaches the hands.
//
// The first time, a tree stands by itself: "Welcome to Mind Forest". Its cards are the lessons, one a layer,
// each playing its gesture on its own face (see "The welcome tree" below). Nothing in it blocks: the next
// card skips a lesson and putting the tree away ends the walk. After it, each gesture not yet done is shown
// by a ghost hand at the moment it becomes useful, a few words stand by the things that need no new
// gesture, and every gesture stays a pinch away on a sheet.
// The reasons, and the standards they follow, are in sketches/onboarding (the design board).
//
// - A ghost hand waits: ten seconds after its moment has come without the gesture being made.
// - One at a time, in order of need, and never two within twenty seconds.
// - It stands where your own hand would be, smaller than life, fixed in the room. Nothing follows the head.
// - It goes the moment you start (your closed hand brings up the app's own gauge), is retired for good
//   once you have done the thing, and does not nag: three loops, then it rests, and it comes back once.
// - It never blocks: everything works while it plays.
#include "oceanmodel.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>
#include <map>

#include "../cards/ocean.h"
#include "agent/bridge.h"
#include "guide.h"

namespace {
// What a pinch on one of the guide's own buttons asks for; 0…8 are the sheet's rows.
/// m round the home card's button that takes a pinch as the button does, about 1.6 degrees at its 2 m (my choice, WS75);
/// m round the home card's pieces that takes a pinch for the card, which does nothing; and s into the button's fade-in
/// (a quarter of it, some 40% shown) from which it takes pinches.
constexpr float homeButtonReach = 0.06f, homeCardMargin = 0.03f;
constexpr double homeButtonShows = 0.15;
/// s before the end of Momo's recorded answer to "what can you do" that its layer comes, as she says "here are some
/// example requests" (the lead, WS78).
constexpr double layerBeforeAnswerEnds = 2;
/// tourTalk's lesson while the example cards listen: none of the lessons' own numbers.
constexpr int exampleTalk = 1000;

// (`offButtons` is OceanModel::guideOffButtons, which pinchEnded reads.)
enum Act { begin = 100, closeSheet = 101, startOver = 102, openSheet = 103, tour = 104, tourSkip = 105, tourEnd = 106, tourBack = 107, homeClose = 108, tourSay = 109, offButtons = 110, tourSettings = 111, momoNote = 112, allowMicrophone = 113 };
// The gestures a ghost hand teaches, in the order they are needed, and how long each waits once its moment has come.
struct Plan {
    const char* id;
    double wait;
};
const Plan plans[] = {{"layers", 10}, {"carry", 10}, {"mark", 6}, {"tree", 10}, {"cut", 10}};

// The welcome tree: its lessons, in order. Each is a card of the tree (a note made here, `note`) that plays
// `gesture` on its own face, says what to do in its own words, and is done when the viewer has done `did`
// (what `guideDid` is told). The next lesson's card stands beside it: pinching that moves on, done or not.
// `alt` says where a button does the same as the gesture, for a pin to point at it. `pictures` is how many
// pictures come with the card, to make its layer a real one and to have something to pick up. The card is
// drawn as the card library draws its own (core/cards/lesson.cpp): `headline` its title, `summary` under it.
struct TourStep {
    const char* note;
    const char* gesture;
    const char* headline;
    const char* summary;
    const char* did;
    const char* alt;
    const char* altWords;
    int pictures;
    float stage;        // how large its gesture plays on its card, of life size: as large as the stage has room for
    const char* say;    // the one thing to do now, said large over the tree
    // The note Momo answers with, where the lesson is one of talking to Momo: it makes a layer of its own, which
    // is that lesson's too, and the way on is from there (the lesson's own card has no next card beside it).
    const char* result = "";
};
const TourStep tourSteps[] = {
    {"welcome", "pinch", "Welcome to Mind Forest",
     "Around you is everything the gardener remembers; a tree is the part in play. Point at the next card and pinch.", "ask", "", "", 2, 0.92f, "Point at card 2 and pinch it"},
    {"welcome-pan", "carry", "Grab to pan",
     "Your pinch asked a question and its answer made this layer. Close your hand and move it: the tree comes too.", "carry", "", "", 2, 0.72f, "Close your hand and move it sideways"},
    {"welcome-pull", "layers", "Grab to pull or push",
     "Close your hand and pull it toward you: the layer behind comes back. Push it away to return here.", "step", "tree", "Or choose a layer here  ↓", 1, 0.68f, "Close your hand and pull it toward you"},
    {"welcome-move", "drag", "Pinch and hold to move",
     "Pinch a picture beside this card, keep it pinched, and put it somewhere else. It stays where you leave it.", "move", "", "", 3, 0.92f, "Pinch a picture, hold, and carry it"},
    // NOTE: the two steps with Momo were added on 2026-11-15, once Momo was in the build (Kai: "weave momo
    // interactions into the onboarding"): asking it aloud what it can do, and sending it a sketch with a word about it.
    {"welcome-momo", "say", "Ask Momo",
     "Momo is the gardener's voice. Say its name first, then what you want. Begin by asking what it can do for you.", "momo", "", "", 0, 0.8f,
     "Say “Hi Momo, what can you do for me?”", "momo-can"},
    {"welcome-mark", "mark", "Show Momo part of a picture",
     "Pinch this card again to go in, take up the pen and draw round something. Then send it to Momo, and say what you want to know.", "mark", "", "", 0, 0.68f,
     "Pinch this picture to go in", "momo-mark"},
    {"welcome-tree", "tree", "Choose a layer on the small tree",
     "Low on your left stands this tree in little. Slide a finger along it and pinch to jump to a layer.", "jump", "tree", "Slide a finger along it, pinch to jump", 1, 0.86f, "Reach for the small tree, low on your left"},
    {"welcome-close", "clap", "Palms together to close",
     "Hold your palms together for a second: the tree is pressed flat and put away. Its buttons do the same.", "press", "strip", "Or pinch Put away", 0, 0.6f, "Hold your palms together for a second"},
};
const int tourCount = int(sizeof(tourSteps) / sizeof(tourSteps[0]));
const int pullStep = 2, moveStep = 3, momoStep = 4, markStep = 5, treeStep = 6, closeStep = 7;
const char* tourTitle = "Welcome to Mind Forest";
// Halved, and the card behind it made half see-through, as Kai asked on 2026-11-15: at 0.7 a lesson
// that came up while you were idle took too much of the view, drew the eye and ran into what stood near it.
const float lessonSize = 0.35f;     // of life size
const float lessonGround = 0.5f;    // how solid the card behind an idle lesson is
const float lessonLine = 0.0024f;   // the hand's line at that size, m (drawn small, it wants more weight)
// The stage on a lesson's card is as wide as the card's panel and this tall, m: all
// that any lesson draws there at its `stage` size fits inside it, seen from where you stand.
const float lessonStageTall = 0.35f;

// The middle of all that a gesture draws over its loop, of life size: a lesson's card plays it there, in the middle
// of its stage, and the tick of a lesson done goes there too (`doneAt`).
Vec3 drawnMiddle(const guide::Gesture& g) {
    static std::map<std::string, Vec3> known;
    if (auto hit = known.find(g.id); hit != known.end()) return hit->second;
    const std::vector<float>& there = guide::modelThere();
    Vec2 lo{1e9f, 1e9f}, hi{-1e9f, -1e9f};
    auto take = [&](Vec3 p) {
        lo = vmin(lo, Vec2{p.x, p.y});
        hi = vmax(hi, Vec2{p.x, p.y});
    };
    guide::Frame f;
    for (int n = 0; n < 120; n++) {
        f.clear();
        g.draw(g.seconds * float(n) / 120, f);
        for (const guide::Frame::Hand& h : f.hands) {
            if (h.alpha < 0.05f) continue;
            for (size_t i = 0; i < h.positions.size(); i++) {
                if (i >= there.size() || there[i] > 0.3f) take(h.positions[i]);
            }
        }
        for (const guide::Frame::Stroke& s : f.strokes) {
            for (size_t i = 0; i < s.points.size(); i++) {
                if (i >= s.alphas.size() || s.alphas[i] > 0.05f) take(s.points[i]);
            }
        }
    }
    Vec3 middle = hi.x >= lo.x ? Vec3{(lo.x + hi.x) / 2, (lo.y + hi.y) / 2, 0} : Vec3::zero();
    known[g.id] = middle;
    return middle;
}

// A lesson done: a ring closes and a tick is drawn where its gesture played. They stay while its card is shown.
const float doneSeconds = 0.75f;
Vec3 doneAt;
void drawDone(float t, guide::Frame& f) {
    const Vec3 X{1, 0, 0}, Y{0, 1, 0};
    float round = guide::travel(guide::span(t, 0, 0.5f)), tick = guide::travel(guide::span(t, 0.3f, 0.75f));
    f.arc(doneAt, X, Y, 0.062f, floatPi / 2, floatPi / 2 - round * 2 * floatPi, 0.003f, guide::white, 0.9f);
    if (tick < 0.01f) return;
    // Down to its corner, then up and out: the first stroke is two fifths of it.
    Vec3 a = doneAt + Vec3{-0.027f, 0.002f, 0}, b = doneAt + Vec3{-0.008f, -0.019f, 0}, c = doneAt + Vec3{0.029f, 0.023f, 0};
    std::vector<Vec3> points{a, a + (b - a) * std::min(1.f, tick / 0.4f)};
    if (tick > 0.4f) points.push_back(b + (c - b) * ((tick - 0.4f) / 0.6f));
    f.path(points, 0.004f, guide::white, 0.95f);
}
const guide::Gesture doneGesture{"done", drawDone, doneSeconds, "", ""};

// Talking to Momo, on its lesson's card: no hand in it. A voice (a row of bars that rise and fall) on the left,
// Momo on the right as a point of light that answers to its name with a ring; the words cross to it; and what
// comes back is cards, coming up from it one after another: a layer.
void drawSay(float t, guide::Frame& f) {
    const Vec3 X{1, 0, 0}, Y{0, 1, 0};
    const float whole = 6.4f;
    f.fade = guide::span(t, 0, 0.4f) * (1 - guide::span(t, whole - 0.5f, whole));
    Vec3 voice{-0.15f, -0.075f, -0.05f}, momo{0.07f, -0.075f, -0.05f};
    float speaking = guide::span(t, 0.7f, 1.0f) * (1 - guide::span(t, 3.0f, 3.3f));
    float named = guide::span(t, 1.1f, 1.3f);                                // "Hi Momo": it wakes
    float heard = guide::span(t, 3.1f, 3.5f);
    // The voice: seven bars, never still while it speaks.
    for (int k = 0; k < 7; k++) {
        float x = (float(k) - 3) * 0.019f;
        float tall = 0.009f + speaking * (0.022f + 0.026f * std::fabs(std::sin(t * (5.3f + 0.9f * float(k)) + float(k) * 1.7f)));
        f.line(voice + Vec3{x, -tall, 0}, voice + Vec3{x, tall, 0}, 0.0052f, guide::white, 0.35f + 0.55f * speaking);
    }
    // Its words, on their way across.
    Vec3 from = voice + Vec3{0.08f, 0, 0}, to = momo - Vec3{0.055f, 0, 0};
    for (int k = 0; k < 3; k++) {
        float u = std::fmod(t * 0.9f + float(k) / 3, 1.f);
        f.orb(from + (to - from) * u, 0.0055f, guide::white, 0.8f * speaking * std::sin(u * floatPi));
    }
    // Momo: awake at its name, and brighter once it has heard.
    float glow = 0.35f + 0.4f * named + 0.25f * heard;
    f.orb(momo, 0.032f, guide::warm, 0.35f * glow);
    f.orb(momo, 0.017f, guide::warm, glow);
    f.ring(momo, X, Y, 0.042f, 0.0026f, guide::warm, 0.3f + 0.5f * named);
    if (t > 1.1f && t < 3.3f) {
        float u = std::fmod(t - 1.1f, 1.1f) / 1.1f;
        f.ring(momo, X, Y, 0.042f + 0.045f * guide::arrive(u), 0.0022f, guide::warm, 0.6f * (1 - u));
    }
    // What comes back: a layer of cards, up and out from it.
    const Vec3 at[4] = {{-0.075f, 0.065f, -0.05f}, {0.03f, 0.095f, -0.05f}, {0.135f, 0.085f, -0.05f}, {0.205f, 0.01f, -0.05f}};
    for (int k = 0; k < 4; k++) {
        float u = guide::arrive(guide::span(t, 3.6f + 0.22f * float(k), 4.3f + 0.22f * float(k)));
        if (u < 0.01f) continue;
        Vec3 p = momo + (at[k] - momo) * u, way = normalize(at[k] - momo);
        f.line(momo + way * 0.05f, p - way * (0.03f * u), 0.0018f, guide::white, 0.3f * u);
        f.card(p, X, Y, 0.075f * u, 0.048f * u, 0.006f, 0.002f, guide::white, 0.85f * u, 0.07f * u);
    }
}
const guide::Gesture sayGesture{"say", drawSay, 6.4f, "", ""};
/// A gesture of the walk's by its name: one of the hand's (guidegestures.cpp), or the walk's own.
const guide::Gesture* tourGesture(const std::string& id) { return id == "say" ? &sayGesture : guide::gesture(id); }

// What the walk points with, in the room's own space: a line round the thing to act on, which breathes
// and rings out; arrowheads running along a path to its end; a dashed line for "about here".
// (A gesture's drawing is a plain function, so what it is to draw is kept here: there is one walk.)
struct Signs {
    std::vector<std::vector<Vec3>> rounds, dashes, flows;
    Vec3 eye;
    float shown = 0;
    void clear() {
        rounds.clear();
        dashes.clear();
        flows.clear();
    }
};
Signs signs;
void drawMarks(float t, guide::Frame& f) {
    f.fade = signs.shown;
    if (signs.shown < 0.01f) return;
    const float beat = 1.6f;
    float u = std::fmod(t, beat) / beat, breath = 0.5f + 0.5f * std::sin(2 * floatPi * u);
    for (const std::vector<Vec3>& round : signs.rounds) {
        if (round.size() < 3) continue;
        f.path(round, 0.0034f + 0.0012f * breath, guide::hot, 0.6f + 0.35f * breath, true);
        // And once a beat it rings out: the same line, spreading and going.
        Vec3 middle = Vec3::zero();
        for (const Vec3& p : round) middle = middle + p;
        middle = middle / float(round.size());
        std::vector<Vec3> out;
        for (const Vec3& p : round) out.push_back(middle + (p - middle) * (1 + 0.2f * guide::arrive(u)));
        f.path(out, 0.0022f, guide::hot, 0.5f * (1 - u), true);
    }
    for (const std::vector<Vec3>& line : signs.dashes) {
        for (size_t i = 0; i + 1 < line.size(); i += 2) f.line(line[i], line[i + 1], 0.003f, guide::white, 0.75f);
    }
    for (const std::vector<Vec3>& path : signs.flows) {
        if (path.size() < 2) continue;
        std::vector<float> along{0};
        for (size_t i = 1; i < path.size(); i++) along.push_back(along.back() + length(path[i] - path[i - 1]));
        float whole = along.back();
        if (whole < 0.03f) continue;
        auto at = [&](float d, Vec3& way) {
            size_t i = 1;
            while (i + 1 < path.size() && along[i] < d) i += 1;
            Vec3 a = path[i - 1], b = path[i];
            float span = std::max(1e-5f, along[i] - along[i - 1]);
            way = (b - a) / span;
            return a + (b - a) * std::min(1.f, std::max(0.f, (d - along[i - 1]) / span));
        };
        auto head = [&](float d, float size, float alpha) {
            Vec3 way, p = at(d, way);
            Vec3 side = cross(way, signs.eye - p);
            float len = length(side);
            if (len < 1e-6f) return;
            side = side / len;
            f.path({p - way * size + side * size, p, p - way * size - side * size}, 0.0032f, guide::hot, alpha);
        };
        f.path(path, 0.0014f, guide::hot, 0.28f);
        // Arrowheads a hand's width apart, running to the end, where a larger one stands.
        const float gap = 0.075f, speed = 0.17f;
        for (float d = std::fmod(t * speed, gap); d < whole - 0.03f; d += gap) {
            head(d, 0.014f, 0.9f * std::min(1.f, d / 0.05f) * std::min(1.f, (whole - 0.03f - d) / 0.04f + 0.25f));
        }
        head(whole, 0.024f, 1);
    }
}
const guide::Gesture marksGesture{"marks", drawMarks, 1e6f, "", ""};

/// A line from `a` to `b` that rises a little off the straight on its way (toward `off`), for a path to run along.
std::vector<Vec3> arcBetween(Vec3 a, Vec3 b, Vec3 off, int parts = 14) {
    std::vector<Vec3> out;
    for (int k = 0; k <= parts; k++) {
        float u = float(k) / float(parts);
        out.push_back(a + (b - a) * u + off * (4 * u * (1 - u)));
    }
    return out;
}
}

std::string OceanModel::guideURL() {
    std::string shelf = shelfURL();
    size_t slash = shelf.rfind('/');
    return slash == std::string::npos ? "" : shelf.substr(0, slash) + "/ocean-guide.txt";
}

/// What has been learned, from last time: a word or two a line. `-freshGuide` forgets it.
void OceanModel::loadGuide() {
    std::string url = guideURL();
    if (url.empty() || Flags::has("freshGuide")) return;
    std::optional<std::string> text = platform::readFile(url);
    if (!text) return;
    size_t at = 0;
    while (at < text->size()) {
        size_t end = text->find('\n', at);
        if (end == std::string::npos) end = text->size();
        std::string line = text->substr(at, end - at);
        at = end + 1;
        if (line == "welcomed") teach.welcomed = true;
        else if (line == "home") teach.homeSeen = true;
        else if (line == "asked") teach.asked = true;
        else if (line.rfind("learned ", 0) == 0) {
            for (GuideLesson& l : teach.lessons) {
                if (l.id == line.substr(8)) l.learned = true;
            }
        } else if (line.rfind("pin ", 0) == 0) {
            teach.pins[line.substr(4)].done = true;
        }
    }
}

void OceanModel::saveGuide() {
    std::string url = guideURL();
    if (url.empty() || teach.demo) return;
    std::string text;
    if (teach.welcomed) text += "welcomed\n";
    if (teach.homeSeen) text += "home\n";
    if (teach.asked) text += "asked\n";
    for (const GuideLesson& l : teach.lessons) {
        if (l.learned) text += "learned " + l.id + "\n";
    }
    for (const auto& [id, pin] : teach.pins) {
        if (pin.done) text += "pin " + id + "\n";
    }
    platform::writeFile(url, text);
}

/// `-noGuide` leaves it all out. `-guideWelcomed` starts past the welcome (a run driven by flags pinches nothing).
/// `-guideDemo welcome|sheet|<gesture>` shows one thing at once and keeps
/// it up (with `-guideT <s>` held at that second of its loop), for looking at it without hands.
void OceanModel::startGuide() {
    addWelcomeNotes();
    if (Flags::has("noGuide")) return;
    if (!guide::hasModel()) {
        std::optional<std::string> bytes = platform::readFile(platform::resourcePath("hands/hand-right.bin"));
        if (!bytes || !guide::loadModel(*bytes)) {
            logLine("[guide] no hand model (hands/hand-right.bin): the guide is off");
            return;
        }
    }
    teach.painter = GuidePainter::make(lineMaterial);
    if (!teach.painter) return;
    // (A second one, for what the walk points with: it draws in the room's own space, however far off.)
    teach.marker = GuidePainter::make(lineMaterial);
    if (teach.marker) {
        teach.marker->setReach(8);
        root_->addChild(teach.marker->entity);
    }
    teach.lessons.clear();
    for (const Plan& plan : plans) {
        GuideLesson l;
        l.id = plan.id;
        l.wait = plan.wait;
        teach.lessons.push_back(l);
    }
    teach.demo = Flags::string("guideDemo");
    if (Flags::has("guideT")) teach.demoT = Flags::number("guideT");
    loadGuide();
    if (Flags::has("guideWelcomed")) teach.welcomed = true;
    // A run driven by flags stands its own trees: the welcome tree does not come by itself then.
    for (const char* flag : {"demo", "brief", "saved", "walk", "expand", "peekFilm"}) {
        if (Flags::has(flag)) teach.scripted = true;
    }
    teach.on = true;
    logLine(fmt("[guide] on: %s", teach.welcomed ? "welcomed before" : "first time"));
}

// MARK: - Showing

/// Something to hang words and the ghost hand from, facing you: `right` and `down` degrees from where the
/// headset points (taken level), `far` metres away. It stays where it is put.
EntityRef OceanModel::guideHolder(float right, float down, float far) {
    std::optional<Mat4> head = platform::head();
    Vec3 eye = head ? head->position() : stage.origin;
    Vec3 look = head ? head->forward() : stage.f;
    look.y = 0;
    look = length(look) > 1e-3f ? normalize(look) : stage.f;
    Vec3 side = normalize(cross(look, stage.u));
    float az = right * floatPi / 180, el = down * floatPi / 180;
    Vec3 p = eye + ((look * std::cos(az) + side * std::sin(az)) * std::cos(el) - stage.u * std::sin(el)) * far;
    EntityRef holder = Entity::make();
    holder->position = p;
    Vec3 z = normalize(eye - p), x = normalize(cross(stage.u, z));
    holder->orientation = Quat(Mat3(x, cross(z, x), z));
    root_->addChild(holder);
    return holder;
}

/// A line of words on a holder, its left edge at `x` (or its middle, with `centred`). Returns how wide it is.
float OceanModel::guideWords(const EntityRef& holder, const std::optional<Piece>& piece, float x, float y, bool centred, int action) {
    if (!piece) return 0;
    EntityRef e = art->quad(*piece);
    e->position = {centred ? x : x + piece->size.x / 2, y, 0};
    if (action >= 0) {
        e->collision = {Shape::generateBox({piece->size.x, piece->size.y + 0.008f, 0.01f})};
        e->inputTarget = true;
        e->hover = Art::hover();
        picks[e.get()] = Pick::guide(action);
        teach.picks.push_back(e.get());
    }
    holder->addChild(e);
    return piece->size.x;
}

void OceanModel::hideGuide(float over) {
    for (const Entity* e : teach.picks) picks.erase(e);
    teach.picks.clear();
    if (teach.holder) {
        for (const EntityRef& child : teach.holder->children) child->inputTarget = false;
        fadeOut(teach.holder, over);
    }
    teach.holder = nullptr;
    teach.mode = 0;
    teach.lesson = -1;
}

/// Puts the ghost hand on a holder, `size` of life size, its middle at `at`, turned `turned` degrees to show its side.
void OceanModel::guideHand(const EntityRef& holder, Vec3 at, float size, float turned) {
    teach.painter->entity->removeFromParent();
    teach.painter->entity->position = at;
    teach.painter->entity->orientation = Quat::angleAxis(turned * floatPi / 180, {0, 1, 0});
    teach.painter->entity->scale = Vec3::repeating(size);
    teach.painter->clear();
    holder->addChild(teach.painter->entity);
}

/// A dark card behind a gesture, for it to read against whatever stands behind it, with `under` metres more
/// below for words. The gesture is in front of it (its hands nearest you). Returns where the words start:
/// the middle of the card's width, just under the gesture, on the card's face.
Vec3 OceanModel::guideBacking(const EntityRef& holder, Vec3 at, float size, float under, float opacity, float atLeast) {
    // (Wider and taller than the gesture itself: what stands off a card toward you looks larger against it.
    // And never narrower than the words it carries, `atLeast`.)
    const float wide = std::max(0.72f * size, atLeast), top = 0.24f * size, bottom = 0.32f * size, back = 0.22f * size;
    // (All but solid: what stands behind it would otherwise read through the words.)
    EntityRef card = art->swatch(Art::ink, {wide, top + bottom + under}, opacity);
    card->position = {at.x, at.y + (top - bottom - under) / 2, at.z - back};
    holder->addChild(card);
    return {at.x, at.y - bottom, at.z - back + 0.004f};
}

/// Where a gesture is shown: low on the right, where your own hand would make it; or, for the small tree
/// (worked by touch, where it stands), just above the tree, leant back by `tip` toward the eyes that look
/// down at it.
EntityRef OceanModel::lessonHolder(const std::string& id, float& size, float& tip) {
    size = lessonSize;
    tip = 0;
    if (id == "tree" && hologram && hologram->entity->isEnabledInHierarchy()) {
        std::optional<Mat4> head = platform::head();
        Vec3 eye = head ? head->position() : stage.origin;
        Vec3 treeAt = hologram->entity->positionRelativeTo(nullptr);
        Vec3 z = eye - treeAt;
        z.y = 0;
        z = length(z) > 1e-3f ? normalize(z) : -stage.f;
        Vec3 x = normalize(cross(stage.u, z));
        EntityRef holder = Entity::make();
        holder->position = treeAt + x * 0.06f + stage.u * 0.38f;
        // It is looked down at: the whole card leans back toward the eyes, most of the way.
        Vec3 to = eye - holder->position;
        tip = 0.6f * std::atan2(to.y, std::max(0.05f, length(Vec3{to.x, 0, to.z})));
        holder->orientation = Quat(Mat3(x, stage.u, z)) * Quat::angleAxis(-tip, {1, 0, 0});
        root_->addChild(holder);
        size = lessonSize * 0.86f;
        return holder;
    }
    // (No lower: the tree's own buttons stand under here, and the small tree to the left of them.)
    return guideHolder(22, 15, 0.75f);
}

/// A gesture, shown where your own hand would make it, with its few words under it.
void OceanModel::showLesson(int index) {
    if (!art || !teach.painter || index < 0 || index >= int(teach.lessons.size())) return;
    const guide::Gesture* g = guide::gesture(teach.lessons[size_t(index)].id);
    if (!g) return;
    hideGuide();
    float size = lessonSize, tip = 0;
    EntityRef holder = lessonHolder(teach.lessons[size_t(index)].id, size, tip);
    teach.painter->setLine(lessonLine);
    guideHand(holder, {0, 0.02f, 0}, size);
    EntityRef words = Entity::make();
    // (Its name only: at this size a second line would be wider than the card, and the hand says the rest.)
    std::optional<Piece> name = art->line(g->title, Art::Size::label, Font::Weight::semibold);
    words->position = guideBacking(holder, {0, 0.02f, 0}, size, 0.034f, lessonGround, name ? name->size.x + 0.03f : 0) + Vec3{0, -0.012f, 0};
    holder->addChild(words);
    guideWords(words, name, 0, 0, true);
    fadeIn(holder, 0, 0.4f);
    teach.holder = holder;
    teach.mode = 2;
    teach.lesson = index;
    teach.began = time;
    sound("holo_wake", 0.4f);
    logLine(fmt("[guide] showing %s", g->id));
}

// MARK: - The welcome tree

// The first thing a new viewer meets is a tree: "Welcome to Mind Forest". It is an ordinary tree, of cards made
// here, and the walk through the hands is the tree itself:
// - Each lesson is a card. Open, it plays its gesture on its own face and says what to do in its own words.
// - The next lesson's card stands beside it. Pinching that card moves on (whether or not the lesson was
//   done), and as any pinch on a card does, it makes a new layer: the tree is seven layers deep by the end,
//   which is what pulling, pushing and the small tree need to be worth learning.
// - The tree's own step numbers count the walk. Putting the tree away, by hand or by button, ends it.
// - Where a button does what a gesture does, a pin stands at the button.

bool OceanModel::onWelcomeTree() const { return tree && tree->title == tourTitle; }

/// Makes the welcome tree's cards: notes like any the gardener keeps, but written here. They are made
/// whether or not the guide runs, since a welcome tree put away on the shelf is opened from them.
void OceanModel::addWelcomeNotes() {
    if (!catalog || catalog->notes.count(tourSteps[0].note)) return;
    int works = int(catalog->works.size()), used = 0;
    // A picture wider than it is tall for the marking lesson: its card shows it whole.
    int toMark = -1;
    for (int k = 0; k < works && toMark < 0; k++) {
        if (catalog->works[size_t(k)].aspect > 1.25f && catalog->works[size_t(k)].aspect < 1.7f) toMark = k;
    }
    for (int k = 0; k < tourCount; k++) {
        const TourStep& step = tourSteps[k];
        std::string links;
        auto link = [&](const std::string& to, const char* why) {
            links += fmt("%s{\"to\": \"%s\", \"why\": \"%s\"}", links.empty() ? "" : ", ", to.c_str(), why);
        };
        // (A lesson of talking to Momo has no next card beside it: the way on is from the layer Momo answers with.)
        if (k + 1 < tourCount && !step.result[0]) link(std::string("note:") + tourSteps[k + 1].note, k == 0 ? "Start here" : "Next");
        for (int n = 0; n < step.pictures && works > 0; n++) {
            used += 1;
            link(fmt("work:%d", (works * (2 * used - 1)) / 23 % works), std::string(step.gesture) == "drag" ? "Pick me up" : "A picture");
        }
        if (k == 0) link("film:22", "A film");
        std::string image = std::string("gesture:") + step.gesture;
        float aspect = Metrics::lessonWidth / Metrics::lessonStage;
        if (k == markStep && toMark >= 0) {
            const Work& work = catalog->works[size_t(toMark)];
            size_t slash = work.file.find_last_of('/'), dot = work.file.find_last_of('.');
            std::string name = work.file.substr(slash == std::string::npos ? 0 : slash + 1);
            if (dot != std::string::npos && (slash == std::string::npos || dot > slash)) name = name.substr(0, name.find_last_of('.'));
            image = "works-small/" + name + ".jpg";
            aspect = work.aspect;
        }
        std::string text = fmt("{\"id\": \"%s\", \"kicker\": \"Step %d of %d\", \"tone\": \"note\", \"headline\": \"%s\", \"highlight\": \"\", "
                               "\"summary\": \"%s\", \"tags\": [], \"links\": [%s], \"image\": \"%s\", \"aspect\": %.3f}",
                               step.note, k + 1, tourCount, step.headline, step.summary, links.c_str(), image.c_str(), double(aspect));
        std::optional<Json> json = Json::parse(text);
        std::optional<OceanNote> note = json ? OceanNote::from(*json) : std::nullopt;
        if (!note) {
            logLine(fmt("[guide] the welcome tree's card %s could not be made", step.note));
            continue;
        }
        catalog->notes[step.note] = *note;
        // Drawn as the card library draws its own, with or without `-cards`: on its stage the guide plays its gesture,
        // or it is the picture to mark.
        bool picture = k == markStep && toMark >= 0;
        Json props = Json::object(), view = Json::object(), item = Json::object();
        props.set("step", k + 1).set("badge", fmt("Step %d of %d", k + 1, tourCount));
        if (picture) props.set("src", fmt("work:%d", toMark)).set("aspect", aspect);
        else props.set("tall", lessonStageTall * Art::ppm / cards::ocean::openScale);
        view.set("component", "lesson").set("props", props);
        item.set("title", step.headline).set("summary", step.summary);
        cards::ocean::hold(cards::OceanCard{step.note, view, item, picture ? std::optional(aspect) : std::nullopt});
    }
    // What Momo answers with on the walk: cards like any it makes, but written here, so that the walk goes the
    // same way with the service or without it. First, what it can do: a card for each, in words that work
    // (they are among the requests Momo's voice is measured on, agents/scripts/live-requests.ts).
    struct Can {
        const char* id;
        const char* why;
        const char* headline;
        const char* say;
        const char* summary;
    };
    const Can cans[] = {
        {"momo-can-tree", "Begin", "Start a tree", "Start a tree on Hitchcock's camera tricks.", "A new tree grows from what you have saved and what Momo finds."},
        {"momo-can-find", "Find", "Find new things", "Bring me some pictures of Delft.", "Museums, films, papers and the web, brought round the card that is open."},
        {"momo-can-saved", "Recall", "Look in what you saved", "Do I have anything about Kubrick?", "Momo answers aloud from what is already yours."},
        {"momo-can-more", "More", "More like this", "Show me more like this.", "About the open card. Narrow it as you like: more, but older."},
        {"momo-can-hand", "Pass on", "Hand it off", "Hand this off to my coding agent.", "The tree becomes one file another agent can work from."},
    };
    auto make = [&](const std::string& text, const char* id) {
        std::optional<Json> json = Json::parse(text);
        std::optional<OceanNote> note = json ? OceanNote::from(*json) : std::nullopt;
        if (note) catalog->notes[id] = *note;
        else logLine(fmt("[guide] the walk's card %s could not be made", id));
    };
    std::string canLinks = fmt("{\"to\": \"note:%s\", \"why\": \"Next\"}", tourSteps[momoStep + 1].note);
    for (const Can& can : cans) {
        make(fmt("{\"id\": \"%s\", \"kicker\": \"Ask Momo\", \"tone\": \"note\", \"headline\": \"%s\", \"highlight\": \"“Hi Momo. %s”\", "
                 "\"summary\": \"%s\", \"tags\": [], \"links\": []}", can.id, can.headline, can.say, can.summary), can.id);
        canLinks += fmt(", {\"to\": \"note:%s\", \"why\": \"%s\"}", can.id, can.why);
    }
    make(fmt("{\"id\": \"momo-can\", \"kicker\": \"Momo\", \"tone\": \"note\", \"headline\": \"Here is what I can do\", "
             "\"highlight\": \"Say “Hi Momo” first, wherever you are.\", "
             "\"summary\": \"Each card round this one is something to ask for, in words that work. The walk goes on at card %d.\", "
             "\"tags\": [], \"links\": [%s]}", momoStep + 2, canLinks.c_str()), "momo-can");
    // And what it makes of a sketch: here a stand-in, since the walk's picture is not one Momo knows. It is made
    // again with what was said (`tourAnswer`); the pictures beside it stand for what Momo would bring.
    teach.tourMarkLinks = fmt("{\"to\": \"note:%s\", \"why\": \"Next\"}", tourSteps[markStep + 1].note);
    teach.tourMarkWork = toMark;
    teach.tourMarkLike.clear();
    for (int n = 0; n < 3 && works > 0; n++) {
        used += 1;
        teach.tourMarkLike.push_back((works * (2 * used - 1)) / 23 % works);
        teach.tourMarkLinks += fmt(", {\"to\": \"work:%d\", \"why\": \"Like it\"}", teach.tourMarkLike.back());
    }
}

/// The card Momo answers a sketch with, on the walk: made (again) with what was said about it.
void OceanModel::tourMarkNote(const std::string& words) {
    if (!catalog) return;
    // (Into a note's own text: nothing in it that would end a string.)
    std::string said;
    for (char ch : words) {
        if (ch != '"' && ch != '\\' && (unsigned char)ch >= 0x20) said += ch;
    }
    if (said.size() > 90) said = said.substr(0, 90) + "…";
    std::string text = fmt("{\"id\": \"momo-mark\", \"kicker\": \"Momo\", \"tone\": \"note\", \"headline\": \"From your sketch\", "
                           "\"highlight\": \"%s\", "
                           "\"summary\": \"On your own trees Momo answers a sketch with a layer like this one: what the part is, and things like it. "
                           "Here these pictures stand in for it. The walk goes on at card %d.\", \"tags\": [], \"links\": [%s]}",
                           said.empty() ? "Sent without a word." : ("You said: “" + said + "”").c_str(), markStep + 2, teach.tourMarkLinks.c_str());
    std::optional<Json> json = Json::parse(text);
    std::optional<OceanNote> note = json ? OceanNote::from(*json) : std::nullopt;
    if (note) catalog->notes["momo-mark"] = *note;
    else logLine("[guide] the walk's card momo-mark could not be made");
}

/// Stands the welcome tree. From there the tree is the walk (`updateTour`).
void OceanModel::startTour() {
    if (!catalog || !teach.painter || catalog->notes.count(tourSteps[0].note) == 0) return;
    hideGuide();
    clearPeek();
    whenClear([this] {
        if (!catalog) return;
        standingSpot = std::nullopt;
        standingPlot = std::nullopt;
        stand(std::make_shared<Tree>(Ref::note(tourSteps[0].note), tourTitle, Maker::gardener, catalog));
    });
    teach.welcomed = true;
    teach.tour = 0;
    teach.answerEnds = 0;
    teach.layerAt = 0;
    teach.layerDue = nullptr;
    teach.askedCard = -1;
    teach.tourStood = false;
    teach.tourCarried = 0;
    teach.tourShown = -1;
    teach.tourHandsGone = -1;
    teach.tourLessonWas = -2;
    teach.tourTickFor = -1;
    teach.tourBeat = 0;
    teach.tourTook = false;
    teach.tourAdvanceFor = -1;
    teach.tourLessonAt = time;
    for (bool& done : teach.tourDone) done = false;
    teach.tourSent = false;
    tourMarkNote("");
    teach.tourWalkAt = time + 4.5;
    saveGuide();
    logLine("[guide] the welcome tree stands");
}

/// Which lesson's card is the one in focus; -1 when it is none of them.
int OceanModel::tourLesson() const {
    if (!tree || !tree->focus()) return -1;
    const TreeNode* node = find(*tree, *tree->focus());
    if (!node || node->ref.kind != Ref::Kind::note) return -1;
    for (int k = 0; k < tourCount; k++) {
        if (node->ref.id == tourSteps[k].note || (tourSteps[k].result[0] && node->ref.id == tourSteps[k].result)) return k;
    }
    return -1;
}

bool OceanModel::tourOnResult() const {
    if (!tree || !tree->focus()) return false;
    const TreeNode* node = find(*tree, *tree->focus());
    if (!node || node->ref.kind != Ref::Kind::note) return false;
    for (int k = 0; k < tourCount; k++) {
        if (tourSteps[k].result[0] && node->ref.id == tourSteps[k].result) return true;
    }
    return false;
}

std::optional<int> OceanModel::tourResultNode(int lesson) const {
    if (!tree || lesson < 0 || lesson >= tourCount || !tourSteps[lesson].result[0]) return std::nullopt;
    for (const auto& [id, node] : tree->nodes) {
        if (node.ref.kind == Ref::Kind::note && node.ref.id == tourSteps[lesson].result) return id;
    }
    return std::nullopt;
}

/// The card of a lesson, if it is in the tree.
OceanModel::CardRef OceanModel::tourCard(int lesson) const {
    if (!tree || lesson < 0 || lesson >= tourCount) return nullptr;
    // The layer Momo made for a lesson is that lesson's too: while it is the one in focus, its card is the lesson's.
    if (tourOnResult() && tourLesson() == lesson) {
        auto found = cards.find(*tree->focus());
        return found == cards.end() ? nullptr : found->second;
    }
    for (const auto& [id, node] : tree->nodes) {
        if (node.ref.kind != Ref::Kind::note || node.ref.id != tourSteps[lesson].note) continue;
        auto found = cards.find(id);
        return found == cards.end() ? nullptr : found->second;
    }
    return nullptr;
}

/// The marking lesson, once its card is gone into, is three things one after another: what to do now, said
/// on the card itself. (Nothing floats over a card gone into: it is being worked on.)
std::string OceanModel::tourLine() const {
    if (teach.tourSent) return "Sent. Say “Hi Momo”, then what you want to know about it";
    if (teach.tourDone[markStep]) return "Marked. Now pinch Send, the third button";
    if (!penOn) return "Pinch the pen, at the top right";
    return "Pinch, hold, and draw round the face";
}

/// Puts the ghost hand where the walk now wants it: on the face of lesson `shown`'s card; or, for 100 +
/// a lesson, on a card of its own beside you (marking, whose card is the picture to be marked); or, for
/// 200 + a lesson, on that lesson's card but showing pull and push (the layer pulled back to, while the
/// walk waits for the push that returns); or nowhere, for -1.
void OceanModel::tourShow(int shown) {
    if (teach.mode == 4) hideGuide(0.25f);
    teach.painter->entity->removeFromParent();
    teach.painter->clear();
    teach.tourShown = shown;
    teach.tourBegan = time;
    if (shown < 0) return;
    const TourStep& step = tourSteps[shown >= 200 ? pullStep : shown % 100];
    if (shown < 100 || shown >= 200) {
        // On its own card: in the middle of the stage at the top of it, standing off it toward you, at its `stage` size.
        CardRef c = tourCard(shown % 100);
        if (!c || !c->openBuilt) {
            teach.tourShown = -1;
            return;
        }
        PictureFrame picture = pictureFrame(*c);
        const float size = step.stage;
        const guide::Gesture* gesture = tourGesture(step.gesture);
        doneAt = gesture ? drawnMiddle(*gesture) : Vec3::zero();
        teach.painter->entity->position = Vec3{picture.center.x, picture.center.y, 0.2f * size + 0.014f} - doneAt * size;
        teach.painter->entity->orientation = Quat::identity();
        teach.painter->entity->scale = Vec3::repeating(size);
        teach.painter->setLine(0.0017f);
        c->openHolder->addChild(teach.painter->entity);
        logLine(fmt("[guide] lesson %d on its card: %s", shown % 100 + 1, step.gesture));
        return;
    }
    // On a card of its own, further to the right than a lesson stands: clear of the tree's card and the next one.
    float size = lessonSize;
    EntityRef holder = guideHolder(27, 13, 0.8f);
    teach.painter->setLine(lessonLine);
    guideHand(holder, {0, 0.02f, 0}, size);
    EntityRef words = Entity::make();
    words->position = guideBacking(holder, {0, 0.02f, 0}, size, 0.034f, lessonGround) + Vec3{0, -0.012f, 0};
    holder->addChild(words);
    guideWords(words, art->line("What marking looks like", Art::Size::label, Font::Weight::semibold), 0, 0, true);
    fadeIn(holder, 0, 0.4f);
    teach.holder = holder;
    teach.mode = 4;
}

/// Turned to the eyes and upright, for words that stand in the room at `p` (the room's own space).
Quat OceanModel::guideFacing(Vec3 p) const {
    std::optional<Mat4> head = platform::head();
    Vec3 eye = root_->convertFrom(head ? head->position() : stage.origin, nullptr);
    Vec3 z = eye - p;
    z = length(z) > 1e-4f ? normalize(z) : Vec3{0, 0, 1};
    Vec3 x = cross(stage.u, z);
    x = length(x) > 1e-4f ? normalize(x) : Vec3{1, 0, 0};
    return Quat(Mat3(x, cross(z, x), z));
}

/// A few words by something, for the walk: put up, moved with what it is by, or taken down (no place).
/// With `on`, they are part of that card (`at` in its own space): they take its size and its curve as it goes in.
void OceanModel::tourPin(EntityRef& pin, std::string& said, const std::string& words, std::optional<Vec3> at, float size, const EntityRef& on) {
    if (!at || words.empty()) {
        if (pin) fadeOut(pin, 0.25f);
        pin = nullptr;
        said.clear();
        return;
    }
    Entity* parent = on ? on.get() : root_.get();
    if (!pin || said != words || pin->parent != parent) {
        if (pin) fadeOut(pin, 0.2f);
        pin = nullptr;
        std::optional<Piece> piece = art->line(words, size > 0 ? size : Art::Size::label, Font::Weight::medium, Color::white(), Art::ink,
                                               size > 0 ? Art::buttonPad : Art::pad);
        if (!piece) return;
        pin = art->quad(*piece);
        parent->addChild(pin);
        fadeIn(pin, 0.4, 0.4f);
        said = words;
    }
    pin->position = *at;
    pin->orientation = on ? Quat::identity() : guideFacing(*at);
}

/// A number (or a word or two) on the accent and words beside it on the dark: how the walk says where it is
/// and what to do, and how the ways to begin are told apart in the room. Its middle is the holder's.
EntityRef OceanModel::guideTag(const std::string& chip, const std::string& words, float size) {
    std::optional<Piece> number = art->line(chip, size >= Art::Size::title ? size * 0.68f : size, Font::Weight::bold, Color::white(), Art::hot, Art::buttonPad);
    std::optional<Piece> line = art->line(words, size, Font::Weight::semibold, Color::white(), Art::ink, Art::buttonPad);
    if (!number || !line) return nullptr;
    EntityRef holder = Entity::make();
    float gap = 0.008f, whole = number->size.x + gap + line->size.x;
    EntityRef a = art->quad(*number), b = art->quad(*line);
    a->position = {-whole / 2 + number->size.x / 2, 0, 0};
    b->position = {-whole / 2 + number->size.x + gap + line->size.x / 2, 0, 0};
    holder->addChild(a);
    holder->addChild(b);
    return holder;
}

/// The one thing to do now, said large over the tree, with where the walk is ("3 of 7") before it. It stays
/// where it last was while there is nowhere to put it (a card on its way open), so it is never simply gone.
void OceanModel::tourCaption(const std::string& chip, const std::string& words, std::optional<Vec3> at) {
    std::string key = words.empty() ? "" : chip + "|" + words;
    if (key != teach.tourCaptionSaid) {
        if (teach.tourCaption) fadeOut(teach.tourCaption, 0.2f);
        teach.tourCaption = nullptr;
        teach.tourCaptionSaid = key;
        if (!key.empty()) {
            if (EntityRef holder = guideTag(chip, words, Art::Size::title)) {
                root_->addChild(holder);
                fadeIn(holder, 0.15, 0.35f);
                teach.tourCaption = holder;
            }
        }
    }
    if (at) teach.tourCaptionAt = *at;
    if (teach.tourCaption) {
        teach.tourCaption->position = teach.tourCaptionAt;
        teach.tourCaption->orientation = guideFacing(teach.tourCaptionAt);
    }
}

/// Off the walk (a picture or a film was followed instead of a lesson): said so over the card now open,
/// with the two ways on. Back to the lesson the walk had got to; or out of the walk altogether.
void OceanModel::tourOff(std::optional<Vec3> at) {
    int want = at ? teach.tour : -1;
    if (want != teach.tourOffFor) {
        for (const Entity* e : teach.tourOffPicks) picks.erase(e);
        teach.tourOffPicks.clear();
        if (teach.tourOffPanel) {
            for (const EntityRef& child : teach.tourOffPanel->children) child->inputTarget = false;
            fadeOut(teach.tourOffPanel, 0.2f);
        }
        teach.tourOffPanel = nullptr;
        teach.tourOffFor = want;
        std::optional<Piece> words = want >= 0 ? art->line("You have left the walk", Art::Size::title, Font::Weight::semibold, Color::white(), Art::ink, Art::buttonPad) : std::nullopt;
        std::optional<Piece> back = want >= 0 ? art->pill(fmt("Back to step %d", want + 1), Art::Size::lead) : std::nullopt;
        std::optional<Piece> skip = want >= 0 ? art->pill("Skip the tutorial", Art::Size::lead, Color::hex(0x2A303B)) : std::nullopt;
        if (words && back && skip) {
            EntityRef holder = Entity::make();
            // Each answer takes a pinch near it as well: outward and below, but only half the gap toward the other and
            // toward the words above (the lead, WS75).
            std::optional<Mat4> head = platform::head();
            float reach = guideReach(head && at ? length(*at - head->position()) : 1.5f);
            float gap = 0.012f;
            auto put = [&](const Piece& piece, float x, float y, int action, float left, float right) {
                EntityRef e = art->quad(piece);
                e->position = {x, y, 0};
                if (action >= 0) {
                    reachOut(e, piece.size, left, right, reach, 0.006f);
                    e->hover = Art::hover();
                    picks[e.get()] = Pick::guide(action);
                    teach.tourOffPicks.push_back(e.get());
                }
                holder->addChild(e);
            };
            // The words over the two answers, the answers a little apart and together in the middle.
            float row = back->size.x + gap + skip->size.x, y = -words->size.y / 2 - 0.012f - back->size.y / 2;
            put(*words, 0, 0, -1, 0, 0);
            put(*back, -row / 2 + back->size.x / 2, y, Act::tourBack, reach, gap / 2);
            put(*skip, -row / 2 + back->size.x + gap + skip->size.x / 2, y, Act::tourSkip, gap / 2, reach);
            // A pinch elsewhere on the panel is the panel's, and does nothing.
            guideSwallow(holder, 0.02f, teach.tourOffPicks);
            root_->addChild(holder);
            // (A moment after the card that was followed has opened: it is what was asked for.) It takes pinches once
            // it has begun to show.
            fadeIn(holder, 0.9, 0.4f);
            std::weak_ptr<Entity> shown = holder;
            after(0.9 + 0.1, [this, shown] {
                EntityRef h = shown.lock();
                if (!h || h != teach.tourOffPanel) return;
                for (const EntityRef& child : h->children) child->inputTarget = !child->collision.empty();
            });
            teach.tourOffPanel = holder;
            logLine("[guide] off the walk: offered the way back and the way out");
        }
    }
    if (teach.tourOffPanel && at) {
        teach.tourOffPanel->position = *at;
        teach.tourOffPanel->orientation = guideFacing(*at);
    }
}

/// The node of a lesson's card, if the tree has it.
std::optional<int> OceanModel::tourNode(int lesson) const {
    if (!tree || lesson < 0 || lesson >= tourCount) return std::nullopt;
    for (const auto& [id, node] : tree->nodes) {
        if (node.ref.kind == Ref::Kind::note && node.ref.id == tourSteps[lesson].note) return id;
    }
    return std::nullopt;
}

/// A pinch on the open lesson itself. A lesson's stage is not gone into (there is nothing in it); where the
/// way on is the next card, the open one will do as well: nobody is left pinching the wrong card.
bool OceanModel::tourPinchedOpen() {
    if (teach.tour < 0 || !onWelcomeTree()) return false;
    int lesson = tourLesson();
    if (lesson < 0 || (lesson == markStep && !tourOnResult())) return false;
    bool onward = lesson == 0 || teach.tourAdvanceFor == lesson;
    if (std::optional<int> next = onward ? tourNode(lesson + 1) : std::nullopt) take(*next);
    return true;
}

/// The walk, each frame. It is always somewhere (`teach.tour`, the lesson it has got to), that lesson is at
/// some beat, and one line over the tree says the one thing to do now. What is to be pinched or reached for
/// has a line round it and arrowheads running to it. A lesson done is marked on its card, and the walk
/// takes the next card by itself a moment later.
void OceanModel::updateTour(double now, Vec3 eye) {
    bool mine = onWelcomeTree() && !pressing;
    if (mine) teach.tourStood = true;
    else if (teach.tourStood) {
        endTour("its tree is gone");
        return;
    }
    if (!mine) return;
    float dt = float(std::min(0.1, std::max(0.0, now - teach.tourLast)));
    teach.tourLast = now;
    int lesson = tourLesson();          // the lesson whose card is open; -1 when it is none of them
    bool zoomed = zoom.target() > 0.5f;
    bool busy = !hands->grabs().empty() || press.has_value();
    static const bool holdDone = Flags::has("guideDone");       // `-guideDone`: a lesson as it is just after it is done, kept so

    // A card was pinched: the walk is wherever that card is.
    if (teach.tourTook) {
        teach.tourTook = false;
        if (lesson >= 0 && lesson != teach.tour) {
            teach.tour = lesson;
            teach.tourBeat = 0;
            teach.tourLessonAt = now;
            teach.tourAdvanceFor = -1;
        }
    }
    int at = teach.tour;
    bool here = lesson == at;
    if (teach.walkFrom != at) {
        if (teach.walkFrom == momoStep || teach.walkFrom == markStep) leaveMomoLesson(teach.walkFrom);
        teach.walkFrom = at;
    }
    // `-guideDemo tour -guideStep <n>`: walks to the nth lesson by itself, a card every few seconds.
    if (teach.demo && Flags::has("guideStep") && lesson >= 0 && lesson < std::min(tourCount, Flags::integer("guideStep")) - 1 && now >= teach.tourWalkAt) {
        if (std::optional<int> next = tourNode(lesson + 1)) {
            teach.tourWalkAt = now + 3.6;
            take(*next);
            return;
        }
        // (A lesson of talking to Momo: its answer is brought, as if it had been asked for.)
        if (tourSteps[lesson].result[0] && !tourOnResult() && now >= teach.layerAt) {
            teach.tourWalkAt = now + 3.6;
            tourAnswer(lesson, lesson == markStep ? "What is she holding?" : "");
            return;
        }
    }
    if (teach.demo && Flags::has("guideBeat")) teach.tourBeat = Flags::integer("guideBeat");
    // `-guideOff <s>`: at that second, follows a picture off the walk, as a stray pinch would.
    static bool strayed = false;
    if (teach.demo && Flags::has("guideOff") && !strayed && now >= Flags::number("guideOff") && lesson >= 0) {
        const TreeNode* node = tree->focus() ? find(*tree, *tree->focus()) : nullptr;
        for (int child : node ? node->children : std::vector<int>{}) {
            const TreeNode* n = find(*tree, child);
            if (!n || n->ref.kind != Ref::Kind::work) continue;
            strayed = true;
            take(child);
            return;
        }
    }

    // Is this lesson finished? Pulling is only half of its lesson: the other half is being back on its card.
    bool finished = teach.tourDone[at];
    if (at == 0) finished = false;                                              // (its doing is the taking of the next card)
    if (at == pullStep) finished = teach.tourBeat >= 1 && here && !(teach.demo && Flags::has("guideBeat"));
    // (A lesson of talking to Momo is done on the layer Momo answered with.)
    bool result = tourOnResult();
    if (tourSteps[at].result[0]) finished = here && result;
    if (at == closeStep) finished = false;                                      // (putting the tree away ends the walk)
    if (holdDone && teach.demo && at > 0) finished = true;
    if (finished && teach.tourAdvanceFor != at) {
        teach.tourAdvanceFor = at;
        teach.tourAdvanceAt = now;
        teach.tourTickFor = at;
        teach.tourTick = -1;
        logLine(fmt("[guide] lesson %d finished", at + 1));
    }
    bool passing = teach.tourAdvanceFor == at;       // done: the next card is the thing to pinch

    // Where the ghost hand belongs: on the open lesson's own face. (Marking's card is the picture to be marked:
    // its gesture plays on a card beside you until the picture is gone into.)
    int want = -1;
    if (zoomed || result) want = -1;
    else if (lesson == markStep) want = teach.tourDone[markStep] ? -1 : 100 + markStep;
    else if (lesson >= 0 && lesson != markStep && at == pullStep && teach.tourBeat >= 1 && !here) want = 200 + lesson;
    else if (lesson >= 0) want = lesson;
    if (want >= 0 && (want < 100 || want >= 200)) {
        CardRef c = tourCard(want % 100);
        if (!c || !c->openBuilt) want = -1;         // its card is still opening
    }
    if (want != teach.tourShown) tourShow(want);
    if (teach.tourShown >= 0) {
        // A lesson just done: the tick, drawn the first time its card is looked at after, and kept there.
        bool ticking = teach.tourShown == teach.tourTickFor;
        if (ticking && teach.tourTick < 0) teach.tourTick = now;
        if (ticking) {
            teach.painter->draw(doneGesture, float(teach.demoT >= 0 ? teach.demoT : now - teach.tourTick), eye);
        } else if (const guide::Gesture* g = tourGesture(tourSteps[teach.tourShown >= 200 ? pullStep : teach.tourShown % 100].gesture)) {
            teach.painter->draw(*g, float(teach.demoT >= 0 ? teach.demoT : std::fmod(now - teach.tourBegan, double(g->seconds))), eye);
        }
    }

    // The cards in play, and where things are on them.
    CardRef open = lesson >= 0 ? tourCard(lesson) : nullptr;
    if (open && !open->openBuilt) open = nullptr;
    CardRef nextCard = at + 1 < tourCount ? tourCard(at + 1) : nullptr;
    if (nextCard && nextCard->alpha.target() < 0.5f) nextCard = nullptr;
    // A lesson done: the next card is asked for, and pinched it is the next lesson. Left alone a quarter of
    // a minute, the walk takes it itself (sooner where the card is not there to pinch: the small tree has
    // taken you to another layer).
    bool canPinchNext = open && nextCard && here;
    static const double autoAfter = Flags::has("guideAutoAfter") ? Flags::number("guideAutoAfter") : 15;
    // (Not out of Momo's two lessons: there the user may still be asking her things, and moves on by hand, card 6 or 7 being
    // there to pinch. The user, WS80: "this auto-advance feature makes sense for some rounds, just probably not right for
    // the two rounds that has momo in it".)
    bool hers = at == momoStep || at == markStep;
    if (passing && !hers && !zoomed && !busy && !holdDone && now - teach.tourAdvanceAt >= (canPinchNext ? autoAfter : 4.0)) {
        if (std::optional<int> next = tourNode(at + 1)) {
            take(*next);
            return;
        }
    }
    auto inRoom = [&](Vec3 world) { return root_->convertFrom(world, nullptr); };
    float openSize = open ? std::max(0.05f, length(open->openHolder->transformMatrix(nullptr).columns[0].xyz())) : 1;
    Vec2 openHalf = open ? open->openBody * (openSize / 2) : Vec2::zero();       // the open card, m on its sheet
    // A line round part of a card, following the card's curve: `middle` and `size` in metres from the card's middle.
    auto roundOn = [](const CardView& c, Vec2 middle, Vec2 size, float corner = 0.014f, float step = 0.07f) {
        std::vector<Vec2> flat;
        const float corners[4][3] = {{1, 1, 0}, {-1, 1, 90}, {-1, -1, 180}, {1, -1, 270}};
        for (const auto& [sx, sy, from] : corners) {
            for (int k = 0; k <= 4; k++) {
                float a = (from + float(k) * 22.5f) * floatPi / 180;
                flat.push_back({middle.x + sx * (size.x / 2 - corner) + std::cos(a) * corner, middle.y + sy * (size.y / 2 - corner) + std::sin(a) * corner});
            }
        }
        std::vector<Vec3> out;
        for (size_t i = 0; i < flat.size(); i++) {
            Vec2 a = flat[i], b = flat[(i + 1) % flat.size()];
            int parts = std::max(1, int(std::ceil(length(b - a) / step)));
            for (int k = 0; k < parts; k++) out.push_back(c.point(a + (b - a) * (float(k) / float(parts)), 0.012f));
        }
        return out;
    };
    // The way to a card from the open one: off its right edge, and in to the other's left.
    auto wayTo = [&](const CardView& to) {
        Vec3 a = open->point({openHalf.x + 0.03f, to.position.y > open->position.y ? 0.05f : -0.05f}, 0.02f);
        Vec3 b = to.point({-to.half.x - 0.035f, 0}, 0.02f);
        return arcBetween(a, b, stage.u * 0.03f + open->normal * 0.03f);
    };

    // What the line over the tree says, and what is pointed at.
    signs.clear();
    std::string words, pinWords, spotWords;
    std::optional<Vec3> pinAt, spotAt, offAt, talkAt;
    float pinSize = 0;
    EntityRef pinOn;
    bool toNext = false;
    if (zoomed) {
        CardRef marking = lesson == markStep ? tourCard(markStep) : nullptr;
        if (marking && marking->openBuilt) {
            // Inside the picture being marked, each thing in its turn, said along the foot of the picture on the
            // card itself: level with the eyes (its top is far overhead), and the one thing to read there.
            PictureFrame picture = pictureFrame(*marking);
            Vec2 middle = picture.center * openSize, size = picture.size * openSize;
            pinWords = tourLine();
            pinSize = Art::Size::lead;
            pinOn = marking->openHolder;
            pinAt = Vec3{picture.center.x, picture.center.y - picture.size.y / 2 + 0.026f, 0.008f};
            if (teach.tourSent) {
                // Sent: what is waited for now is said aloud, and there is nothing to point at. What the walk
                // has to say about it (and the way on without speaking) stands just over the words.
                // (Well off the card: it is flat and the card is not, so its ends would otherwise go in behind the card's curve.)
                talkAt = marking->point({middle.x, middle.y - size.y / 2 + 0.026f * openSize + 0.085f}, 0.13f);
            } else if (teach.tourDone[markStep] && tools && tools->parent) {
                // Round Send (the last of the three at the picture's top right corner), and the way up to it from the words.
                Vec2 corner = Vec2{tools->position.x, tools->position.y} * openSize;
                Vec2 send = corner + Vec2{toolSize / 2, -toolsTall + toolSize / 2};
                signs.rounds.push_back(roundOn(*marking, send, {toolSize + 0.034f, toolSize + 0.034f}, 0.02f));
                std::vector<Vec3> way;
                Vec2 from{middle.x + 0.36f, middle.y - size.y / 2 + 0.026f * openSize}, turn{send.x, from.y}, to{send.x, corner.y - toolsTall - 0.05f};
                for (int k = 0; k <= 4; k++) way.push_back(marking->point(from + (turn - from) * (float(k) / 4), 0.02f));
                for (int k = 1; k <= 10; k++) way.push_back(marking->point(turn + (to - turn) * (float(k) / 10), 0.02f));
                if (turn.x - from.x > 0.03f) signs.flows.push_back(way);
            } else if (!penOn && tools && tools->parent) {
                // Round the pen (the first of the three at the picture's top right corner), and the way up to it from the words.
                Vec2 corner = Vec2{tools->position.x, tools->position.y} * openSize;
                Vec2 pen = corner + Vec2{toolSize / 2, -toolSize / 2};
                signs.rounds.push_back(roundOn(*marking, pen, {toolSize + 0.034f, toolSize + 0.034f}, 0.02f));
                std::vector<Vec3> way;
                Vec2 from{middle.x + 0.36f, middle.y - size.y / 2 + 0.026f * openSize}, turn{pen.x, from.y}, to{pen.x, corner.y - toolsTall - 0.05f};
                for (int k = 0; k <= 4; k++) way.push_back(marking->point(from + (turn - from) * (float(k) / 4), 0.02f));
                for (int k = 1; k <= 10; k++) way.push_back(marking->point(turn + (to - turn) * (float(k) / 10), 0.02f));
                if (turn.x - from.x > 0.03f) signs.flows.push_back(way);
            } else if (penOn) {
                // About here: a dashed round on the picture, to draw over.
                std::vector<Vec3> hint;
                float r = size.y * 0.3f;
                for (int k = 0; k < 48; k++) {
                    float a = float(k) * 2 * floatPi / 48;
                    hint.push_back(marking->point(middle + Vec2{std::cos(a) * r * 0.86f, std::sin(a) * r}, 0.014f));
                }
                signs.dashes.push_back(hint);
            }
        }
    } else if (!open && lesson < 0) {
        // Off the walk (a picture or a film was followed): it is said so over what is open, with the way back
        // and the way out (`tourOff`); and the lesson's own card, where it shows, is the way back too.
        std::optional<Vec3> over = overOpenCard();
        if (over) offAt = inRoom(*over) + stage.u * 0.085f;
        CardRef back = tourCard(at), from = tree->focus() ? card(*tree->focus()) : nullptr;
        if (back && back->alpha.target() > 0.5f) {
            signs.rounds.push_back(roundOn(*back, {0, -0.016f}, back->half * 2 + Vec2{0.06f, 0.09f}));
            if (from && length(back->position - from->position) > 0.25f) {
                Vec3 way = normalize(back->position - from->position);
                signs.flows.push_back(arcBetween(from->position + way * 0.2f + from->normal * 0.03f, back->position - way * (length(Vec3{back->half.x, back->half.y, 0}) + 0.03f) + back->normal * 0.03f, from->normal * 0.04f));
            }
        }
    } else if (!open) {
        // (Its card is on its way open: the line stays as it was.)
        words = teach.tourCaptionWords;
    } else if (passing) {
        words = at + 1 >= tourCount ? "Done" : canPinchNext ? fmt("Done. Pinch card %d to go on", at + 2) : fmt("Done. Step %d opens in a moment", at + 2);
        toNext = true;
    } else if (at == pullStep && teach.tourBeat >= 1) {
        words = here ? "" : "Now push it away to come back";
    } else if (!here) {
        words = lesson < at ? fmt("Step %d is ahead: push your closed hand away", at + 1) : fmt("Back to the walk: pinch card %d", at + 1);
    } else {
        words = tourSteps[at].say;
        // (Come back out of the picture before it was sent, or before a word was said about it.)
        if (at == markStep && teach.tourSent) words = "Say “Hi Momo”, then what you want to know about it";
        else if (at == markStep && teach.tourDone[markStep]) words = "Pinch the picture to go back in, then Send";
        if (at == 0) {
            toNext = true;
        } else if (at == 1) {
            // Either way, under the card.
            float y = -openHalf.y - 0.07f;
            for (float way : {-1.f, 1.f}) {
                std::vector<Vec3> path;
                for (int k = 0; k <= 8; k++) path.push_back(open->point({way * (0.05f + 0.3f * float(k) / 8), y}, 0.02f));
                signs.flows.push_back(path);
            }
        } else if (at == moveStep) {
            // Round the first picture that came with the card, and from it to somewhere else.
            const TreeNode* node = tree->focus() ? find(*tree, *tree->focus()) : nullptr;
            for (int child : node ? node->children : std::vector<int>{}) {
                const TreeNode* n = find(*tree, child);
                CardRef c = n && n->ref.kind == Ref::Kind::work ? card(child) : nullptr;
                if (!c || c->alpha.target() < 0.5f) continue;
                signs.rounds.push_back(roundOn(*c, {0, -0.016f}, c->half * 2 + Vec2{0.06f, 0.09f}));
                // The way from it begins below the ring, so it never runs across the picture's title (WS76).
                Vec3 from = c->point({0, -c->half.y - 0.016f - 0.045f - 0.015f}, 0.02f), to = c->point({0.06f, -c->half.y - 0.26f}, 0.02f);
                signs.flows.push_back(arcBetween(from, to, c->right * 0.05f));
                std::vector<Vec3> spot = roundOn(*c, {0.06f, -c->half.y * 2 - 0.3f}, c->half * 2, 0.012f, 0.016f);
                if (spot.size() % 2) spot.pop_back();
                signs.dashes.push_back(spot);
                break;
            }
        } else if (at == markStep && !teach.tourSent) {
            signs.rounds.push_back(roundOn(*open, {0, 0}, openHalf * 2 + Vec2{0.05f, 0.05f}, 0.02f));
        } else if (at == treeStep && hologram && hologram->entity->isEnabledInHierarchy()) {
            // The small tree is out of the way on purpose: a round about it, and the way down to it from the card.
            Vec3 foot = inRoom(hologram->entity->positionRelativeTo(nullptr)), middle = foot + stage.u * 0.12f;
            Vec3 toEye = normalize(inRoom(eye) - middle), x = normalize(cross(stage.u, toEye)), y = cross(toEye, x);
            std::vector<Vec3> round;
            for (int k = 0; k < 40; k++) {
                float a = float(k) * 2 * floatPi / 40;
                round.push_back(middle + x * (std::cos(a) * 0.115f) + y * (std::sin(a) * 0.145f));
            }
            signs.rounds.push_back(round);
            Vec3 from = open->point({-openHalf.x * 0.5f, -openHalf.y - 0.04f}, 0.03f), to = middle + y * 0.17f;
            signs.flows.push_back(arcBetween(from, to, (from - to) * 0.0f + toEye * 0.08f));
        } else if (at == closeStep && strip && strip->parent && strip->isEnabledInHierarchy()) {
            // The button that does the same: a round about Put away (the first of the tree's buttons, see
            // `layStrip`), and the way down to it from the card, coming in at its left.
            auto onStrip = [&](float x, float y) { return inRoom(strip->convertTo(Vec3{x, y, 0.004f}, nullptr)); };
            std::vector<Vec3> round;
            const float cx = -0.118f, cy = -0.018f, w = 0.1f, h = 0.04f, corner = 0.008f;
            const float corners[4][3] = {{1, 1, 0}, {-1, 1, 90}, {-1, -1, 180}, {1, -1, 270}};
            for (const auto& [sx, sy, from] : corners) {
                for (int k = 0; k <= 4; k++) {
                    float a = (from + float(k) * 22.5f) * floatPi / 180;
                    round.push_back(onStrip(cx + sx * (w / 2 - corner) + std::cos(a) * corner, cy + sy * (h / 2 - corner) + std::sin(a) * corner));
                }
            }
            signs.rounds.push_back(round);
            Vec3 to = onStrip(cx - w / 2 - 0.012f, cy), from = open->point({-openHalf.x * 0.4f, -openHalf.y - 0.04f}, 0.03f);
            if (length(to - from) > 0.2f) signs.flows.push_back(arcBetween(from, to, (onStrip(cx - 0.2f, cy) - to) * 0.6f));
        }
    }
    if (toNext && open && nextCard) {
        signs.rounds.push_back(roundOn(*nextCard, {0, -0.016f}, nextCard->half * 2 + Vec2{0.06f, 0.09f}));
        signs.flows.push_back(wayTo(*nextCard));
    }

    // The line: over the open card, where the eyes already are.
    std::optional<Vec3> over = overOpenCard();
    if (!words.empty()) teach.tourCaptionWords = words;
    tourCaption(fmt("%d of %d", at + 1, tourCount), words, over && !zoomed ? std::optional<Vec3>(inRoom(*over) + stage.u * 0.035f) : std::nullopt);

    // By the next card: what it is for. From the first card it is the lesson itself; once a lesson is done the
    // walk goes there by itself; and to whoever has been on a lesson a while without doing it, that it can be skipped.
    static const double skipAfter = Flags::has("guideSkipAfter") ? Flags::number("guideSkipAfter") : 14;
    bool waited = here && !passing && at > 0 && now - teach.tourLessonAt > skipAfter;
    bool showNext = open && nextCard && !zoomed && here && (at == 0 || passing || waited);
    tourPin(teach.tourNextPin, teach.tourNextSaid, at == 0 ? "Start here" : passing ? "Next" : "Or skip ahead: pinch this card",
            showNext ? std::optional<Vec3>(nextCard->position + stage.u * (nextCard->half.y + 0.05f)) : std::nullopt);

    // Words by the thing to use: inside the card being marked (set above), or where a button does what the gesture does.
    if (!zoomed && here && !passing && !(at == pullStep && teach.tourBeat >= 1)) {
        std::string alt = tourSteps[at].alt;
        if (alt == "tree" && hologram && hologram->entity->isEnabledInHierarchy()) {
            pinWords = tourSteps[at].altWords;
            pinAt = inRoom(hologram->entity->positionRelativeTo(nullptr)) + stage.u * (at == treeStep ? 0.33f : 0.36f);
        } else if (alt == "strip" && strip && strip->parent && strip->isEnabledInHierarchy()) {
            // (One of the buttons' own row: it lies as they lie.)
            pinWords = tourSteps[at].altWords;
            pinAt = Vec3{-0.1f, 0.062f, 0.004f};
            pinSize = Art::Size::label;
            pinOn = strip;
        }
    }
    tourPin(teach.tourPin, teach.tourPinSaid, pinAt ? pinWords : "", pinAt, pinSize, pinOn);
    tourPin(teach.tourSpotPin, teach.tourSpotSaid, spotAt ? spotWords : "", spotAt, 0.034f);
    tourOff(offAt);

    // Talking to Momo: while a lesson waits for words, Momo's ears are the walk's, and what the walk has to say
    // about what it heard, or why it hears nothing, stands over the line (inside a picture gone into, over its words).
    bool talking = here && !result && !passing && lesson == at && now >= teach.layerAt &&
                   ((at == momoStep && open && !zoomed) || (at == markStep && teach.tourSent));
    // From her answer to what she can do, and for as long as its layer is in front, her ears stay the walk's: asked one
    // of its cards, once her answer is over, she says what she would do (the user, WS78: not taken out of the welcome
    // tree). (Given back between her answer and its layer, a "Hi Momo" said meanwhile opened a turn of the live Momo's
    // that nothing ended: on the headset she was stuck listening.)
    bool answered = teach.answerEnds > 0 && (result || now >= teach.layerAt || teach.layerDue);
    bool examples = at == momoStep && here && !zoomed && answered;
    // A recorded answer that couldn't be played once its turn came: its layer at once, not after a silence.
    if (teach.layerDue) {
        agent::Voice* voice = agentBridge ? agentBridge->talk() : nullptr;
        if (voice && voice->recordedFailures() != teach.failuresAt) {
            logLine("[guide] her recorded answer could not be played: its layer at once");
            teach.answerEnds = now;
            teach.layerAt = now;
            std::exchange(teach.layerDue, nullptr)();
        }
    }
    if ((talking || examples) && !talkAt && over) talkAt = inRoom(*over) + stage.u * 0.084f;
    teach.talkPanelScale = zoomed ? 1.8f : 1;
    tourTalk(examples ? exampleTalk : at, talking || examples, now, talkAt);
    if (teach.tour < 0 || tourOnResult() != result) return;      // (it was answered: the tree has moved on under all this)
    // An example card asked for: ringed while her reply to it plays.
    if (examples && teach.askedCard >= 0 && now < teach.askedUntil) {
        if (CardRef asked = card(teach.askedCard); asked && asked->alpha.target() > 0.5f) {
            signs.rounds.push_back(roundOn(*asked, {0, 0}, asked->half * 2 + Vec2{0.04f, 0.04f}));
        }
    }

    // What is pointed with, drawn: gone while a hand of your own is at work (its own light is what to watch then).
    if (teach.marker) {
        bool any = !(signs.rounds.empty() && signs.dashes.empty() && signs.flows.empty()) && !(busy && !zoomed);
        teach.tourMarks += ((any ? 1.f : 0.f) - teach.tourMarks) * std::min(1.f, 6 * dt);
        signs.shown = any ? std::max(teach.tourMarks, teach.demo ? 1.f : 0.f) : teach.tourMarks;
        // (It is drawn from the eyes' own place: what is see-through is drawn furthest first, by where its middle
        // is, and this must come after every card it lies over, however near the card has come.)
        Vec3 from = inRoom(eye);
        teach.marker->entity->position = from;
        for (auto* lists : {&signs.rounds, &signs.dashes, &signs.flows}) {
            for (std::vector<Vec3>& points : *lists) {
                for (Vec3& p : points) p = p - from;
            }
        }
        signs.eye = Vec3::zero();
        if (signs.shown > 0.01f && any) teach.marker->draw(marksGesture, float(std::fmod(now, 1600.0)), eye);
        else teach.marker->clear();
    }

    // No hands seen for a while: that is the first thing to put right.
    bool seen = platform::hand(0).tracked || platform::hand(1).tracked;
    if (seen) teach.tourHandsGone = -1;
    else if (teach.tourHandsGone < 0) teach.tourHandsGone = now;
    tourPin(teach.tourHandsPin, teach.tourHandsSaid, "Hold your hands up where you can see them",
            !seen && now - teach.tourHandsGone > 5 && over && !teach.demo ? std::optional<Vec3>(inRoom(*over) + stage.u * 0.1f) : std::nullopt);
}

/// What the viewer did, for the walk: what a lesson asks for, done at any time, is known to be done.
void OceanModel::tourDid(const std::string& did, float amount) {
    if (!onWelcomeTree()) return;
    if (did == "ask") teach.tourTook = true;
    if (did == "carry") teach.tourCarried += amount;
    if (did == "step" && teach.tour == pullStep) teach.tourBeat = 1;
    for (int k = 0; k < tourCount; k++) {
        if (teach.tourDone[k] || did != tourSteps[k].did) continue;
        if (did == "carry" && teach.tourCarried < 0.1f) continue;
        teach.tourDone[k] = true;
        sound("answer", 0.5f);
        // What was done on the walk is known: no ghost hand comes for it later.
        for (GuideLesson& l : teach.lessons) {
            if (l.id == tourSteps[k].gesture) l.learned = true;
        }
        logLine(fmt("[guide] lesson %d done: %s", k + 1, tourSteps[k].gesture));
        saveGuide();
    }
    if (did == "press") endTour(teach.tourDone[closeStep] ? "the tree was put away" : "the tree was put away early");
}

// MARK: - Talking to Momo
//
// Two of the walk's lessons are done by speaking: "Hi Momo, what can you do for me?", and a word about a sketch
// that was sent. Each ends in a layer Momo answers with. The cards of that layer are the walk's own (see
// `addWelcomeNotes`), so the walk goes the same way joined to the service or not; what is real is the listening:
// while a lesson waits for words, Momo's ears are lent to the walk (`agent::Voice::Tutor`), which hears the name
// and then what was said, and the service is not told (it might otherwise stand a tree of its own in the walk's place).
//
// Nobody is left waiting. Whatever goes wrong is said in a line over the lesson, and where speaking cannot work,
// or has not worked twice, "Go on without speaking" stands under it and does what the words would have done:
// - Momo is not in this copy, its microphone was refused, is still being asked for, or is not on;
// - nothing is said for a while; the name is said and nothing after it;
// - something else is asked (for the first lesson: anything that does not ask what Momo can do). It is quoted
//   back, with what to ask instead. For the sketch, anything said is a word about it, and is taken.
// A refused microphone (its window missed at launch, or answered no) is asked for again as either lesson begins.
// Where the system no longer asks (the Quest, after two refusals), the line says where in its Settings to switch it
// on, beside the way on an "Open Settings" button; back from there with it on, Momo listens (WS87).

namespace {
/// Whether what was said asks what Momo can do, loosely: a transcript is seldom word for word.
bool asksWhatItCan(const std::string& said) {
    std::string low;
    for (char ch : said) low += char(std::tolower((unsigned char)ch));
    for (const char* part : {"what can you", "can you do", "what do you do", "what you can do", "what could you", "what are you", "who are you",
                             "help me", "can you help", "what can momo", "what does momo", "what is this"}) {
        if (low.find(part) != std::string::npos) return true;
    }
    return false;
}
}

int OceanModel::tourHearing() const {
    // `-guideHear ready|starting|asking|refused|settings|off|none`: as if Momo's ears were so, for a look at each in the preview.
    if (teach.demo && Flags::has("guideHear")) {
        std::string as = Flags::string("guideHear").value_or("ready");
        return as == "ready" ? 0 : as == "starting" ? 1 : as == "asking" ? 2 : as == "refused" ? 3 : as == "settings" ? 6 : as == "off" ? 4 : 5;
    }
    agent::Voice* voice = agentBridge ? agentBridge->talk() : nullptr;
    if (!voice) return 5;
    switch (voice->hearing()) {
    case agent::Voice::Hearing::ready: return 0;
    case agent::Voice::Hearing::starting: return 1;
    // (Not asked for yet: the lesson beginning asks for it.)
    case agent::Voice::Hearing::unasked: return 1;
    case agent::Voice::Hearing::asking: return 2;
    case agent::Voice::Hearing::refused: return 3;
    case agent::Voice::Hearing::settingsOnly: return 6;
    case agent::Voice::Hearing::off: return 4;
    }
    return 4;
}

void OceanModel::tourTalk(int lesson, bool wanted, double now, std::optional<Vec3> at) {
    agent::Voice* voice = agentBridge ? agentBridge->talk() : nullptr;
    int want = wanted ? lesson : -1;
    if (want != teach.talkFor) {
        teach.talkFor = want;
        teach.talkSince = now;
        teach.talkWoke = -1;
        teach.talkMisses = 0;
        teach.talkNote.clear();
        teach.talkHeard.clear();
        if (voice && want >= 0) {
            voice->tutor(agent::Voice::Tutor{[this] { teach.talkHeard.push_back({true, ""}); },
                                             [this](const std::string& words) { teach.talkHeard.push_back({false, words}); }});
        } else if (voice) {
            voice->tutor(std::nullopt);
        }
        // As a lesson by speaking begins, the microphone is asked for: the first time here, where the lesson's words say
        // why (WS95: nothing asks at launch), or again where it was refused (its window missed, or answered no; WS87).
        // Where the system no longer asks, the line says where it is switched on.
        if (voice && (want == momoStep || want == markStep)) voice->askForMicrophone();
        if (want == exampleTalk) logLine(fmt("[guide] the example cards listen for one asked: Momo's ears are %d", tourHearing()));
        else if (want >= 0) logLine(fmt("[guide] lesson %d waits for words: Momo's ears are %d", want + 1, tourHearing()));
    }
    if (want < 0) {
        tourTalkPanel("", false, std::nullopt);
        return;
    }
    // `-guideWokeAt <s>`, `-guideSayAt <s> -guideSay <words_with_underscores>`: as if heard, in the preview.
    static bool woken = false, spoken = false;
    if (teach.demo && Flags::has("guideWokeAt") && !woken && now >= Flags::number("guideWokeAt")) {
        woken = true;
        teach.talkHeard.push_back({true, ""});
    }
    if (teach.demo && Flags::has("guideSayAt") && !spoken && now >= Flags::number("guideSayAt")) {
        spoken = true;
        std::string words = Flags::string("guideSay").value_or("");
        std::replace(words.begin(), words.end(), '_', ' ');
        teach.talkHeard.push_back({false, words});
    }
    // `-guideSayAgainAt <s> -guideSayAgain <words>`: something more said, later (on the example cards, say).
    static bool again = false;
    if (teach.demo && Flags::has("guideSayAgainAt") && !again && now >= Flags::number("guideSayAgainAt")) {
        again = true;
        std::string words = Flags::string("guideSayAgain").value_or("");
        std::replace(words.begin(), words.end(), '_', ' ');
        teach.talkHeard.push_back({false, words});
    }
    std::vector<std::pair<bool, std::string>> heard;
    heard.swap(teach.talkHeard);
    for (const auto& [name, words] : heard) {
        if (name) {
            teach.talkWoke = now;
            teach.talkNote = "Momo is listening…";
            continue;
        }
        teach.talkWoke = -1;
        size_t first = words.find_first_not_of(" \t\n"), last = words.find_last_not_of(" \t\n");
        std::string said = first == std::string::npos ? "" : words.substr(first, last - first + 1);
        if (said.empty()) {
            teach.talkMisses += 1;
            teach.talkNote = "Momo heard its name, then nothing. Say it all in one go";
            logLine("[guide] the name, and nothing after it");
            continue;
        }
        if (lesson == exampleTalk) {
            tourExample(said, now);
            continue;
        }
        if (lesson == momoStep && !asksWhatItCan(said)) {
            teach.talkMisses += 1;
            std::string quoted = said.size() > 34 ? said.substr(0, 32) + "…" : said;
            teach.talkNote = "Momo heard “" + quoted + "”. Keep that for after the walk: now ask what it can do";
            logLine("[guide] something else was asked: " + said);
            continue;
        }
        tourAnswer(lesson, said);
        return;
    }
    // (On the example cards nothing is waited for: only what was heard is said, and no way on is offered.)
    if (lesson == exampleTalk) {
        tourTalkPanel(teach.talkNote, false, at);
        return;
    }
    // Why nothing is heard, if nothing can be; otherwise what the last turn came to, or after a while a nudge.
    int hear = tourHearing();
    // The microphone has just come on (allowed at its window, or in Settings): the wait for words begins now, so the way
    // on without speaking, which stood while Momo could not hear, goes. (The user, 2026-11-18.)
    if (hear == 0 && teach.talkHearing > 0) {
        teach.talkSince = now;
        teach.talkMisses = 0;
    }
    teach.talkHearing = hear;
    double waited = now - teach.talkSince;
    std::string note = teach.talkNote;
    bool pill = teach.talkMisses >= 2, settings = false;
    if (hear == 5) {
        note = "Momo is not connected in this copy";
        pill = true;
    } else if (hear == 3) {
        note = "Momo can’t hear you yet: the microphone is off";
        pill = true;
    } else if (hear == 6) {
        // (The system no longer asks: only its Settings can switch it on. Meta's own words for the way there.)
        note = "Momo can’t hear you yet: the microphone is off\nTurn it on in Settings › Privacy and safety › App permissions › Microphone";
        pill = true;
        settings = !(voice && voice->settingsWontOpen());
    } else if (hear == 2) {
        note = "Allow the microphone, so that Momo can hear you";
        pill = waited > 12;
    } else if (hear == 1 && waited > 6) {
        // (Joined, and not listening yet: the service has not answered, or the listener is still loading.)
        note = "Momo is not ready to listen yet";
        pill = true;
    } else if (hear == 4) {
        note = "Momo cannot hear you: its microphone is not on";
        pill = true;
    } else if (hear == 0) {
        if (teach.talkWoke >= 0 && now - teach.talkWoke > 20) {
            // (The name was heard and nothing ever came of it.)
            teach.talkWoke = -1;
            teach.talkNote.clear();
            note.clear();
        }
        if (note.empty() && waited > 14) note = "Say it out loud, and begin with “Hi Momo”";
        if (waited > 32) pill = true;
    } else {
        note.clear();
    }
    tourTalkPanel(note, pill, at, settings);
}

/// What the walk says about the words it waits for, over the lesson: a line (and, after a line break in `words`, a
/// smaller one under it), and under them (where speaking cannot work, or has not) the way on without it; with
/// `settings`, beside it a button that opens the system's Settings for this app (WS87).
void OceanModel::tourTalkPanel(const std::string& words, bool pill, std::optional<Vec3> at, bool settings) {
    std::string key = at && !words.empty() ? words + (pill ? "\n+" : "") + (settings ? "\n*" : "") : "";
    if (key != teach.talkPanelSaid) {
        for (const Entity* e : teach.talkPicks) picks.erase(e);
        teach.talkPicks.clear();
        if (teach.talkPanel) {
            for (const EntityRef& child : teach.talkPanel->children) child->inputTarget = false;
            fadeOut(teach.talkPanel, 0.2f);
        }
        teach.talkPanel = nullptr;
        teach.talkPanelSaid = key;
        size_t cut = words.find('\n');
        std::string first = words.substr(0, cut), second = cut == std::string::npos ? "" : words.substr(cut + 1);
        // (A size under the line it stands over, which says what to do; this says how it is going.)
        std::optional<Piece> line = !key.empty() && art ? art->line(first, 0.02f, Font::Weight::medium, Color::white(), Art::ink, Art::buttonPad) : std::nullopt;
        std::optional<Piece> more = line && !second.empty() ? art->line(second, 0.017f, Font::Weight::regular, Color::white(), Art::ink, Art::buttonPad) : std::nullopt;
        std::optional<Piece> go = line && pill ? art->pill("Go on without speaking", 0.019f) : std::nullopt;
        std::optional<Piece> open = line && settings ? art->pill("Open Settings", 0.019f) : std::nullopt;
        float moreDrop = more ? line->size.y / 2 + 0.006f + more->size.y / 2 : 0;
        float buttons = std::max(go ? go->size.y : 0.0f, open ? open->size.y : 0.0f);
        teach.talkPanelLift = (more ? moreDrop + more->size.y / 2 - line->size.y / 2 : 0) + (buttons > 0 ? buttons + 0.012f : 0);
        if (line) {
            EntityRef holder = Entity::make();
            EntityRef said = art->quad(*line);
            holder->addChild(said);
            float bottom = -line->size.y / 2;
            if (more) {
                EntityRef e = art->quad(*more);
                e->position = {0, -moreDrop, 0};
                holder->addChild(e);
                bottom = -moreDrop - more->size.y / 2;
            }
            // Side by side, as wide as both, under the words: "Open Settings", then the way on without speaking.
            float gap = 0.012f, across = (go ? go->size.x : 0) + (open ? open->size.x : 0) + (go && open ? gap : 0);
            float x = -across / 2;
            for (auto [piece, act] : {std::pair{open, int(Act::tourSettings)}, std::pair{go, int(Act::tourSay)}}) {
                if (!piece) continue;
                EntityRef e = art->quad(*piece);
                e->position = {x + piece->size.x / 2, bottom - 0.012f - buttons / 2, 0};
                e->collision = {Shape::generateBox({piece->size.x, piece->size.y + 0.008f, 0.01f})};
                e->inputTarget = true;
                e->hover = Art::hover();
                picks[e.get()] = Pick::guide(act);
                teach.talkPicks.push_back(e.get());
                holder->addChild(e);
                x += piece->size.x + gap;
            }
            root_->addChild(holder);
            fadeIn(holder, 0, 0.3f);
            teach.talkPanel = holder;
        }
    }
    if (teach.talkPanel && at) {
        // (Its button is under its words: with one, it stands that much higher.)
        Vec3 p = *at + stage.u * (teach.talkPanelLift * teach.talkPanelScale);
        teach.talkPanel->scale = Vec3::repeating(teach.talkPanelScale);
        teach.talkPanel->position = p;
        teach.talkPanel->orientation = guideFacing(p);
    }
}

/// The words came (or were done without): Momo answers, and its answer makes the lesson's layer.
void OceanModel::tourAnswer(int lesson, const std::string& words) {
    if (!catalog || !tree || lesson < 0 || lesson >= tourCount || !tourSteps[lesson].result[0]) return;
    logLine(fmt("[guide] lesson %d answered%s", lesson + 1, words.empty() ? " without a word" : (": " + words).c_str()));
    if (lesson == markStep) tourMarkNote(words);
    auto note = catalog->notes.find(tourSteps[lesson].result);
    if (note == catalog->notes.end()) return;
    teach.tourSent = false;
    teach.talkNote.clear();
    tourTalkPanel("", false, std::nullopt);
    if (lesson == momoStep) tourDid("momo", 1);
    // Momo says so herself, where she has a voice: what she can do in her own recorded words (WS78, the user's choice);
    // a sketch is put to the live Momo, who answers it and walks through what comes, or failing her, her recorded line.
    double answer = 0;          // how long her recorded answer is, where she says one
    if (lesson == momoStep) {
        if (agent::Voice* voice = agentBridge ? agentBridge->talk() : nullptr) teach.failuresAt = voice->recordedFailures();
        answer = sayRecorded("momo-can");
        teach.answerEnds = time + answer;
    } else if (agent::Voice* voice = agentBridge ? agentBridge->talk() : nullptr) {
        {
            agent::Voice::LessonAsk ask;
            ask.words = words;
            auto describe = [&](int w) {
                if (w < 0 || w >= int(catalog->works.size())) return std::string();
                const Work& k = catalog->works[size_t(w)];
                std::string out = (k.kind.empty() ? "" : k.kind + ": ") + k.title;
                for (const std::string* part : {&k.maker, &k.date, &k.medium, &k.museum}) {
                    if (!part->empty()) out += ", " + *part;
                }
                return out;
            };
            ask.picture = describe(teach.tourMarkWork);
            if (teach.tourMarkWork >= 0 && !catalog->works[size_t(teach.tourMarkWork)].about.empty()) ask.picture += ". " + catalog->works[size_t(teach.tourMarkWork)].about;
            for (int w : teach.tourMarkLike) {
                if (w < 0 || w >= int(catalog->works.size())) continue;
                const Work& k = catalog->works[size_t(w)];
                std::string says = k.maker;
                if (!k.date.empty()) says += (says.empty() ? "" : ", ") + k.date;
                ask.cards.push_back({k.title, says});
            }
            voice->askLesson(ask, "momo-sketch");
        }
    } else {
        sayRecorded("momo-sketch");
    }
    // The layer she answers with comes as she says it is coming, near the end of her recorded answer; at once if she
    // says none.
    std::string result = tourSteps[lesson].result, label = lesson == momoStep ? "You asked Momo" : "You showed Momo";
    double began = time;
    auto arrive = [this, lesson, result, label, began, answer] {
        if (!catalog || teach.tour != lesson || !onWelcomeTree() || tourOnResult()) return;
        auto due = catalog->notes.find(result);
        if (due == catalog->notes.end()) return;
        if (answer > 0) logLine(fmt("[guide] its layer comes %.1f s into her %.1f s answer", time - began, answer));
        sound("ask");
        soundLayerAfter = 0.3;
        bring(due->second, label);
    };
    double wait = std::max(0.0, answer - layerBeforeAnswerEnds);
    teach.layerAt = time + wait;
    teach.layerDue = nullptr;
    if (wait > 0) {
        teach.layerDue = arrive;
        after(wait, [this] {
            if (auto due = std::exchange(teach.layerDue, nullptr)) due();
        });
    } else {
        arrive();
    }
}

void OceanModel::leaveMomoLesson(int lesson) {
    logLine(fmt("[guide] the walk left lesson %d: nothing more of Momo's for it", lesson + 1));
    if (agent::Voice* voice = agentBridge ? agentBridge->talk() : nullptr) voice->leaveWalkTurn();
    // (Her voice alone, with no service: stopped.)
    if (walkSound) walkSound->stop();
    walkSound = nullptr;
    teach.layerDue = nullptr;
    teach.askedCard = -1;
}

double OceanModel::sayRecorded(const std::string& name) {
    if (agent::Voice* voice = agentBridge ? agentBridge->talk() : nullptr) return voice->tellRecorded(name).value_or(0);
    // No Momo in this copy: her recorded voice alone, with no words shown (the lead, WS78).
    std::optional<agent::RecordedLine> line = agent::recordedLine(name);
    if (!line) return 0;
    walkSound = agent::playRecordedAlone(*line, [](bool) {});
    if (!walkSound) return 0;
    logLine("[guide] Momo's recorded line, her voice alone: " + line->text);
    return line->seconds;
}

namespace {
/// Which of the example cards of what Momo can do was asked for, loosely: of those whose words were heard, the one
/// heard in the most of its words, so that "tree" or "hand" alone gives way to a fuller match (the lead, WS78).
const char* exampleAsked(const std::string& said) {
    std::string low;
    for (char ch : said) low += char(std::tolower((unsigned char)ch));
    struct Ask {
        const char* card;
        std::vector<const char*> says;
    };
    static const Ask asks[] = {
        {"momo-can-tree", {"start a tree", "hitchcock", "camera trick", "grow a tree", "new tree", "tree"}},
        {"momo-can-find", {"pictures of delft", "delft", "pictures of", "bring me", "find me", "find new"}},
        {"momo-can-saved", {"anything about kubrick", "kubrick", "do i have", "have i saved", "what i saved", "saved"}},
        {"momo-can-more", {"more like this", "more like", "show me more", "more of"}},
        {"momo-can-hand", {"coding agent", "hand this off", "hand it off", "hand off", "hand"}},
    };
    const char* best = nullptr;
    size_t most = 0;
    for (const Ask& a : asks) {
        for (const char* words : a.says) {
            size_t n = std::strlen(words);
            if (n > most && low.find(words) != std::string::npos) {
                most = n;
                best = a.card;
            }
        }
    }
    return best;
}
}  // namespace

void OceanModel::tourExample(const std::string& said, double now) {
    // "What can you do" again: her answer again. One of the cards: her reply to it, the card ringed while she says
    // it. Anything else: her reply to anything else.
    // (Said while she is still answering: let be. She is speaking, and the cards are not there yet.)
    if (now < teach.answerEnds) {
        logLine("[guide] said during her answer, let be: " + said);
        return;
    }
    const char* card = asksWhatItCan(said) ? nullptr : exampleAsked(said);
    std::string line = asksWhatItCan(said) ? "momo-can" : card ? card : "momo-can-other";
    double seconds = sayRecorded(line);
    teach.talkNote.clear();
    teach.askedCard = -1;
    if (card && tree) {
        for (const auto& [id, node] : tree->nodes) {
            if (node.ref.kind == Ref::Kind::note && node.ref.id == card) teach.askedCard = id;
        }
        teach.askedUntil = now + seconds;
    }
    logLine(fmt("[guide] asked of the example cards: %s; answered with %s", said.c_str(), line.c_str()));
}

/// Send, pinched inside the walk's picture: the marked part goes to Momo, and a word about it is waited for.
void OceanModel::tourSend() {
    if (teach.tourSent) return;
    teach.tourSent = true;
    sound("send");
    logLine("[guide] the sketch is sent to Momo");
    // AGENT (WS89): and she is shown it, for her answer to what is asked of it (oceanmodel_look.cpp).
    if (CardRef c = tourCard(markStep)) seeSketch(*c, teach.tourMarkWork);
}

void OceanModel::endTour(const char* why) {
    if (teach.tour < 0) return;
    if (teach.tour == momoStep || teach.tour == markStep) leaveMomoLesson(teach.tour);
    teach.walkFrom = -1;
    teach.tour = -1;
    teach.tourStood = false;
    // Momo's ears are its own again.
    tourTalk(-1, false, time, std::nullopt);
    teach.tourSent = false;
    if (teach.mode == 4) hideGuide(0.3f);
    teach.painter->entity->removeFromParent();
    teach.painter->clear();
    if (teach.marker) teach.marker->clear();
    signs.clear();
    teach.tourMarks = 0;
    teach.tourShown = -1;
    tourPin(teach.tourPin, teach.tourPinSaid, "", std::nullopt);
    tourPin(teach.tourNextPin, teach.tourNextSaid, "", std::nullopt);
    tourPin(teach.tourHandsPin, teach.tourHandsSaid, "", std::nullopt);
    tourPin(teach.tourSpotPin, teach.tourSpotSaid, "", std::nullopt);
    tourOff(std::nullopt);
    tourCaption("", "", std::nullopt);
    teach.quietUntil = time + 20;
    saveGuide();
    logLine(fmt("[guide] the walk ends: %s", why));
    // After the walk, however it ended: the card that says how to begin, once nothing stands (`updateHome`).
    if (std::string(why) != "the guide starts over" && !teach.homeSeen) {
        teach.homeDue = true;
        teach.homeAfter = time + double(Pace::press) + 0.5;
    }
}

// MARK: - Buttons

namespace {
/// How a guide button looks while a pinch is on it: dimmer and a little smaller (the lead, WS75).
constexpr float pressedOpacity = 0.7f, pressedScale = 0.96f;
}  // namespace

bool OceanModel::pressButton(const EntityRef& entity, int action) {
    if (!entity) return false;
    switch (action) {
    case Act::homeClose:
    case Act::tourBack:
    case Act::tourSkip:
    case Act::closeSheet:
    case Act::tourSay:
    case Act::tourSettings:
    case Act::momoNote:
    case Act::allowMicrophone:
        break;
    default:
        return false;
    }
    showPressed(entity);
    logLine(fmt("[guide] a button shows pressed (%d)", action));
    return true;
}

void OceanModel::showPressed(const EntityRef& entity) {
    releaseButton();
    // (Still coming in: it shows whole at once, then pressed.)
    fades.erase(std::remove_if(fades.begin(), fades.end(), [&](const Fade& f) { return f.entity == entity; }), fades.end());
    teach.pressed = entity;
    teach.pressedScale = entity->scale;
    entity->opacity = pressedOpacity;
    entity->scale = entity->scale * pressedScale;
}

void OceanModel::releaseButton() {
    if (!teach.pressed) return;
    teach.pressed->opacity = 1.f;
    teach.pressed->scale = teach.pressedScale;
    teach.pressed = nullptr;
}

std::pair<Vec2, Vec2> OceanModel::guideExtent(const EntityRef& holder) const {
    Vec2 lo{1e9f, 1e9f}, hi{-1e9f, -1e9f};
    std::function<void(const EntityRef&, Vec3)> walk = [&](const EntityRef& e, Vec3 at) {
        Vec3 p = at + e->position;
        // (Its words, buttons and backing: what is drawn flat. A ghost hand's lines are not the panel.)
        if (e->model && e->model->mesh && !e->model->materials.empty() && e->model->materials.front().kind == Material::Kind::unlit) {
            BoundingBox b = e->model->mesh->bounds;
            lo = {std::min(lo.x, p.x + b.min.x), std::min(lo.y, p.y + b.min.y)};
            hi = {std::max(hi.x, p.x + b.max.x), std::max(hi.y, p.y + b.max.y)};
        }
        for (const EntityRef& c : e->children) walk(c, p);
    };
    for (const EntityRef& c : holder->children) walk(c, Vec3::zero());
    return {lo, hi};
}

EntityRef OceanModel::guideSwallow(const EntityRef& holder, float margin, std::vector<const Entity*>& into) {
    auto [lo, hi] = guideExtent(holder);
    if (lo.x > hi.x) return nullptr;
    EntityRef area = Entity::make();
    area->position = {(lo.x + hi.x) / 2, (lo.y + hi.y) / 2, -0.02f};
    area->collision = {Shape::generateBox({hi.x - lo.x + 2 * margin, hi.y - lo.y + 2 * margin, 0.01f})};
    area->inputTarget = true;
    picks[area.get()] = Pick::guide(Act::offButtons);
    into.push_back(area.get());
    holder->addChild(area);
    return area;
}

void OceanModel::reachOut(const EntityRef& button, Vec2 size, float left, float right, float down, float up) {
    button->collision = {Shape::generateBox({size.x + left + right, size.y + down + up, 0.01f}).offsetBy({(right - left) / 2, (up - down) / 2, 0})};
}

// MARK: - After the walk

// The walk over (done, put away early, or skipped), and nothing standing: you are greeted as a headset greets
// you after its own setting up, by lettering that stands free in the room, large, on no card. "Welcome to Mind
// Forest" in Fraunces (the face of Muse's Garden's title, as Kai asked), a word at a time; then, under it and much smaller, the three ways to begin, each with its number,
// and a button. The same numbers stand in the room by the things themselves. It has the middle of the view to
// itself (the questions wait behind it, as they do behind the gesture sheet). It goes at its button, or as soon
// as something is begun; the numbers stay in the room a while longer, so that what it said can be found.
void OceanModel::showHome() {
    if (!art || teach.home) return;
    EntityRef holder = guideHolder(0, -7, 2.0f);
    // The lettering: each word its own piece, set side by side on one line and brought up one after another.
    const float letter = 0.21f, space = letter * 0.2f;
    std::vector<Piece> words;
    float whole = 0;
    for (const char* word : {"Welcome", "to", "Mind", "Forest"}) {
        std::optional<Piece> piece = art->lettering(word, letter);
        if (!piece) return;
        // (Each piece carries room round its word for the script's swing: the words overlap by that much.)
        whole += piece->size.x - 2 * letter * 0.3f + (words.empty() ? 0 : space);
        words.push_back(*piece);
    }
    // (How far the card's pieces reach on it, for what swallows a pinch that misses its button: below.)
    Vec2 lo{1e9f, 1e9f}, hi{-1e9f, -1e9f};
    auto spans = [&](Vec2 middle, Vec2 size) {
        lo = {std::min(lo.x, middle.x - size.x / 2), std::min(lo.y, middle.y - size.y / 2)};
        hi = {std::max(hi.x, middle.x + size.x / 2), std::max(hi.y, middle.y + size.y / 2)};
    };
    float x = -whole / 2;
    for (size_t k = 0; k < words.size(); k++) {
        float inked = words[k].size.x - 2 * letter * 0.3f;
        EntityRef e = art->quad(words[k]);
        e->position = {x + inked / 2, 0, 0.002f * float(k)};
        holder->addChild(e);
        fadeIn(e, 0.3 + 0.38 * double(k), 0.8f);
        spans({x + inked / 2, 0}, {inked, words[k].size.y});
        x += inked + space;
    }
    // Under it, a line and the three ways, side by side.
    double after = 0.3 + 0.38 * double(words.size()) + 0.5;
    auto put = [&](const std::optional<Piece>& piece, float px, float py, double delay, int action) {
        if (!piece) return;
        EntityRef e = art->quad(*piece);
        e->position = {px, py, 0};
        spans({px, py}, piece->size);
        if (action >= 0) {
            // The button takes a pinch near it as well as on it (`homeButtonReach`), and only once it has begun to
            // show: a pinch where nothing yet shows is the card's, which does nothing (the lead, WS75).
            e->collision = {Shape::generateBox({piece->size.x + 2 * homeButtonReach, piece->size.y + 2 * homeButtonReach, 0.01f})};
            e->hover = Art::hover();
            picks[e.get()] = Pick::guide(action);
            teach.homePicks.push_back(e.get());
            std::weak_ptr<Entity> button = e;
            this->after(delay + homeButtonShows, [this, button] {
                EntityRef b = button.lock();
                if (b && teach.home && b->parent == teach.home.get()) b->inputTarget = true;
            });
            spans({px, py}, {piece->size.x + 2 * homeButtonReach, piece->size.y + 2 * homeButtonReach});
        }
        holder->addChild(e);
        fadeIn(e, delay, 0.6f);
    };
    put(art->plain("Start exploring now by", 0.058f, Font::displayFont(0, true), 0.92f), 0, -0.28f, after, -1);
    const float pitch = 0.86f, row = -0.47f;
    put(art->way(1, "Pinching a tree", "They stand on your desk.", 0.055f), -pitch, row, after + 0.25, -1);
    put(art->way(2, "Pinching an item", "They lie in the ocean around you.", 0.055f), 0, row, after + 0.4, -1);
    put(art->way(3, "Talking to Momo", "Pinch a question to begin.", 0.055f), pitch, row, after + 0.55, -1);
    std::optional<Piece> pill = art->pill("Start exploring", 0.042f);
    Vec2 button = pill ? Vec2{pill->size.x + 2 * homeButtonReach, pill->size.y + 2 * homeButtonReach} : Vec2{0, 0};
    put(pill, 0, -0.71f, after + 1.0, Act::homeClose);
    // A pinch anywhere on the card is the card's, never the ocean's behind it, where it would peek an item and so
    // begin something unasked: a pinch that misses the button does nothing (the lead, WS75). Behind the button, so the
    // button is met first.
    EntityRef card = Entity::make();
    card->position = {(lo.x + hi.x) / 2, (lo.y + hi.y) / 2, -0.02f};
    card->collision = {Shape::generateBox({hi.x - lo.x + 2 * homeCardMargin, hi.y - lo.y + 2 * homeCardMargin, 0.01f})};
    card->inputTarget = true;
    picks[card.get()] = Pick::guide(Act::offButtons);
    teach.homePicks.push_back(card.get());
    holder->addChild(card);
    teach.home = holder;
    teach.homeDue = false;
    // WS95: after the walk, done or skipped, the microphone is asked for if it never was, so that "Hey Momo" works from
    // here on (a judge who skips the walk included); Momo's caption says why as the system asks.
    if (agent::Voice* voice = agentBridge ? agentBridge->talk() : nullptr) voice->askForMicrophoneFirst("Allow the microphone to say “Hey Momo” any time");
    // (Momo is Kai's name for who answers. In this build the questions it points at are still headed "Ask the gardener".)
    const char* names[3] = {"A tree", "An item", "Momo"};
    for (int k = 0; k < 3; k++) {
        teach.homeTags[k] = guideTag(std::to_string(k + 1), names[k], 0.02f);
        if (!teach.homeTags[k]) continue;
        teach.homeTags[k]->isEnabled = false;
        root_->addChild(teach.homeTags[k]);
        fadeIn(teach.homeTags[k], after + 0.8 + 0.15 * k, 0.5f);
    }
    sound("holo_wake", 0.4f);
    logLine(fmt("[guide] the greeting after the walk: it takes a pinch over %.2f x %.2f m, its button over %.2f x %.2f m once it shows",
                double(hi.x - lo.x + 2 * homeCardMargin), double(hi.y - lo.y + 2 * homeCardMargin), double(button.x), double(button.y)));
}

void OceanModel::closeHome() {
    for (const Entity* e : teach.homePicks) picks.erase(e);
    teach.homePicks.clear();
    if (teach.home) {
        for (const EntityRef& child : teach.home->children) child->inputTarget = false;
        fadeOut(teach.home, 0.4f);
        teach.homeSeen = true;
        saveGuide();
    }
    teach.home = nullptr;
    teach.homeTagsUntil = time + 14;
}

void OceanModel::clearHomeTags() {
    for (EntityRef& tag : teach.homeTags) {
        if (tag) fadeOut(tag, 0.5f);
        tag = nullptr;
    }
}

void OceanModel::updateHome(double now) {
    if (teach.homeDue && !teach.home && !tree && !pressing && !peek && teach.mode == 0 && now >= teach.homeAfter) showHome();
    // `-guideHomeClose <s>`: leaves the card at that second, as its button would.
    if (teach.demo && teach.home && Flags::has("guideHomeClose") && now >= Flags::number("guideHomeClose")) closeHome();
    bool tags = teach.homeTags[0] || teach.homeTags[1] || teach.homeTags[2];
    if (!teach.home && !tags) return;
    // Something was begun: that was the point.
    if (tree || peek) {
        if (teach.home) logLine(fmt("[guide] the greeting goes: %s was begun", tree ? "a tree" : "a peek"));
        closeHome();
        clearHomeTags();
        return;
    }
    if (!teach.home && now >= teach.homeTagsUntil) {
        clearHomeTags();
        return;
    }
    auto inRoom = [&](Vec3 world) { return root_->convertFrom(world, nullptr); };
    std::optional<Vec3> at[3];
    // A tree: the kept one nearest the middle of the view.
    float best = -2;
    for (const Shelved& s : shelf) {
        if (teach.home) break;
        if (!s.mover || !s.mover->entity || !s.mover->entity->isEnabledInHierarchy()) continue;
        Vec3 p = inRoom(s.mover->entity->positionRelativeTo(nullptr));
        float ahead = dot(normalize(p - stage.origin), stage.f);
        if (ahead > best) {
            best = ahead;
            at[0] = p + stage.u * 0.17f;
        }
    }
    // An item: over the open water between the trees on the desk.
    if (!teach.home) at[1] = stage.point(9, -27, 1.6f);
    // The gardener: over its questions, once the card has left them the middle of the view.
    if (!teach.home && strip && strip->parent && strip->isEnabledInHierarchy()) at[2] = inRoom(strip->convertTo(Vec3{0, 0.128f, 0}, nullptr));
    for (int k = 0; k < 3; k++) {
        if (!teach.homeTags[k]) continue;
        teach.homeTags[k]->isEnabled = at[k].has_value();
        if (!at[k]) continue;
        teach.homeTags[k]->position = *at[k];
        teach.homeTags[k]->orientation = guideFacing(*at[k]);
    }
}

/// Every gesture, a pinch away: their names in a column, and the one picked playing beside them.
void OceanModel::showSheet(int row) {
    if (!art || !teach.painter) return;
    const std::vector<guide::Gesture>& all = guide::gestures();
    row = std::max(0, std::min(row, int(all.size()) - 1));
    // Picking another row keeps the sheet where it is.
    std::optional<Transform> place = teach.mode == 3 && teach.holder ? std::optional<Transform>(teach.holder->transform()) : std::nullopt;
    hideGuide(place ? 0.12f : 0.2f);
    EntityRef holder = guideHolder(0, 1, 0.9f);
    if (place) holder->setTransform(*place);
    const float left = -0.36f, pitch = 0.032f, top = 0.13f;
    guideWords(holder, art->heading("Gestures", Tone::note), left, top + 0.034f);
    for (int i = 0; i < int(all.size()); i++) {
        bool on = i == row;
        guideWords(holder, art->line(all[size_t(i)].title, Art::Size::label, on ? Font::Weight::semibold : Font::Weight::medium, Color::white(),
                                     on ? Art::hot : Art::ink, Art::buttonPad), left, top - float(i) * pitch, false, i);
    }
    float foot = top - float(all.size()) * pitch - 0.014f;
    float x = left;
    std::optional<Piece> close = art->line("Close", Art::Size::label, Font::Weight::semibold, Color::white(), Art::ink, Art::buttonPad);
    float closeWidth = guideWords(holder, close, x, foot, false, Act::closeSheet);
    // Close takes a pinch near it as well: to its left and above and below, and on its right up to half the way to
    // the next (the lead, WS75).
    if (close && !holder->children.empty()) {
        std::optional<Mat4> head = platform::head();
        float reach = guideReach(head ? length(holder->position - head->position()) : 0.9f);
        reachOut(holder->children.back(), close->size, reach, 0.005f, reach, std::min(reach, pitch / 2));
    }
    x += closeWidth + 0.01f;
    x += guideWords(holder, art->line("Take the tour", Art::Size::label, Font::Weight::medium, Color::white(), Art::ink, Art::buttonPad), x, foot, false, Act::tour) + 0.01f;
    guideWords(holder, art->line("Start the guide over", Art::Size::label, Font::Weight::medium, Color::white(1, 0.8f), Art::ink, Art::buttonPad), x, foot, false, Act::startOver);
    const float size = 0.62f, middle = 0.2f;
    // Here a gesture is something to look at, not to copy in place: the one made toward and away from you
    // is turned a little, so that its depth shows.
    std::string id = all[size_t(row)].id;
    teach.painter->setLine(0.0013f);
    guideHand(holder, {middle, 0.03f, 0}, size, id == "layers" ? 30 : 0);
    EntityRef words = Entity::make();
    words->position = guideBacking(holder, {middle, 0.03f, 0}, size, 0.045f) + Vec3{0, -0.014f, 0};
    holder->addChild(words);
    guideWords(words, art->line(all[size_t(row)].line, Art::Size::label, Font::Weight::medium, Color::white(1, 0.8f)), 0, 0, true);
    // A pinch elsewhere on the sheet is the sheet's, and does nothing (the lead, WS75).
    guideSwallow(holder, 0.015f, teach.picks);
    fadeIn(holder, 0, place ? 0.15f : 0.3f);
    teach.holder = holder;
    teach.mode = 3;
    teach.sheetRow = row;
    teach.began = time;
}

void OceanModel::microphonePicks(const EntityRef& momo, const EntityRef& allow) {
    picks[momo.get()] = Pick::guide(Act::momoNote);
    picks[allow.get()] = Pick::guide(Act::allowMicrophone);
}

void OceanModel::guideAct(int action) {
    static_assert(Act::offButtons == guideOffButtons, "pinchEnded reads the act for off the buttons as guideOffButtons");
    // Momo's, while the microphone is off: whether the guide is on or not (WS87).
    if (action == Act::momoNote || action == Act::allowMicrophone) {
        agent::Voice* voice = agentBridge ? agentBridge->talk() : nullptr;
        if (action == Act::momoNote) {
            logLine("[presence] Momo is pinched without the microphone: it is asked for, or her note shows");
            if (voice) voice->addressedWithoutMicrophone();
        } else {
            logLine("[presence] the note's Allow microphone is pinched");
            if (voice) voice->askForMicrophone(true);
        }
        return;
    }
    if (!teach.on) return;
    switch (action) {
    case Act::begin:
        break;      // any pinch leaves the welcome: see `guideDid("pick")`, which every tap reports
    case Act::closeSheet:
        logLine("[guide] the sheet is closed");
        hideGuide();
        teach.quietUntil = time + 6;
        break;
    case Act::startOver:
        // For the next person: everything is to be learned again.
        teach.welcomed = false;
        teach.asked = false;
        closeHome();
        teach.homeSeen = false;
        teach.homeDue = false;
        for (GuideLesson& l : teach.lessons) {
            l.learned = false;
            l.shown = 0;
            l.readySince = -1;
            l.restUntil = 0;
        }
        for (auto& [id, pin] : teach.pins) {
            if (pin.entity) fadeOut(pin.entity, 0.2f);
            pin = GuidePin();
        }
        teach.carried = 0;
        endTour("the guide starts over");
        saveGuide();
        hideGuide();
        teach.welcomeAt = time + 0.6;
        break;
    case Act::tour:
        startTour();
        break;
    case Act::tourBack:
        // Back to the lesson the walk had got to.
        // (To the layer Momo answered with, where the lesson has one already: the way on is from there.)
        if (teach.tour >= 0) {
            std::optional<int> back = tourResultNode(teach.tour);
            if (!back) back = tourNode(teach.tour);
            if (back) take(*back);
        }
        break;
    case Act::tourSay:
        // "Go on without speaking": what the words would have done.
        if (teach.talkFor >= 0) tourAnswer(teach.talkFor, "");
        break;
    case Act::tourSettings:
        // "Open Settings", where the system no longer asks for the microphone: its page for this app comes up over the
        // walk, and back from it with the microphone allowed, Momo listens (agent::Voice). Where it can't be opened, the
        // button goes and the line still says where to look.
        logLine("[guide] the walk's Open Settings is pinched");
        if (agent::Voice* voice = agentBridge ? agentBridge->talk() : nullptr) voice->askForMicrophone(true);
        break;
    case Act::tourSkip:
    case Act::tourEnd:
        // Out of the walk: the tree stays as it is, to be gone on with. What was not done is shown later, in its place.
        endTour("the walk was skipped");
        break;
    case Act::homeClose:
        logLine("[guide] the greeting's button is pinched");
        closeHome();
        break;
    case Act::offButtons:
        logLine("[guide] a pinch on the guide's card, off its buttons: nothing");
        break;
    case Act::openSheet:
        if (teach.mode == 3) hideGuide(); else showSheet(teach.sheetRow);
        break;
    default:
        if (action >= 0 && action < int(guide::gestures().size())) showSheet(action);
        break;
    }
}

// MARK: - Learning

/// Whether a lesson's moment has come: what it teaches could be used right now.
bool OceanModel::guideReady(const GuideLesson& l) const {
    if (!tree || pressing) return false;
    if (l.id == "layers") return tree->route.size() >= 2;
    if (l.id == "carry") return teach.lessons[0].learned;
    if (l.id == "mark") return tree->focus().has_value() && zoom.target() > 0.5f;
    if (l.id == "tree") return tree->route.size() >= 3 && hologram && hologram->entity->isEnabled;
    if (l.id == "cut") return cards.size() >= 8;
    return false;
}

/// Told what the viewer just did, by whatever did it: "pick" (any pinch that landed), "step" (a closed
/// hand between layers), "carry" (with how far, m), "zoom", "mark", "jump" (from the small tree), "cut",
/// "ask", "bring", "out". What it teaches is then known, and is not shown again.
void OceanModel::guideDid(const char* what, float amount) {
    if (!teach.on) return;
    std::string did = what;
    auto learn = [&](const char* id) {
        for (size_t i = 0; i < teach.lessons.size(); i++) {
            GuideLesson& l = teach.lessons[i];
            if (l.id != id || l.learned) continue;
            l.learned = true;
            bool showing = teach.mode == 2 && teach.lesson == int(i);
            // Done while it was being shown, or after: a small sign that that was it.
            if (showing || l.shown > 0) sound("answer", 0.5f);
            if (showing) {
                hideGuide(0.35f);
                teach.quietUntil = time + 20;
            }
            logLine(fmt("[guide] learned %s", id));
            saveGuide();
        }
    };
    auto retire = [&](const char* id) {
        GuidePin& pin = teach.pins[id];
        if (pin.done) return;
        pin.done = true;
        if (pin.entity) fadeOut(pin.entity, 0.3f);
        pin.entity = nullptr;
        saveGuide();
    };
    // On the welcome tree, what a lesson asks for marks it done; putting the tree away ends the walk.
    if (teach.tour >= 0 && teach.tourStood) tourDid(did, amount);
    if (did == "pick") {
        // (Nothing: there is no welcome to leave any more. The first pinch is on the welcome tree.)
    } else if (did == "step") {
        learn("layers");
    } else if (did == "carry") {
        teach.carried += amount;
        if (teach.carried >= 0.1f) learn("carry");
    } else if (did == "zoom") {
        retire("zoom");
    } else if (did == "mark") {
        learn("mark");
    } else if (did == "jump") {
        learn("tree");
    } else if (did == "cut") {
        learn("cut");
    } else if (did == "ask") {
        if (!teach.asked) {
            teach.asked = true;
            saveGuide();
        }
        retire("follow");
    } else if (did == "bring") {
        retire("peek");
    } else if (did == "out") {
        retire("out");
    }
}

/// A few words standing by the thing they are about: up once `wanted` has held for `wait` seconds, down
/// when it no longer does, and not again after it has been up `most` times.
void OceanModel::guidePin(const char* id, const char* words, bool wanted, Vec3 at, double wait, int most) {
    GuidePin& pin = teach.pins[id];
    if (pin.done || teach.mode == 1 || teach.mode == 3 || !teach.welcomed || teach.tour >= 0) wanted = false;
    if (wanted) {
        if (pin.wantedSince < 0) pin.wantedSince = time;
        if (!pin.entity && time - pin.wantedSince >= wait && art) {
            std::optional<Piece> piece = art->line(words, Art::Size::label, Font::Weight::medium, Color::white(1, 0.9f));
            if (!piece) return;
            EntityRef e = art->quad(*piece);
            e->position = at;
            e->orientation = stage.facing(at);
            root_->addChild(e);
            fadeIn(e, 0, 0.5f);
            pin.entity = e;
            pin.times += 1;
        }
    } else {
        pin.wantedSince = -1;
        if (pin.entity) {
            fadeOut(pin.entity, 0.35f);
            pin.entity = nullptr;
            if (pin.times >= most) {
                pin.done = true;
                saveGuide();
            }
        }
    }
}

std::optional<Vec3> OceanModel::overOpenCard() const {
    if (!tree || pressing || !tree->focus()) return std::nullopt;
    auto found = cards.find(*tree->focus());
    if (found == cards.end() || !found->second || !found->second->openBuilt) return std::nullopt;
    const CardView& c = *found->second;
    Mat4 world = c.openHolder->transformMatrix(nullptr);
    float size = std::max(0.05f, length(world.columns[0].xyz()));
    // Over the card's top edge, clear of its title (a card of the card library's has it over its picture).
    return world.point({0, c.openBody.y / 2 + 0.03f / size, 0.012f / size});
}

// MARK: - Each frame

void OceanModel::updateGuide(double now, float dt) {
    if (!teach.on || !teach.painter || !art) return;
    std::optional<Mat4> head = platform::head();
    Vec3 eye = head ? head->position() : stage.origin;
    auto at = [&](const guide::Gesture& g, double since) { return float(teach.demoT >= 0 ? teach.demoT : std::fmod(since, double(g.seconds))); };

    if (teach.demo && teach.mode == 0 && now > 0.8) {
        // `-guideDemo`: one thing, at once, kept up.
        if (*teach.demo == "tour" || *teach.demo == "welcome") {
            if (teach.tour < 0 && !teach.demoStarted) startTour();
            teach.demoStarted = true;
        } else if (*teach.demo == "home") {
            // (The card after the walk, at once.)
            if (!teach.demoStarted) showHome();
            teach.demoStarted = true;
        } else {
            // (`sheet:<gesture>` is that gesture on the sheet, where a lesson's own name would show it in its place.)
            std::string name = *teach.demo;
            bool onSheet = name.rfind("sheet:", 0) == 0;
            if (onSheet) name = name.substr(6);
            int lesson = -1, row = 0;
            for (size_t i = 0; i < teach.lessons.size() && !onSheet; i++) {
                if (teach.lessons[i].id == name) lesson = int(i);
            }
            for (size_t i = 0; i < guide::gestures().size(); i++) {
                if (name == guide::gestures()[i].id) row = int(i);
            }
            // A lesson waits for its moment (the tree it needs may still be growing), but not for the viewer.
            if (lesson >= 0 && !guideReady(teach.lessons[size_t(lesson)]) && now < 30) return;
            if (lesson >= 0) showLesson(lesson); else showSheet(row);
        }
    }
    // The first time (and whenever the guide is started over): the welcome tree, by itself.
    if (!teach.demo && !teach.scripted && !teach.welcomed && teach.tour < 0 && teach.mode == 0 && !tree && !pressing && now > teach.welcomeAt) startTour();

    // Is it time for a lesson? The first one, in order, that is not known and whose moment has come.
    if (teach.mode == 0 && teach.welcomed && !teach.demo && teach.tour < 0 && !pressing && now >= teach.quietUntil) {
        for (size_t i = 0; i < teach.lessons.size(); i++) {
            GuideLesson& l = teach.lessons[i];
            if (l.learned || l.shown >= 2 || now < l.restUntil || !guideReady(l)) {
                l.readySince = -1;
                continue;
            }
            if (l.readySince < 0) l.readySince = now;
            if (now - l.readySince >= l.wait) showLesson(int(i));
            break;
        }
    }

    if (teach.mode == 2 && teach.lesson >= 0) {
        GuideLesson& l = teach.lessons[size_t(teach.lesson)];
        const guide::Gesture* g = guide::gesture(l.id);
        double since = now - teach.began;
        bool closed = !hands->grabs().empty();
        if (!g) {
            hideGuide();
        } else if (teach.demo) {
            teach.painter->draw(*g, at(*g, since), eye);
        } else if ((l.id == "layers" || l.id == "carry") && closed && since > 0.6) {
            // Your own hand has closed: the gauge round it takes over. It can come back if nothing comes of it.
            hideGuide(0.25f);
            l.readySince = -1;
            teach.quietUntil = now + 4;
        } else if (since >= 3 * double(g->seconds) - 0.5) {
            // Three times is enough for now. Once more, later, if it is still not known.
            l.shown += 1;
            l.restUntil = now + 60;
            l.readySince = -1;
            hideGuide(0.3f);
            teach.quietUntil = now + 20;
        } else if (!guideReady(l) && since > double(g->seconds)) {
            // Its moment has passed.
            l.readySince = -1;
            hideGuide(0.3f);
            teach.quietUntil = now + 5;
        } else {
            teach.painter->draw(*g, at(*g, since), eye);
        }
    }

    if (teach.tour >= 0) updateTour(now, eye);
    updateHome(now);

    if (teach.mode == 3) {
        const guide::Gesture& g = guide::gestures()[size_t(teach.sheetRow)];
        teach.painter->draw(g, at(g, now - teach.began), eye);
    }

    // The sheet has the middle of the view to itself: the briefs or the tree's controls wait behind it.
    strip->isEnabled = teach.mode != 3 && !teach.home;

    // The words that stand by things.
    bool idle = !tree && !pressing && !peek && !teach.home && !teach.homeDue;
    guidePin("ocean", "Pinch anything in the ocean to lift it out", idle, stage.point(-27, -27, 1.5f), 6, 2);
    if (peek) {
        Vec3 p = peek->mover->entity->position;
        guidePin("peek", "Pinch again to bring it in", true, p - stage.u * (peek->width * 0.42f + 0.04f), 1.2, 2);
    } else {
        guidePin("peek", "", false, Vec3::zero(), 0, 2);
    }
    // (Over the open card, wherever that is: anywhere fixed is sooner or later where a card stands.)
    std::optional<Vec3> over = overOpenCard();
    guidePin("follow", "Pinch a card round it to follow it", over && !teach.asked && tree->route.size() <= 1, over.value_or(Vec3::zero()), 5, 1);
    bool shut = tree && !pressing && tree->focus().has_value() && zoom.target() < 0.05f;
    guidePin("zoom", "Pinch this card again to go in", shut && teach.asked && over, over.value_or(Vec3::zero()), 8, 2);
    bool deep = tree && !pressing && zoom.target() > 0.5f;
    if (!deep) teach.zoomedSince = -1;
    else if (teach.zoomedSince < 0) teach.zoomedSince = now;
    guidePin("out", "Pinch empty space to step back", deep && now - teach.zoomedSince > 12, stage.point(0, -30, 1.1f), 0, 2);
}
