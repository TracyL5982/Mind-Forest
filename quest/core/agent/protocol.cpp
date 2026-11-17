#include "protocol.h"

#include <algorithm>
#include <cmath>
#include <functional>
#include <initializer_list>
#include <map>
#include <string_view>
#include <utility>

namespace agent {

namespace {

bool same(const Json& a, const Json& b) {
    if (a.type() != b.type()) return false;
    switch (a.type()) {
    case Json::Type::null: return true;
    case Json::Type::boolean: return a.boolean() == b.boolean();
    case Json::Type::number: return a.number() == b.number();
    case Json::Type::string: return a.string() == b.string();
    case Json::Type::array: {
        const std::vector<Json>& x = a.array();
        const std::vector<Json>& y = b.array();
        if (x.size() != y.size()) return false;
        for (size_t i = 0; i < x.size(); i++) {
            if (!same(x[i], y[i])) return false;
        }
        return true;
    }
    case Json::Type::object: {
        const std::map<std::string, Json>& x = a.members();
        const std::map<std::string, Json>& y = b.members();
        if (x.size() != y.size()) return false;
        for (auto i = x.begin(), k = y.begin(); i != x.end(); ++i, ++k) {
            if (i->first != k->first || !same(i->second, k->second)) return false;
        }
        return true;
    }
    }
    return false;
}

}  // namespace

bool operator==(const Content& a, const Content& b) { return same(a, b); }

namespace {

using Why = std::string;

/// Reads the fields of one JSON object. Required and optional are as domain.ts has them.
/// The first problem is kept in `why`, prefixed with the field it was found in.
class Fields {
public:
    Fields(const Json& json, Why& why) : json_(json), why_(why) {
        if (!json.isObject()) fail(nullptr, "not an object");
    }

    bool ok() const { return ok_; }

    std::string string(const char* key) {
        const Json& v = json_[key];
        if (!v.isString()) {
            fail(key, v.isNull() ? "missing" : "not a string");
            return {};
        }
        return v.string();
    }

    std::optional<std::string> optionalString(const char* key) {
        const Json& v = json_[key];
        if (v.isNull()) return std::nullopt;
        if (!v.isString()) {
            fail(key, "not a string");
            return std::nullopt;
        }
        return v.string();
    }

    template <class I>
    I id(const char* key) {
        std::string s = string(key);
        if (ok_ && s.empty()) fail(key, "empty");
        return I{std::move(s)};
    }

    template <class I>
    std::optional<I> optionalId(const char* key) {
        std::optional<std::string> s = optionalString(key);
        if (!s) return std::nullopt;
        if (s->empty()) {
            fail(key, "empty");
            return std::nullopt;
        }
        return I{std::move(*s)};
    }

    double number(const char* key) {
        const Json& v = json_[key];
        if (!v.isNumber()) fail(key, v.isNull() ? "missing" : "not a number");
        return v.number();
    }

    int64_t whole(const char* key) {
        double v = number(key);
        if (ok_ && v != std::floor(v)) fail(key, "not a whole number");
        return int64_t(v);
    }

    /// Two numbers, the first not below 0 and the second after it: a stretch of time.
    std::pair<double, double> span(const char* fromKey, const char* toKey) {
        double from = number(fromKey), to = number(toKey);
        if (ok_ && from < 0) fail(fromKey, "below 0");
        if (ok_ && !(from < to)) fail(toKey, "not after " + std::string(fromKey));
        return {from, to};
    }

    bool boolean(const char* key) {
        const Json& v = json_[key];
        if (!v.isBool()) fail(key, v.isNull() ? "missing" : "not true or false");
        return v.boolean();
    }

    std::optional<bool> optionalBoolean(const char* key) {
        const Json& v = json_[key];
        if (v.isNull()) return std::nullopt;
        if (!v.isBool()) {
            fail(key, "not true or false");
            return std::nullopt;
        }
        return v.boolean();
    }

    Json object(const char* key) {
        const Json& v = json_[key];
        if (!v.isObject()) fail(key, v.isNull() ? "missing" : "not an object");
        return v;
    }

    std::vector<std::string> strings(const char* key) {
        std::vector<std::string> out;
        const Json& v = json_[key];
        if (!v.isArray()) {
            fail(key, v.isNull() ? "missing" : "not a list");
            return out;
        }
        for (const Json& s : v.array()) {
            if (!s.isString()) {
                fail(key, "holds something that is not a string");
                return {};
            }
            out.push_back(s.string());
        }
        return out;
    }

