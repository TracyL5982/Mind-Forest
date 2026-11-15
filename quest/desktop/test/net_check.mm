// Checks platform.h's network on the Mac against a running service: tools/agent-net-check.sh starts one.
//   net_check <http base> <token>
#import <Foundation/Foundation.h>

#include <condition_variable>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <mutex>
#include <string>
#include <vector>

#include "platform.h"

static std::mutex lock;
static std::condition_variable changed;
static std::vector<std::string> seen;
static int failures = 0;

static void note(const std::string& what) {
    std::lock_guard<std::mutex> g(lock);
    seen.push_back(what);
    changed.notify_all();
}

static bool waitFor(const std::string& prefix, double seconds) {
    std::unique_lock<std::mutex> g(lock);
    return changed.wait_for(g, std::chrono::milliseconds(int(seconds * 1000)), [&] {
        for (const auto& s : seen) if (s.rfind(prefix, 0) == 0) return true;
        return false;
    });
}

static void check(bool ok, const std::string& what) {
    std::printf("%s  %s\n", ok ? "ok  " : "FAIL", what.c_str());
    if (!ok) failures++;
}

static platform::Response fetchNow(platform::Request r) {
    std::mutex m;
    std::condition_variable cv;
    bool done = false;
    platform::Response out;
    platform::fetch(r, [&](platform::Response got) {
        std::lock_guard<std::mutex> g(m);
        out = got;
        done = true;
        cv.notify_all();
    });
    std::unique_lock<std::mutex> g(m);
    cv.wait_for(g, std::chrono::seconds(15), [&] { return done; });
    return out;
}

int main(int argc, char** argv) {
    if (argc < 3) return 2;
    std::string base = argv[1], token = argv[2];
    std::string ws = "ws" + base.substr(4) + "/ws?token=" + token;

    platform::Response health = fetchNow({"GET", base + "/api/health"});
    check(health.status == 200 && health.body.find("\"ok\":true") != std::string::npos, "GET /api/health answers");
    platform::Response refused = fetchNow({"GET", base + "/api/state"});
    check(refused.status == 401, "a request without the key is refused (" + std::to_string(refused.status) + ")");

    platform::Request upload{"POST", base + "/api/assets?name=dot.txt", {{"Authorization", "Bearer " + token}, {"Content-Type", "text/plain"}}, "a dot"};
    platform::Response made = fetchNow(upload);
    check(made.status == 200 && made.body.find("\"url\"") != std::string::npos, "POST uploads a file");
    std::string assetUrl = made.body.substr(made.body.find("/assets/"), made.body.find('"', made.body.find("/assets/")) - made.body.find("/assets/"));
    std::string file = std::string(NSTemporaryDirectory().UTF8String) + "net_check_asset.txt";
    platform::Request get{"GET", base + assetUrl + "?token=" + token};
    get.saveTo = file;
    platform::Response saved = fetchNow(get);
    std::ifstream in(file);
    std::stringstream back;
    back << in.rdbuf();
    check(saved.status == 200 && back.str() == "a dot", "GET with saveTo writes the file");

    auto socket = platform::openSocket(ws, {
        [] { note("opened"); },
        [](const std::string& text) { note("text " + text.substr(0, 40)); },
        [](const std::string& why) { note("closed " + why); },
    });
    check(waitFor("opened", 5), "the socket opens");
    check(waitFor("text {\"t\":\"hello\"", 5), "the first message is hello");
    check(socket->send("{\"t\":\"dump\",\"dumps\":[{\"kind\":\"text\",\"text\":\"a thought from the net check\"}]}"), "a dump is sent");
    check(waitFor("text {\"t\":\"change\"", 10), "a change comes back");
    if (argc > 3 && std::string(argv[3]) == "--expect-drop") {
        check(waitFor("closed", 30), "a service that stops is noticed as closed");
        std::printf("%s\n", failures ? "FAILED" : "all passed");
        return failures ? 1 : 0;
    }
    socket->close();
    check(waitFor("closed", 5), "closing reports closed once");
    {
        std::lock_guard<std::mutex> g(lock);
        int closes = 0;
        for (const auto& s : seen) closes += s.rfind("closed", 0) == 0;
        check(closes == 1, "closed was said exactly once (" + std::to_string(closes) + ")");
    }
    std::printf("%s\n", failures ? "FAILED" : "all passed");
    return failures ? 1 : 0;
}
