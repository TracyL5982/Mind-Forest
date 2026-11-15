// Checks every card type this library draws, on the web client's own samples (agents/test/footprints.json),
// against the sizing spec: each sample is 210 px wide, at most 146 px tall, and carries no chip line, since
// chips are listed on the opened card. It prints each type's tallest beside the tallest face derive.mjs
// works out for it (sizing/quest-card-sizing.md, section 6), which assumed shorter titles for some types
// than the two lines a face now gives a title first: a type may stand taller than that, never than 146 px.
// The web keeps its own sizes until it adopts the spec, so its golden sizes are not compared here; once it
// does, this goes back to matching them to the px.
//   quest/core/cards/test/run.sh <path to agents/test/footprints.json>
#include <cstdio>
#include <fstream>
#include <map>
#include <sstream>
#include <string>

#include "../cards.h"

namespace {

/// derive.mjs, section 6: the tallest face of each type, px, with the taller of the two cases its own limit
/// allows for quote (144), qa (132) and idea (142), and facts' value on two lines (146).
const std::map<std::string, int> TALLEST{
    {"note", 146},     {"quote", 144},      {"fact", 140},    {"image", 146},   {"video", 146},      {"audio", 146},     {"link", 146},
    {"chart", 146},    {"person", 140},     {"chat", 136},    {"code", 102},    {"steps", 134},      {"facts", 146},     {"table", 124},
    {"list", 140},     {"breakdown", 128},  {"qa", 132},      {"callout", 144}, {"excerpt", 146},    {"definition", 134}, {"idea", 142},
    {"proscons", 131}, {"swatch", 145},     {"artwork", 146}, {"reference", 134}, {"place", 146},    {"sheet", 146},     {"explorable", 126},
};

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: footprints <footprints.json>\n");
        return 2;
    }
    std::ifstream in(argv[1]);
    std::stringstream text;
    text << in.rdbuf();
    std::optional<Json> file = Json::parse(text.str());
    if (!file) {
        fprintf(stderr, "cannot read %s\n", argv[1]);
        return 2;
    }
    struct Tally {
        int samples = 0, held = 0, tallest = 0, web = 0;
    };
    std::map<std::string, Tally> drawn, skipped;
    int failed = 0;
    for (const Json& sample : (*file)["samples"].array()) {
        std::string type = sample["type"].string("");
        if (!cards::draws(type)) {
            skipped[type].samples++;
            continue;
        }
        Tally& t = drawn[type];
        t.samples++;
        Json view = Json::object();
        view.set("component", type);
        view.set("props", sample["props"]);
        cards::Footprint got = cards::footprint(view, sample["item"]);
        const int cap = 146;
        bool chips = !cards::chipsOf(view, sample["item"]).empty();
        t.tallest = std::max(t.tallest, got.height);
        t.web = std::max(t.web, sample["size"][1].integer());
        if (got.width == 210 && got.height <= cap && !chips) {
            t.held++;
        } else {
            failed++;
            fprintf(stderr, "%s: %d by %d, the spec allows 210 by %d%s: %s\n", type.c_str(), got.width, got.height, cap, chips ? ", and it has a chip line" : "",
                    sample["item"].dump().c_str());
        }
    }
    for (const auto& [type, t] : drawn) {
        auto most = TALLEST.find(type);
        printf("%-12s %d/%d within the spec, tallest %3d px (derive.mjs %3d, the web's today %3d)\n", type.c_str(), t.held, t.samples, t.tallest,
               most == TALLEST.end() ? 146 : most->second, t.web);
    }
    std::string rest;
    for (const auto& [type, t] : skipped) rest += type + " ";
    printf("not drawn yet: %s\n", rest.c_str());
    printf(failed ? "FAIL: %d over the spec\n" : "PASS\n", failed);
    return failed ? 1 : 0;
}
