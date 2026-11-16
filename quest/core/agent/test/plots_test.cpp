#include "support.h"

#include "agent/plots.h"

using namespace agent;

TEST(treePlotsComeBackNextLaunchForEachService) {
    ShelfPlots saved;
    saved.services["http://127.0.0.1:8787"] = {{"t-lenses", Vec2{-0.9f, 1.6f}}, {"t-jaws", Vec2{1.25f, 2.4f}}};
    saved.services["http://127.0.0.1:8799"] = {{"t-other", Vec2{0.2f, 3}}};
    ShelfPlots read = ShelfPlots::parse(saved.text());
    CHECK_EQ(read.services.size(), size_t(2));
    const Plots& home = read.services["http://127.0.0.1:8787"];
    CHECK(home.size() == 2 && home.at("t-lenses").x == -0.9f && home.at("t-lenses").y == 1.6f, "the lenses tree stands where it stood");
    CHECK(home.count("t-jaws") && home.at("t-jaws").x == 1.25f && home.at("t-jaws").y == 2.4f, "and Jaws");
    CHECK(read.services["http://127.0.0.1:8799"].count("t-other"), "another service's plot is kept apart");
}

TEST(aPlotThatCantBeReadIsForgottenAndTheRestKept) {
    ShelfPlots read = ShelfPlots::parse(R"({"version":2,"services":{"s":{"ok":[1,2],"short":[1],"words":"left","named":["a",2]}}})");
    CHECK(read.services["s"].size() == 1 && read.services["s"].count("ok"), "only the plot of two numbers is read");
    CHECK(ShelfPlots::parse("not json").services.empty(), "a file that is not JSON remembers nothing");
    CHECK(ShelfPlots::parse(R"({"version":1,"services":{"s":{"ok":[-39,24]}}})").services.empty(), "nor the old file of shelf places");
    CHECK(ShelfPlots::parse("").services.empty(), "nor no file");
}
