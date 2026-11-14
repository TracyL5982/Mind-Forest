// What the agent core's tests share: small checks (a failure prints where and why, and the run goes
// on), the fixtures record.mjs made from the scripted service, and every outbound message with the
// exact JSON the service must be sent.
#pragma once
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "../../base.h"
#include "../client.h"

namespace check {

struct Test {
    const char* name;
    void (*run)();
};
inline std::vector<Test>& all() {
    static std::vector<Test> tests;
    return tests;
}
inline int& failures() {
    static int n = 0;
    return n;
}
struct Add {
    Add(const char* name, void (*run)()) { all().push_back({name, run}); }
};
inline void fail(const char* file, int line, const std::string& what) {
    failures()++;
    std::fprintf(stderr, "    FAILED %s:%d: %s\n", std::filesystem::path(file).filename().c_str(), line, what.c_str());
}
template <class T>
std::string show(const T& value) {
    std::ostringstream out;
    out << value;
    return out.str();
}

}  // namespace check

#define TEST(name)                                     \
    static void name();                                \
    static check::Add name##Added(#name, name);        \
    static void name()
#define CHECK(condition, ...)                                                                          \
    do {                                                                                               \
        if (!(condition)) check::fail(__FILE__, __LINE__, std::string(#condition) + ": " + fmt(__VA_ARGS__)); \
    } while (0)
#define CHECK_EQ(actual, expected)                                                                     \
    do {                                                                                               \
        const auto actual_ = (actual);                                                                \
        const auto expected_ = (expected);                                                            \
        if (!(actual_ == expected_)) {                                                                 \
            check::fail(__FILE__, __LINE__,                                                            \
                        std::string(#actual) + " is " + check::show(actual_) + ", expected " + check::show(expected_)); \
        }                                                                                              \
    } while (0)

/// A file under fixtures/.
inline std::string fixture(const std::string& name) {
    std::ifstream in(std::filesystem::path(__FILE__).parent_path() / "fixtures" / name);
    std::stringstream text;
    text << in.rdbuf();
    if (text.str().empty()) std::fprintf(stderr, "    no fixture %s\n", name.c_str());
    return text.str();
}

inline std::vector<std::string> lines(const std::string& text) {
    std::vector<std::string> out;
    std::istringstream in(text);
    for (std::string line; std::getline(in, line);) {
        if (!line.empty()) out.push_back(line);
    }
    return out;
}

/// The recorded session: the first connection's messages, as sent.
inline std::vector<std::string> sessionTexts() { return lines(fixture("session.jsonl")); }

/// The hello of a second connection, made after the session: the state the session came to.
inline agent::Hello finalHello() { return std::get<agent::Hello>(agent::parseInbound(fixture("hello.json"))); }

/// The session's change messages, in order.
inline std::vector<agent::Change> sessionChanges() {
    std::vector<agent::Change> out;
    for (const std::string& text : sessionTexts()) {
        agent::Inbound message = agent::parseInbound(text);
        if (auto* change = std::get_if<agent::Change>(&message)) out.push_back(std::move(*change));
    }
    return out;
}

inline agent::Hello firstHello() { return std::get<agent::Hello>(agent::parseInbound(sessionTexts().front())); }

/// A message's `t`, read straight from its text.
inline std::string tOf(const std::string& text) { return Json::parse(text).value_or(Json())["t"].string(""); }

/// The text of the session's change message whose set has this label (the first, if several have it).
inline std::string recordedText(const std::string& label) {
    for (const std::string& text : sessionTexts()) {
        if (Json::parse(text).value_or(Json())["set"]["label"].string("") == label) return text;
    }
    std::fprintf(stderr, "    no recorded change set \"%s\"\n", label.c_str());
    return {};
}

/// The session's change set with this label (the first, if several have it).
inline agent::ChangeSet recordedSet(const std::string& label) {
    for (agent::Change& change : sessionChanges()) {
        if (change.set.label == label) return change.set;
    }
    std::fprintf(stderr, "    no recorded change set \"%s\"\n", label.c_str());
    return {};
}

template <class E>
std::map<agent::IdOf<E>, E> keyed(const std::vector<E>& list) {
    std::map<agent::IdOf<E>, E> out;
    for (const E& e : list) out.insert_or_assign(e.id, e);
    return out;
}

/// Every outbound message the client can build, with the JSON the service is sent.
std::vector<std::pair<agent::Outbound, std::string>> outboundCases();
