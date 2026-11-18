#include "support.h"

#include <atomic>
#include <thread>

using namespace agent;

namespace {

/// A socket that keeps what it was sent, and says `closed` when closed, as the hosts' sockets do.
struct FakeSocket : Socket {
    std::string url;
    SocketEvents events;
    std::vector<std::string> sent;
    bool closed = false;

    bool send(const std::string& text) override {
        if (closed) return false;
        sent.push_back(text);
        return true;
    }
    void close() override {
        if (closed) return;
        closed = true;
        events.closed("closed by the client");
    }
};

struct FakeTransport : Transport {
    std::vector<std::shared_ptr<FakeSocket>> sockets;
    std::shared_ptr<Socket> open(const std::string& url, SocketEvents events) override {
        auto socket = std::make_shared<FakeSocket>();
        socket->url = url;
        socket->events = std::move(events);
        sockets.push_back(socket);
        return socket;
    }
};

Address address() { return *Address::parse("127.0.0.1:8790", "tok"); }

std::string kindOf(const Event& event) {
    return std::visit(overloaded{
                          [](const Synced&) { return std::string("hello"); },
                          [](const Changed&) { return std::string("change"); },
                          [](const Activity&) { return std::string("activity"); },
                          [](const Say&) { return std::string("say"); },
                          [](const Heard&) { return std::string("heard"); },
                          [](const Navigate&) { return std::string("navigate"); },
                          [](const Handoff&) { return std::string("handoff"); },
                          [](const SettingsChanged&) { return std::string("settings"); },
                          [](const Note&) { return std::string("note"); },
                          [](const Questions&) { return std::string("questions"); },
                          [](const Rejected&) { return std::string("error"); },
                          [](const Shared&) { return std::string("shared"); },
                      },
                      event);
}

bool sameState(const Mirror& mirror, const Snapshot& snapshot) {
    return mirror.items() == keyed(snapshot.items) && mirror.nodes() == keyed(snapshot.nodes) && mirror.trees() == keyed(snapshot.trees) &&
           mirror.links() == keyed(snapshot.links) && mirror.groups() == keyed(snapshot.groups);
}

/// A client at `now` with its first socket open and the session's first hello applied.
struct Live {
    std::shared_ptr<FakeTransport> transport = std::make_shared<FakeTransport>();
    Client client{address(), transport};
    double now = 100;

    Live() {
        client.tick(now);
        socket().events.opened();
        socket().events.text(sessionTexts().front());
        client.drain();
    }
    FakeSocket& socket() { return *transport->sockets.back(); }
};

}  // namespace

TEST(addressFromEveryFlagForm) {
    struct Case {
        const char* flag;
        const char* socket;
        const char* http;
    };
    const Case cases[] = {
        {"ws://192.168.1.20:8787", "ws://192.168.1.20:8787/ws?token=tok", "http://192.168.1.20:8787"},
        {"wss://muse.example.ts.net", "wss://muse.example.ts.net/ws?token=tok", "https://muse.example.ts.net"},
        {"http://127.0.0.1:8787", "ws://127.0.0.1:8787/ws?token=tok", "http://127.0.0.1:8787"},
        {"https://agents.example.com", "wss://agents.example.com/ws?token=tok", "https://agents.example.com"},
        {"127.0.0.1:8787", "ws://127.0.0.1:8787/ws?token=tok", "http://127.0.0.1:8787"},
        {"localhost", "ws://localhost/ws?token=tok", "http://localhost"},
        {"  WS://Host:8787/ws?token=old#x \n", "ws://Host:8787/ws?token=tok", "http://Host:8787"},
        {"https://agents.example.com/", "wss://agents.example.com/ws?token=tok", "https://agents.example.com"},
        {"[::1]:8787", "ws://[::1]:8787/ws?token=tok", "http://[::1]:8787"},
    };
    for (const Case& c : cases) {
        std::optional<Address> a = Address::parse(c.flag, "tok");
        CHECK(a, "%s reads", c.flag);
        if (!a) continue;
        CHECK_EQ(a->socket, c.socket);
        CHECK_EQ(a->http, c.http);
        CHECK_EQ(a->token, "tok");
    }
    for (const char* bad : {"", "   ", "ftp://host:21", "ws://", "host:", "host:99999", "host:0", "host:80a", "me@host:8787", "::1:8787", "[]:80",
                            "[::1]8787", "two words:8787"}) {
        CHECK(!Address::parse(bad, "tok"), "\"%s\" is not an address", bad);
    }
    CHECK_EQ(Address::parse("h:1", "a+b/c=")->socket, "ws://h:1/ws?token=a%2Bb%2Fc%3D");
}

