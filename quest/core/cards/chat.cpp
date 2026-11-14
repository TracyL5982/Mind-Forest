// components/chat.js: speech bubbles, yours on the right, and where the chat came from.
#include <algorithm>
#include <cmath>

#include "rows.h"

namespace cards {

namespace {

constexpr int WIDTH = 288;
constexpr int SHOWN = 3;
/// A bubble is at most 86 percent of the card's column, less its own padding.
constexpr int COLUMN = (WIDTH - SIDES) * 86 / 100 - 20;

struct Message {
    std::string text;
    bool user;
};

std::vector<Message> messagesOf(const Json& list, size_t most) {
    std::vector<Message> out;
    for (const Json& m : list.array()) {
        if (out.size() == most) break;
        out.push_back({text(m["text"]), text(m["role"]) == "user"});
    }
    return out;
}

int linesOf(const Message& m) { return fold(points(m.text), COLUMN, TEXT_LETTER, 2); }

Footprint size(const Item&, const Json& props) {
    std::vector<Message> shown = messagesOf(props["messages"], SHOWN);
    int bubbles = shown.empty() ? 0 : 2;
    for (const Message& m : shown) bubbles += 6 + 12 + linesOf(m) * TEXT;
    return {WIDTH, FRAME + TITLE + bubbles + (text(props["source"]).empty() ? 0 : 6 + TEXT)};
}

/// `.bubble`: 10 px corners but the one under the speaker, which is 3, on the white or, for yours, the accent.
void bubble(const Pen& pen, CGRect r, bool user, Color accent) {
    float k = pen.k, big = 10 * k, small = 3 * k;
    struct Corner {
        float radius, x, y, from;
    };
    float tr = big, br = user ? small : big, bl = user ? big : small, tl = big;
    const Corner corners[4] = {{tr, r.maxX() - tr, r.minY() + tr, -90},
                               {br, r.maxX() - br, r.maxY() - br, 0},
                               {bl, r.minX() + bl, r.maxY() - bl, 90},
                               {tl, r.minX() + tl, r.minY() + tl, 180}};
    bool first = true;
    for (const Corner& c : corners) {
        for (int i = 0; i <= 10; i++) {
            float a = (c.from + 9.f * float(i)) * float(M_PI) / 180;
            CGPoint p{c.x + c.radius * std::cos(a), c.y + c.radius * std::sin(a)};
            if (first) pen.ctx.move(p); else pen.ctx.addLine(p);
            first = false;
        }
    }
    pen.ctx.closePath();
    pen.ctx.setFillColor(user ? accent.withAlphaComponent(0.22f) : Color::white(1, 0.07f));
    pen.ctx.fillPath();
}

/// A bubble as wide as its words on one line, at most `most` px, and as tall as the lines they draw on, at most
/// `lines` (0: all), its right edge at `right` when it is yours. Returns its height.
float said(const Pen& pen, const Message& m, float x, float right, float y, float most, int lines, const Setting& t, Color accent) {
    TextAttributes a = attributes(t, Color::white(), pen.k);
    float w = std::min(most, layoutText(m.text, a, INFINITY, 0).width / pen.k + 20);
    float tall = 12 + layoutText(m.text, a, (w - 20) * pen.k, lines).height / pen.k;
    float left = m.user ? right - w : x;
    bubble(pen, pen.px(left, y, w, tall), m.user, accent);
    pen.words(m.text, left + 10, y + 6, most - 20, lines, t, palette::ink);
    return tall;
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float body) {
    float x = 16, column = width - 32, y = 14;
    pen.words(item.titleOrUntitled(), x, y, column, 1, setting::title, palette::ink);
    y += TITLE + 2;
    for (const Message& m : messagesOf(props["messages"], SHOWN)) {
        y += 6 + said(pen, m, x, x + column, y + 6, column * 0.86f, linesOf(m), setting::text, look.accent);
    }
    if (std::string source = text(props["source"]); !source.empty()) label(pen, source, x, body - 14 - TEXT, look.ink2);
}

/// `.detail-chat`: up to 40 messages whole, at 13.5 px, 7 px apart, then the source.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    constexpr Setting line{13.5f, 18.9f};
    const Json& held = item.data["messages"];
    std::vector<Message> messages = messagesOf(held.isNull() ? props["messages"] : held, 40);
    std::string source = text(props["source"]);
    float most = Sheet::width * 0.9f, tall = 0;
    for (const Message& m : messages) tall += (tall > 0 ? 7 : 0) + 12 + heightOf(m.text, most - 20, 0, line, sheet.k);
    if (!source.empty()) tall += (tall > 0 ? 7 : 0) + TEXT;
    Color accent = sheet.look.accent;
    sheet.part(tall, [=](const Pen& pen, float y) {
        for (const Message& m : messages) y += 7 + said(pen, m, Sheet::left, Sheet::left + Sheet::width, y, most, 0, line, accent);
        if (!source.empty()) label(pen, source, Sheet::left, y, palette::ink2);
    });
    for (const Message& m : messages) sheet.said.push_back(m.text);
    if (!source.empty()) sheet.said.push_back(source);
}

const Kind kind{"chat", size, {}, draw, detail};
const Registered registered{kind};

}  // namespace

}  // namespace cards
