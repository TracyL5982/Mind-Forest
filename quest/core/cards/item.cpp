#include "item.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <limits>

namespace cards {

namespace {

/// Unicode's Han script, the code points `\p{Script=Han}` matches.
bool han(char32_t c) {
    return (c >= 0x2e80 && c <= 0x2e99) || (c >= 0x2e9b && c <= 0x2ef3) || (c >= 0x2f00 && c <= 0x2fd5) || c == 0x3005 || c == 0x3007 ||
           (c >= 0x3021 && c <= 0x3029) || (c >= 0x3038 && c <= 0x303b) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) ||
           (c >= 0xf900 && c <= 0xfa6d) || (c >= 0xfa70 && c <= 0xfad9) || c == 0x16fe2 || c == 0x16fe3 || c == 0x16ff0 ||
           c == 0x16ff1 || (c >= 0x20000 && c <= 0x2fa1f) || (c >= 0x30000 && c <= 0x323af);
}
bool latin(char32_t c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'); }
bool wordChar(char32_t c) { return latin(c) || (c >= '0' && c <= '9') || c == '_'; }
bool hex(char32_t c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
char32_t lower(char32_t c) { return c >= 'A' && c <= 'Z' ? c + 32 : c; }

/// Whether `word` (lower case, ASCII) stands at `at`, whatever its case.
bool at(const Text& s, size_t i, const char* word) {
    for (size_t k = 0; word[k]; k++) {
        if (i + k >= s.size() || lower(s[i + k]) != char32_t(word[k])) return false;
    }
    return true;
}

/// How long a match of words.js's NOT_WORDS is at `i`, or 0: a web address, a hex colour, or an rgb() or hsl() colour.
size_t notWords(const Text& s, size_t i) {
    bool boundary = i == 0 || !wordChar(s[i - 1]);
    if (boundary) {
        for (const char* start : {"https://", "http://", "www."}) {
            if (!at(s, i, start)) continue;
            size_t j = i + std::char_traits<char>::length(start);
            while (j < s.size() && !isSpace(s[j])) j++;
            return j - i;
        }
    }
    if (s[i] == '#') {
        size_t j = i + 1;
        while (j < s.size() && hex(s[j])) j++;
        size_t n = j - i - 1;
        if (n >= 3 && n <= 8 && (j == s.size() || !wordChar(s[j]))) return j - i;
    }
    if (boundary) {
        for (const char* start : {"rgba(", "rgb(", "hsla(", "hsl("}) {
            if (!at(s, i, start)) continue;
            size_t j = i + std::char_traits<char>::length(start);
            while (j < s.size() && s[j] != ')') j++;
            if (j < s.size()) return j + 1 - i;
        }
    }
    return 0;
}

/// words.js: Chinese when the title and text, without web addresses and colour values, hold a Han
/// character and no more Latin letters than Han characters.
bool chinese(const std::string& title, const std::string& text) {
    Text written = points(title + "\n" + text);
    int hans = 0, latins = 0;
    for (size_t i = 0; i < written.size();) {
        if (size_t n = notWords(written, i)) {
            i += n;
            continue;
        }
        if (han(written[i])) hans++;
        if (latin(written[i])) latins++;
        i++;
    }
    return hans > 0 && latins <= hans;
}

std::string trimmed(const Json& value) { return value.isString() ? utf8(trim(points(value.string()))) : ""; }

std::vector<std::string> names(const Json& value) {
    std::vector<std::string> out;
    for (const Json& name : value.array()) {
        std::string s = trimmed(name);
        if (!s.empty()) out.push_back(s);
    }
    return out;
}

}  // namespace

std::string Words::more(int count) const { return chinese ? "还有 " + std::to_string(count) + " 项" : "and " + std::to_string(count) + " more"; }

std::string text(const Json& value) { return value.isString() ? value.string() : ""; }

double number(const Json& value) {
    constexpr double nan = std::numeric_limits<double>::quiet_NaN();
    switch (value.type()) {
    case Json::Type::number: return value.number();
    case Json::Type::boolean: return value.boolean() ? 1 : 0;
    case Json::Type::null: return 0;
    case Json::Type::string: {
        std::string s = utf8(trim(points(value.string())));
        if (s.empty()) return 0;
        size_t i = 0;
        bool negative = false;
        if (s[i] == '+' || s[i] == '-') negative = s[i++] == '-';
        if (s.compare(i, std::string::npos, "Infinity") == 0) return negative ? -INFINITY : INFINITY;
        size_t digits = 0, j = i;
        while (j < s.size() && isdigit((unsigned char)s[j])) j++, digits++;
        if (j < s.size() && s[j] == '.') {
            j++;
            while (j < s.size() && isdigit((unsigned char)s[j])) j++, digits++;
        }
        if (digits == 0) return nan;
        if (j < s.size() && (s[j] == 'e' || s[j] == 'E')) {
            size_t k = j + 1;
            if (k < s.size() && (s[k] == '+' || s[k] == '-')) k++;
            size_t e = k;
            while (k < s.size() && isdigit((unsigned char)s[k])) k++;
            if (k == e) return nan;
            j = k;
        }
        return j == s.size() ? std::strtod(s.c_str(), nullptr) : nan;
    }
    default: return nan;
    }
}

Item Item::from(const Json& j) {
    Item item;
    item.title = cards::text(j["title"]);
    item.text = cards::text(j["text"]);
    item.summary = cards::text(j["summary"]);
    if (j["data"].isObject()) item.data = j["data"];
    item.agent = cards::text(j["origin"]["by"]) == "agent";
    item.sourceFrom = cards::text(j["source"]["from"]);
    item.url = cards::text(j["source"]["url"]);
    item.capturedAt = cards::text(j["source"]["capturedAt"]);
    for (const Json& tag : j["tags"].array()) {
        if (tag.isString()) item.tags.push_back(tag.string());
    }
    item.words.chinese = chinese(item.title, item.text);
    return item;
}

const char* name(Chip::Kind kind) {
    switch (kind) {
    case Chip::Kind::when: return "when";
    case Chip::Kind::origin: return "origin";
    case Chip::Kind::where: return "where";
    case Chip::Kind::people: return "people";
    }
    return "";
}

std::vector<Chip> sources(const Item& item) {
    const Json& data = item.data;
    auto first = [&](std::initializer_list<const char*> keys) -> std::string {
        for (const char* key : keys) {
            if (!trimmed(data[key]).empty()) return key;
        }
        return "";
    };
    auto plain = [](Chip::Kind kind, const std::string& text, const std::string& key) { return Chip{kind, text, 0, 0, key, text}; };
    std::vector<Chip> held;
    if (std::string key = first({"when", "date"}); !key.empty()) held.push_back(plain(Chip::Kind::when, trimmed(data[key]), key));
    if (item.agent) {
        if (std::string key = first({"holder", "venue", "site", "from"}); !key.empty())
            held.push_back(plain(Chip::Kind::origin, trimmed(data[key]), key));
    }
    if (std::string where = trimmed(data["where"]); !where.empty()) held.push_back(plain(Chip::Kind::where, where, "where"));
    for (const char* key : {"people", "authors"}) {
        std::vector<std::string> found = names(data[key]);
        if (found.empty()) continue;
        std::string text = found[0] + (found.size() > 1 ? ", " + found[1] : ""), full;
        for (const std::string& name : found) full += (full.empty() ? "" : ", ") + name;
        held.push_back({Chip::Kind::people, text, int(found.size()) > 2 ? int(found.size()) - 2 : 0, 0, key, full});
        break;
    }
    std::vector<Chip> out;
    for (size_t i = 0; i < held.size(); i++) {
        bool again = std::any_of(held.begin(), held.begin() + long(i), [&](const Chip& earlier) { return earlier.text == held[i].text; });
        if (!again) out.push_back(held[i]);
    }
    return out;
}

std::vector<Chip> chips(const Item& item, const std::vector<std::string>& shown) {
    std::vector<std::string> said;
    for (const std::string& key : shown) {
        if (std::string s = trimmed(item.data[key]); !s.empty()) said.push_back(s);
    }
    std::vector<Chip> out;
    for (const Chip& chip : sources(item)) {
        if (out.size() == 3) break;
        if (std::count(shown.begin(), shown.end(), chip.key) || std::count(said.begin(), said.end(), chip.text)) continue;
        out.push_back(chip);
    }
    return out;
}

namespace {
constexpr int CHIP_FLOOR = 72;
constexpr int CHIP_PAD = 28;
constexpr int CHIP_GAP = 6;
int padOf(const Chip& chip) { return CHIP_PAD + (chip.count ? textWidth(points(" +" + std::to_string(chip.count))) : 0); }
int needOf(const Chip& chip) { return padOf(chip) + textWidth(points(chip.text)); }

/// index.js's `shares`: like `spread`, but an equal share may be below 0.
std::vector<int> shares(const std::vector<int>& needs, int room) {
    std::vector<int> given(needs.size(), 0);
    std::vector<size_t> open;
    for (size_t i = 0; i < needs.size(); i++) open.push_back(i);
    while (!open.empty()) {
        int n = int(open.size());
        int each = room >= 0 ? room / n : -((-room + n - 1) / n);
        std::vector<size_t> whole, left;
        for (size_t i : open) (needs[i] <= each ? whole : left).push_back(i);
        for (size_t i : whole.empty() ? open : whole) {
            given[i] = whole.empty() ? each : needs[i];
            room -= given[i];
        }
        if (whole.empty()) break;
        open = left;
    }
    return given;
}
}  // namespace

std::vector<Chip> fit(const std::vector<Chip>& all, int room) {
    std::vector<Chip> line;
    int rest = room;
    size_t from = 0;
    if (!all.empty() && all[0].kind == Chip::Kind::when) {
        Chip date = all[0];
        date.width = std::min(needOf(date), room);
        rest = room - date.width - CHIP_GAP;
        line.push_back(date);
        from = 1;
    }
    int must = line.empty() ? 1 : 0;
    int left = rest + CHIP_GAP;
    std::vector<Chip> others;
    for (size_t i = from; i < all.size(); i++) {
        left -= CHIP_GAP + padOf(all[i]) + std::min(CHIP_FLOOR - CHIP_PAD, textWidth(points(all[i].text)));
        if (int(i - from) < must || left >= 0) others.push_back(all[i]);
    }
    int free = rest - CHIP_GAP * (int(others.size()) - 1);
    std::vector<int> needs;
    for (Chip& chip : others) {
        free -= padOf(chip);
        needs.push_back(textWidth(points(chip.text)));
    }
    std::vector<int> given = shares(needs, free);
    for (size_t i = 0; i < others.size(); i++) {
        others[i].width = padOf(others[i]) + given[i];
        line.push_back(others[i]);
    }
    return line;
}

}  // namespace cards
