// components/note.js: plain paper. The one line the model sets apart hangs from a rule.
#include "face.h"
#include "kind.h"

namespace cards {

namespace {

constexpr int WIDTH = 240;
constexpr int COLUMN = WIDTH - SIDES;

struct Plan {
    std::string title, emphasis, body;
    int titleLines = 1, bodyLines = 0;
};

Plan plan(const Item& item, const Json& props) {
    Plan p;
    p.title = item.titleOrUntitled();
    p.emphasis = text(props["emphasis"]);
    const std::string& body = !item.summary.empty() ? item.summary : item.text;
    p.body = !body.empty() && body != item.title ? body : "";
    p.titleLines = fold(points(p.title), COLUMN, TITLE_LETTER, 2);
    p.bodyLines = p.body.empty() ? 0 : fold(points(p.body), COLUMN, TEXT_LETTER, p.emphasis.empty() ? 3 : 2);
    return p;
}

/// A title, the body under it in whole lines, and the cue when the body runs on.
void lay(Col& c, const Item& item, const Json&) {
    const std::string& body = !item.summary.empty() ? item.summary : item.text;
    std::string shown = !body.empty() && body != item.title ? body : "";
    if (!c.title(item.titleOrUntitled())) return;
    if (!shown.empty() && c.room() >= face::GAP + face::BODY) {
        c.gap(face::GAP);
        c.lines(shown, Measure::body, 99, c.look.ink2);
    } else if (!shown.empty()) {
        c.more = true;
    }
    if (c.more) c.cue(cueMore(c.words));
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}




void detail(Sheet&, const Item&, const Json&) {}

const Kind kind{"note", size, {}, draw, detail};
const Registered registered{kind};

}  // namespace

}  // namespace cards
