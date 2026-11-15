#include "support.h"

#include "agent/spots.h"

using namespace agent;

TEST(coverSpotsComeBackNextLaunchForEachService) {
    ShelfSpots saved;
    saved.services["http://127.0.0.1:8787"] = {{"t-lenses", Vec2{-40, 24}}, {"t-jaws", Vec2{12.5f, 38}}};
    saved.services["http://127.0.0.1:8799"] = {{"t-other", Vec2{20, 30}}};
    ShelfSpots read = ShelfSpots::parse(saved.text());
    CHECK_EQ(read.services.size(), size_t(2));
    const Spots& home = read.services["http://127.0.0.1:8787"];
    CHECK(home.size() == 2 && home.at("t-lenses").x == -40 && home.at("t-lenses").y == 24, "the lenses tree hangs where it hung");
    CHECK(home.count("t-jaws") && home.at("t-jaws").x == 12.5f && home.at("t-jaws").y == 38, "and Jaws");
    CHECK(read.services["http://127.0.0.1:8799"].count("t-other"), "another service's spot is kept apart");
}

TEST(aSpotThatCantBeReadIsForgottenAndTheRestKept) {
    ShelfSpots read = ShelfSpots::parse(R"({"version":1,"services":{"s":{"ok":[1,2],"short":[1],"words":"left","named":["a",2]}}})");
    CHECK(read.services["s"].size() == 1 && read.services["s"].count("ok"), "only the spot of two numbers is read");
    CHECK(ShelfSpots::parse("not json").services.empty(), "a file that is not JSON remembers nothing");
    CHECK(ShelfSpots::parse(R"({"version":2,"services":{"s":{"ok":[1,2]}}})").services.empty(), "nor a file of another version");
    CHECK(ShelfSpots::parse("").services.empty(), "nor no file");
}
