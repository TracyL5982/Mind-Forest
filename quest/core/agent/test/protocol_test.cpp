#include "support.h"

using namespace agent;

namespace {

/// The `t` a parsed message stands for, or what kept it from being one.
std::string kindOf(const Inbound& message) {
    return std::visit(overloaded{
                          [](const Hello&) { return std::string("hello"); },
                          [](const Change&) { return std::string("change"); },
                          [](const Activity&) { return std::string("activity"); },
                          [](const Say&) { return std::string("say"); },
                          [](const Heard&) { return std::string("heard"); },
                          [](const Navigate&) { return std::string("navigate"); },
                          [](const Handoff&) { return std::string("handoff"); },
                          [](const SettingsChanged&) { return std::string("settings"); },
                          [](const Note&) { return std::string("note"); },
                          [](const Questions&) { return std::string("questions"); },
                          [](const Rejected&) { return std::string("error"); },
                          [](const Unknown& u) { return "unknown " + u.t; },
                          [](const Malformed& m) { return "malformed " + m.t + ": " + m.why; },
                      },
                      message);
}

Json raw(const std::string& text) { return Json::parse(text).value_or(Json()); }

/// A recorded message with one field of one object changed: `edit` gets the parsed text and returns it changed.
std::string edited(const std::string& text, Json (*edit)(Json)) { return edit(raw(text)).dump(); }

Malformed malformed(const std::string& text) {
    Inbound message = parseInbound(text);
    if (auto* bad = std::get_if<Malformed>(&message)) return *bad;
    return Malformed{.t = "(read as " + kindOf(message) + ")", .why = ""};
}

}  // namespace

TEST(everyRecordedMessageReadsAsItsKind) {
    std::vector<std::string> texts = sessionTexts();
    texts.push_back(fixture("hello.json"));
    CHECK(texts.size() > 40, "the fixtures hold %zu messages", texts.size());
    for (size_t i = 0; i < texts.size(); i++) {
        std::string expected = raw(texts[i])["t"].string("");
        CHECK_EQ(kindOf(parseInbound(texts[i])), expected);
    }
}

