// The registry of card types (components/index.js), and the opened card's layout.
#include "kind.h"

#include <cmath>

namespace cards {

const Kind* kindNamed(const std::string& component) {
    static const Kind* const all[] = {&kinds::note, &kinds::quote, &kinds::image};
    for (const Kind* kind : all) {
        if (component == kind->name) return kind;
    }
    return nullptr;
}

const Kind& note() { return kinds::note; }

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
