// Checks every gallery sample at the size the Quest shows it, by the sizing spec (sizing/quest-card-sizing.md,
// "Build spec", section 10). Small: 1 mm a web px, never shrunk, at most 210 by 146 px, and drawn with whole
// lines only, so no text is cut with an ellipsis or loses lines without the cue after it. Opened: the fixed
// box of its kind, 46 by 37.2 cm for text, chart and link, the panel's window inside the frame, and the whole
// panel drawn once with nothing cut. Prints one line per sample and exits with 1 if any fails.
//   quest/core/cards/test/sizes.sh
#include <cstdio>

#include "../../base.h"
#include "../../ocean/catalog.h"
#include "../face.h"
#include "../gallery.h"
#include "../ocean.h"

namespace {

/// Draws `draw` into a picture `size` pixels, and returns what the cut watch saw while it did.
std::vector<std::string> watched(CGSize size, const std::function<void(Canvas&)>& draw) {
    cards::Cuts::seen.clear();
    cards::Cuts::on = true;
    UIGraphicsImageRendererFormat format;
    format.scale = 1;
    ImageRef image = UIGraphicsImageRenderer(size, format).image([&](Canvas& ctx) { draw(ctx); });
    if (image) image->wait();
    cards::Cuts::on = false;
    return cards::Cuts::seen;
}

}  // namespace

int main() {
    Flags::set({"-syncRaster"});
    std::optional<Json> samples = cards::readSamples();
    if (!samples) return 2;
    const float textTall = cards::ocean::OPEN_TALL * cards::ocean::openScale / Art::ppm;
    int failed = 0, count = 0, scrolls = 0;
    for (const Json& type : (*samples)["types"].array()) {
        std::string name = type["type"].string("");
        if (!cards::draws(name)) continue;
        int i = 0;
        for (const Json& card : type["cards"].array()) {
            std::string id = name + "-" + std::to_string(i++);
            cards::put(id, card["view"], card["item"], cards::Node{.pick = card["status"].string("") == "pick"});
            for (const std::string& src : cards::pictures(id)) {
                if (src.rfind("sample:", 0) != 0) cards::picture(src, nullptr);
            }
            cards::Footprint f = *cards::footprintOf(id);
            Vec2 small = *cards::ocean::smallSize(id), open = *cards::ocean::openSize(id);
            cards::Opened o = *cards::ocean::opened(id);
            const cards::Kind& kind = *cards::kindOf(id);
            float box = kind.opens == cards::Kind::Opens::picture ? Catalog::openSize(OceanNote::Kind::image, false, *cards::pictureAspect(id)).y
                                                                  : textTall;
            std::vector<std::string> wrong;
            if (f.width > cards::face::W || f.height > cards::face::H) wrong.push_back("small over 210 x 146");
            if (std::fabs(small.x - float(f.width) / 1000) > 1e-5f || std::fabs(small.y - float(f.height) / 1000) > 1e-5f) wrong.push_back("small shrunk");
            std::optional<cards::Drawn> face = cards::small(id, cards::ocean::smallScale);
            for (const std::string& cut : watched(face->size, face->draw)) wrong.push_back("small " + cut);
            if (std::fabs(open.x - Metrics::openNoteWidth) > 1e-4f || std::fabs(open.y - box) > 1e-4f) wrong.push_back("open box");
            if (std::fabs(o.size.height / Art::ppm - open.y) > 1.5f / Art::ppm) wrong.push_back("frame height");
            if (!(o.window.minX() >= 0 && o.window.minY() >= 0 && o.window.maxX() <= o.size.width && o.window.maxY() <= o.size.height)) wrong.push_back("window outside the frame");
            if (o.contentTall < o.size.height) wrong.push_back("panel shorter than the frame");
            if (o.contentTall / cards::ocean::openScale >= 3200) wrong.push_back("panel cut at its longest");
            for (const std::string& cut : watched(CGSize{o.size.width, o.contentTall}, o.content)) wrong.push_back("open " + cut);
            float runs = cards::ocean::overflow(id);
            count++;
            scrolls += runs > 0;
            failed += !wrong.empty();
            std::string said;
            for (const std::string& w : wrong) said += (said.empty() ? "  FAIL " : "; ") + w;
            printf("%-14s small %3d x %3d px  open %.3f x %.3f m  scrolls %4.0f px%s\n", id.c_str(), f.width, f.height, open.x, open.y, double(runs), said.c_str());
        }
    }
    printf("%d samples, %d that scroll, %d failing\n", count, scrolls, failed);
    return failed ? 1 : 0;
}
