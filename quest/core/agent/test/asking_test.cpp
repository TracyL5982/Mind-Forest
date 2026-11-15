#include "support.h"

#include "agent/asking.h"

using namespace agent;

TEST(aRowPickedAgainWhileItsSearchRunsIsAskedOnce) {
    Asking asking;
    const std::string row = "Compare this pen version to wall drawings";
    CHECK(asking.begin("n-pen", row, 10.0), "the first pick is asked");
    CHECK(!asking.begin("n-pen", row, 10.7) && !asking.begin("n-pen", row, 11.9), "the next two, within 2 s, are not");
    CHECK(asking.begin("n-pen", "Who drew on walls first?", 11.0), "another question about the card is asked");
    CHECK(asking.begin("n-wall", row, 11.0), "the same words about another card are asked");
}

TEST(aRowCanBeAskedAgainOnceItsSearchEndsOrAMinutePasses) {
    Asking asking;
    const std::string row = "Compare this pen version to wall drawings";
    asking.begin("n-pen", row, 10.0);
    asking.begin("n-wall", row, 10.0);
    asking.searching("a-pen", "n-pen", row);
    asking.searching("a-wall", "n-wall", row);
    asking.ended("a-pen");
    CHECK(asking.begin("n-pen", row, 14.0), "once the service is done with the row's search, the row asks again");
    CHECK(!asking.begin("n-wall", row, 14.0), "another card's search still runs");
    CHECK(asking.begin("n-wall", row, 10.0 + Asking::within), "a search the service never ends holds the row a minute");
}

TEST(anotherSearchOnTheCardEndingLeavesTheRowInFlight) {
    Asking asking;
    const std::string row = "Compare this pen version to wall drawings";
    asking.searching("a-earlier", "n-pen", "Who drew on walls first?");
    asking.begin("n-pen", row, 10.0);
    asking.searching("a-row", "n-pen", row);
    asking.ended("a-round");
    asking.ended("a-earlier");
    CHECK(!asking.begin("n-pen", row, 11.0), "the tree's first round and an earlier question ending do not free the row");
    asking.ended("a-row");
    CHECK(asking.begin("n-pen", row, 12.0), "its own search ending does");
}
