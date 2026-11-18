#include "json.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>

namespace {

struct Parser {
    const std::string& s;
    size_t i = 0;
    bool ok = true;

    void space() {
        while (i < s.size() && (s[i] == ' ' || s[i] == '\n' || s[i] == '\t' || s[i] == '\r')) i++;
    }

    bool literal(const char* word) {
        size_t n = 0;
        while (word[n]) n++;
        if (s.compare(i, n, word) != 0) return false;
        i += n;
        return true;
    }

    static void utf8(std::string& out, unsigned cp) {
        if (cp < 0x80) {
            out += char(cp);
        } else if (cp < 0x800) {
            out += char(0xC0 | (cp >> 6));
            out += char(0x80 | (cp & 0x3F));
        } else if (cp < 0x10000) {
            out += char(0xE0 | (cp >> 12));
            out += char(0x80 | ((cp >> 6) & 0x3F));
            out += char(0x80 | (cp & 0x3F));
        } else {
            out += char(0xF0 | (cp >> 18));
            out += char(0x80 | ((cp >> 12) & 0x3F));
            out += char(0x80 | ((cp >> 6) & 0x3F));
            out += char(0x80 | (cp & 0x3F));
        }
    }

    unsigned hex4() {
        unsigned v = 0;
        for (int k = 0; k < 4 && i < s.size(); k++, i++) {
            char c = s[i];
            v <<= 4;
            if (c >= '0' && c <= '9') v |= unsigned(c - '0');
            else if (c >= 'a' && c <= 'f') v |= unsigned(c - 'a' + 10);
            else if (c >= 'A' && c <= 'F') v |= unsigned(c - 'A' + 10);
            else ok = false;
        }
        return v;
    }

    std::string string() {
        std::string out;
        i++;    // the opening quote
        while (i < s.size() && s[i] != '"') {
            char c = s[i++];
            if (c != '\\') {
                out += c;
                continue;
            }
            if (i >= s.size()) break;
            char e = s[i++];
            switch (e) {
            case 'n': out += '\n'; break;
            case 't': out += '\t'; break;
            case 'r': out += '\r'; break;
            case 'b': out += '\b'; break;
            case 'f': out += '\f'; break;
            case 'u': {
                unsigned cp = hex4();
                if (cp >= 0xD800 && cp < 0xDC00 && s.compare(i, 2, "\\u") == 0) {
                    i += 2;
                    unsigned low = hex4();
                    cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
                }
                utf8(out, cp);
                break;
            }
            default: out += e;
            }
        }
        if (i >= s.size()) ok = false;
        i++;    // the closing quote
        return out;
    }

    Json value() {
        space();
        if (i >= s.size()) {
            ok = false;
            return {};
        }
        char c = s[i];
        if (c == '{') {
            i++;
            Json out = Json::object();
            space();
            if (i < s.size() && s[i] == '}') {
                i++;
                return out;
            }
            while (ok) {
                space();
                if (i >= s.size() || s[i] != '"') {
                    ok = false;
                    break;
                }
                std::string key = string();
                space();
                if (i >= s.size() || s[i] != ':') {
                    ok = false;
                    break;
                }
                i++;
                out.set(key, value());
                space();
                if (i < s.size() && s[i] == ',') {
                    i++;
                    continue;
                }
                if (i < s.size() && s[i] == '}') {
                    i++;
                    break;
                }
                ok = false;
            }
            return out;
        }
        if (c == '[') {
            i++;
            Json out = Json::list();
            space();
            if (i < s.size() && s[i] == ']') {
                i++;
                return out;
            }
            while (ok) {
                out.push(value());
                space();
                if (i < s.size() && s[i] == ',') {
                    i++;
                    continue;
                }
                if (i < s.size() && s[i] == ']') {
                    i++;
                    break;
                }
                ok = false;
            }
            return out;
        }
        if (c == '"') return Json(string());
        if (literal("true")) return Json(true);
        if (literal("false")) return Json(false);
        if (literal("null")) return Json();
        const char* begin = s.c_str() + i;
        char* end = nullptr;
        double v = strtod(begin, &end);
        if (end == begin) {
            ok = false;
            return {};
        }
        i += size_t(end - begin);
        return Json(v);
    }
};

void quote(std::string& out, const std::string& s) {
    out += '"';
    for (unsigned char c : s) {
        switch (c) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\t': out += "\\t"; break;
        case '\r': out += "\\r"; break;
        default:
            if (c < 0x20) {
                char buf[8];
                snprintf(buf, sizeof buf, "\\u%04x", c);
                out += buf;
            } else {
                out += char(c);
            }
        }
    }
    out += '"';
}

}  // namespace

std::optional<Json> Json::parse(const std::string& text) {
    Parser p{text};
    Json v = p.value();
    p.space();
    if (!p.ok || p.i != text.size()) return std::nullopt;
    return v;
}

void Json::write(std::string& out, bool pretty, int depth) const {
    auto newline = [&](int d) {
        if (!pretty) return;
        out += '\n';
        out.append(size_t(d) * 2, ' ');
    };
    switch (type_) {
    case Type::null: out += "null"; break;
    case Type::boolean: out += bool_ ? "true" : "false"; break;
    case Type::number: {
        char buf[40];
        if (std::isfinite(number_) && number_ == std::floor(number_) && std::fabs(number_) < 1e15) {
            snprintf(buf, sizeof buf, "%lld", (long long)number_);
        } else {
            // Short, and exact for a float: the fewest digits that read back as the same float.
            snprintf(buf, sizeof buf, "%.9g", std::isfinite(number_) ? number_ : 0.0);
        }
        out += buf;
        break;
    }
    case Type::string: quote(out, string_); break;
    case Type::array:
        out += '[';
        for (size_t k = 0; k < array_.size(); k++) {
            if (k) out += ',';
            newline(depth + 1);
            array_[k].write(out, pretty, depth + 1);
        }
        if (!array_.empty()) newline(depth);
        out += ']';
        break;
    case Type::object: {
        out += '{';
        bool first = true;
        for (const auto& [key, value] : object_) {
            if (!first) out += ',';
            first = false;
            newline(depth + 1);
            quote(out, key);
            out += pretty ? ": " : ":";
            value.write(out, pretty, depth + 1);
        }
        if (!object_.empty()) newline(depth);
        out += '}';
        break;
    }
    }
}

std::string Json::dump(bool pretty) const {
    std::string out;
    write(out, pretty, 0);
    return out;
}