TEST(helloReadsTheWholeSnapshot) {
    std::string text = fixture("hello.json");
    Json j = raw(text);
    Hello hello = finalHello();
    CHECK_EQ(hello.protocol, 1);
    CHECK_EQ(hello.snapshot.seq, int64_t(j["snapshot"]["seq"].number()));
    CHECK_EQ(hello.snapshot.items.size(), j["snapshot"]["items"].size());
    CHECK_EQ(hello.snapshot.nodes.size(), j["snapshot"]["nodes"].size());
    CHECK_EQ(hello.snapshot.trees.size(), j["snapshot"]["trees"].size());
    CHECK_EQ(hello.snapshot.links.size(), j["snapshot"]["links"].size());
    CHECK_EQ(hello.snapshot.groups.size(), j["snapshot"]["groups"].size());
    CHECK(hello.undo == j["undo"].optionalString(), "undo label");
    CHECK(!hello.voice && hello.hearing == Hearing::browser, "the scripted service has neither voice nor hearing");
    CHECK(hello.settings.picksMode == PicksMode::provisional, "picksMode");
    CHECK_EQ(hello.settings.picksPerRun, 3);
    CHECK(hello.settings.scoutOnDump, "scoutOnDump");

    // The service's settings change between versions; a hello still reads with settings this client does not use.
    std::string newer = edited(text, [](Json j) {
        j.set("settings", Json::object().set("picksMode", "provisional").set("picksPerRun", 5).set("strongTie", 0.8).set("scoutOnDump", true));
        return j;
    });
    Inbound read = parseInbound(newer);
    auto* fresh = std::get_if<Hello>(&read);
    CHECK(fresh && fresh->settings.picksPerRun == 5, "a hello whose settings name strongTie and no link settings reads (got %s)", kindOf(read).c_str());
    CHECK(fresh && fresh->settings.agentName == "momo", "a service that names no agent calls it Momo");
    Inbound named = parseInbound(edited(text, [](Json j) {
        j.set("settings", Json::object().set("picksMode", "provisional").set("picksPerRun", 5).set("scoutOnDump", true).set("agentName", "Juno"));
        return j;
    }));
    auto* juno = std::get_if<Hello>(&named);
    CHECK(juno && juno->settings.agentName == "Juno", "the agent's name is the service's setting");

    for (size_t i = 0; i < hello.snapshot.nodes.size(); i++) {
        const Json& r = j["snapshot"]["nodes"][i];
        const Node& n = hello.snapshot.nodes[i];
        CHECK_EQ(n.id.value, r["id"].string());
        CHECK_EQ(n.treeId.value, r["treeId"].string());
        CHECK_EQ(n.itemId.value, r["itemId"].string());
        CHECK_EQ(n.parent ? n.parent->value : "null", r["parent"].string("null"));
        CHECK_EQ(n.status == Node::Status::pick ? "pick" : "kept", r["status"].string());
        CHECK_EQ(n.why, r["why"].string());
        CHECK_EQ(n.importance, r["importance"].number());
        CHECK_EQ(n.order, r["order"].number());
        CHECK_EQ(n.view.component, r["view"]["component"].string());
        CHECK_EQ(n.view.props.dump(), r["view"]["props"].dump());
        CHECK_EQ(n.origin.role.value_or("none"), r["origin"]["role"].string("none"));
    }
    for (size_t i = 0; i < hello.snapshot.items.size(); i++) {
        const Json& r = j["snapshot"]["items"][i];
        const Item& item = hello.snapshot.items[i];
        CHECK_EQ(item.id.value, r["id"].string());
        CHECK_EQ(item.kind, r["kind"].string());
        CHECK_EQ(item.title, r["title"].string());
        CHECK_EQ(item.text, r["text"].string());
        CHECK_EQ(item.tags.size(), r["tags"].size());
        CHECK_EQ(item.data.dump(), r["data"].dump());
        CHECK_EQ(item.source.from, r["source"]["from"].string());
        CHECK_EQ(item.source.url.value_or("none"), r["source"]["url"].string("none"));
        CHECK_EQ(item.archived, r["archived"].boolean());
        CHECK_EQ(item.revision, r["revision"].integer());
    }
    const TreeInfo& tree = hello.snapshot.trees.at(0);
    CHECK_EQ(tree.title, j["snapshot"]["trees"][0]["title"].string());
    CHECK_EQ(tree.rootId.value, j["snapshot"]["trees"][0]["rootId"].string());
    CHECK_EQ(tree.createdAt, j["snapshot"]["trees"][0]["createdAt"].string());
}

TEST(aChangeKeepsItsPatchesInOrder) {
    std::string text = recordedText("Picks for \"Dolly zoom\"");
    Json r = raw(text)["set"];
    Change change = std::get<Change>(parseInbound(text));
    CHECK_EQ(change.set.seq, int64_t(r["seq"].number()));
    CHECK_EQ(change.set.id.value, r["id"].string());
    CHECK_EQ(change.set.label, r["label"].string());
    CHECK(change.set.origin.by == Origin::By::agent && change.set.origin.role == "scout", "the Scout made it");
    CHECK(change.set.part == r["part"].optionalString(), "part");
    CHECK_EQ(change.set.patches.size(), r["patches"].size());
    for (size_t i = 0; i < change.set.patches.size(); i++) {
        const Json& p = r["patches"][i];
        std::visit(overloaded{
                       [&]<class E>(const PatchOf<E>& patch) {
                           CHECK_EQ(patch.id.value, p["id"].string());
                           CHECK(!patch.before && patch.after, "patch %zu is a creation", i);
                           if (patch.after) CHECK_EQ(patch.after->id.value, p["id"].string());
                       },
                       [&](const UnknownPatch& patch) { CHECK(false, "patch %zu read as an unknown %s", i, patch.entity.c_str()); },
                   },
                   change.set.patches[i]);
        bool isItem = std::holds_alternative<PatchOf<Item>>(change.set.patches[i]);
        CHECK_EQ(isItem ? "item" : "node", p["entity"].string());
    }
    CHECK(change.undo == raw(text)["undo"].optionalString(), "undo label");
}

TEST(aMessageOfAnUnknownKindIsKeptAsUnknown) {
    Inbound message = parseInbound(R"({"t":"wave","hand":"left"})");
    auto* unknown = std::get_if<Unknown>(&message);
    CHECK(unknown && unknown->t == "wave", "read as %s", kindOf(message).c_str());
}

