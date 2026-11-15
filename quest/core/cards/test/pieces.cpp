// Checks every note, film and work of the ocean as the card `-cards` draws it (pieces.h), at the ocean's sizes
// and with a stand-in for each picture in the shape the scene hands it: each piece has a card, a film's poster
// shows whole in the opened card's first view, and the film plays where its poster is drawn, and not once the
// panel is scrolled off it. Prints, for each type, how many cards show their picture in the first view and
// how many scroll, then each card that fails.
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
        int cards = 0, pictured = 0, scrolls = 0;
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
        Tally& t = tally[kind];
        t.cards++;
        float most = cards::ocean::overflow(*id);
        t.scrolls += most > 0;
        std::vector<std::string> wrong;
        cards::ocean::scrollTo(*id, 0);
        std::optional<NoteLayout> top = cards::ocean::layout(*id);
        if (o.picture) {
            bool whole = o.picture->minY() >= o.window.minY() && o.picture->maxY() <= o.window.maxY();
            t.pictured += whole;
            // A film plays only on a poster whole in view; a still under a long title may need a scroll to be seen whole.
            if (!whole && ref.kind == Ref::Kind::film) wrong.push_back("its poster is not whole in the first view");
        }
        if (ref.kind == Ref::Kind::film && o.picture) {
            if (!(top && top->picture)) {
                wrong.push_back("no film in the first view");
            } else {
                CGRect plays = *top->picture;
                CGRect poster = cards::contained(*o.picture, *cards::aspectOf(cards::pictures(*id).front()));
                float off = std::max({std::fabs(plays.minX() - poster.minX()), std::fabs(plays.maxX() - poster.maxX()),
                                      std::fabs(plays.minY() - poster.minY()), std::fabs(plays.maxY() - poster.maxY())});
                if (off > 1) wrong.push_back(fmt("plays %.1f px off its poster", off));
            }
            if (most > 1) {
                cards::ocean::scrollTo(*id, most);
                if (cards::ocean::layout(*id)->picture) wrong.push_back("its film plays scrolled");
                cards::ocean::scrollTo(*id, 0);
            }
        }
        failed += !wrong.empty();
        if (!wrong.empty()) {
            std::string said;
            for (const std::string& w : wrong) said += (said.empty() ? "FAIL " : ", FAIL ") + w;
            printf("%-22s %-8s scrolls %4.0f px, %s\n", id->c_str(), kind.c_str(), double(most), said.c_str());
        }
    }
    for (const auto& [kind, t] : tally) printf("%-8s %4d cards, picture whole in the first view %d, scroll %d\n", kind.c_str(), t.cards, t.pictured, t.scrolls);
    printf("%d pieces, %d failing\n", int(refs.size()), failed);
    return failed ? 1 : 0;
}
