// Not a port: there is nothing like it in the visionOS app. The guide: what teaches the hands.
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

#include <cmath>

#include "../cards/ocean.h"
#include "guide.h"

namespace {
// What a pinch on one of the guide's own buttons asks for; 0…8 are the sheet's rows.
enum Act { begin = 100, closeSheet = 101, startOver = 102, openSheet = 103, tour = 104, tourSkip = 105, tourEnd = 106, tourBack = 107, homeClose = 108 };
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
// drawn as the card library draws its own (core/cards/lesson.cpp): `headline` its title, `line` under it.
struct TourStep {
    const char* note;
    const char* gesture;
    const char* headline;
    const char* line;
    const char* did;
    const char* alt;
    const char* altWords;
    int pictures;
    float stage;        // how large its gesture plays on its card, of life size: as large as the stage has room for
    const char* say;    // the one thing to do now, said large over the tree
};
const TourStep tourSteps[] = {
    {"welcome", "pinch", "Welcome to Mind Forest",
     "Point at the next card and pinch it.", "ask", "", "", 2, 0.92f, "Point at card 2 and pinch it"},
    {"welcome-pan", "carry", "Grab to pan",
     "Close your hand and move it: the tree comes too.", "carry", "", "", 2, 0.72f, "Close your hand and move it sideways"},
    {"welcome-pull", "layers", "Grab to pull or push",
     "Pull your closed hand in; push it away to return.", "step", "tree", "Or choose a layer here  ↓", 1, 0.68f, "Close your hand and pull it toward you"},
    {"welcome-move", "drag", "Pinch and hold to move",
     "Pinch a picture, hold, and put it somewhere else.", "move", "", "", 3, 0.92f, "Pinch a picture, hold, and carry it"},
    {"welcome-mark", "mark", "Mark part of a picture",
     "Go in, take up the pen, and draw round something.", "mark", "", "", 1, 0.68f, "Pinch this picture to go in"},
    {"welcome-tree", "tree", "Choose a layer on the small tree",
     "Slide a finger along it and pinch to jump there.", "jump", "tree", "Slide a finger along it, pinch to jump", 1, 0.86f, "Reach for the small tree, low on your left"},
    {"welcome-close", "clap", "Palms together to close",
     "Hold them together a second: the tree is put away.", "press", "strip", "Or pinch Put away", 0, 0.6f, "Hold your palms together for a second"},
};
const int tourCount = int(sizeof(tourSteps) / sizeof(tourSteps[0]));
const int pullStep = 2, moveStep = 3, markStep = 4, treeStep = 5, closeStep = 6;
const char* tourTitle = "Welcome to Mind Forest";
// NOTE(port): halved, and the card behind it made half see-through, as Kai asked on 2026-11-15: at 0.7 a lesson
// that came up while you were idle took too much of the view, drew the eye and ran into what stood near it.
const float lessonSize = 0.35f;     // of life size
const float lessonGround = 0.5f;    // how solid the card behind an idle lesson is
const float lessonLine = 0.0024f;   // the hand's line at that size, m (drawn small, it wants more weight)

// A lesson done: a ring closes and a tick is drawn where its gesture played. They stay while its card is shown.
const float doneSeconds = 0.75f;
void drawDone(float t, guide::Frame& f) {
    const Vec3 X{1, 0, 0}, Y{0, 1, 0};
    float round = guide::travel(guide::span(t, 0, 0.5f)), tick = guide::travel(guide::span(t, 0.3f, 0.75f));
    f.arc(Vec3::zero(), X, Y, 0.062f, floatPi / 2, floatPi / 2 - round * 2 * floatPi, 0.003f, guide::white, 0.9f);
    if (tick < 0.01f) return;
    // Down to its corner, then up and out: the first stroke is two fifths of it.
    Vec3 a{-0.027f, 0.002f, 0}, b{-0.008f, -0.019f, 0}, c{0.029f, 0.023f, 0};
    std::vector<Vec3> points{a, a + (b - a) * std::min(1.f, tick / 0.4f)};
    if (tick > 0.4f) points.push_back(b + (c - b) * ((tick - 0.4f) / 0.6f));
    f.path(points, 0.004f, guide::white, 0.95f);
}
const guide::Gesture doneGesture{"done", drawDone, doneSeconds, "", ""};

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
        if (k + 1 < tourCount) link(std::string("note:") + tourSteps[k + 1].note, k == 0 ? "Start here" : "Next");
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
                               step.note, k + 1, tourCount, step.headline, step.line, links.c_str(), image.c_str(), double(aspect));
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
        props.set("step", k + 1).set("badge", fmt("Step %d of %d", k + 1, tourCount)).set("aspect", aspect);
        if (picture) props.set("src", fmt("work:%d", toMark));
        view.set("component", "lesson").set("props", props);
        item.set("title", step.headline).set("summary", step.line);
        cards::ocean::hold(cards::OceanCard{step.note, view, item, picture ? std::optional(aspect) : std::nullopt});
    }
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
        if (node->ref.id == tourSteps[k].note) return k;
    }
    return -1;
}