TEST(aChangeThisConnectionAskedForIsMarkedYours) {
    Inbound asked = parseInbound(edited(recordedText("Keep a pick"), [](Json j) { return j.set("yours", true); }));
    Inbound elsewhere = parseInbound(recordedText("Keep a pick"));
    auto* mine = std::get_if<Change>(&asked);
    auto* theirs = std::get_if<Change>(&elsewhere);
    CHECK(mine && mine->yours, "a change sent with yours is this connection's");
    CHECK(theirs && !theirs->yours, "a change sent without it is another's");
}

TEST(aPatchToAnUnknownEntityIsKeptAndTheRestRead) {
    std::string text = edited(recordedText("Keep a pick"), [](Json j) {
        Json set = j["set"];
        Json patches = set["patches"];
        patches.push(Json::object().set("entity", "comment").set("id", "c1").set("before", nullptr).set("after", Json::object().set("text", "hi")));
        set.set("patches", patches);
        return j.set("set", set);
    });
    Inbound message = parseInbound(text);
    auto* change = std::get_if<Change>(&message);
    CHECK(change, "read as %s", kindOf(message).c_str());
    if (!change) return;
    CHECK_EQ(change->set.patches.size(), size_t(2));
    CHECK(std::holds_alternative<PatchOf<Node>>(change->set.patches.at(0)), "the node patch reads");
    auto* unknown = std::get_if<UnknownPatch>(&change->set.patches.at(1));
    CHECK(unknown && unknown->entity == "comment" && unknown->id == "c1", "the comment patch is kept as unknown");
}

TEST(whatCantBeReadIsMalformedWithWhere) {
    CHECK_EQ(malformed("not json").t, "");
    CHECK_EQ(malformed(R"({"text":"no t"})").t, "");
    CHECK_EQ(malformed(R"({"t":7})").t, "");

    Malformed noSeq = malformed(edited(recordedText("Keep a pick"), [](Json j) {
        Json set = j["set"];
        set.set("seq", nullptr);
        return j.set("set", set);
    }));
    CHECK_EQ(noSeq.t, "change");
    CHECK(noSeq.why.find("set.seq") == 0, "why: %s", noSeq.why.c_str());

    Malformed badStatus = malformed(edited(recordedText("Keep a pick"), [](Json j) {
        Json set = j["set"];
        Json patch = set["patches"][0];
        Json after = patch["after"];
        after.set("status", "maybe");
        patch.set("after", after);
        set.set("patches", Json::list({patch}));
        return j.set("set", set);
    }));
    CHECK_EQ(badStatus.t, "change");
    CHECK(badStatus.why.find("set.patches[0].after.status") == 0, "why: %s", badStatus.why.c_str());

    Malformed emptyId = malformed(edited(fixture("hello.json"), [](Json j) {
        Json snapshot = j["snapshot"];
        Json nodes = snapshot["nodes"];
        Json first = nodes[0];
        first.set("id", "");
        Json list = Json::list({first});
        snapshot.set("nodes", list);
        return j.set("snapshot", snapshot);
    }));
    CHECK_EQ(emptyId.t, "hello");
    CHECK(emptyId.why.find("snapshot.nodes[0].id") == 0, "why: %s", emptyId.why.c_str());

    CHECK_EQ(malformed(R"({"t":"say"})").t, "say");
    CHECK_EQ(malformed(R"({"t":"error","message":3})").t, "error");
    CHECK_EQ(malformed(R"({"t":"heard","text":"hi","final":"yes"})").t, "heard");
}

