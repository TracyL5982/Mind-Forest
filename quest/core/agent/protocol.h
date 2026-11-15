// The agent service's wire contract, version 1, as C++ values: agents/docs/protocol.md, with the
// field names of agents/src/core/domain.ts. Text from the service is parsed here, once, on the
// thread it arrives on; past this file the types are trusted.
#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "../json.h"

namespace agent {

constexpr int protocolVersion = 1;

/// An entity's id, of one kind, so a node's id can't go where an item's is wanted.
template <class Tag>
struct Id {
    std::string value;
    bool operator==(const Id&) const = default;
    bool operator<(const Id& other) const { return value < other.value; }
};
using ItemId = Id<struct ItemTag>;
using NodeId = Id<struct NodeTag>;
using TreeId = Id<struct TreeTag>;
using LinkId = Id<struct LinkTag>;
using GroupId = Id<struct GroupTag>;
/// A change set's id.
using SetId = Id<struct SetTag>;

/// For std::visit over the variants here: `std::visit(overloaded{[](const Say& s) {…}, [](const auto&) {}}, message)`.
template <class... F>
struct overloaded : F... {
    using F::operator()...;
};

/// Free-form JSON (an item's `data`, a view's or a group's `props`), read like any Json.
/// Json has no ==; this has one, so the entities that hold it can be compared.
struct Content : Json {
    Content() : Json(Json::object()) {}
    Content(Json json) : Json(std::move(json)) {}
    friend bool operator==(const Content& a, const Content& b);
};

// MARK: - Entities

struct Origin {
    enum class By { user, agent };
    By by = By::user;
    std::optional<std::string> role;
    std::optional<std::string> tool;
    bool operator==(const Origin&) const = default;
};

struct Source {
    /// How it arrived: paste, drop, voice, web, library …
    std::string from;
    std::optional<std::string> url;
    /// Served by the service at /assets/<asset>.
    std::optional<std::string> asset;
    std::string capturedAt;
    bool operator==(const Source&) const = default;
};

/// One piece of content.
struct Item {
    ItemId id;
    /// text, image, video, link, chat, file or code. Kept as written, so a kind added later still reads.
    std::string kind;
    std::string title;
    std::string text;
    std::string summary;
    std::vector<std::string> tags;
    /// An object: chart, steps, facts, library, mediaUrl …
    Content data;
    Source source;
    Origin origin;
    bool archived = false;
    int revision = 0;
    bool operator==(const Item&) const = default;
};

/// How a node is drawn: a component from agents/docs/libraries.md and its props.
struct View {
    std::string component;
    Content props;
    std::string by;
    /// The service is choosing the card's look, which lands within 12 s: an in-progress card stands in its place.
    bool composing = false;
    bool operator==(const View&) const = default;
};

/// An item's place in a tree.
struct Node {
    enum class Status { kept, pick };
    NodeId id;
    TreeId treeId;
    ItemId itemId;
    /// None for a tree's root.
    std::optional<NodeId> parent;
    /// A pick is the agent's suggestion, drawn dashed until kept.
    Status status = Status::kept;
    std::string why;
    double importance = 0;
    Origin origin;
    View view;
    /// Position among siblings.
    double order = 0;
    bool operator==(const Node&) const = default;
};

/// A tree. Named so beside the scene's own Tree.
struct TreeInfo {
    TreeId id;
    std::string title;
    NodeId rootId;
    std::string digest;
    std::string createdAt;
    bool operator==(const TreeInfo&) const = default;
};

/// A tie between two nodes, usually across trees.
struct Link {
    LinkId id;
    NodeId a;
    NodeId b;
    std::string why;
    double strength = 0;
    bool operator==(const Link&) const = default;
};

/// Several nodes of one tree drawn as one arrangement.
struct Group {
    GroupId id;
    TreeId treeId;
    /// The node the members hang from.
    NodeId anchor;
    std::string composite;
    std::string title;
    std::vector<NodeId> members;
    Content props;
    bool operator==(const Group&) const = default;
};

template <class E>
using IdOf = decltype(E::id);

// MARK: - State and change

struct Snapshot {
    int64_t seq = 0;
    std::vector<Item> items;
    std::vector<Node> nodes;
    std::vector<TreeInfo> trees;
    std::vector<Link> links;
    std::vector<Group> groups;
};

/// One entity changing: no `before` is a creation, no `after` a removal.
template <class E>
struct PatchOf {
    IdOf<E> id;
    std::optional<E> before;
    std::optional<E> after;
};
/// A patch to a kind of entity this build doesn't know. The mirror passes over it.
struct UnknownPatch {
    std::string entity;
    std::string id;
};
using Patch = std::variant<PatchOf<Item>, PatchOf<Node>, PatchOf<TreeInfo>, PatchOf<Link>, PatchOf<Group>, UnknownPatch>;

/// Commands applied together, undone together. The service's `commands` are left out: a client applies the patches.
struct ChangeSet {
    SetId id;
    /// Rises with every set, but not by one each time: a set that changed nothing is never sent.
    int64_t seq = 0;
    std::string at;
    Origin origin;
    std::string label;
    std::vector<Patch> patches;
    /// Shared by the sets of one piece of work, such as the deliveries of one Scout run.
    std::optional<std::string> part;
    std::optional<SetId> undoes;
    std::vector<SetId> alsoUndoes;
};

enum class PicksMode { provisional, immediate };

struct Settings {
    PicksMode picksMode = PicksMode::provisional;
    int picksPerRun = 0;
    bool scoutOnDump = false;
    /// What the user calls the agent: "hey" or "hi" and this name wake it.
    std::string agentName = "momo";
};

/// Work the agent began or ended, on a node when it is about one.
struct Activity {
    enum class State { start, done, error };
    std::string id;
    std::string role;
    State state = State::start;
    std::string message;
    std::optional<NodeId> nodeId;
    /// A few words on the step, for showing; `message` stands in when the service gives none.
    std::optional<std::string> label;
    /// More about the step: for a Scout run on a card, the question it answers; on an error, what went wrong.
    std::optional<std::string> detail;
};

/// Who should turn speech into text: the service (record and POST /api/transcribe) or the client's own recognizer.
enum class Hearing { browser, service };

// MARK: - Service to client

/// Sent once on every connect.
struct Hello {
    int protocol = 0;
    Snapshot snapshot;
    Settings settings;
    /// What an undo would take back now.
    std::optional<std::string> undo;
    /// Whether GET /api/speak reads replies aloud.
    bool voice = false;
    Hearing hearing = Hearing::browser;
    /// Whether Momo's live voice answers on /live.
    bool live = false;
    /// This connection's id, which /live names so that what Momo starts there is this connection's own.
    std::string connection;
};
struct Change {
    ChangeSet set;
    std::optional<std::string> undo;
    /// This connection's own message started the work that made it ("make a tree about …"), not another client's.
    bool yours = false;
};
/// One short line for the agent to speak.
struct Say {
    std::string text;
};
/// The transcript the service is acting on.
struct Heard {
    std::string text;
    bool final = false;
};
/// Move the view to a node or a tree.
struct Navigate {
    std::optional<NodeId> nodeId;
    std::optional<TreeId> treeId;
    /// This connection asked to go there, or asked for the run whose card it is (`Change::yours`).
    bool yours = false;
};
/// A handoff bundle is ready; `url` is a zip on the service.
struct Handoff {
    std::string name;
    std::string url;
    std::string markdown;
    std::vector<std::string> files;
};
struct SettingsChanged {
    Settings settings;
};
/// A log line.
struct Note {
    std::string role;
    std::string message;
};
/// What the user might ask next about an open node, answered to this connection alone. Empty when the service has none.
struct Questions {
    NodeId nodeId;
    std::vector<std::string> questions;
};
/// The service rejected the last message this client sent.
struct Rejected {
    std::string message;
};
/// A message of a kind this build doesn't know, by its `t`.
struct Unknown {
    std::string t;
};
/// Text that isn't a message this build can read. `t` is empty when even that was missing.
struct Malformed {
    std::string t;
    /// The first problem, with the path to it: "set.patches[2].after.status: not one of kept, pick".
    std::string why;
};

using Inbound = std::variant<Hello, Change, Activity, Say, Heard, Navigate, Handoff, SettingsChanged, Note, Questions, Rejected, Unknown, Malformed>;

/// Reads one socket message. Never fails: what can't be read comes back as Unknown or Malformed.
Inbound parseInbound(const std::string& text);

// MARK: - Client to service

/// Where the user is, so the agent can resolve "this" and "that".
struct Scene {
    std::optional<NodeId> focus;
    std::vector<NodeId> selection;
    std::optional<TreeId> treeId;
};
/// As the service reads it, in an `utter` and in /live's `start`.
Json sceneJson(const Scene& scene);

/// What an organize or handoff covers. Empty means everything.
struct Scope {
    std::vector<TreeId> treeIds;
    std::vector<NodeId> nodeIds;
};

struct SettingsPatch {
    std::optional<PicksMode> picksMode;
    std::optional<int> picksPerRun;
    std::optional<bool> scoutOnDump;
};

/// What this client can play: whether it can show a page's embedded player, and which file types.
struct Media {
    bool embeds = false;
    std::vector<std::string> files;
};

/// Something dropped into the mindstorm. A file is uploaded first (POST /api/assets) and dumped by its asset id.
class Dump {
public:
    static Dump text(const std::string& text, const std::optional<std::string>& name = std::nullopt);
    static Dump link(const std::string& url);
    static Dump asset(const std::string& asset, const std::string& mime, const std::optional<std::string>& name = std::nullopt);
    const Json& json() const { return json_; }

private:
    explicit Dump(Json json) : json_(std::move(json)) {}
    Json json_;
};

/// A direct change, sent in a `commands` message and applied as one undoable set.
class Command {
public:
    /// Removes the node and everything under it.
    static Command deleteNode(const NodeId& id);
    /// Moves the node and everything under it. `treeId` moves it into another tree.
    static Command moveNode(const NodeId& id, const NodeId& parent, const std::optional<TreeId>& treeId = std::nullopt,
                            std::optional<double> order = std::nullopt);
    static Command renameTree(const TreeId& id, const std::string& title);
    static Command deleteTree(const TreeId& id);
    const Json& json() const { return json_; }

private:
    explicit Command(Json json) : json_(std::move(json)) {}
    Json json_;
};

/// One message to the service.
class Outbound {
public:
    static Outbound dump(const std::vector<Dump>& dumps);
    /// Speech as text: partials with `final` false as they come, then the last with `final` true.
    static Outbound utter(const std::string& text, bool final, const Scene& scene);
    /// The user opened or looked at a node, to see it whole. It brings no picks.
    static Outbound focus(const NodeId& nodeId);
    static Outbound ask(const NodeId& nodeId, const std::string& need);
    static Outbound more(const NodeId& nodeId, const std::optional<std::string>& need = std::nullopt);
    /// Asks what the user might ask next about an open node. Only this connection hears the answer, as `Questions`.
    static Outbound questions(const NodeId& nodeId);
    static Outbound keep(const std::vector<NodeId>& nodeIds);
    /// The latest real change, or the named set.
    static Outbound undo(const std::optional<SetId>& id = std::nullopt);
    static Outbound commands(const std::string& label, const std::vector<Command>& commands);
    static Outbound organize(const std::string& request, const Scope& scope, const std::optional<NodeId>& focus = std::nullopt);
    static Outbound handoff(const Scope& scope, const std::optional<std::string>& note = std::nullopt);
    static Outbound settings(const SettingsPatch& patch);
    static Outbound client(const Media& media);

    const Json& json() const { return json_; }
    std::string text() const { return json_.dump(); }

private:
    explicit Outbound(Json json) : json_(std::move(json)) {}
    Json json_;
};

}  // namespace agent
