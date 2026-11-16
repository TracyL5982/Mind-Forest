#include "filmpanel.h"

#include <cmath>
#include <functional>

#include "base.h"
#include "canvas.h"

namespace {

// A point of the panel's drawing is half a millimetre: type of 15 points is 7.5 mm tall, which at the
// panel's 60 cm reads as a card's body does at arm's length.
constexpr float metre = 0.0005f;
constexpr float wide = 520, high = 232;
constexpr float margin = 24, gap = 12;
constexpr float buttonHigh = 60, buttonWide = (wide - 2 * margin - gap) / 2;
constexpr float buttonTop = high - margin - buttonHigh;

// Art's colours (core/ocean/art.h): the panel, the well a quiet button sits in, the one accent.
constexpr Color panel = Color::hex(0x161A21), quiet = Color::hex(0x2A2E36), well = Color::hex(0x20252E), hot = Color::hex(0xFF5A36);

/// A rectangle with rounded corners, as a path of short straight lines (the canvas has no arcs).
UIBezierPath rounded(CGRect r, float radius) {
    UIBezierPath path;
    const int steps = 8;
    const float cx[4] = {r.origin.x + r.size.width - radius, r.origin.x + r.size.width - radius, r.origin.x + radius, r.origin.x + radius};
    const float cy[4] = {r.origin.y + radius, r.origin.y + r.size.height - radius, r.origin.y + r.size.height - radius, r.origin.y + radius};
    bool first = true;
    for (int corner = 0; corner < 4; corner++) {
        for (int i = 0; i <= steps; i++) {
            float a = float(M_PI) * (-0.5f + 0.5f * (float(corner) + float(i) / steps));
            CGPoint p{cx[corner] + radius * std::cos(a), cy[corner] + radius * std::sin(a)};
            if (first) path.move(p); else path.addLine(p);
            first = false;
        }
    }
    path.close();
    return path;
}

TextAttributes type(float size, Font::Weight weight, Color color) {
    TextAttributes a;
    a.font = Font::systemFont(size, weight);
    a.foregroundColor = color;
    return a;
}

ImageRef picture(float w, float h, const std::function<void()>& actions) {
    UIGraphicsImageRendererFormat format;
    format.scale = 2;
    return UIGraphicsImageRenderer(CGSize(w, h), format).image([&](Canvas&) { actions(); });
}

std::string clock(double seconds) {
    int s = int(seconds);
    return fmt("%d:%02d", s / 60, s % 60);
}

/// Where things stand, in one line, in the person's own terms.
std::string words(const FilmPanel::State& s) {
    if (s.recording && !s.sheetLocked) return "Recording. The sheet is not locked, so a camera can't be placed.";
    if (s.recording) return "Recording.";
    if (s.sheetLocked) return "Sheet locked. Ready to record.";
    if (!s.sheetSeen) return "Look at the sheet.";
    if (s.sheetSteady) return "Sheet steady. Lock it.";
    if (s.sheetAway > 0) return fmt("Sheet seen from %.0f cm. Come closer.", double(s.sheetAway * 100));
    return "Sheet seen. Come closer.";
}

EntityRef quad(float w, float h) {
    Material m = Material::unlit(Color::white());
    m.transparent = true;
    EntityRef e = Entity::make(Mesh::generatePlane(w * metre, h * metre), {m});
    e->isEnabled = false;       // until its picture is there
    return e;
}

}  // namespace

bool FilmPanel::State::operator==(const State& o) const {
    return sheetSeen == o.sheetSeen && sheetSteady == o.sheetSteady && sheetLocked == o.sheetLocked && recording == o.recording &&
           int(sheetAway * 20) == int(o.sheetAway * 20) && int(recorded) == int(o.recorded);
}

FilmPanel::FilmPanel() {
    base = Entity::make();
    base->unfilmed = true;
    base->isEnabled = false;
    plate = quad(wide, high);
    base->addChild(plate);
    // The buttons stand a little off the plate, each its own picture, so that a ray resting on one lights it alone.
    auto button = [&](float left) {
        EntityRef e = quad(buttonWide, buttonHigh);
        e->position = {(left + buttonWide / 2 - wide / 2) * metre, (high / 2 - buttonTop - buttonHigh / 2) * metre, 0.003f};
        e->collision = {Shape::generateBox({buttonWide * metre, buttonHigh * metre, 0.01f})};
        e->inputTarget = true;
        e->hover = Hover::highlight(Color::hex(0xFFE2A8), 0.9f);     // a lift, not another colour: these are small and dark
        base->addChild(e);
        return e;
    };
    lockButton = button(margin);
    recordButton = button(margin + buttonWide + gap);
}

FilmPanel::Press FilmPanel::pressed(const EntityRef& entity) const {
    return entity == lockButton ? Press::lock : entity == recordButton ? Press::record : Press::none;
}

void FilmPanel::set(const EntityRef& onto, const ImageRef& image) {
    // (One waiting picture for each thing: a newer one takes the older one's place.)
    for (Waiting& w : waiting) {
        if (w.onto == onto) {
            w.image = image;
            return;
        }
    }
    waiting.push_back({onto, image});
}

