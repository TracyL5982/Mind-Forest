// The part of canvas.h that is the same on every host: the command list a
// Canvas writes, the measures remembered, strings, cropping and the blur.
#include "canvas.h"

#include <chrono>
#include <thread>

#include "async.h"
#include "base.h"

#include <algorithm>
#include <cstring>
#include <map>
#include <unordered_map>

#include "base.h"

// MARK: - Strings

namespace {

/// Reads one code point of UTF-8 at `i` and moves `i` past it. A broken byte reads as U+FFFD.
char32_t nextScalar(const std::string& s, size_t& i) {
    unsigned char c = (unsigned char)s[i];
    if (c < 0x80) {
        i += 1;
        return c;
    }
    size_t extra = (c >> 5) == 0x6 ? 1 : (c >> 4) == 0xE ? 2 : (c >> 3) == 0x1E ? 3 : 0;
    if (extra == 0 || i + extra >= s.size()) {
        i += 1;
        return 0xFFFD;
    }
    char32_t v = extra == 1 ? (c & 0x1F) : extra == 2 ? (c & 0x0F) : (c & 0x07);
    for (size_t k = 1; k <= extra; k++) {
        unsigned char d = (unsigned char)s[i + k];
        if ((d & 0xC0) != 0x80) {
            i += k;
            return 0xFFFD;
        }
        v = (v << 6) | (d & 0x3F);
    }
    i += extra + 1;
    return v;
}

void appendScalar(std::string& out, char32_t c) {
    if (c < 0x80) {
        out += char(c);
    } else if (c < 0x800) {
        out += char(0xC0 | (c >> 6));
        out += char(0x80 | (c & 0x3F));
    } else if (c < 0x10000) {
        out += char(0xE0 | (c >> 12));
        out += char(0x80 | ((c >> 6) & 0x3F));
        out += char(0x80 | (c & 0x3F));
    } else {
        out += char(0xF0 | (c >> 18));
        out += char(0x80 | ((c >> 12) & 0x3F));
        out += char(0x80 | ((c >> 6) & 0x3F));
        out += char(0x80 | (c & 0x3F));
    }
}

/// One scalar's capital. U+0000 means "SS" (for ß), which is two.
char32_t upper(char32_t c) {
    if (c >= 'a' && c <= 'z') return c - 0x20;
    if (c < 0x80) return c;
    if (c == 0xDF) return 0;
    if (c == 0xB5) return 0x39C;
    if (c >= 0xE0 && c <= 0xFE && c != 0xF7) return c - 0x20;
    if (c == 0xFF) return 0x178;
    if (c >= 0x100 && c <= 0x17F) {
        if (c == 0x131) return 'I';
        if (c == 0x17F) return 'S';
        if (c == 0x138 || c == 0x149 || c == 0x178) return c;
        bool oddIsLower = (c <= 0x137) || (c >= 0x14A && c <= 0x177);
        if (oddIsLower) return (c & 1) ? c - 1 : c;
        return (c & 1) ? c : c - 1;                     // 0x139...0x148 and 0x179...0x17E: the even one is the small one
    }
    if (c == 0x3C2) return 0x3A3;
    if (c >= 0x3B1 && c <= 0x3CB) return c - 0x20;
    if (c == 0x3AC) return 0x386;
    if (c >= 0x3AD && c <= 0x3AF) return c - 0x25;
    if (c == 0x3CC) return 0x38C;
    if (c == 0x3CD || c == 0x3CE) return c - 0x3F;
    if (c >= 0x430 && c <= 0x44F) return c - 0x20;
    if (c >= 0x450 && c <= 0x45F) return c - 0x50;
    return c;
}

}  // namespace

std::u16string utf16(const std::string& s) {
    std::u16string out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size();) {
        char32_t c = nextScalar(s, i);
        if (c < 0x10000) {
            out += char16_t(c);
        } else {
            c -= 0x10000;
            out += char16_t(0xD800 | (c >> 10));
            out += char16_t(0xDC00 | (c & 0x3FF));
        }
    }
    return out;
}

std::string utf8(const std::u16string& s) {
    std::string out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size(); i++) {
        char32_t c = s[i];
        if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.size() && s[i + 1] >= 0xDC00 && s[i + 1] < 0xE000) {
            c = 0x10000 + ((c - 0xD800) << 10) + (char32_t(s[i + 1]) - 0xDC00);
            i++;
        } else if (c >= 0xD800 && c < 0xE000) {
            c = 0xFFFD;                                  // half a pair, as when a range cuts one in two
        }
        appendScalar(out, c);
    }
    return out;
}

