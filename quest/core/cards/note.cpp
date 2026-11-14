// components/note.js: plain paper. The one line the model sets apart hangs from a rule.
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

Footprint size(const Item& item, const Json& props) {
    Plan p = plan(item, props);
    return {WIDTH, FRAME + p.titleLines * TITLE + (p.emphasis.empty() ? 0 : 6 + TEXT) + (p.bodyLines ? 6 + p.bodyLines * TEXT : 0)};
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float) {
    Plan p = plan(item, props);
    float x = 16, column = width - 32, y = 14;
    pen.words(p.title, x, y, column, p.titleLines, setting::title, palette::ink);
    y += float(p.titleLines * TITLE);
    if (!p.emphasis.empty()) {
        y += 6;
        pen.ctx.setFillColor(look.accent);
        pen.ctx.fill(pen.px(x, y, 2, TEXT));
        Setting italic = setting::text;
        italic.italic = true;
        pen.words(p.emphasis, x + 11, y, column - 11, 1, italic, palette::ink);
        y += TEXT;
    }
    if (p.bodyLines) pen.words(p.body, x, y + 6, column, p.bodyLines, setting::text, look.ink2);
}

void detail(Sheet&, const Item&, const Json&) {}

const Kind kind{"note", size, {}, draw, detail};
const Registered registered{kind};

}  // namespace

}  // namespace cards