TEST(optionalFieldsMayBeMissing) {
    Inbound older = parseInbound(edited(fixture("hello.json"), [](Json j) {
        Json out = Json::object();
        for (const auto& [key, value] : j.members()) {
            if (key != "voice" && key != "hearing" && key != "undo" && key != "live") out.set(key, value);
        }
        return out;
    }));
    auto* hello = std::get_if<Hello>(&older);
    CHECK(hello, "a hello without voice, hearing, live or undo reads: %s", kindOf(older).c_str());
    if (hello) CHECK(!hello->voice && hello->hearing == Hearing::browser && !hello->live && !hello->undo, "and has none of them");

    if (hello) CHECK(hello->connection.empty(), "nor a connection's id");

    Inbound hearing = parseInbound(edited(fixture("hello.json"), [](Json j) { return j.set("hearing", "service").set("voice", true).set("live", true).set("connection", "c-1"); }));
    auto* withHearing = std::get_if<Hello>(&hearing);
    CHECK(withHearing && withHearing->hearing == Hearing::service && withHearing->voice && withHearing->live, "hearing service, voice and live true");
    CHECK(withHearing && withHearing->connection == "c-1", "the connection's id");

    Inbound labelled = parseInbound(R"({"t":"activity","activity":{"id":"a1","role":"scout","state":"start","message":"Looking for films with a dolly zoom in them","label":"Finding dolly zooms"}})");
    auto* withLabel = std::get_if<Activity>(&labelled);
    CHECK(withLabel && withLabel->label == std::optional<std::string>("Finding dolly zooms"), "an activity's label: %s", kindOf(labelled).c_str());

    Change keep = std::get<Change>(parseInbound(recordedText("Keep a pick")));
    CHECK(!keep.set.part && !keep.set.undoes && keep.set.alsoUndoes.empty(), "a plain set has no part or undoes");
    CHECK(keep.set.origin.by == Origin::By::user && !keep.set.origin.role && !keep.set.origin.tool, "the user's origin has no role");

    Change undo = std::get<Change>(parseInbound(recordedText("Undo: Cut a card")));
    CHECK(undo.set.undoes && undo.set.undoes->value == raw(recordedText("Undo: Cut a card"))["set"]["undoes"].string(), "undoes");

    Hello final = finalHello();
    const Item* pasted = nullptr;
    for (const Item& item : final.snapshot.items) {
        if (item.source.from == "paste") pasted = &item;
    }
    CHECK(pasted && !pasted->source.url && !pasted->source.asset, "a pasted item has no url or asset");
    int roots = 0;
    for (const Node& n : final.snapshot.nodes) roots += n.parent ? 0 : 1;
    CHECK_EQ(roots, 1);

    bool sawActivityWithoutNode = false;
    for (const std::string& text : sessionTexts()) {
        if (raw(text)["t"].string("") != "activity" || raw(text)["activity"].has("nodeId")) continue;
        Inbound message = parseInbound(text);
        auto* activity = std::get_if<Activity>(&message);
        CHECK(activity && !activity->nodeId && !activity->label, "an activity without a node or label: %s", kindOf(message).c_str());
        sawActivityWithoutNode = true;
    }
    CHECK(sawActivityWithoutNode, "the session has an activity without a node");

    Inbound nowhere = parseInbound(R"({"t":"navigate"})");
    auto* navigate = std::get_if<Navigate>(&nowhere);
    CHECK(navigate && !navigate->nodeId && !navigate->treeId, "navigate with neither");
    Inbound somewhere = parseInbound(R"({"t":"navigate","nodeId":"n1"})");
    auto* toNode = std::get_if<Navigate>(&somewhere);
    CHECK(toNode && toNode->nodeId && toNode->nodeId->value == "n1" && !toNode->treeId && !toNode->yours, "navigate to a node, asked elsewhere");
    Inbound asked = parseInbound(R"({"t":"navigate","nodeId":"n1","yours":true})");
    auto* mine = std::get_if<Navigate>(&asked);
    CHECK(mine && mine->yours, "a navigate this connection asked for says so");
    Inbound search = parseInbound(
        R"({"t":"activity","activity":{"id":"a1","role":"scout","state":"start","label":"Looking into pen","detail":"Who drew on walls first?","message":"Looking into pen","nodeId":"n1"}})");
    auto* question = std::get_if<Activity>(&search);
    CHECK(question && question->detail == std::optional<std::string>("Who drew on walls first?"), "a Scout run on a card says the question it answers");
    Inbound round = parseInbound(R"({"t":"activity","activity":{"id":"a2","role":"scout","state":"start","label":"Finding more for pen","message":"Finding more for pen","nodeId":"n1"}})");
    CHECK(std::get_if<Activity>(&round) && !std::get_if<Activity>(&round)->detail, "a round with no question has no detail");

    Inbound nullUndo = parseInbound(edited(recordedText("Keep a pick"), [](Json j) { return j.set("undo", nullptr); }));
    auto* change = std::get_if<Change>(&nullUndo);
    CHECK(change && !change->undo, "undo null is none");

    CHECK(!final.snapshot.nodes.front().view.composing, "a view without composing is a finished card");
}

