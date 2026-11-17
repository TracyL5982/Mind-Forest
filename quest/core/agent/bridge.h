// The agent service in the ocean: its mindstorm drawn as trees, and what a hand does sent back to it.
// Made at launch only with `-agent <address>`; without it the ocean is exactly as it was.
//
// Each service tree is a `Tree` with `grows` off, so its cards come from the service, never from the
// catalog. Its trees keep the forest's rules: at launch nothing stands and every tree is put away on the desk, the
// newest first, where it stood last time (plots.h). A tree this headset asks for stands as a tree the user starts always
// has, the standing one put away first; one asked for anywhere else is only put away. A service item
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

#include "agent/asking.h"
#include "agent/client.h"
#include "agent/presence_view.h"
#include "agent/plots.h"
#include "agent/voice.h"
#include "ocean/catalog.h"
#include "ocean/tree.h"

class OceanModel;
struct CardEdit;

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
    /// Where a card of a service tree plays its video from: a file the service holds (its view is "video" and its `src`
    /// is a path on the service), as an address with the headset's token, streamed as it plays. None for any other card,
    /// and for a video somewhere else, such as a web page.
    std::optional<std::string> video(int nodeID);
    /// The rows under an open card of a service tree: "Keep this" for a suggestion, then what can be asked about it (at most
    /// three of the questions the service wrote for the card and the conversation, once they come), then typing your own.
    void rows(const TreeNode& node, std::vector<Ask>& asks);
    /// The most of the service's questions an open card offers.
    static constexpr size_t mostQuestions = 3;
    /// One of the open card's rows was picked. A question is a conversation about the card: the card starts a layer
    /// (keeping it, if it was a suggestion) and the service brings related suggestions round it. True when the
    /// service takes it (the tree is the service's).
    bool ask(int nodeID, int k);
    /// A long pinch on the open card: more like it, through the service's `more`, as Momo's "more like this" asks. The card
    /// leads a layer of its own (kept, if it was a suggestion), and when it has highlights the request leans on them.
    void moreLike(int nodeID);
    /// A tree the user starts from one of the headset's own pieces (a film, work or note of the ocean), asked of Momo as
    /// the user would say it, so the service makes it, rooted on that piece, and it stands when it comes (`changed`).
    /// False when the service can't be reached.
    bool treeFrom(const Ref& ref);
    /// Whether a tree is one of the service's.
    bool serves(const Tree& tree);
    /// One of the headset's own pieces brought into the standing tree, which is the service's: it goes to the service as a
    /// kept card of the user's under the card in focus, as Kai's trees take one, and comes back drawn in progress until the
    /// service chooses its look, with Momo's rows as every card of the tree. Already on the tree, it is not added again.
    /// False when the service can't be reached, or the piece is not of the headset's library.
    bool addPiece(const Ref& ref);
    /// Send on a service card gone into, with something marked on it: `question` ("Tell me more about these parts: …"), a
    /// conversation about the card, as a picked question is.
    void tellMore(int nodeID, const std::string& question);
    /// Whether a card is the service's, so the pen's marks on it are kept with it.
    bool editable(int nodeID);
    /// The highlights and lines the service keeps on a card, as the scene draws them.
    std::vector<CardEdit> edits(int nodeID);
    /// One was made on the headset, or all of a card's taken off at once (the eraser): kept by the service as one change,
    /// which it undoes as it undoes any.
    void edited(int nodeID, const CardEdit& edit);
    void erasedAll(int nodeID, const std::vector<std::string>& editIds);
    /// A branch was cut with the flat of the hand; `gone` is what left with it.
    void pruned(int nodeID, const std::vector<TreeNode>& gone);
    /// Writes down where this service's trees stand on the desk, in place of the headset's own shelf file.
    void saveShelf();

    // GUIDE: the welcome walk's way to Momo's ears and voice (voice.h, `Tutor`); null with -agentVoice off.
    Voice* talk() { return voice.get(); }

private:
    /// One service tree as the scene holds it.
    struct Planted {
        std::shared_ptr<Tree> tree;
        std::map<std::string, int> local;           // service node id -> TreeNode id
        std::map<int, std::string> service;         // TreeNode id -> service node id
    };
    OceanModel& model;
    Client client;
    /// Talking to the agent: on with `-agent`, unless `-agentVoice off`.
    std::unique_ptr<Voice> voice;
    /// Momo low in front of you, showing what the voice and the agents are doing, with the words said beside it.
    std::unique_ptr<PresenceView> presenceView;
    void showPresence();
    /// Where the user is, for what they say: the standing tree and its open card.
    Scene scene();
    std::optional<std::string> dump;
    std::map<std::string, Planted> trees;           // by service tree id
    /// The open cards' rows asked about and still being searched for, so a row picked again is not asked again.
    Asking asking;
    /// The row a hand just picked answers at once, before the service does: it dims and comes back.
    void acknowledge(int nodeID, int k);
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
    /// `-agentType <words> -agentTypeAt <s>`: the words are asked then, as typed on the headset, for runs with no keyboard.
    std::optional<double> typeAt;
    /// Where each of this service's trees stands on the desk, by service tree id: read at launch, written with the shelf.
    Plots plots;
    /// Which layer the user last stood on in each, by the service card leading it: read at launch, written with the shelf.
    Stands stands;
    double now = 0;

    void synced(const Delta& delta);
    /// `yours`: this headset asked for the change.
    void changed(const Delta& delta, bool animate, bool yours);
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
    /// A card the user asks about leads a layer of its own, kept if it was a suggestion, where what the service brings stands.
    void lead(Planted& p, int nodeID);
    /// A service node's edits as the scene draws them.
    std::vector<CardEdit> sceneEdits(const Node& node);
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
    void fetchPicture(const std::string& src);
    /// Pictures fetched and unpacked on a host thread, waiting for the frame thread: each with its picture, or none and
    /// whether the service said it can't be had (not found, gone, or not a picture the headset can draw) or it may yet come.
    struct Came {
        std::string src;
        ImageRef image;
        bool gone = false;
    };
    struct Pictures {
        std::mutex lock;
        std::vector<Came> arrived;
    };
    std::shared_ptr<Pictures> pictures = std::make_shared<Pictures>();
    std::set<std::string> asked;                    // picture addresses already fetched or on their way
    /// Pictures that did not come, asked for again until they do, 1, 2, 4 and 8 s on, then every 15 s: when next, and how many
    /// times so far.
    struct Retry {
        double at = 0;
        int tries = 0;
    };
    std::map<std::string, Retry> retries;
    Planted* plantedOf(const Tree& tree);
    Planted* holding(const std::string& nodeId);
    bool standing(const Planted& p) const;
    /// Tells the service which card is open when that changes: standing a tree, unfolding a cover, a pinch, a step.
    void reportFocus();

    /// A `navigate` this headset asked for (`Navigate::yours`), carried out once neither the user nor Momo is speaking, so the view does not move
    /// mid-sentence, and once its tree stands: taken off the shelf as a pinch on its cover takes it. A later one replaces it.
    struct Going {
        Navigate to;
        double came = 0;                        // when it came
        std::optional<double> waitingSince;     // since its tree was asked to stand
    };
    std::optional<Going> going;
    void goOn();
    /// Whether the user is heard or their turn is being sent, or Momo's reply has come, is on its way or plays.
    bool speaking() const;
    /// Brings a card of the standing tree into view the way hands go to one: a card that leads a layer stands on it, any
    /// other opens on its group's layer, which stands first, each card on the way leading its own layer.
    void bring(Planted& p, int id);
};

}  // namespace agent
