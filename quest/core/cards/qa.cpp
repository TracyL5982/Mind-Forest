// components/qa.js: two voices. The question set as a title beside a `Q`, and under a rule the answer
// beside an `A`.
#include <algorithm>

#include "face.h"
#include "kind.h"
#include "text.h"

namespace cards {

namespace {

constexpr int WIDTH = 272;
/// The letter that names each voice, and the gap after it.
constexpr int MARK = 22;
constexpr int COLUMN = WIDTH - SIDES - MARK;
/// The rule between the question and the answer, and the room either side of it.
constexpr int RULE = 17;

/// `.qa-mark`: the question's on the title's line, in the card's colour; the answer's on the text's line.
constexpr Setting ASKS{12.5f, 21, Font::Weight::semibold};
constexpr Setting ANSWERS{12.5f, 17, Font::Weight::semibold};

struct Plan {
    std::string question, answer;
    int questionLines, answerLines;
};

Plan plan(const Json& props) {
    Text question = trim(points(text(props["question"]))), answer = trim(points(text(props["answer"])));
    return {utf8(question), utf8(answer), wrap(question, COLUMN, TITLE_LETTER, 4), wrap(answer, COLUMN, TEXT_LETTER, 6)};
}

/// The question beside its letter, the answer beside its own in whole lines, and the cue.
void lay(Col& c, const Item& item, const Json& props) {
    Plan p = plan(props);
    const float gutter = 22;
    if (!c.above(props)) {
        c.cue(cueMore(c.words));
        return;
    }
    c.gap(8);
    // The question first; the answer only under it.
    float top = c.y;
    int asked = c.lines(p.question, Measure::title, 2, palette::ink, p.answer.empty() ? 0 : face::GAP + face::BODY, c.x + gutter, face::W - 55, c.width - gutter);
    if (asked == 0) {
        c.more = true;
        c.cue(cueMore(c.words));
        return;
    }
    if (c.pen) label(*c.pen, fixed::question.in(item.words), c.x, top + 3, c.look.accent, setting::faceLabelSize);
    if (!p.answer.empty() && c.room() >= face::GAP + face::BODY + (c.more ? face::CUE : 0)) {
        c.gap(face::GAP);
        float at = c.y;
        if (c.lines(p.answer, Measure::body, 99, c.look.ink2, 0, c.x + gutter, face::W - 55, c.width - gutter) > 0 && c.pen) {
            label(*c.pen, fixed::answer.in(item.words), c.x, at + 2, palette::ink2, setting::faceLabelSize);
        }
    } else if (!p.answer.empty()) {
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




/// `.detail-qa`: both whole. A question that is the opened card's own title is not asked again.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    constexpr Setting answer{15, 21, Font::Weight::medium};
    Plan p = plan(props);
    bool asks = p.question != item.title;
    float column = Sheet::width - MARK;
    float asked = asks ? std::max(float(TITLE), heightOf(p.question, column, 0, setting::title, sheet.k)) : 0;
    float answered = std::max(float(TEXT), heightOf(p.answer, column, 0, answer, sheet.k));
    // Without the question, the answer's margin still stands above its rule.
    float rule = asked + 8;
    std::string q = fixed::question.in(item.words), a = fixed::answer.in(item.words);
    Look look = sheet.look;
    sheet.part(rule + 1 + 8 + answered, [=](const Pen& pen, float y) {
        if (asks) {
            pen.words(q, Sheet::left, y, MARK, 1, ASKS, look.accent);
            pen.words(p.question, Sheet::left + MARK, y, column, 0, setting::title, palette::ink);
        }
        pen.ctx.setFillColor(palette::line);
        pen.ctx.fill(pen.px(Sheet::left, y + rule, Sheet::width, 1));
        float top = y + rule + 1 + 8;
        pen.words(a, Sheet::left, top, MARK, 1, ANSWERS, palette::ink3);
        pen.words(p.answer, Sheet::left + MARK, top, column, 0, answer, palette::ink);
    });
    if (asks) sheet.said.insert(sheet.said.end(), {q, p.question});
    sheet.said.insert(sheet.said.end(), {a, p.answer});
}

const Kind kind{"qa", size, {}, draw, detail};
const Registered registered{kind};

}  // namespace

}  // namespace cards
