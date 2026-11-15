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

void Sheet::part(float height, std::function<void(const Pen&, float top)> draw) {
    if (!first) y += gap;
    first = false;
    float top = y, scale = k;
    draws.push_back([draw, top, scale](Canvas& ctx) { draw(Pen{ctx, scale}, top); });
    y += height;
}

void Sheet::paragraph(const std::string& s, const Setting& t, Color color, int lines) {
    if (s.empty()) return;
    float h = heightOf(s, width, lines, t, k);
    if (!first) y += gap;
    first = false;
    Run run{s, CGPoint{left * k, y * k - lift(t, k)}, width * k, lines, attributes(t, color, k)};
    runs.push_back(run);
    draws.push_back([run](Canvas& ctx) { ctx.drawText(run.text, run.at, run.attributes, run.width, run.lines); });
    said.push_back(s);
    y += h;
}

}  // namespace cards
