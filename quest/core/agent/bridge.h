// The agent service in the ocean: its mindstorm drawn as trees, and what a hand does sent back to it.
// Made at launch only with `-agent <address>`; without it the ocean is exactly as it was.
//
// Each service tree is a `Tree` with `grows` off, so its cards come from the service, never from the
// catalog. The newest stands when nothing does; the rest hang as covers on the shelf. A service item
// is a note in the catalog ("agent-<item id>"), or the film or work itself when it is from the
// headset's own library. A pick is a node that is not kept: its thread is dashed until a pinch keeps it.
#pragma once
#include <map>
#include <mutex>
#include <set>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "agent/client.h"
#include "agent/presence_view.h"
#include "agent/voice.h"
#include "ocean/catalog.h"
#include "ocean/tree.h"

class OceanModel;

namespace agent {

class Bridge {
public:
    /// The bridge `-agent`, `-agentToken` and `-agentDump` ask for, or null when there is no `-agent`.
    static std::shared_ptr<Bridge> fromFlags(OceanModel& model);
    Bridge(OceanModel& model, Address address, std::shared_ptr<Transport> transport, std::optional<std::string> dump);

    /// Once a frame, on the frame thread: what the service sent since the last frame reaches the scene.
    void frame(double now);
    /// A pinch on a card of a service tree on the layer you work on: it opens where it stands, to show its details, once
    /// its parent's group stands (it may not, for a card whose parent has led no layer yet). True when it did; otherwise
    /// the scene does what it always did (going back to a card's own layer).
    bool opens(int nodeID);
    /// The rows under an open card of a service tree: "Keep this" for a suggestion, then what can be asked about it (the
    /// questions the service wrote for the card and the conversation, once they come), then typing your own.
    void rows(const TreeNode& node, std::vector<Ask>& asks);
    /// One of the open card's rows was picked. A question is a conversation about the card: the card starts a layer
    /// (keeping it, if it was a suggestion) and the service brings related suggestions round it. True when the
    /// service takes it (the tree is the service's).
    bool ask(int nodeID, int k);
    /// The marked part of the open card was asked about. True when the service takes it.
    bool askMark(int nodeID, const Mark& mark);
    /// A branch was cut with the flat of the hand; `gone` is what left with it.
    void pruned(int nodeID, const std::vector<TreeNode>& gone);
    /// The tree was pressed by a clap: sent on, or put away.
    void pressed(const Tree& tree, bool send);

private:
    /// One service tree as the scene holds it.
    struct Planted {
        std::shared_ptr<Tree> tree;
        std::map<std::string, int> local;           // service node id -> TreeNode id
        std::map<int, std::string> service;         // TreeNode id -> service node id
    };
    /// A service activity on a card, shown as the scene's "Thinking…" until it is done.
    struct Thinking {
        std::string tree;
        int node;
        double shown;
    };

    OceanModel& model;
    Client client;
    /// Talking to the agent: on with `-agent`, unless `-agentVoice off`.
    std::unique_ptr<Voice> voice;
    /// Momo low in front of you: an orb that shows what the voice is doing, with the words said beside it.
    std::unique_ptr<PresenceView> presenceView;
    Presence presence;
    void showPresence();
    /// Where the user is, for what they say: the standing tree and its open card.
    Scene scene();
    std::optional<std::string> dump;
    std::map<std::string, Planted> trees;           // by service tree id
    std::map<std::string, Thinking> thinking;       // by activity id
    /// The service node last reported as open, so the service hears each time the open card changes.
    std::optional<std::string> focusSent;
    /// The open card's questions from the service: asked for once each time it opens, empty until they come.
    struct Offered {
        std::string nodeId;
        std::vector<std::string> questions;
    };
    std::optional<Offered> offered;
    void offer(const Questions& q);
    /// Builds an open card's rows again where they stand, after what they offer changed.
    void refreshRows(int localId);
    /// `-agentWalk <n>`: for runs with no hands, the first new pick round the open card is pinched, n times.
    int walk = 0;
    /// `-keyboardTest`: brings up the system keyboard once, 3 s in, and logs what is typed.
    bool keyboardTest = false;
    double now = 0;

    void synced(const Delta& delta);
    void changed(const Delta& delta, bool animate);
    void activity(const Activity& a);
    /// Makes the scene's tree for a service tree, with every node the mirror holds for it.
    Planted* plant(const TreeInfo& info);
    /// Puts one service node into its tree. Returns the TreeNode id, or nullopt if its parent is not there yet.
    std::optional<int> graft(Planted& p, const Node& node);
    /// Takes a service node, and what hangs from it, out of the scene.
    void remove(const std::string& nodeId);
    /// The scene's reference for a node: its library film, work, tag or note, or a note made for it in the
    /// catalog ("agent-<node id>"), drawn by the card library (core/cards) in the web client's look.
    Ref refFor(const Item& item, const Node& node);
    /// Hands a node's view and item to the card library. True when what its card draws changed.
    bool paint(const Item& item, const Node& node);
    /// Draws a card already in the standing tree again, from where it is, after its content changed.
    void redraw(int localId);
    /// A conversation about a card: it leads a layer of its own (kept, if it was a suggestion), and the question goes
    /// to the service, which brings related suggestions round it.
    void converse(int nodeID, const std::string& question);
    /// What was typed on the system keyboard, waiting for the frame thread: the text, and whether it was sent.
    struct Typed {
        std::mutex lock;
        std::vector<std::pair<std::string, bool>> done;
    };
    std::shared_ptr<Typed> typed = std::make_shared<Typed>();
    std::optional<int> typingFor;                   // the card the keyboard is open for
    /// Brings up the keyboard for a question about a card.
    void type(int nodeID);
    /// Fetches the pictures a card shows from the service, off the frame thread.
    void fetchPictures(const std::string& noteID);
    /// Pictures fetched and unpacked on a host thread, waiting for the frame thread.
    struct Pictures {
        std::mutex lock;
        std::vector<std::pair<std::string, ImageRef>> arrived;
    };
    std::shared_ptr<Pictures> pictures = std::make_shared<Pictures>();
    std::set<std::string> asked;                    // picture addresses already fetched or on their way
    Planted* plantedOf(const Tree& tree);
    Planted* holding(const std::string& nodeId);
    bool standing(const Planted& p) const;
    /// Tells the service which card is open when that changes: standing a tree, unfolding a cover, a pinch, a step.
    void reportFocus();

    /// A `navigate` from the service, carried out once neither the user nor Momo is speaking, so the view does not move
    /// mid-sentence, and once its tree stands: taken off the shelf as a pinch on its cover takes it. A later one replaces it.
    struct Going {
        Navigate to;
        double came = 0;                        // when it came
        std::optional<double> waitingSince;     // since its tree was asked to stand
    };
    std::optional<Going> going;
    void goOn();
    /// Whether the user is heard, Momo thinks about what they said, or Momo speaks.
    bool speaking() const;
    /// Brings a card of the standing tree into view the way hands go to one: a card that leads a layer stands on it, any
    /// other opens on its group's layer, which stands first, each card on the way leading its own layer.
    void bring(Planted& p, int id);
};

}  // namespace agent
