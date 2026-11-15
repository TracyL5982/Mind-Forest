// The registry of card types (components/index.js), and the opened card's layout.
#include "kind.h"

#include <cmath>
#include <map>

namespace cards {

namespace {
std::map<std::string, const Kind*>& registry() {
    static std::map<std::string, const Kind*> all;
    return all;
}
}  // namespace

Registered::Registered(const Kind& kind) { registry()[kind.name] = &kind; }

const Kind* kindNamed(const std::string& component) {
    auto it = registry().find(component);
    return it == registry().end() ? nullptr : it->second;
}

const Kind& note() { return *kindNamed("note"); }

void Sheet::part(float height, std::function<void(const Pen&, float top)> draw, std::vector<float> breaks) {
    if (!first) y += gap;
    first = false;
    blocks.push_back(Block{y, height, std::move(draw), std::move(breaks)});
    y += height;
}

void Sheet::paragraph(const std::string& s, const Setting& t, Color color, int lines) {
    if (s.empty()) return;
    float h = heightOf(s, width, lines, t, k);
    if (!first) y += gap;
    first = false;
    Run run{s, CGPoint{left * k, y * k - lift(t, k)}, width * k, lines, attributes(t, color, k)};
    runs.push_back(run);
    std::vector<float> breaks;
    for (float at = t.lead; at < h - 1; at += t.lead) breaks.push_back(at);
    float top = y;
    blocks.push_back(Block{top, h, [run, top](const Pen& pen, float at) {
                               pen.ctx.drawText(run.text, CGPoint{run.at.x, run.at.y + (at - top) * pen.k}, run.attributes, run.width, run.lines);
                           }, breaks});
    said.push_back(s);
    y += h;
}

}  // namespace cards
