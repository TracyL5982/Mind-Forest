#include "face.h"

#include <algorithm>
#include <cmath>

#include "figures.h"
#include "item.h"

namespace cards {

int counted(const std::string& s, int column, Measure m, int max) {
    if (s.empty()) return 1;
    // Measured: the host sets the words as the face is drawn, in its own font, two pixels a px.
    const TextFrame& set = layoutText(s, attributes(settingOf(m), Color::white(), face::K), float(column) * face::K, 0);
    return std::clamp(int(set.lines.size()), 1, std::max(1, max));
}

namespace {

/// A Han character, kana or hangul: a line may break before or after any of them.
bool ideograph(char32_t c) { return han(c) || (c >= 0x3040 && c <= 0x30FF) || (c >= 0xAC00 && c <= 0xD7AF); }
/// What is not left at the end of a cut title, before its ellipsis.
bool trailing(char32_t c) {
    return isSpace(c) || c == ',' || c == ';' || c == ':' || c == '-' || c == 0x2014 || c == 0x2013 || c == 0x3001 || c == 0xFF0C ||
           c == 0xFF1B || c == 0xFF1A;
}

}  // namespace

std::string ellipsized(const std::string& s, int lines, const std::function<int(const std::string&)>& count) {
    if (s.empty() || count(s) <= lines) return s;
    Text t = points(s);
    // Where it may be cut: at the end of a word, or beside a Han character.
    std::vector<size_t> cuts;
    for (size_t i = 1; i < t.size(); i++) {
        if ((isSpace(t[i]) && !isSpace(t[i - 1])) || ideograph(t[i - 1]) || (ideograph(t[i]) && !isSpace(t[i - 1]))) cuts.push_back(i);
    }
    auto at = [&](size_t end) {
        Text head = t.substr(0, end);
        while (!head.empty() && trailing(head.back())) head.pop_back();
        return utf8(head) + "\u2026";
    };
    // The longest that stands in `lines` lines with its ellipsis; a single word too long for them is cut
    // at a letter instead.
    if (cuts.empty() || count(at(cuts.front())) > lines) {
        cuts.clear();
        for (size_t i = 1; i < t.size(); i++) cuts.push_back(i);
    }
    size_t lo = 0, hi = cuts.size();
    while (lo + 1 < hi) {
        size_t mid = (lo + hi) / 2;
        if (count(at(cuts[mid])) <= lines) lo = mid; else hi = mid;
    }
    return cuts.empty() ? "\u2026" : at(cuts[lo]);
}

Titled titled(const std::string& title, float column, Measure m, int most) {
    if (title.empty()) return {};
    std::string said = ellipsized(title, most, [&](const std::string& s) { return counted(s, int(column), m); });
    return {said, counted(said, int(column), m)};
}

Titled titledFigure(const std::string& title, float column, const Figure& size) {
    if (title.empty()) return {};
    std::string said = ellipsized(title, face::TITLE_LINES, [&](const std::string& s) { return figureLines(s, column, size); });
    return {said, figureLines(said, column, size)};
}

int figureLines(const std::string& value, float column, const Figure& size) {
    if (value.empty()) return 1;
    return std::max(1, int(std::lround(figureHeight(value, column, 0, size, face::K) / float(size.lineHeight))));
}

float countedWidth(const std::string& s, Measure m) { return widthOf(s, settingOf(m), face::K); }

const Setting& settingOf(Measure m) {
    switch (m) {
    case Measure::title: return setting::faceTitle;
    case Measure::body: return setting::faceBody;
    case Measure::meta: return setting::faceMeta;
    case Measure::passage: return setting::facePassage;
    case Measure::head: return setting::faceHead;
    }
    return setting::faceBody;
}

namespace {

/// The last letter of a line says whether it heads what follows: a colon, a letter or a digit, and no stop.
bool heads(const Text& t) {
    if (t.empty()) return false;
    char32_t c = t.back();
    if (c == ':' || c == 0xFF1A) return true;
    if (c < 0x80) return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    static const std::u32string stops = U"\u3002\uFF0E\uFF0C\u3001\uFF1B\uFF01\uFF1F\u300D\u300F\uFF09\u3011\u2026\u2014\u2013\u201D\u2019\u00BB";
    return stops.find(c) == std::u32string::npos;
}

}  // namespace

std::vector<Over> oversOf(const Json& props) {
    std::vector<Over> out;
    for (const Json& line : props["above"].array()) {
        Text t = trim(points(text(line)));
        if (t.empty()) continue;
        Over o;
        // `**words**` or `__words__`, with a colon after it or none.
        for (const char32_t* mark : {U"**", U"__"}) {
            Text m(mark);
            Text tail = t.size() > 4 && (t.back() == ':' || t.back() == 0xFF1A) ? Text(1, t.back()) : Text();
            Text core = t.substr(0, t.size() - tail.size());
            if (core.size() > 4 && core.compare(0, 2, m) == 0 && core.compare(core.size() - 2, 2, m) == 0) {
                Text inner = core.substr(2, core.size() - 4);
                if (inner.find_first_of(U"*_") == Text::npos) {
                    t = inner + tail;
                    o.head = true;
                }
            }
        }
        o.words = utf8(t);
        o.head = o.head || heads(t);
        out.push_back(o);
    }
    return out;
}

std::optional<std::array<std::string, 2>> headsOf(const Json& props) {
    const std::vector<Json>& given = props["heads"].array();
    if (given.size() != 2) return std::nullopt;
    std::array<std::string, 2> h{utf8(trim(points(text(given[0])))), utf8(trim(points(text(given[1]))))};
    if (h[0].empty() && h[1].empty()) return std::nullopt;
    return h;
}

std::string cueMore(const Words& w) { return w.chinese ? "更多" : "More"; }
std::string cueCount(const Words& w, int n) { return w.chinese ? "还有 " + std::to_string(n) + " 项" : std::to_string(n) + " more"; }
std::string cueRows(const Words& w, int n) {
    return w.chinese ? std::to_string(n) + " 行" : std::to_string(n) + (n == 1 ? " row" : " rows");
}
std::string cueParts(const Words& w, int n) {
    return w.chinese ? std::to_string(n) + " 部分" : std::to_string(n) + (n == 1 ? " part" : " parts");
}
std::string cueControls(const Words& w, int n) {
    return w.chinese ? std::to_string(n) + " 个控件" : std::to_string(n) + (n == 1 ? " control" : " controls");
}
std::string cuePoints(const Words& w, int n) {
    return w.chinese ? std::to_string(n) + " 个要点" : std::to_string(n) + (n == 1 ? " point" : " points");
}
std::string cueCodeLines(const Words& w, int n, const std::string& language) {
    if (w.chinese) return std::to_string(n) + " 行" + (language.empty() ? "代码" : " " + language);
    return std::to_string(n) + (n == 1 ? " line" : " lines") + (language.empty() ? "" : " of " + language);
}
std::string cueForAgainst(const Words& w, int pros, int cons) {
    if (w.chinese) return std::to_string(pros) + " 条优点，" + std::to_string(cons) + " 条缺点";
    return std::to_string(pros) + " for, " + std::to_string(cons) + " against";
}

void Col::say(const std::string& s, const Setting& t, int n, float atX, float atY, float w, Color color) const {
    if (!pen || s.empty() || n <= 0) return;
    float k = pen->k;
    TextAttributes a = attributes(t, color, k);
    const TextFrame& all = layoutText(s, a, w * k, 0);
    std::string shown = s;
    // Whole lines only: the first `n` the host sets, never one cut with an ellipsis.
    if (int(all.lines.size()) > n) {
        heldBack = true;
        std::u16string units = utf16(s);
        shown = ::utf8(units.substr(0, size_t(std::clamp(all.lines[size_t(n - 1)].end, 0, int(units.size())))));
    }
    pen->ctx.drawText(shown, CGPoint{atX * k, atY * k - lift(t, k)}, a, w * k, 0);
}

int Col::lines(const std::string& s, Measure m, int max, Color color, float after, float at, float column, float drawn) {
    if (s.empty() || max <= 0 || ended) return 0;
    const Setting& t = settingOf(m);
    // Counted as it is drawn: in the width it is drawn in.
    float col = drawn > 0 ? drawn : column < 0 ? width : column;
    int need = counted(s, int(col), m);
    // Once something is left out, the cue's row is kept free under whatever follows.
    int fit = std::min(max, int(std::floor((room() - after - (more ? face::CUE : 0)) / t.lead)));
    int shown = need;
    if (need > fit) {
        shown = std::min(max, int(std::floor((room() - after - face::CUE) / t.lead)));
        more = true;
    }
    shown = std::max(0, shown);
    say(s, t, shown, at < 0 ? x : at, y, drawn > 0 ? drawn : col, color);
    y += float(shown) * t.lead;
    if (shown > 0) inked = y;
    return shown;
}

bool Col::title(const std::string& s, float atX, float column, int most) {
    if (ended) return false;
    if (s.empty()) return true;
    float w = column > 0 ? column : width, at = atX < 0 ? x : atX;
    Titled t = titled(s, w, Measure::title, most);
    say(t.said, setting::faceTitle, t.lines, at, y, w, palette::ink);
    y += float(t.lines * face::TITLE);
    inked = y;
    return true;
}

bool Col::above(const Json& props, float keep) {
    std::vector<Over> over = oversOf(props);
    if (ended) return false;
    if (over.empty()) return true;
    bool first = y <= face::TOP;
    if (!first) gap(face::GAP);
    for (const Over& line : over) {
        Measure m = line.head ? Measure::head : Measure::body;
        const Setting& t = settingOf(m);
        int need = counted(line.words, int(width), m);
        int fit = std::max(0, int(std::floor((room() - face::CUE - keep) / t.lead)));
        int shown = std::min(need, fit);
        say(line.words, t, shown, x, y, width, palette::ink);
        y += float(shown) * t.lead;
        if (shown > 0) inked = y;
        if (shown < need) {
            more = true;
            ended = keep <= 0;
            return false;
        }
    }
    if (first) gap(face::GAP);
    return true;
}

bool Col::heads(const Json& props, float keep) {
    std::optional<std::array<std::string, 2>> h = headsOf(props);
    if (ended) return false;
    if (!h) return true;
    // The second stands at the column's end, as wide as it is when that is no more than half; the first has the rest.
    const float half = std::floor((width - 17) / 2);
    float second = std::min(half, std::ceil(countedWidth((*h)[1], Measure::meta))), first = width - 17 - second;
    int lines = std::max({1, counted((*h)[0], int(first), Measure::meta), counted((*h)[1], int(second), Measure::meta)});
    float tall = face::GAP + float(lines * face::META) + 4 + 1;
    if (tall > room() - face::CUE - keep) {
        more = true;
        ended = keep <= 0;
        return false;
    }
    gap(face::GAP);
    if (pen) {
        say((*h)[0], setting::faceMeta, lines, x, y, first, palette::ink2);
        float w = std::min(second, std::ceil(widthOf((*h)[1], setting::faceMeta, pen->k)));
        say((*h)[1], setting::faceMeta, lines, x + width - w, y, w + 1, palette::ink2);
        pen->ctx.setFillColor(palette::line);
        pen->ctx.fill(pen->px(x, y + float(lines * face::META) + 4, width, 1));
    }
    gap(float(lines * face::META) + 4 + 1);
    inked = y;
    return true;
}

void Col::cue(const std::string& said) {
    cued = true;
    // A gap left open for what then did not fit closes up over the cue's row, but never over words drawn.
    y = std::max(std::min(y, float(face::H - face::BOTTOM - face::CUE)), inked);
    say(said, setting::faceMeta, 1, x, y, width, look.accent);
    y += face::CUE;
}

namespace {
constexpr float SIDE_GAP = 12;
void pictureAt(Col& c, const std::string& src, float x, float wide, float tall) {
    if (!c.pen) return;
    CGRect box = c.pen->px(x, c.y, wide, tall);
    c.pen->ctx.setFillColor(palette::media);
    c.pen->ctx.fill(box);
    c.pen->picture(src, box, true, c.words);
    c.pen->mask(box, 3 * c.pen->k, c.look.fill);
}
}  // namespace

float sidePicture(Col& c, const std::string& src, float wide, float tall) {
    pictureAt(c, src, c.x, wide, tall);
    c.x += wide + SIDE_GAP;
    c.width -= wide + SIDE_GAP;
    return c.y + tall;
}

float sidePictureRight(Col& c, const std::string& src, float wide, float tall) {
    pictureAt(c, src, c.x + c.width - wide, wide, tall);
    c.width -= wide + SIDE_GAP;
    return c.y + tall;
}

}  // namespace cards