TEST(aComposingViewReadsAsComposing) {
    Inbound composing = parseInbound(edited(fixture("hello.json"), [](Json j) {
        Json snapshot = j["snapshot"];
        Json nodes = Json::list();
        for (const Json& n : snapshot["nodes"].array()) {
            Json node = n;
            Json view = node["view"];
            nodes.push(node.set("view", view.set("composing", true)));
        }
        return j.set("snapshot", snapshot.set("nodes", nodes));
    }));
    auto* hello = std::get_if<Hello>(&composing);
    CHECK(hello && !hello->snapshot.nodes.empty(), "a hello whose cards compose reads: %s", kindOf(composing).c_str());
    if (hello) CHECK(hello->snapshot.nodes.front().view.composing && !hello->snapshot.nodes.front().view.component.empty(), "composing: true, beside the rules' card");
}

TEST(aCardsEditsReadInOrderAndAreNoneWhenAbsent) {
    Json highlight = Json::object().set("id", "e1").set("kind", "highlight").set("quote", "the room stretches").set("at", 61);
    Json stroke = Json::object().set("id", "e2").set("kind", "stroke").set("points", Json::list({0.1, 0.2, 0.15, 0.25}));
    Json stretch = Json::object().set("id", "e4").set("kind", "stretch").set("from", 12).set("to", 20.5);
    auto withEdits = [](Json edits) {
        Json j = raw(fixture("hello.json"));
        Json snapshot = j["snapshot"];
        Json nodes = snapshot["nodes"];
        Json first = nodes[0];
        Json list = Json::list();
        list.push(first.set("edits", edits));
        for (size_t i = 1; i < nodes.size(); i++) list.push(nodes[i]);
        return parseInbound(j.set("snapshot", snapshot.set("nodes", list)).dump());
    };
    Inbound read = withEdits(Json::list({highlight, stroke, stretch}));
    auto* hello = std::get_if<Hello>(&read);
    CHECK(hello, "a node with edits reads: %s", kindOf(read).c_str());
    if (hello) {
        const std::vector<Edit>& edits = hello->snapshot.nodes.front().edits;
        CHECK_EQ(edits.size(), size_t(3));
        if (edits.size() == 3) {
            CHECK(edits[0].kind == Edit::Kind::highlight && edits[0].id == "e1" && edits[0].quote == "the room stretches" && edits[0].at == 61, "the highlight");
            CHECK(edits[1].kind == Edit::Kind::stroke && edits[1].points.size() == 2 && edits[1].points[1].second == 0.25f, "the line, two points");
            CHECK(edits[2].kind == Edit::Kind::stretch && edits[2].from == 12 && edits[2].to == 20.5, "the video's stretch, in seconds");
        }
        CHECK(hello->snapshot.nodes.back().edits.empty(), "a node without edits has none");
    }
    Inbound odd = withEdits(Json::list({Json::object().set("id", "e3").set("kind", "stroke").set("points", Json::list({0.1, 0.2, 1.5, 0.2}))}));
    auto* bad = std::get_if<Malformed>(&odd);
    CHECK(bad && bad->why.find("edits[0].points") != std::string::npos, "a point off the card is malformed: %s", bad ? bad->why.c_str() : kindOf(odd).c_str());
    Inbound backwards = withEdits(Json::list({Json::object().set("id", "e5").set("kind", "stretch").set("from", 20).set("to", 12)}));
    auto* refused = std::get_if<Malformed>(&backwards);
    CHECK(refused && refused->why.find("edits[0].to") != std::string::npos, "a stretch that ends before it begins is malformed: %s",
          refused ? refused->why.c_str() : kindOf(backwards).c_str());
}

