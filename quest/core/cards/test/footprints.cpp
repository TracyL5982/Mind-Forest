// Checks every card type this library draws against the web client's own footprints:
// agents/test/footprints.json, which `npm test` holds the web client to. Each sample's size, and the
// chips its card draws with each one's box, must come out the same, to the px.
//   quest/core/cards/test/run.sh <path to agents/test/footprints.json>
#include <cstdio>
#include <fstream>
#include <map>
#include <sstream>
#include <string>

#include "../cards.h"

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
        int samples = 0, sizes = 0, chips = 0, chipSamples = 0;
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
        int w = sample["size"][0].integer(), h = sample["size"][1].integer();
        if (got.width == w && got.height == h) {
            t.sizes++;
        } else {
            failed++;
            fprintf(stderr, "%s: %d by %d, the web gives %d by %d: %s\n", type.c_str(), got.width, got.height, w, h, sample["item"].dump().c_str());
        }
        if (!sample.has("chips")) continue;
        t.chipSamples++;
        std::vector<cards::Chip> line = cards::chipsOf(view, sample["item"]);
        const std::vector<Json>& want = sample["chips"].array();
        bool same = line.size() == want.size();
        for (size_t i = 0; same && i < line.size(); i++) {
            same = want[i]["kind"].string("") == cards::name(line[i].kind) && want[i]["text"].string("") == line[i].text &&
                   want[i]["width"].integer() == line[i].width && want[i]["count"].integer() == line[i].count;
        }
        if (same) {
            t.chips++;
        } else {
            failed++;
            std::string mine;
            for (const cards::Chip& c : line) mine += std::string(cards::name(c.kind)) + " '" + c.text + "' " + std::to_string(c.width) + "  ";
            fprintf(stderr, "%s chips: %s, the web gives %s\n", type.c_str(), mine.c_str(), sample["chips"].dump().c_str());
        }
    }
    for (const auto& [type, t] : drawn) {
        printf("%-12s sizes %d/%d  chips %d/%d\n", type.c_str(), t.sizes, t.samples, t.chips, t.chipSamples);
    }
    std::string rest;
    for (const auto& [type, t] : skipped) rest += type + " ";
    printf("not drawn yet: %s\n", rest.c_str());
    printf(failed ? "FAIL: %d differ\n" : "PASS\n", failed);
    return failed ? 1 : 0;
}
