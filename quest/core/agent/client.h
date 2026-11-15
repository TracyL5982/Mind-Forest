// The connection to the agent service: a state machine the frame thread drives through tick() and
// drain(). A host opens the socket (Transport). What the service says is parsed on the host's
// thread, handed over through a locked queue, and applied to the mirror on the frame thread.
#pragma once
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "mirror.h"
#include "protocol.h"

namespace agent {

/// Where the service is, from the `-agent` flag: ws://host:port, wss://host, http://host:port,
/// https://host or host:port. A path or query in the flag is ignored.
struct Address {
    /// The WebSocket, carrying the token: ws://host:port/ws?token=…
    std::string socket;
    /// The service for HTTP, with no trailing slash: http://host:port
    std::string http;
    std::string token;

    static std::optional<Address> parse(const std::string& flag, const std::string& token);
    /// A path on the service (/assets/<id>, /api/transcribe?tree=<id>) as a whole URL carrying the
    /// token. A URL that is already whole is returned as it is.
    std::string resolve(const std::string& path) const;
};

/// A query value made safe for a URL: `"/api/speak?text=" + queryEscape(reply)`.
std::string queryEscape(const std::string& value);

/// What a host's socket says, on any thread of the host's.
struct SocketEvents {
    std::function<void()> opened;
    std::function<void(const std::string& text)> text;
    /// Once, when it closes, could not open, or was closed.
    std::function<void(const std::string& why)> closed;
};

/// One WebSocket, as a host opened it.
class Socket {
public:
    virtual ~Socket() = default;
    /// Queues a text message. False once the socket has closed.
    virtual bool send(const std::string& text) = 0;
    virtual void close() = 0;
};

/// What a host gives the client: a way to open a WebSocket. A socket that can't connect, or that
/// goes silent, must end in `closed`: hosts time out a connect and ping an open socket.
class Transport {
public:
    virtual ~Transport() = default;
    /// Null when it can't even begin.
    virtual std::shared_ptr<Socket> open(const std::string& url, SocketEvents events) = 0;
};

/// A fresh snapshot is in the mirror. Every connect begins with one.
struct Synced {
    /// Against what the mirror held before, so a reconnect shows only what changed meanwhile.
    Delta delta;
    Settings settings;
    /// What an undo would take back now.
    std::optional<std::string> undo;
    bool voice = false;
    Hearing hearing = Hearing::browser;
};

/// A change set is in the mirror.
struct Changed {
    ChangeSet set;
    std::optional<std::string> undo;
    Delta delta;
};

/// What the frame thread hears, in the order the service said it.
using Event = std::variant<Synced, Changed, Activity, Say, Heard, Navigate, Handoff, SettingsChanged, Note, Questions, Rejected>;

/// Every member is for the frame thread. Only the host's callbacks come from elsewhere, and
/// they reach the client only through its queue.
class Client {
public:
    enum class State { connecting, live, waiting };
    /// Seconds before each try after a failure. The last repeats.
    static constexpr double retryDelays[] = {1, 2, 4, 8, 15};

    /// Connects on the first tick.
    Client(Address address, std::shared_ptr<Transport> transport);
    ~Client();
    Client(const Client&) = delete;
    Client& operator=(const Client&) = delete;

    /// The frame's clock, once a frame: opens the socket when a wait is over.
    void tick(double now);
    /// What arrived since the last drain, applied to the mirror, in order. A change set that
    /// doesn't follow from the mirror, or that couldn't be read, ends the connection: the next
    /// one starts with a fresh snapshot.
    std::vector<Event> drain();
    /// False unless live.
    bool send(const Outbound& message);

    /// Connecting lasts until the socket's first hello is applied.
    State state() const;
    const Mirror& mirror() const { return mirror_; }
    const Address& address() const { return address_; }

private:
    struct Inbox;
    /// Connecting or live.
    struct Open {
        std::shared_ptr<Socket> socket;
        uint64_t number = 0;
        bool live = false;
    };
    struct Waiting {
        double until = 0;
    };

    Address address_;
    std::shared_ptr<Transport> transport_;
    std::shared_ptr<Inbox> inbox_;
    std::variant<Open, Waiting> link_ = Waiting{};
    uint64_t opened_ = 0;
    int failures_ = 0;
    double now_ = 0;
    Mirror mirror_;

    void open();
    /// Ends the connection and waits before the next try.
    void drop(const std::string& why);
    void receive(Inbound message, std::vector<Event>& events);
};

}  // namespace agent
