// components/code.js: a sunk face, a fixed-width face, and a numbered gutter.
#include <algorithm>
#include <cmath>

#include "rows.h"

namespace cards {

namespace {

constexpr int WIDTH = 304;
constexpr int SHOWN = 7;
constexpr Setting CODE{12.5f, 17};
/// `.code-source`'s colour.
constexpr Color SOURCE = Color::hex(0xCDD6E4);
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

Footprint size(const Item&, const Json& props) {
    return {WIDTH, FRAME + TITLE + 8 + int(clamp(int64_t(linesOf(props).size()), 1, SHOWN)) * TEXT};
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float body) {
    float x = 16, column = width - 32, y = 14;
    std::string named = language(props);
    float labelled = named.empty() ? 0 : labelWidth(named, pen.k);
    pen.words(item.titleOrUntitled(), x, y, column - (named.empty() ? 0 : 10 + labelled), 1, setting::title, palette::ink);
    if (!named.empty()) label(pen, named, x + column - labelled, y + (TITLE - TEXT) / 2.f, look.ink2);
    y += TITLE + 8;

    // `.code-lines`: the numbers set right, 10 px, then a rule, all of it at least two figures wide (`border-box`).
    std::vector<std::string> lines = linesOf(props);
    lines.resize(std::min(lines.size(), size_t(SHOWN)));
    float figures = std::max(2 * pen.width("0", CODE) - 11, pen.width(std::to_string(lines.size()), CODE));
    float tall = body - 14 - y;
    for (size_t i = 0; i < lines.size(); i++) {
        std::string n = std::to_string(i + 1);
        float w = pen.width(n, CODE);
        pen.words(n, x + figures - w, y + float(i) * TEXT, w + 1, 1, CODE, look.ink3);
    }
    pen.ctx.setFillColor(palette::line);
    pen.ctx.fill(pen.px(x + figures + 10, y, 1, tall));

    // `.code-source`: cut at the card's edge, and faded over its last 28 px.
    float left = x + figures + 10 + 1 + 11, room = x + column - left;
    pen.ctx.saveGState();
    pen.ctx.clip(pen.px(left, y, room, tall));
    for (size_t i = 0; i < lines.size(); i++) pen.words(lines[i], left, y + float(i) * TEXT, INFINITY, 1, CODE, SOURCE);
    pen.ctx.restoreGState();
    const int bands = 14;
    for (int i = 0; i < bands; i++) {
        pen.ctx.setFillColor(look.fill.withAlphaComponent((float(i) + 0.5f) / bands));
        pen.ctx.fill(pen.px(left + room - FADE + FADE * float(i) / bands, y, FADE / bands, tall));
    }
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
