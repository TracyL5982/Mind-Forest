#include "client.h"

#include <algorithm>
#include <cctype>
#include <mutex>
#include <utility>

#include "../base.h"

namespace agent {

// MARK: - Address

namespace {

std::string trimmed(const std::string& s) {
    size_t begin = s.find_first_not_of(" \t\r\n");
    size_t end = s.find_last_not_of(" \t\r\n");
    return begin == std::string::npos ? std::string() : s.substr(begin, end - begin + 1);
}

std::string lowercase(std::string s) {
    for (char& c : s) c = char(std::tolower((unsigned char)c));
    return s;
}

bool validPort(const std::string& port) {
    if (port.empty() || port.size() > 5 || !std::all_of(port.begin(), port.end(), [](char c) { return c >= '0' && c <= '9'; })) return false;
    int n = std::stoi(port);
    return n >= 1 && n <= 65535;
}

/// host, host:port, [v6] or [v6]:port.
bool validAuthority(const std::string& a) {
    if (a.empty() || a.find_first_of(" \t@") != std::string::npos) return false;
    if (a[0] == '[') {
        size_t close = a.find(']');
        if (close == std::string::npos || close == 1) return false;
        std::string rest = a.substr(close + 1);
        return rest.empty() || (rest[0] == ':' && validPort(rest.substr(1)));
    }
    size_t colon = a.find(':');
    if (colon == std::string::npos) return true;
    return colon > 0 && a.find(':', colon + 1) == std::string::npos && validPort(a.substr(colon + 1));
}

}  // namespace

std::string queryEscape(const std::string& value) {
    static const char* hex = "0123456789ABCDEF";
    std::string out;
    for (unsigned char c : value) {
        if (std::isalnum(c) || c == '-' || c == '.' || c == '_' || c == '~') {
            out += char(c);
        } else {
            out += '%';
            out += hex[c >> 4];
            out += hex[c & 15];
        }
    }
    return out;
}

std::optional<Address> Address::parse(const std::string& flag, const std::string& token, const std::string& device) {
    std::string s = trimmed(flag);
    bool secure = false;
    size_t start = 0;
    if (size_t scheme = s.find("://"); scheme != std::string::npos) {
        std::string name = lowercase(s.substr(0, scheme));
        if (name == "wss" || name == "https") secure = true;
        else if (name != "ws" && name != "http") return std::nullopt;
        start = scheme + 3;
    }
    size_t end = s.find_first_of("/?#", start);
    std::string authority = s.substr(start, end == std::string::npos ? std::string::npos : end - start);
    if (!validAuthority(authority)) return std::nullopt;
    Address out{.http = std::string(secure ? "https://" : "http://") + authority, .token = token, .device = device};
    out.socket = std::string(secure ? "wss://" : "ws://") + authority + "/ws?" + out.credentials();
    return out;
}

std::string Address::credentials() const { return "token=" + queryEscape(token) + (device.empty() ? "" : "&device=" + queryEscape(device)); }

std::string Address::resolve(const std::string& path) const {
    if (path.find("://") != std::string::npos) return path;
    std::string p = path.empty() || path[0] != '/' ? "/" + path : path;
    return http + p + (p.find('?') == std::string::npos ? "?" : "&") + credentials();
}

// MARK: - Client

struct Client::Inbox {
    struct Opened {};
    struct Closed {
        std::string why;
    };
    struct Arrival {
        uint64_t socket = 0;
        std::variant<Opened, Inbound, Closed> what;
    };

    std::mutex lock;
    std::vector<Arrival> arrivals;