std::string uppercased(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size();) {
        char32_t c = nextScalar(s, i);
        char32_t u = upper(c);
        if (u == 0) out += "SS"; else appendScalar(out, u);
    }
    return out;
}

bool CharacterSet::whitespacesAndNewlines(char32_t c) {
    return (c >= 0x09 && c <= 0x0D) || c == 0x20 || c == 0x85 || c == 0xA0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200A) ||
           c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x3000;
}

/// Unicode's punctuation (general category P), for the scripts the app's words come in:
/// Latin, the general punctuation block, and East Asian marks.
bool CharacterSet::punctuationCharacters(char32_t c) {
    if (c < 0x80) {
        return (c >= 0x21 && c <= 0x23) || (c >= 0x25 && c <= 0x2A) || (c >= 0x2C && c <= 0x2F) || c == 0x3A || c == 0x3B ||
               c == 0x3F || c == 0x40 || (c >= 0x5B && c <= 0x5D) || c == 0x5F || c == 0x7B || c == 0x7D;
    }
    if (c < 0x100) return c == 0xA1 || c == 0xA7 || c == 0xAB || c == 0xB6 || c == 0xB7 || c == 0xBB || c == 0xBF;
    if (c == 0x37E || c == 0x387 || (c >= 0x55A && c <= 0x55F) || c == 0x589 || c == 0x58A || c == 0x5BE || c == 0x5F3 || c == 0x5F4 ||
        c == 0x60C || c == 0x61B || c == 0x61F || (c >= 0x66A && c <= 0x66D) || c == 0x6D4 || c == 0x964 || c == 0x965) return true;
    if (c >= 0x2010 && c <= 0x2027) return true;
    if (c >= 0x2030 && c <= 0x205E) return c != 0x2044 && c != 0x2052;
    if (c == 0x207D || c == 0x207E || c == 0x208D || c == 0x208E) return true;
    if ((c >= 0x2308 && c <= 0x230B) || c == 0x2329 || c == 0x232A || (c >= 0x2768 && c <= 0x2775) || (c >= 0x27E6 && c <= 0x27EF) ||
        (c >= 0x2983 && c <= 0x2998)) return true;
    if (c >= 0x2E00 && c <= 0x2E4F) return true;
    if ((c >= 0x3001 && c <= 0x3003) || (c >= 0x3008 && c <= 0x3011) || (c >= 0x3014 && c <= 0x301F) || c == 0x3030 || c == 0x303D ||
        c == 0x30A0 || c == 0x30FB) return true;
    if ((c >= 0xFE10 && c <= 0xFE19) || (c >= 0xFE30 && c <= 0xFE52) || (c >= 0xFE54 && c <= 0xFE61) || c == 0xFE63 || c == 0xFE68 ||
        c == 0xFE6A || c == 0xFE6B) return true;
    if ((c >= 0xFF01 && c <= 0xFF03) || (c >= 0xFF05 && c <= 0xFF0A) || (c >= 0xFF0C && c <= 0xFF0F) || c == 0xFF1A || c == 0xFF1B ||
        c == 0xFF1F || c == 0xFF20 || (c >= 0xFF3B && c <= 0xFF3D) || c == 0xFF3F || c == 0xFF5B || c == 0xFF5D ||
        (c >= 0xFF5F && c <= 0xFF65)) return true;
    return false;
}

std::u16string trimmingCharacters(const std::u16string& s, const std::function<bool(char32_t)>& in) {
    // Halves of a pair (anything past U+FFFF) are in none of the sets asked about.
    auto inSet = [&](char16_t c) { return !(c >= 0xD800 && c < 0xE000) && in(c); };
    size_t lo = 0, hi = s.size();
    while (lo < hi && inSet(s[lo])) lo++;
    while (hi > lo && inSet(s[hi - 1])) hi--;
    return s.substr(lo, hi - lo);
}

// MARK: - Fonts and measures

FontMetrics Font::metrics() const {
    static std::map<std::pair<float, int>, FontMetrics> known;
    auto key = std::make_pair(pointSize, int(weight));
    auto it = known.find(key);
    if (it != known.end()) return it->second;
    FontMetrics m = platform::fontMetrics(*this);
    known[key] = m;
    return m;
}

