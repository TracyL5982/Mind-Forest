#include "said.h"

#include <algorithm>
#include <optional>
#include <set>

namespace cards {

namespace {

bool unspaced(char32_t c) { return (c >= 0x3040 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af); }

/// `\p{L}` or `\p{N}`, near enough: ASCII letters and digits, and any other character that is not a
/// space, a mark of punctuation or a symbol from the blocks those live in.
bool isLetter(char32_t c) {
    if (c < 0x80) return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
    if (isSpace(c)) return false;
    if (c <= 0xbf || c == 0xd7 || c == 0xf7) return c == 0xaa || c == 0xb5 || c == 0xba || c == 0xb2 || c == 0xb3 || c == 0xb9;
    if ((c >= 0x2000 && c <= 0x2bff) || (c >= 0x3000 && c <= 0x303f) || (c >= 0xfe10 && c <= 0xfe6f)) return false;
    if ((c >= 0xff00 && c <= 0xff0f) || (c >= 0xff1a && c <= 0xff20) || (c >= 0xff3b && c <= 0xff40) || (c >= 0xff5b && c <= 0xff65))
        return false;
    if (c >= 0x1f000 && c <= 0x1faff) return false;
    return true;
}

char32_t lower(char32_t c) {
    if ((c >= 'A' && c <= 'Z') || (c >= 0xc0 && c <= 0xde && c != 0xd7) || (c >= 0x391 && c <= 0x3ab && c != 0x3a2) ||
        (c >= 0x410 && c <= 0x42f))
        return c + 32;
    return c;
}
Text lowered(Text s) {
    for (char32_t& c : s) c = lower(c);
    return s;
}

int weight(const Text& s) {
    int sum = 0;
    for (char32_t c : s) sum += unspaced(c) ? 2 : isLetter(c) ? 1 : 0;
    return sum;
}

/// A word may end beside this character (or beside nothing).
bool edge(const Text& s, long i) { return i < 0 || i >= long(s.size()) || !isLetter(s[size_t(i)]) || unspaced(s[size_t(i)]); }

bool in(char32_t c, const char32_t* set) {
    for (; *set; set++) {
        if (*set == c) return true;
    }
    return false;
}
const char32_t* OPENS = U"\"'“‘«「『（(";
const char32_t* CLOSES = U"\"'”’»」』）).!?。！？,，;；:：";
const char32_t* ENDS = U".!?。！？:：;；";

std::vector<Text> letterRuns(const Text& s) {
    std::vector<Text> out;
    Text run;
    for (char32_t c : s) {
        if (isLetter(c)) {
            run += c;
        } else if (!run.empty()) {
            out.push_back(run);
            run.clear();
        }
    }
    if (!run.empty()) out.push_back(run);
    return out;
}

/// A pasted line's bullet, number or tick box, taken off its start.
Text withoutBullet(const Text& s) {
    size_t i = 0, matched = 0;
    while (i < s.size() && isSpace(s[i])) i++;
    while (i < s.size()) {
        size_t j = i;
        if (in(s[j], U"-*•·+")) {
            j++;
        } else if (s[j] >= '0' && s[j] <= '9') {
            while (j < s.size() && s[j] >= '0' && s[j] <= '9') j++;
            if (j < s.size() && in(s[j], U".)、")) j++;
            else break;
        } else if (s[j] == '[' && j + 2 < s.size() && in(s[j + 1], U" xX✓") && s[j + 2] == ']') {
            j += 3;
        } else {
            break;
        }
        while (j < s.size() && isSpace(s[j])) j++;
        i = j;
        matched = i;
    }
    return matched ? s.substr(matched) : s;
}

/// Labels before a colon that weigh at most 16 are taken out.
Text withoutLabels(const Text& s) {
    Text out;
    size_t i = 0;
    while (i < s.size()) {
        if (isLetter(s[i])) {
            size_t far = i + 1;
            while (far < s.size() && (isLetter(s[far]) || s[far] == ' ')) far++;
            size_t found = 0;
            for (size_t e = far; e > i; e--) {
                size_t k = e;
                while (k < s.size() && isSpace(s[k])) k++;
                if (k < s.size() && (s[k] == ':' || s[k] == U'：')) {
                    found = e;
                    break;
                }
            }
            if (found) {
                Text label = s.substr(i, found - i);
                if (weight(label) > 16) out += label;
                i = found;
                continue;
            }
        }
        out += s[i++];
    }
    return out;
}

std::vector<Text> unmarked(const Text& remains) {
    std::vector<Text> words = letterRuns(withoutLabels(withoutBullet(remains)));
    std::vector<Text> out;
    for (const Text& w : words) {
        Text low = lowered(w);
        if (low == U"and" || low == U"or" || low == U"和" || low == U"与" || low == U"以及") continue;
        out.push_back(w);
    }
    return out;
}

Text trimEnd(const Text& s) {
    size_t b = s.size();
    while (b > 0 && isSpace(s[b - 1])) b--;
    return s.substr(0, b);
}

std::optional<Text> withoutSentences(const Text& line, const std::vector<bool>& drawn) {
    Text out;
    size_t from = 0, n = line.size();
    for (size_t at = 0; at < n; at++) {
        if (!drawn[at] || (at > 0 && drawn[at - 1])) continue;
        size_t end = at;
        while (end < n && drawn[end]) end++;
        size_t start = at, stop = end;
        while (start > from && in(line[start - 1], OPENS)) start--;
        while (stop < n && in(line[stop], CLOSES)) stop++;
        Text before = trimEnd(line.substr(from, start - from));
        bool begins = before.empty() || in(before.back(), ENDS);
        size_t k = stop;
        while (k < n && isSpace(line[k])) k++;
        bool aside = k < n && (line[k] == '(' || line[k] == U'（');
        bool finishes = stop == n || stop > end || in(line[end - 1], ENDS) || aside;
        if (end - at >= 20 && begins && finishes) {
            out += line.substr(from, start - from);
            from = stop;
        }
        at = end;
    }
    if (from == 0) return std::nullopt;
    return squash(out + line.substr(from));
}

Text rest(const Text& text, const std::vector<std::string>& said, bool marks = true) {
    std::vector<Text> shown;
    std::set<Text> seen;
    for (const std::string& part : said) {
        Text p = lowered(squash(points(part)));
        if (!p.empty() && seen.insert(p).second) shown.push_back(p);
    }
    std::stable_sort(shown.begin(), shown.end(), [](const Text& a, const Text& b) { return a.size() > b.size(); });
    std::vector<Text> kept;
    size_t i = 0;
    while (i <= text.size()) {
        size_t j = text.find(U'\n', i);
        if (j == Text::npos) j = text.size();
        Text raw = text.substr(i, j - i);
        i = j + 1;
        Text line = squash(raw), low = lowered(line);
        if (weight(line) == 0) {
            kept.push_back(U"");
            continue;
        }
        if (std::any_of(shown.begin(), shown.end(), [&](const Text& part) { return part.find(low) != Text::npos; })) continue;
        std::vector<bool> drawn(line.size(), false);
        for (const Text& part : shown) {
            for (size_t at = low.find(part); at != Text::npos; at = low.find(part, at + part.size())) {
                size_t end = at + part.size();
                bool opens = edge(part, 0) || edge(low, long(at) - 1);
                bool closes = edge(part, long(part.size()) - 1) || edge(low, long(end));
                if (opens && closes) std::fill(drawn.begin() + long(at), drawn.begin() + long(end), true);
            }
        }
        Text remains;
        for (size_t c = 0; c < line.size(); c++) {
            if (!drawn[c]) remains += line[c];
            else if (c == 0 || !drawn[c - 1]) remains += U'\n';
        }
        bool any = std::find(drawn.begin(), drawn.end(), true) != drawn.end();
        size_t left = marks ? unmarked(remains).size() : letterRuns(remains).size();
        if (any && left == 0) continue;
        std::optional<Text> cut = withoutSentences(line, drawn);
        kept.push_back(cut ? *cut : trim(raw));
    }
    Text joined;
    for (size_t k = 0; k < kept.size(); k++) {
        if (k) joined += U'\n';
        joined += kept[k];
    }
    Text out;
    int feeds = 0;
    for (char32_t c : joined) {
        feeds = c == '\n' ? feeds + 1 : 0;
        if (feeds <= 2) out += c;
    }
    return trim(out);
}

bool isSaid(const std::string& words, const std::vector<std::string>& said) {
    Text w = points(words);
    Text tail = trimEnd(w);
    if (tail.size() >= 1 && tail.back() == U'…') tail.pop_back();
    else if (tail.size() >= 3 && tail.substr(tail.size() - 3) == U"...") tail.resize(tail.size() - 3);
    else tail = w;
    Text needle = lowered(squash(tail));
    if (needle.empty()) return true;
    return std::any_of(said.begin(), said.end(), [&](const std::string& part) { return lowered(squash(points(part))).find(needle) != Text::npos; });
}

}  // namespace

Leftover leftover(const Item& item, const std::vector<std::string>& said) {
    Leftover out;
    out.text = utf8(rest(points(item.text), said));
    std::vector<std::string> withText{item.text};
    withText.insert(withText.end(), said.begin(), said.end());
    bool told = isSaid(item.summary, withText) || rest(points(item.summary), said, false).empty();
    out.summary = told ? "" : item.summary;
    return out;
}

}  // namespace cards
