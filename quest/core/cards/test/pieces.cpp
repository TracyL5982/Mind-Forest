// Checks every note, film and work of the ocean as the card `-cards` draws it (pieces.h), at the ocean's sizes
// and with a stand-in for each picture in the shape the scene hands it: each piece has a card, no part of an
// opened card is cut between two pages, and a film plays where its poster is drawn. Prints, for each type,
// how many cards show their picture on the first page, then each card that does not or that fails.
//   quest/core/cards/test/pieces.sh, which passes it the repository's folder
#include <cstdio>
#include <map>

#include "../../../desktop/host_mac.h"
#include "../../base.h"
#include "../../ocean/catalog.h"
#include "../media.h"
#include "../ocean.h"
#include "../pieces.h"

namespace {

/// A picture of the shape the scene hands the card for `src`, with no pixels: only its shape is read here.
ImageRef standIn(const Catalog& catalog, const std::string& src) {
    std::optional<cards::OceanPicture> at = cards::oceanPicture(src);
    if (!at) return nullptr;
    float aspect = 1;
    switch (at->kind) {
    case cards::OceanPicture::Kind::still: aspect = catalog.clips[size_t(at->index)].aspect; break;
    case cards::OceanPicture::Kind::work: aspect = catalog.works[size_t(at->index)].aspect; break;
    case cards::OceanPicture::Kind::file:
        for (const auto& [id, note] : catalog.notes) {
            if (note.image && "file:" + *note.image == src) aspect = catalog.aspect(note);
        }
        break;
    }
    auto image = std::make_shared<Image>();
    image->height = 144;
    image->width = int(std::round(144 * aspect));
    return image;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) return 2;
    Flags::set({"-syncRaster"});
    host::repoRoot = argv[1];
    std::shared_ptr<ClipLibrary> clips = ClipLibrary::make();
    std::shared_ptr<Catalog> catalog = clips ? Catalog::make(clips->clips, WorkLibrary::make()) : nullptr;
    if (!catalog) return 2;
    cards::ocean::hold(catalog);
    std::vector<Ref> refs;
    for (const auto& [id, note] : catalog->notes) refs.push_back(Ref::note(id));
    for (const Clip& clip : catalog->clips) refs.push_back(Ref::film(clip.index));
    for (const Work& work : catalog->works) refs.push_back(Ref::work(work.index));
    struct Tally {
        int cards = 0, first = 0, later = 0;
    };
    std::map<std::string, Tally> tally;
    int failed = 0;
    for (const Ref& ref : refs) {
        std::optional<std::string> id = cards::ocean::cardOf(ref);
        if (!id) {
            printf("%-22s FAIL no card\n", ref.key().c_str());
            failed++;
            continue;
        }
        for (const std::string& src : cards::pictures(*id)) cards::picture(src, standIn(*catalog, src));
        cards::Opened o = *cards::ocean::opened(*id);
        std::string kind = cards::kindOf(*id)->name;
        std::optional<int> at;
        for (size_t p = 0; p < o.pages.size(); p++) {
            if (o.pages[p].picture) at = int(p);
        }
        Tally& t = tally[kind];
        t.cards++;
        t.first += at == 0;
        t.later += at > 0;
        std::vector<std::string> wrong;
        if (o.cut) wrong.push_back("a part cut between pages");
        if (ref.kind == Ref::Kind::film && at) {
            while (cards::ocean::page(*id) != *at) cards::ocean::turn(*id);
            CGRect plays = *cards::ocean::layout(*id)->picture;
            CGRect poster = cards::contained(*o.pages[size_t(*at)].picture, *cards::aspectOf(cards::pictures(*id).front()));
            float off = std::max({std::fabs(plays.minX() - poster.minX()), std::fabs(plays.maxX() - poster.maxX()), std::fabs(plays.minY() - poster.minY()),
                                  std::fabs(plays.maxY() - poster.maxY())});
            if (off > 1) wrong.push_back(fmt("plays %.1f px off its poster", off));
        }
        failed += !wrong.empty();
        if (!wrong.empty() || at > 0) {
            std::string said = at ? fmt("picture on page %d", *at + 1) : "";
            for (const std::string& w : wrong) said += (said.empty() ? "FAIL " : ", FAIL ") + w;
            printf("%-22s %-8s %d pages, %s\n", id->c_str(), kind.c_str(), int(o.pages.size()), said.c_str());
        }
    }
    for (const auto& [kind, t] : tally) printf("%-8s %4d cards, picture on the first page %d, on a later one %d\n", kind.c_str(), t.cards, t.first, t.later);
    printf("%d pieces, %d failing\n", int(refs.size()), failed);
    return failed ? 1 : 0;
}