/// The card of a lesson, if it is in the tree.
OceanModel::CardRef OceanModel::tourCard(int lesson) const {
    if (!tree || lesson < 0 || lesson >= tourCount) return nullptr;
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
    if (teach.tourDone[markStep]) return "Marked. Pinch empty space to come back out";
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
        // On its own card: over the stage at the top of it, standing off it toward you, as large as there is room for.
        CardRef c = tourCard(shown % 100);
        if (!c || !c->openBuilt) {
            teach.tourShown = -1;
            return;
        }
        // (`stage` is of life size on a stage as large as Metrics' lesson: on the card's own, it is as much smaller.)
        PictureFrame picture = pictureFrame(*c);
        const float size = step.stage * std::min(picture.size.x / Metrics::lessonWidth, picture.size.y / Metrics::lessonStage);
        teach.painter->entity->position = {picture.center.x, picture.center.y + 0.04f * size, 0.2f * size + 0.014f};
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
            auto put = [&](const Piece& piece, float x, float y, int action) {
                EntityRef e = art->quad(piece);
                e->position = {x, y, 0};
                if (action >= 0) {
                    e->collision = {Shape::generateBox({piece.size.x, piece.size.y + 0.008f, 0.01f})};
                    e->inputTarget = true;
                    e->hover = Art::hover();
                    picks[e.get()] = Pick::guide(action);
                    teach.tourOffPicks.push_back(e.get());
                }
                holder->addChild(e);
            };
            // The words over the two answers, the answers a little apart and together in the middle.
            float gap = 0.012f, row = back->size.x + gap + skip->size.x, y = -words->size.y / 2 - 0.012f - back->size.y / 2;
            put(*words, 0, 0, -1);
            put(*back, -row / 2 + back->size.x / 2, y, Act::tourBack);
            put(*skip, -row / 2 + back->size.x + gap + skip->size.x / 2, y, Act::tourSkip);
            root_->addChild(holder);
            // (A moment after the card that was followed has opened: it is what was asked for.)
            fadeIn(holder, 0.9, 0.4f);
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
    if (lesson < 0 || lesson == markStep) return false;
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
    // `-guideDemo tour -guideStep <n>`: walks to the nth lesson by itself, a card every few seconds.
    if (teach.demo && Flags::has("guideStep") && lesson >= 0 && lesson < std::min(tourCount, Flags::integer("guideStep")) - 1 && now >= teach.tourWalkAt) {
        if (std::optional<int> next = tourNode(lesson + 1)) {
            teach.tourWalkAt = now + 3.6;
            take(*next);
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
    if (at == markStep) finished = teach.tourDone[markStep] && !zoomed;
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
    if (zoomed) want = -1;
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
        } else if (const guide::Gesture* g = guide::gesture(tourSteps[teach.tourShown >= 200 ? pullStep : teach.tourShown % 100].gesture)) {
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
    if (passing && !zoomed && !busy && !holdDone && now - teach.tourAdvanceAt >= (canPinchNext ? autoAfter : 4.0)) {
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
    std::optional<Vec3> pinAt, spotAt, offAt;
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
            if (teach.tourDone[markStep]) {
                // The way out is anywhere that is not the card: a place for it is shown, just off the card's
                // right edge at the height of the words, and the way there from them.
                Vec2 spot{openHalf.x + 0.17f, middle.y - size.y / 2 + 0.026f * openSize};
                std::vector<Vec3> round;
                for (int k = 0; k < 36; k++) {
                    float a = float(k) * 2 * floatPi / 36;
                    round.push_back(marking->point(spot + Vec2{std::cos(a), std::sin(a)} * 0.075f, 0.02f));
                }
                signs.rounds.push_back(round);
                std::vector<Vec3> way;
                Vec2 from{middle.x + 0.44f, spot.y}, to{spot.x - 0.09f, spot.y};
                for (int k = 0; k <= 10; k++) way.push_back(marking->point(from + (to - from) * (float(k) / 10), 0.02f));
                if (to.x - from.x > 0.1f) signs.flows.push_back(way);
                spotWords = "Pinch here";
                spotAt = marking->point(spot + Vec2{0.02f, 0.13f}, 0.05f);
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
                Vec3 from = c->point({0, -c->half.y - 0.03f}, 0.02f), to = c->point({0.06f, -c->half.y - 0.26f}, 0.02f);
                signs.flows.push_back(arcBetween(from, to, c->right * 0.05f));
                std::vector<Vec3> spot = roundOn(*c, {0.06f, -c->half.y * 2 - 0.3f}, c->half * 2, 0.012f, 0.016f);
                if (spot.size() % 2) spot.pop_back();
                signs.dashes.push_back(spot);
                break;
            }
        } else if (at == markStep) {
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

void OceanModel::endTour(const char* why) {
    if (teach.tour < 0) return;
    teach.tour = -1;
    teach.tourStood = false;
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
    float x = -whole / 2;
    for (size_t k = 0; k < words.size(); k++) {
        float inked = words[k].size.x - 2 * letter * 0.3f;
        EntityRef e = art->quad(words[k]);
        e->position = {x + inked / 2, 0, 0.002f * float(k)};
        holder->addChild(e);
        fadeIn(e, 0.3 + 0.38 * double(k), 0.8f);
        x += inked + space;
    }
    // Under it, a line and the three ways, side by side.
    double after = 0.3 + 0.38 * double(words.size()) + 0.5;
    auto put = [&](const std::optional<Piece>& piece, float px, float py, double delay, int action) {
        if (!piece) return;
        EntityRef e = art->quad(*piece);
        e->position = {px, py, 0};
        if (action >= 0) {
            e->collision = {Shape::generateBox({piece->size.x, piece->size.y + 0.012f, 0.01f})};
            e->inputTarget = true;
            e->hover = Art::hover();
            picks[e.get()] = Pick::guide(action);
            teach.homePicks.push_back(e.get());
        }
        holder->addChild(e);
        fadeIn(e, delay, 0.6f);
    };
    put(art->plain("Start exploring now by", 0.058f, Font::displayFont(0, true), 0.92f), 0, -0.28f, after, -1);
    const float pitch = 0.86f, row = -0.47f;
    put(art->way(1, "Pinching a tree", "They stand on your desk.", 0.055f), -pitch, row, after + 0.25, -1);
    put(art->way(2, "Pinching an item", "They lie in the ocean around you.", 0.055f), 0, row, after + 0.4, -1);
    put(art->way(3, "Talking to Momo", "Pinch a question to begin.", 0.055f), pitch, row, after + 0.55, -1);
    put(art->pill("Start exploring", 0.042f), 0, -0.71f, after + 1.0, Act::homeClose);
    teach.home = holder;
    teach.homeDue = false;
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
    logLine("[guide] the greeting after the walk");
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
    x += guideWords(holder, art->line("Close", Art::Size::label, Font::Weight::semibold, Color::white(), Art::ink, Art::buttonPad), x, foot, false, Act::closeSheet) + 0.01f;
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
    fadeIn(holder, 0, place ? 0.15f : 0.3f);
    teach.holder = holder;
    teach.mode = 3;
    teach.sheetRow = row;
    teach.began = time;
}

void OceanModel::guideAct(int action) {
    if (!teach.on) return;
    switch (action) {
    case Act::begin:
        break;      // any pinch leaves the welcome: see `guideDid("pick")`, which every tap reports
    case Act::closeSheet:
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
        if (std::optional<int> back = teach.tour >= 0 ? tourNode(teach.tour) : std::nullopt) take(*back);
        break;
    case Act::tourSkip:
    case Act::tourEnd:
        // Out of the walk: the tree stays as it is, to be gone on with. What was not done is shown later, in its place.
        endTour("the walk was skipped");
        break;
    case Act::homeClose:
        closeHome();
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
