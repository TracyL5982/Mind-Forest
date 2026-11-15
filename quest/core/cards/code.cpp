// components/code.js: a sunk face, a fixed-width face, and a numbered gutter.
#include <algorithm>
#include <cmath>

#include "face.h"
#include "rows.h"

namespace cards {

namespace {

constexpr int WIDTH = 304;
constexpr int SHOWN = 7;
constexpr Setting CODE{12.5f, 17, Font::Weight::regular, false, false, true};
/// `.code-source`'s colour.
constexpr Color SOURCE = palette::ink2;
/// Where the source fades out, at the end of its column, px.
constexpr float FADE = 28;

/// `props.source` split at each line feed, each tab set to the next stop of eight, as `white-space: pre` sets one.
std::vector<std::string> linesOf(const Json& props) {
    std::vector<std::string> out{""};
    int column = 0;
    for (char c : text(props["source"])) {
        if (c == '\n') {
            out.emplace_back();
            column = 0;
        } else if (c == '\t') {
            int spaces = 8 - column % 8;
            out.back().append(size_t(spaces), ' ');
            column += spaces;
        } else {
            out.back() += c;
            if ((c & 0xC0) != 0x80) column++;
        }
    }
    return out;
}

/// The Renderer sends `text` when it does not know the language, and that names nothing.
std::string language(const Json& props) {
    std::string given = text(props["language"]);
    return given == "text" ? "" : given;
}

/// The title, and one meta line in place of the source: how many lines, in what language.
void lay(Col& c, const Item& item, const Json& props) {
    if (!c.title(item.titleOrUntitled())) return;
    c.gap(face::GAP);
    c.lines(cueCodeLines(c.words, int(linesOf(props).size()), language(props)), Measure::meta, 1, palette::ink2);
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}




/// `.code-source.is-full`: the whole source in a dark box, at most 420 px tall, cut where it runs past the box.
void detail(Sheet& sheet, const Item&, const Json& props) {
    std::vector<std::string> lines = linesOf(props);
    float tall = std::min(20 + float(lines.size()) * TEXT, 420.f);
    sheet.part(tall, [lines, tall](const Pen& pen, float y) {
        CGRect box = pen.px(Sheet::left, y, Sheet::width, tall);
        pen.ctx.setFillColor(Color::black(0.35f));
        pen.rounded(box, 8 * pen.k);
        pen.ctx.fillPath();
        pen.ctx.saveGState();
        pen.ctx.clip(box);
        for (size_t i = 0; i < lines.size(); i++) pen.words(lines[i], Sheet::left + 12, y + 10 + float(i) * TEXT, INFINITY, 1, CODE, SOURCE);
        pen.ctx.restoreGState();
    });
    std::string source = text(props["source"]);
    if (!source.empty()) sheet.said.push_back(source);
}

Kind make() {
    Kind k{"code", size, {}, draw, detail};
    k.face = Kind::Face::sunk;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