    template <class I>
    std::vector<I> ids(const char* key) {
        std::vector<I> out;
        for (std::string& s : strings(key)) out.push_back(I{std::move(s)});
        return out;
    }

    template <class E>
    E choice(const char* key, std::initializer_list<std::pair<std::string_view, E>> names) {
        std::string s = string(key);
        for (const auto& [name, value] : names) {
            if (s == name) return value;
        }
        if (ok_) {
            std::string all;
            for (const auto& [name, value] : names) all += (all.empty() ? "" : ", ") + std::string(name);
            fail(key, "not one of " + all);
        }
        return names.begin()->second;
    }

    template <class T>
    T nested(const char* key, std::optional<T> (*read)(const Json&, Why&)) {
        if (!ok_) return T{};
        if (json_[key].isNull()) {
            fail(key, "missing");
            return T{};
        }
        std::optional<T> v = read(json_[key], why_);
        if (!v) return failed<T>(key);
        return std::move(*v);
    }

    /// Null or absent is none.
    template <class T>
    std::optional<T> maybe(const char* key, std::optional<T> (*read)(const Json&, Why&)) {
        if (!ok_ || json_[key].isNull()) return std::nullopt;
        std::optional<T> v = read(json_[key], why_);
        if (!v) failed<T>(key);
        return v;
    }

    /// Absent is empty.
    template <class T>
    std::vector<T> optionalList(const char* key, std::optional<T> (*read)(const Json&, Why&)) {
        return json_[key].isNull() ? std::vector<T>{} : list(key, read);
    }

    /// Points as pairs, x then y, each 0 to 1.
    std::vector<std::pair<float, float>> points(const char* key) {
        std::vector<std::pair<float, float>> out;
        const Json& v = json_[key];
        if (!v.isArray() || v.size() < 4 || v.size() % 2 != 0) {
            fail(key, v.isArray() ? "not two points or more, x then y" : v.isNull() ? "missing" : "not a list");
            return out;
        }
        for (size_t i = 0; i + 1 < v.size(); i += 2) {
            const Json& x = v[i];
            const Json& y = v[i + 1];
            if (!(x.isNumber() && y.isNumber() && x.number() >= 0 && x.number() <= 1 && y.number() >= 0 && y.number() <= 1)) {
                fail(key, "holds something that is not a number from 0 to 1");
                return {};
            }
            out.emplace_back(float(x.number()), float(y.number()));
        }
        return out;
    }

    template <class T>
    std::vector<T> list(const char* key, std::optional<T> (*read)(const Json&, Why&)) {
        std::vector<T> out;
        const Json& v = json_[key];
        if (!ok_) return out;
        if (!v.isArray()) {
            fail(key, v.isNull() ? "missing" : "not a list");
            return out;
        }
        out.reserve(v.size());
        for (size_t i = 0; i < v.size(); i++) {
            std::optional<T> one = read(v[i], why_);
            if (!one) {
                ok_ = false;
                why_ = std::string(key) + "[" + std::to_string(i) + "]." + why_;
                return {};
            }
            out.push_back(std::move(*one));
        }
        return out;
    }

private:
    const Json& json_;
    Why& why_;
    bool ok_ = true;

    void fail(const char* key, const std::string& problem) {
        if (!ok_) return;
        ok_ = false;
        why_ = key ? std::string(key) + ": " + problem : problem;
    }

