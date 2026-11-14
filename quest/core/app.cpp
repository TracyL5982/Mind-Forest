#include "app.h"

#include "base.h"
#include "platform.h"

#ifndef OCEAN_NO_SCENE
#include "ocean/oceanmodel.h"
#endif

namespace {

/// Rows of cards in front of you and a field of specks on the floor: about
/// the ocean's load (`-testCards <n>`, default 60), with nothing to load.
/// A pinch on a card turns it over to the next colour; a drag moves it; two
/// hands scale them all.
class TestScene : public PalaceScene {
public:
    EntityRef root() override { return base; }

    void start() override {
        Vec3 origin = platform::head() ? platform::head()->position() : Vec3{0, 1.5f, 0};
        Vec3 f = platform::head() ? platform::head()->forward() : Vec3{0, 0, -1};
        f.y = 0;
        f = length(f) > 1e-3f ? normalize(f) : Vec3{0, 0, -1};
        Vec3 r = normalize(cross(f, {0, 1, 0}));
        int count = Flags::integer("testCards") > 0 ? Flags::integer("testCards") : 60;
        int columns = 12;
        for (int i = 0; i < count; i++) {
            int col = i % columns, row = i / columns;
            float az = (float(col) - (columns - 1) / 2.f) * 9 * float(M_PI) / 180;
            Vec3 dir = f * std::cos(az) + r * std::sin(az);
            Vec3 p = origin + dir * 1.5f + Vec3{0, 0.35f - 0.2f * float(row), 0};
            Material m = Material::unlit(Color::hex(colors[i % 5]));
            if (i % 3 == 0) {
                m.transparent = true;
                m.opacity = 0.6f;
            }
            EntityRef e = Entity::make(Mesh::generatePlane(0.17f, 0.11f), {m});
            e->position = p;
            Vec3 right = r * std::cos(az) - f * std::sin(az);
            e->orientation = Quat(Mat3(right, {0, 1, 0}, -dir));
            e->collision = {Shape::generateBox({0.17f, 0.11f, 0.01f})};
            e->inputTarget = true;
            e->hover = Hover::highlight(Color::hex(0xFFE2A8), 2.4f);
            base->addChild(e);
            cards.push_back(e);
        }
        // `-testAtlas`: two pictures through the whole path (decode, upload, draw), a JPEG and a HEIC.
        if (Flags::has("testAtlas")) {
            const char* names[2] = {"clips/atlas.jpg", "works/atlas.jpg"};
            for (int k = 0; k < 2; k++) {
                ImageRef image = platform::loadImage(platform::resourcePath(names[k]), k == 0 ? 0 : 1024);
                if (!image) {
                    logLine(fmt("[test] could not load %s", names[k]));
                    continue;
                }
                logLine(fmt("[test] %s: %d x %d", names[k], image->width, image->height));
                float w = 0.8f, h = w * float(image->height) / float(image->width);
                EntityRef e = Entity::make(Mesh::generatePlane(w, h), {Material::unlit(Color::white(1), Texture::make(image, true))});
                e->position = origin + f * 1.2f + r * (k == 0 ? -0.45f : 0.45f) + Vec3{0, 0.1f, 0};
                e->orientation = Quat(Mat3(r, {0, 1, 0}, -f));
                base->addChild(e);
            }
        }
        logLine(fmt("[test] %d cards", count));
    }

    void update(float dt) override { time += dt; }

    void pinchChanged(const EntityRef& entity, Vec3 at, Vec3 start) override {
        if (!held) {
            held = entity;
            heldFrom = entity->position;
        }
        held->position = heldFrom + (at - start);
        moved = std::max(moved, length(at - start));
    }

    void pinchEnded(Vec3) override {
        if (held && moved < 0.035f && held->model) {
            turn++;
            held->position = heldFrom;
            held->model->materials[0].color = Color::hex(colors[turn % 5]);
        }
        held = nullptr;
        moved = 0;
    }

    void magnifyChanged(float ratio) override {
        for (auto& c : cards) c->scale = Vec3::repeating(std::min(3.f, std::max(0.3f, ratio)));
    }
    void magnifyEnded() override {}
    /// `-dim` is the share of the room's light kept, as in the ocean (0.88 by default there; here, none taken).
    float surroundingsDim() override { return Flags::has("dim") ? 1 - float(Flags::number("dim")) : 0; }

private:
    static constexpr uint32_t colors[5] = {0xB9A7FF, 0x5EDDB4, 0xF59AB8, 0xF5C451, 0x8FC7FF};
    EntityRef base = Entity::make();
    std::vector<EntityRef> cards;
    EntityRef held;
    Vec3 heldFrom;
    float moved = 0;
    int turn = 0;
    double time = 0;
};

}  // namespace

std::unique_ptr<PalaceScene> makeScene() {
#ifndef OCEAN_NO_SCENE
    if (!Flags::has("testScene")) return std::make_unique<OceanModel>();
#endif
    return std::make_unique<TestScene>();
}
