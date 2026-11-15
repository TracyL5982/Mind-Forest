// The agents at work, as their lines above Momo's words tell them: one line per agent with a step going, saying its
// newest step, then "finished working" for 3 s once its last step ends.
#include "support.h"

#include "../crew.h"

using namespace agent;

namespace {

Activity began(const std::string& id, const std::string& role, const std::string& label) {
    Activity a;
    a.id = id;
    a.role = role;
    a.state = Activity::State::start;
    a.message = label;
    a.label = label;
    return a;
}

Activity ended(const std::string& id, const std::string& role, Activity::State how = Activity::State::done) {
    Activity a;
    a.id = id;
    a.role = role;
    a.state = how;
    return a;
}

std::string said(const Crew& c) {
    std::string out;
    for (const AgentLine& l : c.lines("Momo")) out += (out.empty() ? "" : " | ") + l.name + " · " + (l.finished ? "finished working" : l.step);
    return out;
}

}  // namespace

TEST(aLineAppearsWhenItsAgentStartsAndAnIdleAgentHasNone) {
    Crew c;
    CHECK(c.lines("Momo").empty() && !c.working(), "no one at work, no lines");
    c.activity(ended("x", "scout"), 0);
    CHECK(c.lines("Momo").empty(), "a step ending that was never seen begin brings no line");
    c.activity(began("m1", "momo", "Searching the web for the Booker winner"), 1);
    c.activity(began("s1", "scout", "Searching museum collections for dancing people"), 2);
    CHECK_EQ(said(c), std::string("Momo (librarian) · Searching the web for the Booker winner | Scout · Searching museum collections for dancing people"));
    CHECK(c.working(), "at work");
}

TEST(aLineSaysItsNewestStepStillGoing) {
    Crew c;
    c.activity(began("s1", "scout", "Looking into dancing people"), 0);
    c.activity(began("s2", "scout", "Searching museum collections for dancing people"), 1);
    c.activity(began("s3", "scout", "Fetching 8 pictures from Are.na"), 2);
    CHECK_EQ(said(c), std::string("Scout · Fetching 8 pictures from Are.na"));
    c.activity(ended("s3", "scout"), 3);
    CHECK_EQ(said(c), std::string("Scout · Searching museum collections for dancing people"));
    c.activity(ended("s2", "scout", Activity::State::error), 4);
    CHECK_EQ(said(c), std::string("Scout · Looking into dancing people"));
}

TEST(anAgentDoneReadsFinishedWorkingForThreeSecondsThenGoes) {
    Crew c;
    c.activity(began("r1", "renderer", "Laying out 2 cards"), 10);
    c.activity(ended("r1", "renderer"), 12);
    c.update(12);
    CHECK_EQ(said(c), std::string("Renderer · finished working"));
    CHECK(!c.working(), "finished is not working: the monocle comes off");
    c.update(12 + Crew::finishedFor - 0.05);
    CHECK_EQ(said(c), std::string("Renderer · finished working"));
    c.update(12 + Crew::finishedFor);
    CHECK_EQ(said(c), std::string(""));
}

TEST(anAgentThatStartsAgainWhileFinishedKeepsItsPlace) {
    Crew c;
    c.activity(began("s1", "scout", "Looking into dancing people"), 0);
    c.activity(began("r1", "renderer", "Laying out 2 cards"), 1);
    c.activity(ended("s1", "scout"), 2);
    c.activity(began("s2", "scout", "Finding more for dancing people"), 3);
    c.update(6);
    CHECK_EQ(said(c), std::string("Scout · Finding more for dancing people | Renderer · Laying out 2 cards"));
}

TEST(aPictureStillBeingMadeKeepsTheScoutsLineAndTheMonocle) {
    Crew c;
    c.activity(began("run", "scout", "Looking into dancing people"), 0);
    c.activity(began("pic", "scout", "Making a picture of Night stairs"), 5);
    c.activity(ended("run", "scout"), 8);
    c.update(30);
    CHECK_EQ(said(c), std::string("Scout · Making a picture of Night stairs"));
    CHECK(c.working(), "still at work, 22 s after the run's other steps ended");
    c.activity(ended("pic", "scout"), 31);
    c.update(31);
    CHECK_EQ(said(c), std::string("Scout · finished working"));
}

TEST(momoIsTheLibrarianAndEveryOtherAgentGoesByItsRole) {
    CHECK_EQ(agentName("momo", "Momo"), std::string("Momo (librarian)"));
    const char* roles[][2] = {{"scout", "Scout"},       {"renderer", "Renderer"},   {"filer", "Filer"},
                              {"intake", "Intake"},     {"organizer", "Organizer"}, {"packager", "Packager"},
                              {"archivist", "Archivist"}, {"conductor", "Conductor"}};
    for (auto& r : roles) CHECK_EQ(agentName(r[0], "Momo"), std::string(r[1]));
    Activity a = began("x", "scout", "");
    a.label.reset();
    a.message = "Reading three articles about the dolly zoom in Vertigo";
    CHECK_EQ(stepOf(a), std::string("Reading three articles about the dolly…"));
}
