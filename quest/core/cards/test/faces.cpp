// Draws every gallery sample's card, small and opened, to PNG files with the Mac's fonts, at 2 pixels to
// a web px, and lists them in manifest.json, so each can be set beside the web's own drawing
// (quest/tools/cards_compare.mjs). The opened card is drawn as the Quest shows it, its frame with the panel in
// the window at its top, as <id>-open.png; when the panel runs on past the window, scrolled to its end as
// <id>-open-end.png; and the whole panel as <id>-panel.png.
//   quest/core/cards/test/faces.sh <out folder>
#include <cstdio>

#include "../../../desktop/host_mac.h"
#include "../../base.h"
#include "../cards.h"
#include "../gallery.h"
#include "../ocean.h"

namespace {

bool save(const ImageRef& image, const std::string& path) {
    if (!image) return false;
    image->wait();
    std::vector<uint8_t> flipped(image->rgba.size());
    size_t row = size_t(image->width) * 4;
    for (int y = 0; y < image->height; y++) {
        std::copy_n(&image->rgba[size_t(image->height - 1 - y) * row], row, &flipped[size_t(y) * row]);
    }
    // The PNG keeps no alpha, so what is see-through is laid on the web page's ground (#0b0d11).
    const uint8_t ground[3] = {0x0b, 0x0d, 0x11};
    for (size_t i = 0; i < flipped.size(); i += 4) {
        int clear = 255 - flipped[i + 3];
        for (int c = 0; c < 3; c++) flipped[i + size_t(c)] = uint8_t(flipped[i + size_t(c)] + ground[c] * clear / 255);
    }
    return host::savePNG(path, image->width, image->height, flipped);
}

ImageRef render(const cards::Drawn& drawn) {
    UIGraphicsImageRendererFormat format;
    format.scale = 1;
    return UIGraphicsImageRenderer(drawn.size, format).image([&](Canvas& ctx) { drawn.draw(ctx); });
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: faces <out folder>\n");
        return 2;
    }
    std::string out = argv[1];
    Flags::set({"-syncRaster"});
    std::optional<Json> samples = cards::readSamples();
    if (!samples) return 1;
    const float k = 2;
    Json manifest = Json::list();
    for (const Json& type : (*samples)["types"].array()) {
        std::string name = type["type"].string("");
        if (!cards::draws(name)) continue;
        int i = 0;
        for (const Json& card : type["cards"].array()) {
            std::string id = name + "-" + std::to_string(i++);
            cards::Node node{.pick = card["status"].string("") == "pick", .root = false};
            cards::put(id, card["view"], card["item"], node);
            for (const std::string& src : cards::pictures(id)) {
                if (src.rfind("sample:", 0) != 0) cards::picture(src, nullptr);
            }
            bool ok = save(render(*cards::small(id, k)), out + "/" + id + "-small.png");
            cards::Opened opened = *cards::ocean::opened(id, k);
            ImageRef panel = render(cards::Drawn{opened.key, CGSize{opened.size.width, opened.contentTall}, opened.content});
            ok = ok && save(panel, out + "/" + id + "-panel.png");
            float most = opened.contentTall - opened.size.height;
            for (float off : most > 0 ? std::vector<float>{0, most} : std::vector<float>{0}) {
                cards::Drawn view{opened.key, opened.size, [&](Canvas& ctx) {
                                      opened.frame(ctx);
                                      ctx.saveGState();
                                      ctx.clip(opened.window);
                                      ctx.drawImage(panel, CGRect{0, -off, opened.size.width, opened.contentTall});
                                      ctx.restoreGState();
                                  }};
                ok = ok && save(render(view), out + "/" + id + (off > 0 ? "-open-end.png" : "-open.png"));
            }
            if (!ok) {
                fprintf(stderr, "could not draw %s\n", id.c_str());
                return 1;
            }
            cards::Footprint f = *cards::footprintOf(id);
            Json entry = Json::object();
            entry.set("type", name).set("id", id).set("label", card["label"]).set("status", card["status"]);
            entry.set("footprint", Json::list({f.width, f.height}));
            manifest.push(entry);
        }
    }
    FILE* f = fopen((out + "/manifest.json").c_str(), "w");
    if (!f) return 1;
    fputs(manifest.dump(true).c_str(), f);
    fclose(f);
    printf("drew %d cards into %s\n", int(manifest.size()), out.c_str());
    return 0;
}
