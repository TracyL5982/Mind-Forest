// Replays the headset's saved trees with the Quest app's own code and prints the steps walked, each with the
// step it hangs from and the label on its thread. Built and run by scripts/saved-trees.ts.
#include <fstream>
#include <iostream>
#include <sstream>

#include "ocean/catalog.h"
#include "ocean/library.h"
#include "ocean/tree.h"
#include "platform.h"

static std::string repo;

namespace platform {
std::string resourcePath(const std::string& name) {
    return repo + "/library/" + name;
}
std::optional<std::string> readText(const std::string& name) {
    std::ifstream file(resourcePath(name));
    if (!file) return std::nullopt;
    std::stringstream text;
    text << file.rdbuf();
    return text.str();
}
}  // namespace platform

int main(int argc, char** argv) {
    if (argc < 2) return 2;
    repo = argv[1];
    std::shared_ptr<ClipLibrary> clips = ClipLibrary::make();
    std::shared_ptr<Catalog> catalog = Catalog::make(clips ? clips->clips : std::vector<Clip>{}, WorkLibrary::make());
    if (!catalog) return 1;
    Json trees = Json::list();
    for (const SavedSpec& spec : catalog->saved) {
        std::shared_ptr<Tree> tree = Tree::replay(spec, catalog);
        if (!tree) return 1;
        // A step is a card that was opened. Only an opened card brings cards round it, so a step always hangs from another step.
        std::map<int, int> stepOf;
        Json steps = Json::list();
        for (const auto& [id, node] : tree->nodes) {
            if (!node.opened) continue;
            Json step = Json::object();
            step.set("ref", node.ref.key());
            step.set("parent", node.parent ? Json(double(stepOf.at(*node.parent))) : Json());
            step.set("why", node.why);
            stepOf[id] = int(stepOf.size());
            steps.push(step);
        }
        Json saved = Json::object();
        saved.set("title", spec.title);
        Json walked = Json::list();
        for (const std::string& s : spec.steps) walked.push(s);
        saved.set("walked", walked);
        saved.set("steps", steps);
        trees.push(saved);
    }
    std::cout << trees.dump(true) << "\n";
    return 0;
}