float Font::lineHeight() const {
    FontMetrics m = metrics();
    return m.ascent + m.descent + m.leading;
}

float textLineHeight(const TextAttributes& attributes) {
    float h = attributes.font.lineHeight();
    const ParagraphStyle& style = attributes.paragraphStyle;
    if (style.maximumLineHeight > 0) h = std::min(h, style.maximumLineHeight);
    if (style.minimumLineHeight > 0) h = std::max(h, style.minimumLineHeight);
    return h;
}

namespace {

/// What the host is told about line height: 0 unless the paragraph style sets one.
float askedLineHeight(const TextAttributes& attributes) {
    const ParagraphStyle& style = attributes.paragraphStyle;
    return style.maximumLineHeight > 0 || style.minimumLineHeight > 0 ? textLineHeight(attributes) : 0;
}

/// How many lines of this text a box so tall shows: always one, at least.
int linesThatFit(float height, const TextAttributes& attributes) {
    float line = textLineHeight(attributes);
    if (!(line > 0) || !std::isfinite(height)) return 0;
    return std::max(1, int(std::floor(height / line + 1e-3f)));
}

/// How many lines a string drawn in a box may take, from the options and the paragraph style. 0: any number.
int lineLimit(float height, int options, const TextAttributes& attributes) {
    if (attributes.paragraphStyle.lineBreakMode == LineBreakMode::byTruncatingTail) return 1;
    if (options & truncatesLastVisibleLine) return linesThatFit(height, attributes);
    return 0;
}

constexpr float unwrapped = 1e9f;       // how "no wrapping" is written for the host

}  // namespace

const TextFrame& layoutText(const std::string& string, const TextAttributes& attributes, float width, int maxLines, bool carets) {
    static std::unordered_map<std::string, TextFrame> known;
    float w = width < 1e6f ? width : unwrapped;
    float line = askedLineHeight(attributes);
    std::string key = string;
    key += '\x1f';
    key += fmt("%g|%d|%d|%g|%g|%g|%d|%d", double(attributes.font.pointSize), int(attributes.font.weight), attributes.kern ? 1 : 0,
               double(attributes.kern.value_or(0)), double(line), double(w), maxLines, carets ? 1 : 0);
    auto it = known.find(key);
    if (it != known.end()) return it->second;
    return known.emplace(std::move(key), platform::layoutText(string, attributes.font, attributes.kern, line, w, maxLines, carets))
        .first->second;
}

CGSize stringSize(const std::string& string, const TextAttributes& withAttributes) {
    const TextFrame& frame = layoutText(string, withAttributes, unwrapped, 0);
    return {frame.width, frame.height};
}

CGRect stringBoundingRect(const std::string& string, CGSize size, int options, const TextAttributes& attributes) {
    const TextFrame& frame = layoutText(string, attributes, size.width, lineLimit(size.height, options, attributes));
    return {0, 0, frame.width, frame.height};
}

// MARK: - Canvas

Canvas::Canvas(CGSize size, float scale, bool opaque) : size(size), scale(scale), opaque(opaque) {}

void Canvas::put(Op op, CGRect r) {
    put(op);
    commands.insert(commands.end(), {r.origin.x, r.origin.y, r.size.width, r.size.height});
}

void Canvas::put(Op op, Color c) {
    put(op);
    commands.insert(commands.end(), {c.r, c.g, c.b, c.a});
}

void Canvas::saveGState() { put(Op::save); }
void Canvas::restoreGState() { put(Op::restore); }
void Canvas::clip(CGRect to) { put(Op::clip, to); }
void Canvas::setFillColor(Color color) { put(Op::fillColor, color); }
void Canvas::setStrokeColor(Color color) { put(Op::strokeColor, color); }

void Canvas::setLineWidth(float width) {
    put(Op::lineWidth);
    commands.push_back(width);
}

void Canvas::setLineJoin(LineJoin join) {
    put(Op::lineJoin);
    commands.push_back(float(int(join)));
}

void Canvas::setLineCap(LineCap cap) {
    put(Op::lineCap);
    commands.push_back(float(int(cap)));
}

void Canvas::setLineDash(float phase, const std::vector<float>& lengths) {
    put(Op::lineDash);
    commands.push_back(phase);
    commands.push_back(float(lengths.size()));
    commands.insert(commands.end(), lengths.begin(), lengths.end());
}