TEST(theOtherMessagesRead) {
    for (const std::string& text : sessionTexts()) {
        Json r = raw(text);
        Inbound message = parseInbound(text);
        if (auto* say = std::get_if<Say>(&message)) CHECK_EQ(say->text, r["text"].string());
        if (auto* heard = std::get_if<Heard>(&message)) {
            CHECK_EQ(heard->text, r["text"].string());
            CHECK_EQ(heard->final, r["final"].boolean());
        }
        if (auto* handoff = std::get_if<Handoff>(&message)) {
            CHECK_EQ(handoff->name, r["name"].string());
            CHECK_EQ(handoff->url, r["url"].string());
            CHECK_EQ(handoff->markdown, r["markdown"].string());
            CHECK_EQ(handoff->files.size(), r["files"].size());
        }
        if (auto* settings = std::get_if<SettingsChanged>(&message)) CHECK_EQ(settings->settings.picksPerRun, r["settings"]["picksPerRun"].integer());
        if (auto* rejected = std::get_if<Rejected>(&message)) CHECK_EQ(rejected->message, r["message"].string());
        if (auto* activity = std::get_if<Activity>(&message)) {
            CHECK_EQ(activity->id, r["activity"]["id"].string());
            CHECK_EQ(activity->role, r["activity"]["role"].string());
            std::string state = activity->state == Activity::State::start ? "start" : activity->state == Activity::State::done ? "done" : "error";
            CHECK_EQ(state, r["activity"]["state"].string());
            CHECK_EQ(activity->nodeId ? activity->nodeId->value : "none", r["activity"]["nodeId"].string("none"));
        }
    }
    Inbound asked = parseInbound(R"({"t":"questions","nodeId":"n1","questions":["Where did it start?","Who uses it now?"]})");
    auto* q = std::get_if<Questions>(&asked);
    const std::vector<std::string> written = {"Where did it start?", "Who uses it now?"};
    CHECK(q && q->nodeId.value == "n1" && q->questions == written, "questions");
    Inbound none = parseInbound(R"({"t":"questions","nodeId":"n1","questions":[]})");
    CHECK(std::get_if<Questions>(&none) && std::get_if<Questions>(&none)->questions.empty(), "no questions");
    Inbound note = parseInbound(R"({"t":"note","role":"scout","message":"failed: no network"})");
    auto* n = std::get_if<Note>(&note);
    CHECK(n && n->role == "scout" && n->message == "failed: no network", "note");
}

TEST(everyOutboundMessageIsExactly) {
    for (const auto& [message, expected] : outboundCases()) CHECK_EQ(message.text(), expected);
}

