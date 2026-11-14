// components/qa.js: two voices. The question set as a title beside a `Q`, and under a rule the answer
// beside an `A`.
#include <algorithm>

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

Footprint size(const Item&, const Json& props) {
    Plan p = plan(props);
    return {WIDTH, FRAME + p.questionLines * TITLE + RULE + p.answerLines * TEXT};
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float) {
    Plan p = plan(props);
    float x = 16, column = width - 32, y = 14;
    pen.words(fixed::question.in(item.words), x, y, MARK, 1, ASKS, look.accent);
    pen.words(p.question, x + MARK, y, column - MARK, p.questionLines, setting::title, palette::ink);
    // `.c-qa` has no gap: `.qa-voice.is-answer`'s margin, then its rule and its padding.
    y += float(p.questionLines * TITLE + 8);
    pen.ctx.setFillColor(palette::line);
    pen.ctx.fill(pen.px(x, y, column, 1));
    y += 1 + 8;
    pen.words(fixed::answer.in(item.words), x, y, MARK, 1, ANSWERS, look.ink3);
    pen.words(p.answer, x + MARK, y, column - MARK, p.answerLines, setting::text, palette::ink);
}

/// `.detail-qa`: both whole. A question that is the opened card's own title is not asked again.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    constexpr Setting answer{14, 20};
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