void Canvas::move(CGPoint to) {
    put(Op::move);
    commands.insert(commands.end(), {to.x, to.y});
}

void Canvas::addLine(CGPoint to) {
    put(Op::line);
    commands.insert(commands.end(), {to.x, to.y});
}

void Canvas::closePath() { put(Op::close); }
void Canvas::strokePath() { put(Op::strokePath); }
void Canvas::fillPath() { put(Op::fillPath); }
void Canvas::stroke(CGRect rect) { put(Op::strokeRect, rect); }
void Canvas::fill(CGRect rect) { put(Op::fillRect, rect); }
void Canvas::strokeEllipse(CGRect in) { put(Op::strokeEllipse, in); }
void Canvas::fillEllipse(CGRect in) { put(Op::fillEllipse, in); }
void Canvas::rectFill(CGRect rect) { put(Op::copyRect, rect); }

void Canvas::drawImage(const ImageRef& image, CGRect in) {
    if (!image || image->width <= 0 || image->height <= 0) return;
    // The same picture drawn again (a still, cut once and used twice) is sent once.
    size_t index = size_t(std::find(images.begin(), images.end(), image) - images.begin());
    if (index == images.size()) images.push_back(image);
    put(Op::image);
    commands.push_back(float(index));
    commands.insert(commands.end(), {in.origin.x, in.origin.y, in.size.width, in.size.height});
}

void Canvas::drawText(const std::string& string, CGPoint at, const TextAttributes& attributes, float width, int maxLines) {
    if (string.empty()) return;
    put(Op::text);
    commands.push_back(float(strings.size()));
    strings.push_back(string);
    const Color& c = attributes.foregroundColor;
    commands.insert(commands.end(), {at.x, at.y, width < 1e6f ? width : unwrapped, float(maxLines), attributes.font.pointSize,
                                     float(int(attributes.font.weight)), attributes.kern ? 1.f : 0.f, attributes.kern.value_or(0),
                                     askedLineHeight(attributes), c.r, c.g, c.b, c.a});
}

ImageRef Canvas::image() {
    // Quest: the calls are recorded here, on the frame thread (sizes come from measuring, which is done by
    // now), and turned into pixels on the background thread. What comes back at once is a picture whose
    // size is known and whose pixels are on their way: a step that makes a dozen cards no longer holds
    // the frame while each is painted. `-syncRaster` paints them here, as before.
    static const bool later = !Flags::has("syncRaster");
    if (later) {
        auto out = std::make_shared<Image>();
        out->width = std::max(1, int(std::ceil(size.width * scale)));
        out->height = std::max(1, int(std::ceil(size.height * scale)));
        out->scale = scale;
        out->ready.store(false);
        auto job = std::make_shared<Canvas>(*this);
        Async::run([job, out] {
            // Pictures this one is drawn from were asked for before it: they are there by now.
            for (const ImageRef& used : job->images) {
                if (used) used->wait();
            }
            // `-slowRaster <ms>` holds each picture back, to see how waiting looks.
            static const double slow = Flags::number("slowRaster");
            if (slow > 0) std::this_thread::sleep_for(std::chrono::microseconds(int64_t(slow * 1000)));
            ImageRef done = platform::rasterize(*job);
            if (done) {
                if (job->opaque) {
                    for (size_t i = 3; i < done->rgba.size(); i += 4) done->rgba[i] = 255;
                }
                out->width = done->width;
                out->height = done->height;
                out->rgba = std::move(done->rgba);
            } else {
                out->rgba.assign(size_t(out->width) * size_t(out->height) * 4, 0);
            }
            out->arrived();
        });
        return out;
    }
    ImageRef out = platform::rasterize(*this);
    if (!out) return nullptr;
    out->scale = scale;
    if (opaque) {
        for (size_t i = 3; i < out->rgba.size(); i += 4) out->rgba[i] = 255;
    }
    return out;
}

namespace {
std::vector<Canvas*>& contexts() {
    static std::vector<Canvas*> stack;
    return stack;
}
}

Canvas* Canvas::current() { return contexts().empty() ? nullptr : contexts().back(); }
void Canvas::push(Canvas* canvas) { contexts().push_back(canvas); }
void Canvas::pop() {
    if (!contexts().empty()) contexts().pop_back();
}

ImageRef UIGraphicsImageRenderer::image(const std::function<void(Canvas&)>& actions) const {
    Canvas canvas(size, format.scale, format.opaque);
    Canvas::push(&canvas);
    actions(canvas);
    Canvas::pop();
    return canvas.image();
}

