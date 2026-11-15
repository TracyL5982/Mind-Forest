#include "support.h"

#include "agent/connection.h"

using namespace agent;

namespace {

using Arguments = std::vector<std::string>;

bool holds(const Arguments& arguments, const Arguments& run) {
    return std::search(arguments.begin(), arguments.end(), run.begin(), run.end()) != arguments.end();
}

}  // namespace

TEST(aLaunchFromTheLibraryJoinsTheServiceTheAppWasLastStartedWith) {
    Launch joined = launch({"-agent", "ws://127.0.0.1:8787", "-agentToken", "s3cret-token", "-cards", "-fps"}, std::nullopt);
    CHECK(joined.file == Launch::File::save, "a launch with -agent is remembered");
    Launch library = launch({}, joined.text);
    CHECK(library.file == Launch::File::keep, "the file stays");
    CHECK(holds(library.arguments, {"-agent", "ws://127.0.0.1:8787"}) && holds(library.arguments, {"-agentToken", "s3cret-token"}) &&
              holds(library.arguments, {"-cards"}),
          "it joins as agent.sh started it, with the cards");
    CHECK(!holds(library.arguments, {"-fps"}), "the other flags were that run's alone");
    for (const Launch& l : {joined, library}) CHECK(l.said.find("s3cret") == std::string::npos, "the log line \"%s\" holds no token", l.said.c_str());
}

TEST(aLaunchWithOtherFlagsButNoAgentStillJoins) {
    Launch joined = launch({"-agent", "ws://127.0.0.1:8787", "-agentToken", "tok"}, std::nullopt);
    Launch demo = launch({"-demo", "-cards"}, joined.text);
    CHECK(holds(demo.arguments, {"-demo"}) && holds(demo.arguments, {"-agent", "ws://127.0.0.1:8787"}), "its own flags and the connection");
    CHECK(std::count(demo.arguments.begin(), demo.arguments.end(), "-cards") == 1, "-cards given is not given twice");
    CHECK(!holds(launch({}, joined.text).arguments, {"-cards"}), "a connection remembered without -cards brings none");
}

TEST(forgottenTheAppStartsAsItWas) {
    Launch joined = launch({"-agent", "ws://127.0.0.1:8787", "-agentToken", "tok", "-cards"}, std::nullopt);
    Launch forget = launch({"-agentForget"}, joined.text);
    CHECK(forget.file == Launch::File::forget, "-agentForget forgets it");
    CHECK(!holds(forget.arguments, {"-agent"}), "and that launch does not join");
    Launch once = launch({"-agentForget", "-agent", "ws://10.0.0.2:8787"}, joined.text);
    CHECK(once.file == Launch::File::forget && holds(once.arguments, {"-agent", "ws://10.0.0.2:8787"}), "given -agent too, it joins this once");
    Launch next = launch({}, std::nullopt);
    CHECK(next.arguments.empty() && next.file == Launch::File::keep && next.said.empty(), "with nothing remembered nothing is added");
}

TEST(aRememberedFileThatCantBeReadIsLeftAlone) {
    for (const char* text : {"", "not json", R"({"agent":""})", R"({"token":"tok"})", R"([1,2])"}) {
        Launch l = launch({"-demo"}, std::string(text));
        CHECK(l.arguments == Arguments{"-demo"} && l.file == Launch::File::keep, "\"%s\" adds nothing", text);
    }
}