void FilmPanel::draw(const State& s) {
    bool first = !drawnOnce;
    bool plateChanged = first || words(s) != words(shown) || s.recording != shown.recording || (s.recording && int(s.recorded) != shownSecond);
    if (plateChanged) {
        std::string line = words(s), time = clock(s.recorded);
        bool recording = s.recording;
        set(plate, picture(wide, high, [=] {
            setFill(Color::white(1, 0.10f));
            rounded(CGRect(0, 0, wide, high), 20).fill();
            setFill(panel);
            rounded(CGRect(1.5f, 1.5f, wide - 3, high - 3), 18.5f).fill();
            // One left edge for everything; the take's length at the right while one runs.
            drawString("Filming", CGPoint(margin, 20), type(13, Font::Weight::medium, Color::white(1, 0.55f)));
            if (recording) {
                TextAttributes t = type(13, Font::Weight::medium, Color::white());
                float w = stringSize(time, t).width;
                drawString(time, CGPoint(wide - margin - w, 20), t);
                setFill(hot);
                UIBezierPath::ovalIn(CGRect(wide - margin - w - 18, 24, 10, 10)).fill();
            }
            drawString(line, CGRect(margin, 48, wide - 2 * margin, 76), usesLineFragmentOrigin | truncatesLastVisibleLine,
                       type(17, Font::Weight::medium, Color::white()));
        }));
        shownSecond = int(s.recorded);
    }
    auto label = [&](const EntityRef& onto, const std::string& text, Color ground, Color ink) {
        set(onto, picture(buttonWide, buttonHigh, [=] {
            setFill(ground);
            rounded(CGRect(0, 0, buttonWide, buttonHigh), 14).fill();
            TextAttributes t = type(17, Font::Weight::semibold, ink);
            CGSize size = stringSize(text, t);
            drawString(text, CGPoint((buttonWide - size.width) / 2, (buttonHigh - size.height) / 2), t);
        }));
    };
    // Lock: there to be pinched once the sheet is seen; a locked sheet is unlocked by the same button, but not during a take.
    bool canLock = s.sheetLocked ? !s.recording : s.sheetSeen;
    bool couldLock = shown.sheetLocked ? !shown.recording : shown.sheetSeen;
    if (first || s.sheetLocked != shown.sheetLocked || canLock != couldLock) {
        label(lockButton, s.sheetLocked ? "Unlock sheet" : "Lock sheet", canLock ? quiet : well, Color::white(1, canLock ? 1 : 0.35f));
    }
    if (first || s.recording != shown.recording) {
        label(recordButton, s.recording ? "Stop" : "Record", s.recording ? quiet : hot, Color::white());
    }
    shown = s;
    drawnOnce = true;
}

void FilmPanel::place(const Mat4& head) {
    // To the left of where the head faces, a forearm off and below the eyes: in reach of a ray, out of the middle of things.
    static const double turn = Flags::has("filmPanelTurn") ? Flags::number("filmPanelTurn") : 48;
    static const double drop = Flags::has("filmPanelDrop") ? Flags::number("filmPanelDrop") : 0.24;
    static const double reach = Flags::has("filmPanelReach") ? Flags::number("filmPanelReach") : 0.6;
    Vec3 ahead = head.forward();
    ahead.y = 0;
    ahead = length(ahead) > 1e-3f ? normalize(ahead) : Vec3{0, 0, -1};
    Vec3 toward = Quat::angleAxis(float(turn * M_PI / 180), {0, 1, 0}).act(ahead);
    Vec3 at = head.position() + toward * float(reach) - Vec3{0, float(drop), 0};
    // Facing the eyes, upright.
    Vec3 z = normalize(head.position() - at), x = normalize(cross({0, 1, 0}, z));
    base->position = at;
    base->orientation = Quat(Mat3(x, cross(z, x), z));
    placed = true;
    farFor = 0;
}

void FilmPanel::update(const State& state, const std::optional<Mat4>& head, float dt) {
    if (!drawnOnce || !(state == shown)) draw(state);
    for (auto it = waiting.begin(); it != waiting.end();) {
        if (it->image && it->image->ready.load()) {
            it->onto->model->materials[0].texture = Texture::make(it->image, true);
            it->onto->isEnabled = true;
            it = waiting.erase(it);
        } else {
            ++it;
        }
    }
    if (!head) return;
    if (!placed) place(*head);
    // Left behind (the person has walked off, or the scene was brought elsewhere): it comes along after a moment.
    float away = distance(head->position(), base->position);
    farFor = away > 1.3f ? farFor + dt : 0;
    if (farFor > 3) {
        place(*head);
        appear = 0;
    }
    base->isEnabled = true;
    appear = std::min(1.f, appear + dt / 0.25f);
    float eased = 1 - (1 - appear) * (1 - appear);
    if (eased < 0.999f) base->opacity = eased; else base->opacity.reset();
}