// MARK: - UIKit's calls, into the current canvas

void setFill(Color color) {
    if (Canvas* c = Canvas::current()) c->setFillColor(color);
}

void UIRectFill(CGRect rect) {
    if (Canvas* c = Canvas::current()) c->rectFill(rect);
}

UIBezierPath UIBezierPath::ovalIn(CGRect rect) {
    UIBezierPath path;
    path.oval = rect;
    return path;
}

void UIBezierPath::move(CGPoint to) { elements.push_back({0, to}); }
void UIBezierPath::addLine(CGPoint to) { elements.push_back({1, to}); }
void UIBezierPath::close() { elements.push_back({2, {}}); }

void UIBezierPath::fill() const {
    Canvas* c = Canvas::current();
    if (!c) return;
    if (oval) {
        c->fillEllipse(*oval);
        return;
    }
    if (elements.empty()) return;
    for (const Element& e : elements) {
        if (e.kind == 0) c->move(e.p); else if (e.kind == 1) c->addLine(e.p); else c->closePath();
    }
    c->fillPath();
}

void drawString(const std::string& string, CGPoint at, const TextAttributes& withAttributes) {
    if (Canvas* c = Canvas::current()) c->drawText(string, at, withAttributes, unwrapped, 0);
}

void drawString(const std::string& string, CGRect rect, int options, const TextAttributes& attributes) {
    if (Canvas* c = Canvas::current()) {
        c->drawText(string, rect.origin, attributes, rect.width(), lineLimit(rect.height(), options, attributes));
    }
}

void drawImage(const ImageRef& image, CGRect in) {
    if (Canvas* c = Canvas::current()) c->drawImage(image, in);
}

// MARK: - TextKit

TextLayout::TextLayout(const std::string& string, const TextAttributes& attributes, CGSize containerSize, int maximumNumberOfLines)
    : containerSize(containerSize), string(string), attributes(attributes), lines(maximumNumberOfLines) {
    frame();        // ensureLayout
}

const TextFrame& TextLayout::frame() const { return layoutText(string, attributes, containerSize.width, lines, true); }

CGRect TextLayout::usedRect() const {
    const TextFrame& f = frame();
    return {0, 0, f.width, f.height};
}

void TextLayout::drawGlyphs(CGPoint at) const {
    if (Canvas* c = Canvas::current()) c->drawText(string, at, attributes, containerSize.width, lines);
}

int TextLayout::characterIndex(CGPoint point) const {
    const TextFrame& f = frame();
    if (f.lines.empty()) return 0;
    const TextLine* line = &f.lines.back();
    for (const TextLine& l : f.lines) {
        if (point.y < l.y + l.height) {
            line = &l;
            break;
        }
    }
    int n = line->end - line->start;
    if (n <= 0 || int(line->carets.size()) < n + 1) return line->start;
    for (int i = 0; i < n; i++) {
        if (point.x < line->carets[size_t(i) + 1]) return line->start + i;
    }
    return line->end - 1;
}

void TextLayout::enumerateEnclosingRects(CharacterRange range, const std::function<void(CGRect)>& body) const {
    const TextFrame& f = frame();
    for (const TextLine& line : f.lines) {
        int lo = std::max(range.location, line.start), hi = std::min(range.location + range.length, line.end);
        if (lo >= hi || int(line.carets.size()) < line.end - line.start + 1) continue;
        float x0 = line.carets[size_t(lo - line.start)];
        // Not past the line's last word: the spaces a line ends with are not marked.
        float x1 = std::min(line.carets[size_t(hi - line.start)], line.x + line.width);
        if (x1 > x0) body(CGRect{x0, line.y, x1 - x0, line.height});
    }
}

// MARK: - Pictures

ImageRef cropping(const ImageRef& image, CGRect to) {
    if (!image) return nullptr;
    image->wait();      // its pixels are read here
    int x0 = std::max(0, int(std::floor(to.minX()))), y0 = std::max(0, int(std::floor(to.minY())));
    int x1 = std::min(image->width, int(std::ceil(to.maxX()))), y1 = std::min(image->height, int(std::ceil(to.maxY())));
    if (x1 <= x0 || y1 <= y0) return nullptr;
    auto out = std::make_shared<Image>();
    out->width = x1 - x0;
    out->height = y1 - y0;
    out->scale = image->scale;
    out->rgba.resize(size_t(out->width) * size_t(out->height) * 4);
    for (int y = 0; y < out->height; y++) {
        std::memcpy(&out->rgba[size_t(y) * size_t(out->width) * 4],
                    &image->rgba[(size_t(y0 + y) * size_t(image->width) + size_t(x0)) * 4], size_t(out->width) * 4);
    }
    return out;
}