std::vector<std::pair<Outbound, std::string>> outboundCases() {
    NodeId n1{"n1"}, n2{"n2"};
    TreeId t1{"t1"}, t2{"t2"};
    Scene scene{.focus = n1, .selection = {n2}, .treeId = t1};
    return {
        {Outbound::dump({Dump::text("Dolly zoom")}), R"({"dumps":[{"kind":"text","text":"Dolly zoom"}],"t":"dump"})"},
        {Outbound::dump({Dump::text("notes", "notes.txt"), Dump::link("https://example.com/a"), Dump::asset("a1", "image/png", "shot.png")}),
         R"({"dumps":[{"kind":"text","name":"notes.txt","text":"notes"},{"kind":"link","url":"https://example.com/a"},)"
         R"({"asset":"a1","kind":"asset","mime":"image/png","name":"shot.png"}],"t":"dump"})"},
        {Outbound::utter("more like", false, scene),
         R"({"final":false,"scene":{"focus":"n1","selection":["n2"],"treeId":"t1"},"t":"utter","text":"more like"})"},
        {Outbound::utter("hello", true, Scene{}), R"({"final":true,"scene":{"selection":[]},"t":"utter","text":"hello"})"},
        {Outbound::focus(n1), R"({"nodeId":"n1","t":"focus"})"},
        {Outbound::ask(n1, "why does it work"), R"({"need":"why does it work","nodeId":"n1","t":"ask"})"},
        {Outbound::more(n1), R"({"nodeId":"n1","t":"more"})"},
        {Outbound::questions(n1), R"({"nodeId":"n1","t":"questions"})"},
        {Outbound::more(n1, "older films"), R"({"need":"older films","nodeId":"n1","t":"more"})"},
        {Outbound::keep({n1, n2}), R"({"nodeIds":["n1","n2"],"t":"keep"})"},
        {Outbound::undo(), R"({"t":"undo"})"},
        {Outbound::undo(SetId{"s1"}), R"({"id":"s1","t":"undo"})"},
        {Outbound::commands("Cut a card", {Command::deleteNode(n1)}), R"({"commands":[{"id":"n1","type":"deleteNode"}],"label":"Cut a card","t":"commands"})"},
        {Outbound::commands("Add Dracula", {Command::addNode(NodeId{"n3"}, t1, ItemId{"library:film:0"}, n1, 2)}),
         R"({"commands":[{"node":{"id":"n3","importance":1,"itemId":"library:film:0","order":2,"origin":{"by":"user"},"parent":"n1","status":"kept",)"
         R"("treeId":"t1","view":{"by":"default","component":"note","composing":true,"props":{}},"why":""},"type":"addNode"}],"label":"Add Dracula","t":"commands"})"},
        {Outbound::commands("Rearrange", {Command::moveNode(n1, n2), Command::moveNode(n1, n2, t2, 2.5), Command::renameTree(t1, "Zooms"),
                                          Command::deleteTree(t2)}),
         R"({"commands":[{"id":"n1","parent":"n2","type":"moveNode"},{"id":"n1","order":2.5,"parent":"n2","treeId":"t2","type":"moveNode"},)"
         R"({"id":"t1","title":"Zooms","type":"renameTree"},{"id":"t2","type":"deleteTree"}],"label":"Rearrange","t":"commands"})"},
        {Outbound::commands("Highlight", {Command::addEdit(n1, Edit{.id = "e1", .kind = Edit::Kind::highlight, .quote = "the lens zooms in", .at = 30}),
                                          Command::addEdit(n1, Edit{.id = "e2", .kind = Edit::Kind::highlight, .quote = "dread"})}),
         R"({"commands":[{"edit":{"at":30,"id":"e1","kind":"highlight","quote":"the lens zooms in"},"id":"n1","type":"addEdit"},)"
         R"({"edit":{"id":"e2","kind":"highlight","quote":"dread"},"id":"n1","type":"addEdit"}],"label":"Highlight","t":"commands"})"},
        {Outbound::commands("Draw", {Command::addEdit(n1, Edit{.id = "e3", .kind = Edit::Kind::stroke, .points = {{0.1f, 0.25f}, {0.123456f, 1.2f}}})}),
         R"({"commands":[{"edit":{"id":"e3","kind":"stroke","points":[0.1,0.25,0.1235,1]},"id":"n1","type":"addEdit"}],"label":"Draw","t":"commands"})"},
        {Outbound::commands("Erase", {Command::removeEdit(n1, "e3")}), R"({"commands":[{"editId":"e3","id":"n1","type":"removeEdit"}],"label":"Erase","t":"commands"})"},
        {Outbound::commands("Mark a stretch", {Command::addEdit(n1, Edit{.id = "e4", .kind = Edit::Kind::stretch, .from = 12.004, .to = 20.456})}),
         R"({"commands":[{"edit":{"from":12,"id":"e4","kind":"stretch","to":20.46},"id":"n1","type":"addEdit"}],"label":"Mark a stretch","t":"commands"})"},
        {Outbound::commands("Erase the marks", {Command::removeEdit(n1, "e1"), Command::removeEdit(n1, "e4")}),
         R"({"commands":[{"editId":"e1","id":"n1","type":"removeEdit"},{"editId":"e4","id":"n1","type":"removeEdit"}],"label":"Erase the marks","t":"commands"})"},
        {Outbound::organize("tidy this", Scope{.treeIds = {t1}}), R"({"request":"tidy this","scope":{"nodeIds":[],"treeIds":["t1"]},"t":"organize"})"},
        {Outbound::organize("tidy", Scope{.nodeIds = {n1}}, n1), R"({"focus":"n1","request":"tidy","scope":{"nodeIds":["n1"],"treeIds":[]},"t":"organize"})"},
        {Outbound::handoff(Scope{}), R"({"scope":{"nodeIds":[],"treeIds":[]},"t":"handoff"})"},
        {Outbound::handoff(Scope{.treeIds = {t1}}, "for Sam"), R"({"note":"for Sam","scope":{"nodeIds":[],"treeIds":["t1"]},"t":"handoff"})"},
        {Outbound::settings(SettingsPatch{.picksMode = PicksMode::immediate, .picksPerRun = 3, .scoutOnDump = false}),
         R"({"patch":{"picksMode":"immediate","picksPerRun":3,"scoutOnDump":false},"t":"settings"})"},
        {Outbound::settings(SettingsPatch{}), R"({"patch":{},"t":"settings"})"},
        {Outbound::client(Media{.embeds = false, .files = {"mp4", "webm", "mp3"}}), R"({"media":{"embeds":false,"files":["mp4","webm","mp3"]},"t":"client"})"},
        {Outbound::worn(42.36), R"({"away":42.4,"t":"worn"})"},
        {Outbound::share(t1), R"({"t":"share","tree":"t1"})"},
    };
}
