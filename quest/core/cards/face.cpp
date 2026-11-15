#include "face.h"

#include <algorithm>
#include <cmath>

namespace cards {

int counted(const std::string& s, int column, Measure m, int max) {
    Text t = points(s);
    switch (m) {
    case Measure::title: return wrap(t, int(std::floor(float(column) * 16 / setting::faceTitle.size)), TITLE_LETTER, max);
    case Measure::body: return wrap(t, column, TITLE_LETTER, max);
    case Measure::meta: return wrap(t, int(std::floor(float(column) * 16 / setting::faceMeta.size)), TITLE_LETTER, max);
    case Measure::passage: return wrap(t, column, PASSAGE_LETTER, max);
    }
    return 1;
}

const Setting& settingOf(Measure m) {
    switch (m) {
    case Measure::title: return setting::faceTitle;
    case Measure::body: return setting::faceBody;
    case Measure::meta: return setting::faceMeta;
    case Measure::passage: return setting::facePassage;
    }
    return setting::faceBody;
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
    if (s.empty() || max <= 0) return 0;
    const Setting& t = settingOf(m);
    float col = column < 0 ? width : column;
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
    return shown;
}

void Col::cue(const std::string& said) {
    cued = true;
    say(said, setting::faceMeta, 1, x, y, width, look.accent);
    y += face::CUE;
}

}  // namespace cards