ImageRef gaussianBlur(const ImageRef& image, float sigma) {
    if (!image || image->width <= 0 || image->height <= 0 || !(sigma > 0)) return image;
    image->wait();      // its pixels are read here
    const int w = image->width, h = image->height;
    // sRGB to linear light and back, by table.
    static float toLinear[256];
    static bool made = false;
    if (!made) {
        for (int i = 0; i < 256; i++) {
            float s = float(i) / 255;
            toLinear[i] = s <= 0.04045f ? s / 12.92f : std::pow((s + 0.055f) / 1.055f, 2.4f);
        }
        made = true;
    }
    auto toSRGB = [](float l) {
        l = std::min(1.f, std::max(0.f, l));
        return l <= 0.0031308f ? l * 12.92f : 1.055f * std::pow(l, 1 / 2.4f) - 0.055f;
    };
    // Premultiplied, linear, as floats.
    std::vector<float> a(size_t(w) * size_t(h) * 4), b(a.size());
    for (size_t i = 0; i < size_t(w) * size_t(h); i++) {
        const uint8_t* p = &image->rgba[i * 4];
        float alpha = float(p[3]) / 255;
        for (int k = 0; k < 3; k++) {
            // Take the alpha out before the curve, and put it back after.
            int straight = p[3] == 0 ? 0 : std::min(255, int(std::lround(float(p[k]) / alpha)));
            a[i * 4 + size_t(k)] = toLinear[straight] * alpha;
        }
        a[i * 4 + 3] = alpha;
    }
    int radius = std::max(1, int(std::ceil(sigma * 3)));
    std::vector<float> kernel(size_t(2 * radius + 1));
    float sum = 0;
    for (int k = -radius; k <= radius; k++) {
        kernel[size_t(k + radius)] = std::exp(-float(k * k) / (2 * sigma * sigma));
        sum += kernel[size_t(k + radius)];
    }
    for (float& k : kernel) k /= sum;
    // Across, then down; past an edge, the edge's own pixel again (clampedToExtent).
    for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
            float acc[4] = {0, 0, 0, 0};
            for (int k = -radius; k <= radius; k++) {
                const float* p = &a[(size_t(y) * size_t(w) + size_t(std::min(w - 1, std::max(0, x + k)))) * 4];
                float weight = kernel[size_t(k + radius)];
                acc[0] += p[0] * weight;
                acc[1] += p[1] * weight;
                acc[2] += p[2] * weight;
                acc[3] += p[3] * weight;
            }
            std::memcpy(&b[(size_t(y) * size_t(w) + size_t(x)) * 4], acc, sizeof acc);
        }
    }
    for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
            float acc[4] = {0, 0, 0, 0};
            for (int k = -radius; k <= radius; k++) {
                const float* p = &b[(size_t(std::min(h - 1, std::max(0, y + k))) * size_t(w) + size_t(x)) * 4];
                float weight = kernel[size_t(k + radius)];
                acc[0] += p[0] * weight;
                acc[1] += p[1] * weight;
                acc[2] += p[2] * weight;
                acc[3] += p[3] * weight;
            }
            std::memcpy(&a[(size_t(y) * size_t(w) + size_t(x)) * 4], acc, sizeof acc);
        }
    }
    auto out = std::make_shared<Image>();
    out->width = w;
    out->height = h;
    out->scale = image->scale;
    out->rgba.resize(image->rgba.size());
    for (size_t i = 0; i < size_t(w) * size_t(h); i++) {
        float alpha = std::min(1.f, std::max(0.f, a[i * 4 + 3]));
        for (int k = 0; k < 3; k++) {
            float straight = alpha > 1e-5f ? a[i * 4 + size_t(k)] / alpha : 0;
            out->rgba[i * 4 + size_t(k)] = uint8_t(std::lround(toSRGB(straight) * alpha * 255));
        }
        out->rgba[i * 4 + 3] = uint8_t(std::lround(alpha * 255));
    }
    return out;
}
