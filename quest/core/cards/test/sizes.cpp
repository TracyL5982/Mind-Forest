// Checks every gallery sample at the size the Quest shows it: small, as wide as the ocean's small note;
// opened, the ocean's open note of the kind it opens as, every page that size, and no part cut between
// two pages. Prints one line per sample and exits with 1 if any fails.
//   quest/core/cards/test/sizes.sh
#include <cstdio>
#include <set>

#include "../../base.h"
#include "../../ocean/catalog.h"
#include "../gallery.h"
#include "../ocean.h"

int main() {
    Flags::set({"-syncRaster"});
    std::optional<Json> samples = cards::readSamples();
    if (!samples) return 2;
    std::vector<float> boxes;
    for (OceanNote::Kind kind : {OceanNote::Kind::text, OceanNote::Kind::chart, OceanNote::Kind::link}) boxes.push_back(Catalog::openSize(kind, false, 1).y);
    int failed = 0, count = 0, paged = 0;
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
            Vec2 small = *cards::ocean::smallSize(id), open = *cards::ocean::openSize(id);
            cards::Opened o = *cards::ocean::opened(id);
            const cards::Kind& kind = *cards::kindOf(id);
            float box = kind.opens == cards::Kind::Opens::picture ? Catalog::openSize(OceanNote::Kind::image, false, *cards::pictureAspect(id)).y
                        : boxes[size_t(kind.opens)];
            std::vector<std::string> wrong;
            bool atCeiling = std::fabs(small.y - cards::ocean::smallCeiling) < 1e-3f;
            if (small.x > Metrics::smallNoteWidth + 1e-3f || (!atCeiling && small.x < Metrics::smallNoteWidth - 1e-3f)) wrong.push_back("small width");
            if (small.y > cards::ocean::smallCeiling + 1e-3f) wrong.push_back("small over the ceiling");
            if (std::fabs(open.x - Metrics::openNoteWidth) > 1e-4f || std::fabs(open.y - box) > 1e-4f) wrong.push_back("open box");
            if (std::fabs(o.size.height / Art::ppm - open.y) > 1.5f / Art::ppm) wrong.push_back("page height");
            if (o.cut) wrong.push_back("a part cut between pages");
            count++;
            paged += o.pages.size() > 1;
            failed += !wrong.empty();
            std::string said;
            for (const std::string& w : wrong) said += (said.empty() ? "  FAIL " : ", ") + w;
            printf("%-14s small %.3f x %.3f m  open %.3f x %.3f m  %d page%s%s\n", id.c_str(), small.x, small.y, open.x, open.y, int(o.pages.size()),
                   o.pages.size() == 1 ? "" : "s", said.c_str());
        }
    }
    printf("%d samples, %d on more than one page, %d failing\n", count, paged, failed);
    return failed ? 1 : 0;
}