    /// A nested read failed and left its own reason; this adds where it was.
    template <class T>
    T failed(const char* key) {
        ok_ = false;
        why_ = std::string(key) + "." + why_;
        return T{};
    }
};

template <class T>
std::optional<T> done(const Fields& f, T value) {
    return f.ok() ? std::optional<T>(std::move(value)) : std::nullopt;
}

std::optional<Origin> readOrigin(const Json& j, Why& why) {
    Fields f(j, why);
    return done(f, Origin{
                       .by = f.choice<Origin::By>("by", {{"user", Origin::By::user}, {"agent", Origin::By::agent}}),
                       .role = f.optionalString("role"),
                       .tool = f.optionalString("tool"),
                   });
}

std::optional<Source> readSource(const Json& j, Why& why) {
    Fields f(j, why);
    return done(f, Source{
                       .from = f.string("from"),
                       .url = f.optionalString("url"),
                       .asset = f.optionalString("asset"),
                       .capturedAt = f.string("capturedAt"),
                   });
}

std::optional<Item> readItem(const Json& j, Why& why) {
    Fields f(j, why);
    return done(f, Item{
                       .id = f.id<ItemId>("id"),
                       .kind = f.string("kind"),
                       .title = f.string("title"),
                       .text = f.string("text"),
                       .summary = f.string("summary"),
                       .tags = f.strings("tags"),
                       .data = f.object("data"),
                       .source = f.nested("source", readSource),
                       .origin = f.nested("origin", readOrigin),
                       .archived = f.boolean("archived"),
                       .revision = int(f.whole("revision")),
                   });
}

std::optional<View> readView(const Json& j, Why& why) {
    Fields f(j, why);
    return done(f, View{
                       .component = f.string("component"),
                       .props = f.object("props"),
                       .by = f.string("by"),
                       .composing = f.optionalBoolean("composing").value_or(false),
                   });
}

std::optional<Edit> readEdit(const Json& j, Why& why) {
    Fields f(j, why);
    Edit e{.id = f.string("id"),
           .kind = f.choice<Edit::Kind>("kind", {{"highlight", Edit::Kind::highlight}, {"stroke", Edit::Kind::stroke}, {"stretch", Edit::Kind::stretch}})};
    if (!f.ok()) return std::nullopt;
    if (e.kind == Edit::Kind::highlight) {
        e.quote = f.string("quote");
        if (j["at"].isNumber()) e.at = int(f.whole("at"));
    } else if (e.kind == Edit::Kind::stretch) {
        auto [from, to] = f.span("from", "to");
        e.from = from;
        e.to = to;
    } else {
        e.points = f.points("points");
    }
    return done(f, std::move(e));
}

std::optional<Node> readNode(const Json& j, Why& why) {
    Fields f(j, why);
    return done(f, Node{
                       .id = f.id<NodeId>("id"),
                       .treeId = f.id<TreeId>("treeId"),
                       .itemId = f.id<ItemId>("itemId"),
                       .parent = f.optionalId<NodeId>("parent"),
                       .status = f.choice<Node::Status>("status", {{"kept", Node::Status::kept}, {"pick", Node::Status::pick}}),
                       .why = f.string("why"),
                       .importance = f.number("importance"),
                       .origin = f.nested("origin", readOrigin),
                       .view = f.nested("view", readView),
                       .order = f.number("order"),
                       .edits = f.optionalList("edits", readEdit),
                   });
}

std::optional<TreeInfo> readTree(const Json& j, Why& why) {
    Fields f(j, why);
    return done(f, TreeInfo{
                       .id = f.id<TreeId>("id"),
                       .title = f.string("title"),
                       .rootId = f.id<NodeId>("rootId"),
                       .digest = f.string("digest"),
                       .createdAt = f.string("createdAt"),
                   });
}

std::optional<Link> readLink(const Json& j, Why& why) {
    Fields f(j, why);
    return done(f, Link{
                       .id = f.id<LinkId>("id"),
                       .a = f.id<NodeId>("a"),
                       .b = f.id<NodeId>("b"),
                       .why = f.string("why"),
                       .strength = f.number("strength"),
                   });
}

std::optional<Group> readGroup(const Json& j, Why& why) {
    Fields f(j, why);
    return done(f, Group{
                       .id = f.id<GroupId>("id"),
                       .treeId = f.id<TreeId>("treeId"),
                       .anchor = f.id<NodeId>("anchor"),
                       .composite = f.string("composite"),
                       .title = f.string("title"),
                       .members = f.ids<NodeId>("members"),
                       .props = f.object("props"),
                   });
}

std::optional<Snapshot> readSnapshot(const Json& j, Why& why) {
    Fields f(j, why);
    return done(f, Snapshot{
                       .seq = f.whole("seq"),
                       .items = f.list("items", readItem),
                       .nodes = f.list("nodes", readNode),
                       .trees = f.list("trees", readTree),
                       .links = f.list("links", readLink),
                       .groups = f.list("groups", readGroup),
                   });
}

std::optional<Patch> readPatch(const Json& j, Why& why) {
    Fields f(j, why);
    std::string entity = f.string("entity");
    std::string id = f.string("id");
    if (!f.ok()) return std::nullopt;
    auto patch = [&]<class E>(std::optional<E> (*read)(const Json&, Why&)) {
        PatchOf<E> p{.id = IdOf<E>{id}, .before = f.maybe("before", read), .after = f.maybe("after", read)};
        return f.ok() ? std::optional<Patch>(std::move(p)) : std::nullopt;
    };
    if (entity == "item") return patch(readItem);
    if (entity == "node") return patch(readNode);
    if (entity == "tree") return patch(readTree);
    if (entity == "link") return patch(readLink);
    if (entity == "group") return patch(readGroup);
    return UnknownPatch{entity, id};
}

std::optional<ChangeSet> readChangeSet(const Json& j, Why& why) {
    Fields f(j, why);
    return done(f, ChangeSet{
                       .id = f.id<SetId>("id"),
                       .seq = f.whole("seq"),
                       .at = f.string("at"),
                       .origin = f.nested("origin", readOrigin),
                       .label = f.string("label"),
                       .patches = f.list("patches", readPatch),
                       .part = f.optionalString("part"),
                       .undoes = f.optionalId<SetId>("undoes"),
                       .alsoUndoes = j["alsoUndoes"].isNull() ? std::vector<SetId>{} : f.ids<SetId>("alsoUndoes"),
                   });
}

std::optional<Settings> readSettings(const Json& j, Why& why) {
    Fields f(j, why);
    return done(f, Settings{
                       .picksMode = f.choice<PicksMode>("picksMode", {{"provisional", PicksMode::provisional}, {"immediate", PicksMode::immediate}}),
                       .picksPerRun = int(f.whole("picksPerRun")),
                       .scoutOnDump = f.boolean("scoutOnDump"),
                       .agentName = f.optionalString("agentName").value_or("momo"),
                   });
}

std::optional<Activity> readActivity(const Json& j, Why& why) {
    Fields f(j, why);
    return done(f, Activity{
                       .id = f.string("id"),
                       .role = f.string("role"),
                       .state = f.choice<Activity::State>("state", {{"start", Activity::State::start}, {"done", Activity::State::done},
                                                   {"error", Activity::State::error}}),
                       .message = f.string("message"),
                       .nodeId = f.optionalId<NodeId>("nodeId"),
                       .label = f.optionalString("label"),
                       .detail = f.optionalString("detail"),
                   });
}

// MARK: messages

using Reader = std::optional<Inbound> (*)(const Json&, Why&);

template <class T>
std::optional<Inbound> message(const Fields& f, T value) {
    return f.ok() ? std::optional<Inbound>(std::move(value)) : std::nullopt;
}

std::optional<Inbound> readHello(const Json& j, Why& why) {
    Fields f(j, why);
    // `voice`, `hearing` and `live` came later than version 1; a service without them reads as one with none.
    return message(f, Hello{
                          .protocol = int(f.whole("protocol")),
                          .snapshot = f.nested("snapshot", readSnapshot),
                          .settings = f.nested("settings", readSettings),
                          .undo = f.optionalString("undo"),
                          .voice = f.optionalBoolean("voice").value_or(false),
                          .hearing = j["hearing"].isNull()
                                         ? Hearing::browser
                                         : f.choice<Hearing>("hearing", {{"browser", Hearing::browser}, {"service", Hearing::service}}),
                          .live = f.optionalBoolean("live").value_or(false),
                          .connection = f.optionalString("connection").value_or(""),
                      });
}

std::optional<Inbound> readChange(const Json& j, Why& why) {
    Fields f(j, why);
    return message(f, Change{.set = f.nested("set", readChangeSet), .undo = f.optionalString("undo"), .yours = f.optionalBoolean("yours").value_or(false)});
}

std::optional<Inbound> readActivityMessage(const Json& j, Why& why) {
    Fields f(j, why);
    return message(f, f.nested("activity", readActivity));
}

std::optional<Inbound> readSay(const Json& j, Why& why) {
    Fields f(j, why);
    return message(f, Say{.text = f.string("text")});
}

std::optional<Inbound> readHeard(const Json& j, Why& why) {
    Fields f(j, why);
    return message(f, Heard{.text = f.string("text"), .final = f.boolean("final")});
}

std::optional<Inbound> readNavigate(const Json& j, Why& why) {
    Fields f(j, why);
    return message(f, Navigate{.nodeId = f.optionalId<NodeId>("nodeId"), .treeId = f.optionalId<TreeId>("treeId"), .yours = f.optionalBoolean("yours").value_or(false)});
}

std::optional<Inbound> readHandoff(const Json& j, Why& why) {
    Fields f(j, why);
    return message(f, Handoff{
                          .name = f.string("name"),
                          .url = f.string("url"),
                          .markdown = f.string("markdown"),
                          .files = f.strings("files"),
                      });
}

std::optional<Inbound> readSettingsMessage(const Json& j, Why& why) {
    Fields f(j, why);
    return message(f, SettingsChanged{.settings = f.nested("settings", readSettings)});
}

std::optional<Inbound> readNote(const Json& j, Why& why) {
    Fields f(j, why);
    return message(f, Note{.role = f.string("role"), .message = f.string("message")});
}

std::optional<Inbound> readQuestions(const Json& j, Why& why) {
    Fields f(j, why);
    return message(f, Questions{.nodeId = f.id<NodeId>("nodeId"), .questions = f.strings("questions")});
}

std::optional<Inbound> readError(const Json& j, Why& why) {
    Fields f(j, why);
    return message(f, Rejected{.message = f.string("message")});
}

const std::map<std::string, Reader, std::less<>>& readers() {
    static const std::map<std::string, Reader, std::less<>> table = {
        {"hello", readHello},       {"change", readChange},     {"activity", readActivityMessage},
        {"say", readSay},           {"heard", readHeard},       {"navigate", readNavigate},
        {"handoff", readHandoff},   {"settings", readSettingsMessage},
        {"note", readNote},         {"questions", readQuestions}, {"error", readError},
    };
    return table;
}

// MARK: outbound

template <class I>
Json idList(const std::vector<I>& ids) {
    Json out = Json::list();
    for (const I& id : ids) out.push(Json(id.value));
    return out;
}

Json named(const char* t) { return Json::object().set("t", t); }

}  // namespace

Json sceneJson(const Scene& scene) {
    Json s = Json::object().set("selection", idList(scene.selection));
    if (scene.focus) s.set("focus", scene.focus->value);
    if (scene.treeId) s.set("treeId", scene.treeId->value);
    return s;
}

namespace {

Json scope(const Scope& s) { return Json::object().set("treeIds", idList(s.treeIds)).set("nodeIds", idList(s.nodeIds)); }

}  // namespace

Inbound parseInbound(const std::string& text) {
    std::optional<Json> json = Json::parse(text);
    if (!json) return Malformed{.t = "", .why = "not JSON"};
    const Json& t = (*json)["t"];
    if (!t.isString()) return Malformed{.t = "", .why = "t: missing or not a string"};
    auto reader = readers().find(t.string());
    if (reader == readers().end()) return Unknown{.t = t.string()};
    Why why;
    std::optional<Inbound> message = reader->second(*json, why);
    if (!message) return Malformed{.t = t.string(), .why = why};
    return std::move(*message);
}

Dump Dump::text(const std::string& text, const std::optional<std::string>& name) {
    Json j = Json::object().set("kind", "text").set("text", text);
    if (name) j.set("name", *name);
    return Dump(std::move(j));
}

Dump Dump::link(const std::string& url) { return Dump(Json::object().set("kind", "link").set("url", url)); }

Dump Dump::asset(const std::string& asset, const std::string& mime, const std::optional<std::string>& name) {
    Json j = Json::object().set("kind", "asset").set("asset", asset).set("mime", mime);
    if (name) j.set("name", *name);
    return Dump(std::move(j));
}

Command Command::addNode(const NodeId& id, const TreeId& treeId, const ItemId& itemId, const NodeId& parent, double order) {
    Json view = Json::object().set("component", "note").set("props", Json::object()).set("by", "default").set("composing", true);
    Json node = Json::object()
                    .set("id", id.value)
                    .set("treeId", treeId.value)
                    .set("itemId", itemId.value)
                    .set("parent", parent.value)
                    .set("status", "kept")
                    .set("why", "")
                    .set("importance", 1)
                    .set("origin", Json::object().set("by", "user"))
                    .set("view", std::move(view))
                    .set("order", order);
    return Command(Json::object().set("type", "addNode").set("node", std::move(node)));
}

Command Command::deleteNode(const NodeId& id) { return Command(Json::object().set("type", "deleteNode").set("id", id.value)); }

Command Command::moveNode(const NodeId& id, const NodeId& parent, const std::optional<TreeId>& treeId, std::optional<double> order) {
    Json j = Json::object().set("type", "moveNode").set("id", id.value).set("parent", parent.value);
    if (treeId) j.set("treeId", treeId->value);
    if (order) j.set("order", *order);
    return Command(std::move(j));
}

Command Command::renameTree(const TreeId& id, const std::string& title) {
    return Command(Json::object().set("type", "renameTree").set("id", id.value).set("title", title));
}

Command Command::deleteTree(const TreeId& id) { return Command(Json::object().set("type", "deleteTree").set("id", id.value)); }

Command Command::addEdit(const NodeId& id, const Edit& edit) {
    Json e = Json::object().set("id", edit.id);
    if (edit.kind == Edit::Kind::highlight) {
        e.set("kind", "highlight").set("quote", edit.quote);
        if (edit.at) e.set("at", *edit.at);
    } else if (edit.kind == Edit::Kind::stretch) {
        // Hundredths of a second.
        auto rounded = [](double v) { return std::round(v * 100) / 100; };
        e.set("kind", "stretch").set("from", rounded(edit.from)).set("to", rounded(edit.to));
    } else {
        Json points = Json::list();
        // Four places: a tenth of a millimetre on the widest card.
        auto rounded = [](float v) { return std::round(double(std::clamp(v, 0.f, 1.f)) * 1e4) / 1e4; };
        for (const auto& [x, y] : edit.points) points.push(rounded(x)).push(rounded(y));
        e.set("kind", "stroke").set("points", std::move(points));
    }
    return Command(Json::object().set("type", "addEdit").set("id", id.value).set("edit", std::move(e)));
}

Command Command::removeEdit(const NodeId& id, const std::string& editId) {
    return Command(Json::object().set("type", "removeEdit").set("id", id.value).set("editId", editId));
}

Outbound Outbound::dump(const std::vector<Dump>& dumps) {
    Json list = Json::list();
    for (const Dump& d : dumps) list.push(d.json());
    return Outbound(named("dump").set("dumps", std::move(list)));
}

Outbound Outbound::utter(const std::string& text, bool final, const Scene& scene) {
    return Outbound(named("utter").set("text", text).set("final", final).set("scene", sceneJson(scene)));
}

Outbound Outbound::focus(const NodeId& nodeId) { return Outbound(named("focus").set("nodeId", nodeId.value)); }

Outbound Outbound::ask(const NodeId& nodeId, const std::string& need) {
    return Outbound(named("ask").set("nodeId", nodeId.value).set("need", need));
}

Outbound Outbound::questions(const NodeId& nodeId) { return Outbound(named("questions").set("nodeId", nodeId.value)); }

Outbound Outbound::more(const NodeId& nodeId, const std::optional<std::string>& need) {
    Json j = named("more").set("nodeId", nodeId.value);
    if (need) j.set("need", *need);
    return Outbound(std::move(j));
}

Outbound Outbound::keep(const std::vector<NodeId>& nodeIds) { return Outbound(named("keep").set("nodeIds", idList(nodeIds))); }

Outbound Outbound::undo(const std::optional<SetId>& id) {
    Json j = named("undo");
    if (id) j.set("id", id->value);
    return Outbound(std::move(j));
}

Outbound Outbound::commands(const std::string& label, const std::vector<Command>& commands) {
    Json list = Json::list();
    for (const Command& c : commands) list.push(c.json());
    return Outbound(named("commands").set("label", label).set("commands", std::move(list)));
}

Outbound Outbound::organize(const std::string& request, const Scope& s, const std::optional<NodeId>& focus) {
    Json j = named("organize").set("request", request).set("scope", scope(s));
    if (focus) j.set("focus", focus->value);
    return Outbound(std::move(j));
}

Outbound Outbound::handoff(const Scope& s, const std::optional<std::string>& note) {
    Json j = named("handoff").set("scope", scope(s));
    if (note) j.set("note", *note);
    return Outbound(std::move(j));
}

Outbound Outbound::settings(const SettingsPatch& patch) {
    Json p = Json::object();
    if (patch.picksMode) p.set("picksMode", *patch.picksMode == PicksMode::provisional ? "provisional" : "immediate");
    if (patch.picksPerRun) p.set("picksPerRun", *patch.picksPerRun);
    if (patch.scoutOnDump) p.set("scoutOnDump", *patch.scoutOnDump);
    return Outbound(named("settings").set("patch", std::move(p)));
}

Outbound Outbound::client(const Media& media) {
    Json files = Json::list();
    for (const std::string& f : media.files) files.push(Json(f));
    return Outbound(named("client").set("media", Json::object().set("embeds", media.embeds).set("files", std::move(files))));
}

}  // namespace agent