TEST(addressResolvesServicePaths) {
    Address a = *Address::parse("192.168.1.20:8787", "tok");
    CHECK_EQ(a.resolve("/assets/a1"), "http://192.168.1.20:8787/assets/a1?token=tok");
    CHECK_EQ(a.resolve("/api/speak?text=hi"), "http://192.168.1.20:8787/api/speak?text=hi&token=tok");
    CHECK_EQ(a.resolve("assets/a1"), "http://192.168.1.20:8787/assets/a1?token=tok");
    CHECK_EQ(a.resolve("https://example.com/x.jpg"), "https://example.com/x.jpg");
    CHECK_EQ(queryEscape("hello world, \xC3\xBC~-._"), "hello%20world%2C%20%C3%BC~-._");
}

TEST(theFirstTickConnects) {
    auto transport = std::make_shared<FakeTransport>();
    Client client(address(), transport);
    CHECK(client.state() == Client::State::waiting && transport->sockets.empty(), "nothing before the first tick");
    client.tick(100);
    CHECK_EQ(transport->sockets.size(), size_t(1));
    CHECK_EQ(transport->sockets.at(0)->url, "ws://127.0.0.1:8790/ws?token=tok");
    CHECK(client.state() == Client::State::connecting, "connecting");
    transport->sockets[0]->events.opened();
    client.drain();
    CHECK(client.state() == Client::State::connecting, "still connecting once open: live means a hello is in");
}

TEST(failuresWait1_2_4_8ThenAlways15) {
    auto transport = std::make_shared<FakeTransport>();
    Client client(address(), transport);
    double now = 100;
    client.tick(now);
    for (double wait : {1.0, 2.0, 4.0, 8.0, 15.0, 15.0, 15.0}) {
        size_t opened = transport->sockets.size();
        transport->sockets.back()->events.closed("refused");
        client.drain();
        CHECK(client.state() == Client::State::waiting, "waiting after a refusal");
        client.tick(now + wait - 0.01);
        CHECK_EQ(transport->sockets.size(), opened);
        client.tick(now + wait);
        CHECK(transport->sockets.size() == opened + 1, "tries again %g s later", wait);
        now += wait;
    }

    transport->sockets.back()->events.text(fixture("hello.json"));
    client.drain();
    CHECK(client.state() == Client::State::live, "live after hello");
    transport->sockets.back()->events.closed("the service stopped");
    client.drain();
    size_t opened = transport->sockets.size();
    client.tick(now + 0.99);
    CHECK_EQ(transport->sockets.size(), opened);
    client.tick(now + 1);
    CHECK(transport->sockets.size() == opened + 1, "a connection that was live tries again after 1 s");
}

TEST(sendingOnlyWhileLive) {
    auto transport = std::make_shared<FakeTransport>();
    Client client(address(), transport);
    Outbound focus = Outbound::focus(NodeId{"n1"});
    CHECK(!client.send(focus), "not before connecting");
    client.tick(0);
    transport->sockets[0]->events.opened();
    client.drain();
    CHECK(!client.send(focus), "not while waiting for hello");
    transport->sockets[0]->events.text(fixture("hello.json"));
    client.drain();
    CHECK(client.send(focus), "live");
    CHECK(transport->sockets[0]->sent.size() == 1 && transport->sockets[0]->sent[0] == focus.text(), "the socket got it");
    transport->sockets[0]->events.closed("gone");
    client.drain();
    CHECK(!client.send(focus), "not once closed");
    CHECK_EQ(transport->sockets[0]->sent.size(), size_t(1));
}

TEST(theSessionArrivesAsEventsInOrder) {
    auto transport = std::make_shared<FakeTransport>();
    Client client(address(), transport);
    client.tick(0);
    std::vector<std::string> texts = sessionTexts();
    for (const std::string& text : texts) transport->sockets[0]->events.text(text);
    std::vector<Event> events = client.drain();
    CHECK_EQ(events.size(), texts.size());
    for (size_t i = 0; i < std::min(events.size(), texts.size()); i++) {
        CHECK_EQ(kindOf(events[i]), tOf(texts[i]));
    }
    CHECK(client.state() == Client::State::live, "live");
    CHECK(sameState(client.mirror(), finalHello().snapshot), "the mirror came to what a fresh hello holds");

    auto* synced = std::get_if<Synced>(&events.at(0));
    CHECK(synced && synced->delta.empty() && synced->settings.picksPerRun == 5, "the first hello, of an empty mindstorm");
    CHECK(synced && synced->share.empty(), "a service that names no way of sharing");
    int64_t last = 0;
    for (const Event& e : events) {
        if (auto* changed = std::get_if<Changed>(&e)) {
            CHECK(changed->set.seq > last, "seq %lld after %lld", (long long)changed->set.seq, (long long)last);
            CHECK(!changed->delta.empty(), "\"%s\" did something", changed->set.label.c_str());
            last = changed->set.seq;
        }
    }
}

TEST(aChangeKeepsWhetherThisConnectionAskedForIt) {
    Live live;
    Json asked = Json::parse(recordedText("Add \"Dolly zoom\"")).value_or(Json());
    live.socket().events.text(asked.set("yours", true).dump());
    std::vector<Event> events = live.client.drain();
    auto* changed = events.size() == 1 ? std::get_if<Changed>(&events[0]) : nullptr;
    CHECK(changed && changed->yours, "the change this connection asked for says so");
}