    void put(Arrival arrival) {
        std::lock_guard<std::mutex> hold(lock);
        arrivals.push_back(std::move(arrival));
    }
    std::vector<Arrival> take() {
        std::lock_guard<std::mutex> hold(lock);
        return std::exchange(arrivals, {});
    }
};

Client::Client(Address address, std::shared_ptr<Transport> transport)
    : address_(std::move(address)), transport_(std::move(transport)), inbox_(std::make_shared<Inbox>()) {}

Client::~Client() {
    if (auto* open = std::get_if<Open>(&link_)) open->socket->close();
}

Client::State Client::state() const {
    if (auto* open = std::get_if<Open>(&link_)) return open->live ? State::live : State::connecting;
    return State::waiting;
}

void Client::tick(double now) {
    now_ = now;
    if (auto* waiting = std::get_if<Waiting>(&link_); waiting && now >= waiting->until) open();
}

void Client::open() {
    uint64_t number = ++opened_;
    // The host's threads hold the inbox, not the client, so a late callback after the client is gone is harmless.
    std::shared_ptr<Inbox> inbox = inbox_;
    SocketEvents events{
        .opened = [inbox, number] { inbox->put({number, Inbox::Opened{}}); },
        .text = [inbox, number](const std::string& text) { inbox->put({number, parseInbound(text)}); },
        .closed = [inbox, number](const std::string& why) { inbox->put({number, Inbox::Closed{why}}); },
    };
    std::shared_ptr<Socket> socket = transport_->open(address_.socket, std::move(events));
    if (!socket) {
        link_ = Open{.number = number};
        drop("the host could not open a socket");
        return;
    }
    link_ = Open{.socket = std::move(socket), .number = number};
}

void Client::drop(const std::string& why) {
    if (auto* open = std::get_if<Open>(&link_); open && open->socket) open->socket->close();
    double wait = retryDelays[std::min<size_t>(size_t(failures_), std::size(retryDelays) - 1)];
    failures_++;
    link_ = Waiting{.until = now_ + wait};
    logLine(fmt("[agent] %s; trying again in %g s", why.c_str(), wait));
}

std::vector<Event> Client::drain() {
    std::vector<Event> events;
    for (Inbox::Arrival& arrival : inbox_->take()) {
        auto* open = std::get_if<Open>(&link_);
        if (!open || arrival.socket != open->number) continue;
        std::visit(overloaded{
                       [&](Inbox::Opened&) { logLine("[agent] socket open, waiting for hello"); },
                       [&](Inbox::Closed& closed) { drop("closed: " + closed.why); },
                       [&](Inbound& message) { receive(std::move(message), events); },
                   },
                   arrival.what);
    }
    return events;
}

void Client::receive(Inbound message, std::vector<Event>& events) {
    Open& open = std::get<Open>(link_);
    std::visit(overloaded{
                   [&](Hello& hello) {
                       if (hello.protocol != protocolVersion) {
                           logLine(fmt("[agent] the service speaks protocol %d, this client %d", hello.protocol, protocolVersion));
                       }
                       Delta delta = mirror_.apply(std::move(hello.snapshot));
                       open.live = true;
                       failures_ = 0;
                       events.push_back(Synced{
                           .delta = std::move(delta),
                           .settings = hello.settings,
                           .undo = std::move(hello.undo),
                           .voice = hello.voice,
                           .hearing = hello.hearing,
                           .live = hello.live,
                           .connection = hello.connection,
                       });
                   },
                   [&](Change& change) {
                       Applied applied = mirror_.apply(change.set);
                       if (auto* delta = std::get_if<Delta>(&applied)) {
                           events.push_back(Changed{.set = std::move(change.set), .undo = std::move(change.undo), .delta = std::move(*delta), .yours = change.yours});
                       } else if (auto* gap = std::get_if<Gap>(&applied)) {
                           drop("missed a change (" + gap->why + "), reconnecting for a fresh snapshot");
                       }
                   },
                   [&](Unknown& unknown) { logLine("[agent] a message this build does not know: " + unknown.t); },
                   [&](Malformed& bad) {
                       if (bad.t == "hello" || bad.t == "change") drop("could not read a " + bad.t + " (" + bad.why + ")");
                       else logLine("[agent] could not read a message: " + (bad.t.empty() ? "" : bad.t + ": ") + bad.why);
                   },
                   [&](auto& other) { events.push_back(std::move(other)); },
               },
               message);
}

bool Client::send(const Outbound& message) {
    auto* open = std::get_if<Open>(&link_);
    return open && open->live && open->socket->send(message.text());
}

}  // namespace agent
