#include "support.h"

#include "agent/connection.h"
#include "platform.h"

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

TEST(aTokenThatStartsWithADashIsStillTheToken) {
    // The service's tokens are random base64url, so about one in eighty starts with a dash and a letter.
    std::map<std::string, std::string> flags = Flags::parse({"-agent", "ws://127.0.0.1:8787", "-agentToken", "-Kq3xZ_token", "-cards"});
    CHECK_EQ(flags["agentToken"], std::string("-Kq3xZ_token"));
    CHECK(flags.count("cards") && !flags.count("Kq3xZ_token"), "the token is not read as a flag, and the flag after it still is");
    Launch joined = launch({"-agent", "ws://127.0.0.1:8787", "-agentToken", "-Kq3xZ_token", "-cards"}, std::nullopt);
    Launch library = launch({}, joined.text);
    CHECK(holds(library.arguments, {"-agentToken", "-Kq3xZ_token"}), "it is remembered and given back as the token");
    CHECK(Flags::parse(library.arguments)["agentToken"] == "-Kq3xZ_token", "and read back as the token");
    CHECK(Flags::parse({"-walk", "-demo"})["walk"].empty() && Flags::parse({"-walk", "-demo"}).count("demo"), "a flag that takes no word is followed by the next flag, as before");
}

TEST(aBuildWithItsOwnServiceJoinsItWithNoFlags) {
    BuiltIn judging{"https://mind-palace-judging.fly.dev", "app-key-1"};
    Launch library = launch({}, std::nullopt, judging);
    CHECK(holds(library.arguments, {"-agent", "https://mind-palace-judging.fly.dev"}) && holds(library.arguments, {"-agentToken", "app-key-1"}) &&
              holds(library.arguments, {"-cards"}),
          "opened from the app library it joins its own service, with the cards");
    CHECK(library.file == Launch::File::keep && library.said.find("app-key") == std::string::npos, "nothing is written, and the key is not logged");
    std::optional<Address> address = Address::parse(Flags::parse(library.arguments)["agent"], Flags::parse(library.arguments)["agentToken"], "0123456789abcdef0123456789abcdef");
    CHECK(address, "the built-in address reads");
    if (address) {
        CHECK_EQ(address->socket, "wss://mind-palace-judging.fly.dev/ws?token=app-key-1&device=0123456789abcdef0123456789abcdef");
        CHECK_EQ(address->http, "https://mind-palace-judging.fly.dev");
    }
    Launch remembered = launch({}, R"({"agent":"ws://127.0.0.1:8787","token":"dev","cards":true})", judging);
    CHECK(holds(remembered.arguments, {"-agent", "https://mind-palace-judging.fly.dev"}) && !holds(remembered.arguments, {"-agent", "ws://127.0.0.1:8787"}),
          "a connection left by a developer launch is not used");
}

TEST(aBuildWithItsOwnServiceJoinsAGivenOneOnlyThatOnce) {
    BuiltIn judging{"https://mind-palace-judging.fly.dev", "app-key-1"};
    Launch once = launch({"-agent", "ws://127.0.0.1:8787", "-agentToken", "local"}, std::nullopt, judging);
    CHECK(holds(once.arguments, {"-agent", "ws://127.0.0.1:8787"}) && !holds(once.arguments, {"-agent", "https://mind-palace-judging.fly.dev"}), "the given one");
    CHECK(once.file == Launch::File::keep, "and it is not remembered");
    CHECK(holds(launch({}, std::nullopt, judging).arguments, {"-agent", "https://mind-palace-judging.fly.dev"}), "the next launch joins its own again");
}

TEST(theDeviceIdIsMadeOnceAndKept) {
    std::filesystem::path dir = std::filesystem::temp_directory_path() / "mind-palace-device-test";
    std::filesystem::remove_all(dir);
    std::filesystem::create_directories(dir);
    std::string file = (dir / "device-id").string();
    std::string first = deviceId(file);
    CHECK(first.size() == 32 && first.find_first_not_of("0123456789abcdef") == std::string::npos, "32 hex digits: %s", first.c_str());
    CHECK_EQ(platform::readFile(file).value_or(""), first);
    CHECK_EQ(deviceId(file), first);
    CHECK_EQ(deviceId(file), first);
    std::string other = (dir / "another-headset").string();
    CHECK(deviceId(other) != first, "another headset makes its own");
    std::ofstream(file, std::ios::binary) << "not an id\n";
    std::string remade = deviceId(file);
    CHECK(remade != first && remade.size() == 32 && deviceId(file) == remade, "a file that holds no id gets a new one, kept from then on");
    std::filesystem::remove_all(dir);
}
