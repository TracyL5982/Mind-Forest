// An open card's frame with its panel a hair in front, bent as a card on its layer is: the panel must show in front of
// the frame all the way across, at every size and curve, however each was cut. Where the frame comes through, the
// headset shows dark stripes down the panel.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <map>

#include "../bend.h"

namespace {

int failures = 0;

void check(bool ok, const std::string& what) {
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what.c_str());
    if (!ok) failures++;
}

/// Where a piece lies across the card once bent: for each place along the flat card where it has points, where those
/// points went in the card's space (all points at one place along the card go to one place across it).
std::map<float, Vec2> across(const EntityRef& e, const EntityRef& root, float width) {
    std::map<float, Vec2> out;
    auto* low = dynamic_cast<LowLevelMesh*>(e->model->mesh.get());
    if (!low) return out;
    struct Vertex {
        Vec3 position;
        Vec2 uv;
    };
    const auto* v = reinterpret_cast<const Vertex*>(low->vertexData.data());
    Mat4 m = e->transformMatrix(root);
    for (int i = 0; i < low->indexCount; i++) {
        const Vertex& p = v[low->indexData[size_t(i)]];
        Vec4 flat = m * Vec4((p.uv.x - 0.5f) * width, 0, 0, 1), bent = m * Vec4(p.position, 1);
        out[std::round(flat.x * 1e6f) / 1e6f] = {bent.x, bent.z};
    }
    return out;
}

/// The piece's place across the card at `x` along it, between the points either side.
Vec2 at(const std::map<float, Vec2>& surface, float x) {
    auto after = surface.lower_bound(x);
    if (after == surface.begin()) return after->second;
    if (after == surface.end()) return std::prev(after)->second;
    auto before = std::prev(after);
    float t = (x - before->first) / (after->first - before->first);
    return before->second + (after->second - before->second) * t;
}

/// How much nearer the eye (the bend's axis) the panel lies than the frame, at its least, across the panel, m.
float clearance(const EntityRef& frame, float frameWidth, const EntityRef& panel, float panelWidth, const EntityRef& root, float curve) {
    std::map<float, Vec2> f = across(frame, root, frameWidth), p = across(panel, root, panelWidth);
    if (f.size() < 2 || p.size() < 2) return -1;
    auto far = [curve](Vec2 q) { return std::hypot(q.x, q.y - 1 / curve); };
    float least = INFINITY;
    for (float x = p.begin()->first; x <= std::prev(p.end())->first; x += 0.0005f) least = std::min(least, far(at(f, x)) - far(at(p, x)));
    return least;
}

struct Card {
    EntityRef root = Entity::make(), face = Entity::make(), frame, panel;
    Vec2 frameSize{0.46f, 0.372f}, panelSize{0.43f, 0.33f};
    static constexpr float lift = 0.0003f;
    Card() {
        root->addChild(face);
        frame = Entity::make(Mesh::generatePlane(frameSize.x, frameSize.y), {Material::unlit(Color::white())});
        panel = Entity::make(Mesh::generatePlane(panelSize.x, panelSize.y), {Material::unlit(Color::white())});
        panel->position = {0.004f, -0.006f, lift};
        face->addChild(frame);
        face->addChild(panel);
    }
    /// The panel is given a new flat mesh, as a scroll or a newly arrived picture gives it.
    void redrawPanel() { panel->model->mesh = Mesh::generatePlane(panelSize.x, panelSize.y); }
};

}  // namespace

int main() {
    // The open face grows from 1/g of its size, as a card opens, and the panel is drawn again once it has.
    for (float g : {1.43f, 2.03f, 2.2f}) {
        for (float curve : {0.67f, 2.02f, 6.f}) {
            Card card;
            Bend bend;
            card.face->scale = Vec3::repeating(1 / g);
            bend.update(card.root, curve, true);
            for (float s : {0.6f, 0.8f, 1.f}) {
                card.face->scale = Vec3::repeating(std::max(s, 1 / g));
                bend.update(card.root, curve, true);
            }
            card.redrawPanel();
            bend.forget(card.panel);
            bend.update(card.root, curve, false);
            bend.update(card.root, curve, false);
            float c = clearance(card.frame, card.frameSize.x, card.panel, card.panelSize.x, card.root, curve);
            char line[200];
            std::snprintf(line, sizeof line, "opened from 1/%.2f, panel drawn again, curve %.2f: the panel stands %.3f mm in front of the frame at least (%.3f mm flat)",
                          double(g), double(curve), double(c * 1000), double(Card::lift * 1000));
            check(c > 0.9f * Card::lift, line);
        }
    }
    // The panel drawn again while the card is still opening, in front of the frame then and once the card is open.
    for (float curve : {0.67f, 2.02f, 6.f}) {
        Card card;
        Bend bend;
        card.face->scale = Vec3::repeating(1 / 2.03f);
        bend.update(card.root, curve, true);
        card.face->scale = Vec3::repeating(0.7f);
        bend.update(card.root, curve, true);
        card.redrawPanel();
        bend.forget(card.panel);
        bend.update(card.root, curve, true);
        float during = clearance(card.frame, card.frameSize.x, card.panel, card.panelSize.x, card.root, curve) / 0.7f;
        for (float s : {0.85f, 1.f}) {
            card.face->scale = Vec3::repeating(s);
            bend.update(card.root, curve, true);
        }
        bend.update(card.root, curve, false);
        float after = clearance(card.frame, card.frameSize.x, card.panel, card.panelSize.x, card.root, curve);
        char line[200];
        std::snprintf(line, sizeof line, "panel drawn again while opening, curve %.2f: it stands %.3f mm in front of the frame at least then, at the face's scale, and %.3f mm once open",
                      double(curve), double(during * 1000), double(after * 1000));
        check(during > 0.9f * Card::lift && after > 0.9f * Card::lift, line);
    }
    // A piece whose edge falls inside a column lies on the same surface as one that spans it.
    for (float curve : {0.67f, 2.02f, 6.f}) {
        Card card;
        Bend bend;
        bend.update(card.root, curve, true);
        bend.update(card.root, curve, false);
        float c = clearance(card.frame, card.frameSize.x, card.panel, card.panelSize.x, card.root, curve);
        char line[200];
        std::snprintf(line, sizeof line, "cut once, curve %.2f: the panel stands %.3f mm in front of the frame at least", double(curve), double(c * 1000));
        check(c > 0.9f * Card::lift, line);
    }
    std::printf(failures ? "%d failed\n" : "all passed\n", failures);
    return failures ? 1 : 0;
}