TEST(aGapReconnectsForAFreshHello) {
    Live live;
    FakeSocket& first = live.socket();
    first.events.text(recordedText("Add \"Dolly zoom\""));
    first.events.text(recordedText("Choose formats"));
    std::vector<Event> events = live.client.drain();
    CHECK(events.size() == 1 && std::get<Changed>(events[0]).set.label == "Add \"Dolly zoom\"",
          "the formats for picks that never came are not applied");
    CHECK(live.client.state() == Client::State::waiting, "the set after a missed one ends the connection");
    CHECK(first.closed, "the client closed the socket");

    live.client.tick(live.now + 1);
    CHECK_EQ(live.transport->sockets.size(), size_t(2));
    live.socket().events.text(fixture("hello.json"));
    events = live.client.drain();
    CHECK(live.client.state() == Client::State::live, "live again");
    CHECK(events.size() == 1 && std::holds_alternative<Synced>(events[0]), "a fresh hello");
    CHECK(sameState(live.client.mirror(), finalHello().snapshot), "the mirror is whole again");

    first.events.text(R"({"t":"say","text":"from the old socket"})");
    first.events.closed("late");
    events = live.client.drain();
    CHECK(events.empty() && live.client.state() == Client::State::live, "an old socket is not heard");
}

TEST(aChangeThatCantBeReadReconnects) {
    Live live;
    live.socket().events.text(R"({"t":"change","set":{"id":"s"}})");
    live.client.drain();
    CHECK(live.client.state() == Client::State::waiting && live.transport->sockets[0]->closed, "a change it can't read leaves the mirror behind");
}

TEST(unknownAndUnreadableMessagesAreSkipped) {
    Live live;
    for (const char* text : {R"({"t":"wave"})", "garbage", R"({"t":"say"})", R"({"t":"say","text":"next"})"}) live.socket().events.text(text);
    std::vector<Event> events = live.client.drain();
    CHECK(events.size() == 1 && std::holds_alternative<Say>(events[0]) && std::get<Say>(events[0]).text == "next", "only the say that reads");
    CHECK(live.client.state() == Client::State::live, "still live");
}

TEST(theQueueAcrossTwoThreads) {
    auto transport = std::make_shared<FakeTransport>();
    Client client(address(), transport);
    client.tick(0);
    SocketEvents events = transport->sockets[0]->events;
    std::vector<std::string> texts = sessionTexts();
    std::atomic<bool> done{false};
    std::thread host([&] {
        events.opened();
        for (const std::string& text : texts) {
            events.text(text);
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        done = true;
    });
    std::vector<Event> heard;
    int drainsWithEvents = 0;
    auto take = [&] {
        std::vector<Event> got = client.drain();
        drainsWithEvents += !got.empty();
        for (Event& e : got) heard.push_back(std::move(e));
    };
    for (double now = 0; !done; now += 0.016) {
        client.tick(now);
        take();
        std::this_thread::yield();
    }
    host.join();
    take();
    CHECK(drainsWithEvents > 1, "the frame thread drained while the host was still talking (%d drains)", drainsWithEvents);
    CHECK_EQ(heard.size(), texts.size());
    for (size_t i = 0; i < std::min(heard.size(), texts.size()); i++) CHECK_EQ(kindOf(heard[i]), tOf(texts[i]));
    CHECK(sameState(client.mirror(), finalHello().snapshot), "every change set applied, in order");
}

TEST(aClientCanGoWhileTheHostStillTalks) {
    auto transport = std::make_shared<FakeTransport>();
    SocketEvents events;
    {
        Client client(address(), transport);
        client.tick(0);
        events = transport->sockets[0]->events;
    }
    std::thread host([&] {
        for (const std::string& text : sessionTexts()) events.text(text);
        events.closed("late");
    });
    host.join();
    CHECK(transport->sockets[0]->closed, "the client closed its socket as it went");
}

TEST(aServiceThatCantBeReachedIsSaidSoUntilItIsJoined) {
    auto transport = std::make_shared<FakeTransport>();
    Client client(address(), transport);
    client.tick(0);
    CHECK(!client.unreachable(), "the first try is still going");
    transport->sockets.back()->events.closed("connection refused");
    client.drain();
    CHECK(client.unreachable() && client.state() == Client::State::waiting, "it failed, and waits to try again");
    client.tick(Client::retryDelays[0]);
    CHECK(client.unreachable() && client.state() == Client::State::connecting, "trying again, still unreachable");
    transport->sockets.back()->events.opened();
    client.drain();
    CHECK(client.unreachable(), "open but no hello yet");
    transport->sockets.back()->events.text(sessionTexts().front());
    client.drain();
    CHECK(!client.unreachable() && client.state() == Client::State::live, "joined");
    transport->sockets.back()->events.closed("the service restarted");
    client.drain();
    CHECK(client.unreachable(), "a live connection that drops is unreachable again until it comes back");
}
