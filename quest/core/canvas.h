// Drawing text and shapes into a picture: what stands in for UIKit drawing
// (UIGraphicsImageRenderer, UIRectFill, UIBezierPath, NSString drawing,
// CGContext, TextKit) in the ported sources, under names close to UIKit's so
// the drawing code reads like the Swift.
//
//   CGFloat                                   -> float
//   CGPoint / CGSize / CGRect                 -> the same names, here (float)
//   UIFont.systemFont(ofSize:weight:)         -> Font::systemFont(size, Font::Weight::semibold)
//   font.lineHeight / font.pointSize          -> font.lineHeight() / font.pointSize
//   [NSAttributedString.Key: Any]             -> TextAttributes {font, foregroundColor, kern, paragraphStyle}
//   NSMutableParagraphStyle                   -> ParagraphStyle
//   UIGraphicsImageRendererFormat             -> the same name
//   UIGraphicsImageRenderer(size:format:).image { ctx in … }
//                                             -> UIGraphicsImageRenderer(size, format).image([&](Canvas& ctx) { … })
//   CGContext (and $0.cgContext)              -> Canvas&
//   color.setFill()                           -> setFill(color)
//   UIRectFill(rect)                          -> UIRectFill(rect)
//   UIBezierPath(ovalIn: r).fill()            -> UIBezierPath::ovalIn(r).fill()
//   (s as NSString).size(withAttributes: a)   -> stringSize(s, a)
//   (s as NSString).boundingRect(with: size, options: o, attributes: a, context: nil)
//                                             -> stringBoundingRect(s, size, o, a)
//   (s as NSString).draw(at: p, withAttributes: a)
//                                             -> drawString(s, p, a)
//   (s as NSString).draw(with: rect, options: o, attributes: a, context: nil)
//                                             -> drawString(s, rect, o, a)
//   UIImage(cgImage: image).draw(in: rect)    -> drawImage(image, rect)
//   image.cropping(to: rect)                  -> cropping(image, rect)
//   NSTextStorage + NSLayoutManager + NSTextContainer
//                                             -> TextLayout
//   CIImage…applyingGaussianBlur(sigma:)      -> gaussianBlur(image, sigma)
//
// How it works. A Canvas does not draw: it writes each call into a small list
// of commands, and `image()` hands the whole list to the host, which draws it
// in one go (CoreGraphics and CoreText on the Mac, android.graphics on the
// Quest, where that is one call into Kotlin). Text is measured by the host
// too, by the same code that later draws it, so a measure and a drawing always
// agree; measures are remembered here, since the same words are asked about
// again and again.
//
// The fonts are the host's own (SF on the Mac, Roboto on the Quest), so the
// same words are not the same width on both. Nothing may assume a text's
// size: measure it, as the Swift does.
//
// Coordinates are UIKit's: points, the origin at the top left, y downward.
//
// Strings and character indices. Strings are std::string, UTF-8. A character
// index or range (what the Swift takes from NSString and NSRange) counts
// UTF-16 code units, exactly as NSString does, on both hosts. Code that walks
// a string by index turns it into a std::u16string first with `utf16()`,
// indexes that as the Swift indexes its NSString, and turns what it cut out
// back with `utf8()`.
#pragma once
#include <cmath>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "scene.h"

// MARK: - Geometry

struct CGPoint {
    float x = 0, y = 0;
    constexpr CGPoint() = default;
    constexpr CGPoint(float x, float y) : x(x), y(y) {}
    static constexpr CGPoint zero() { return {}; }
};
inline bool operator==(CGPoint a, CGPoint b) { return a.x == b.x && a.y == b.y; }

struct CGSize {
    float width = 0, height = 0;
    constexpr CGSize() = default;
    constexpr CGSize(float width, float height) : width(width), height(height) {}
    static constexpr CGSize zero() { return {}; }
};
inline bool operator==(CGSize a, CGSize b) { return a.width == b.width && a.height == b.height; }

/// Its width and height are never negative in the sources, so nothing here standardizes.
struct CGRect {
    CGPoint origin;
    CGSize size;
    constexpr CGRect() = default;
    /// CGRect(x:y:width:height:)
    constexpr CGRect(float x, float y, float width, float height) : origin(x, y), size(width, height) {}
    /// CGRect(origin:size:)
    constexpr CGRect(CGPoint origin, CGSize size) : origin(origin), size(size) {}
    static constexpr CGRect zero() { return {}; }
    constexpr float width() const { return size.width; }
    constexpr float height() const { return size.height; }
    constexpr float minX() const { return origin.x; }
    constexpr float midX() const { return origin.x + size.width / 2; }
    constexpr float maxX() const { return origin.x + size.width; }
    constexpr float minY() const { return origin.y; }
    constexpr float midY() const { return origin.y + size.height / 2; }
    constexpr float maxY() const { return origin.y + size.height; }
    constexpr CGRect insetBy(float dx, float dy) const { return {origin.x + dx, origin.y + dy, size.width - 2 * dx, size.height - 2 * dy}; }
    constexpr CGRect offsetBy(float dx, float dy) const { return {origin.x + dx, origin.y + dy, size.width, size.height}; }
    constexpr bool contains(CGPoint p) const { return p.x >= minX() && p.x < maxX() && p.y >= minY() && p.y < maxY(); }
};

// MARK: - Strings

/// A string as NSString holds it, and back.
std::u16string utf16(const std::string& s);
std::string utf8(const std::u16string& s);
/// String.uppercased(): Latin (with its accents), Greek and Cyrillic; anything else is left as it is.
std::string uppercased(const std::string& s);

/// Foundation's CharacterSet, as far as the sources ask: `CharacterSet::whitespacesAndNewlines(c)`
/// is `CharacterSet.whitespacesAndNewlines.contains(c)`.
namespace CharacterSet {
bool whitespacesAndNewlines(char32_t c);
bool punctuationCharacters(char32_t c);
}
/// String.trimmingCharacters(in:), for a set given as a test.
std::u16string trimmingCharacters(const std::u16string& s, const std::function<bool(char32_t)>& in);

/// NSRange: UTF-16 code units.
struct CharacterRange {
    int location = 0, length = 0;
};

// MARK: - Fonts and text attributes

/// What a font measures, points, all positive: UIFont's ascender, -descender and leading.
struct FontMetrics {
    float ascent = 0, descent = 0, leading = 0;
};

/// UIFont: only the system font, by size and weight.
struct Font {
    /// UIFont.Weight
    enum class Weight { regular, medium, semibold, bold };
    float pointSize = 12;
    Weight weight = Weight::regular;

    static Font systemFont(float ofSize, Weight weight = Weight::regular) { return {ofSize, weight}; }
    /// ascender - descender + leading: what one line of it takes when nothing says otherwise.
    float lineHeight() const;
    FontMetrics metrics() const;
};
inline bool operator==(const Font& a, const Font& b) { return a.pointSize == b.pointSize && a.weight == b.weight; }

/// `weight.rawValue`
inline float rawValue(Font::Weight w) {
    switch (w) {
    case Font::Weight::regular: return 0;
    case Font::Weight::medium: return 0.23f;
    case Font::Weight::semibold: return 0.3f;
    case Font::Weight::bold: return 0.4f;
    }
    return 0;
}

/// NSLineBreakMode
enum class LineBreakMode { byWordWrapping, byTruncatingTail };

/// NSMutableParagraphStyle: the three things the sources set. A line height of 0 is "not set".
struct ParagraphStyle {
    float minimumLineHeight = 0;
    float maximumLineHeight = 0;
    LineBreakMode lineBreakMode = LineBreakMode::byWordWrapping;
};

/// A string's attributes: `[.font: f, .foregroundColor: c, .kern: k, .paragraphStyle: style]`.
/// `kern` is nullopt when the Swift leaves `.kern` out, and the font then spaces its letters as it
/// likes. When it is given, that much is added after every character; given as 0, it also turns
/// the font's own spacing off (pair kerning, and on Apple's system font its tracking), as the
/// same dictionary does in UIKit: the same words measure a little wider with `.kern: 0` than with
/// no kern at all. So a width measured with one set of attributes holds only for drawing with the same.
/// `[.font: f, .kern: kern]` is `TextAttributes{.font = f, .kern = kern}`.
struct TextAttributes {
    Font font;
    Color foregroundColor = Color::black();
    std::optional<float> kern;
    ParagraphStyle paragraphStyle;
};

/// NSStringDrawingOptions, to be or-ed together.
enum StringDrawingOptions : int {
    usesLineFragmentOrigin = 1 << 0,
    truncatesLastVisibleLine = 1 << 5,
};

// MARK: - Laid-out text

/// One line of laid-out text. Positions are from the layout's top-left corner.
struct TextLine {
    float x = 0, y = 0;             // the line's own box: as wide as its words (and its ellipsis),
    float width = 0, height = 0;    // as tall as a line is
    float baseline = 0;
    int start = 0, end = 0;         // the characters of the string it shows (UTF-16), before any ellipsis
    bool truncated = false;         // it ends in an ellipsis: the string went on
    /// Only when asked for: where each character from `start` to `end` begins, and where the last one ends
    /// (end - start + 1 numbers), from the layout's left edge.
    std::vector<float> carets;
};

/// A string, laid out: what the host answers.
struct TextFrame {
    float width = 0, height = 0;    // the used rectangle: the widest line, and every line's height
    std::vector<TextLine> lines;
};

/// Lays a string out, or finds the same layout again if it was asked for before.
/// - `width`: where lines wrap; infinity for a single line (a newline still starts another).
/// - `maxLines`: 0 for as many as it takes. Otherwise the text stops there, and if it went on, the
///   last line ends in an ellipsis.
/// - `carets`: also say where each character lies.
/// Lines are `textLineHeight(attributes)` apart, each with its words standing on the bottom of its line.
const TextFrame& layoutText(const std::string& string, const TextAttributes& attributes, float width, int maxLines, bool carets = false);

/// How tall each line of text with these attributes is: the font's own line
/// height, kept within the paragraph style's minimum and maximum.
float textLineHeight(const TextAttributes& attributes);

/// NSString.size(withAttributes:): one line, unwrapped. Not rounded.
CGSize stringSize(const std::string& string, const TextAttributes& withAttributes);
/// NSString.boundingRect(with:options:attributes:context:), with `.usesLineFragmentOrigin`: wrapped to
/// `size.width`. Without `.truncatesLastVisibleLine` it may come out taller than `size`.
CGRect stringBoundingRect(const std::string& string, CGSize size, int options, const TextAttributes& attributes);

// MARK: - Canvas

/// A picture being drawn. It is a CGContext (the calls below have its names) and, while a
/// UIGraphicsImageRenderer runs its actions, the "current context" the UIKit calls draw into.
class Canvas {
public:
    /// CGLineJoin and CGLineCap
    enum class LineJoin { miter = 0, round = 1, bevel = 2 };
    enum class LineCap { butt = 0, round = 1, square = 2 };

    /// A picture `size` points large, `scale` pixels to a point. An opaque one starts black
    /// and has no see-through pixels; otherwise it starts clear.
    Canvas(CGSize size, float scale = 1, bool opaque = false);

    const CGSize size;
    const float scale;
    const bool opaque;

    // CGContext
    void saveGState();
    void restoreGState();
    /// clip(to: rect)
    void clip(CGRect to);
    void setFillColor(Color color);
    void setStrokeColor(Color color);
    void setLineWidth(float width);
    void setLineJoin(LineJoin join);
    void setLineCap(LineCap cap);
    /// setLineDash(phase:lengths:); no lengths is a solid line again.
    void setLineDash(float phase, const std::vector<float>& lengths);
    /// move(to:), addLine(to:), closePath(): the current path, used up by strokePath() or fillPath().
    void move(CGPoint to);
    void addLine(CGPoint to);
    void closePath();
    void strokePath();
    void fillPath();
    /// stroke(rect), fill(rect), strokeEllipse(in:), fillEllipse(in:)
    void stroke(CGRect rect);
    void fill(CGRect rect);
    void strokeEllipse(CGRect in);
    void fillEllipse(CGRect in);

    // What UIKit draws into the current context. The free functions below call these.
    /// UIRectFill: the fill color put in place of what was there (a see-through color leaves a see-through hole).
    void rectFill(CGRect rect);
    /// UIImage.draw(in:): the whole picture, stretched to the rectangle.
    void drawImage(const ImageRef& image, CGRect in);
    /// A string laid out as `layoutText` lays it, its top-left corner at `at`.
    void drawText(const std::string& string, CGPoint at, const TextAttributes& attributes, float width, int maxLines);

    /// The finished picture: RGBA8, premultiplied, row 0 at the top, `scale` set. Call it once, at the end.
    ImageRef image();

    /// The canvas the UIKit calls draw into, or nullptr outside a renderer's actions.
    static Canvas* current();
    /// UIGraphicsPushContext and UIGraphicsPopContext
    static void push(Canvas* canvas);
    static void pop();

    // What was drawn, for the host. `commands` is a run of numbers: an Op, then what it takes.
    // Colors are r, g, b, a (0...1, not premultiplied); rectangles are x, y, width, height.
    enum class Op : int {
        save = 1,           // -
        restore = 2,        // -
        clip = 3,           // rect
        fillColor = 4,      // color
        strokeColor = 5,    // color
        lineWidth = 6,      // width
        lineJoin = 7,       // LineJoin
        lineCap = 8,        // LineCap
        lineDash = 9,       // phase, n, then n lengths
        move = 10,          // x, y
        line = 11,          // x, y
        close = 12,         // -
        strokePath = 13,    // -   (and the path is gone)
        fillPath = 14,      // -   (and the path is gone)
        fillRect = 15,      // rect: CGContext.fill, drawn over what is there
        copyRect = 16,      // rect: UIRectFill, put in place of what is there
        strokeRect = 17,    // rect
        fillEllipse = 18,   // rect
        strokeEllipse = 19, // rect
        image = 20,         // index into `images`, rect
        text = 21,          // index into `strings`, x, y, width (>= 1e6: no wrapping), maxLines, font size,
                            // weight (Font::Weight), kerned (0 or 1), kern, line height (0: the font's own), color
    };
    std::vector<float> commands;
    std::vector<std::string> strings;
    std::vector<ImageRef> images;

private:
    void put(Op op) { commands.push_back(float(int(op))); }
    void put(Op op, CGRect r);
    void put(Op op, Color c);
};

/// UIGraphicsImageRendererFormat. (UIKit's own default scale is the screen's; the sources always say 1.)
struct UIGraphicsImageRendererFormat {
    float scale = 1;
    bool opaque = false;
};

/// UIGraphicsImageRenderer(size:format:). `image` runs the actions with a new canvas as the
/// current context and gives the picture; the canvas it passes is `context.cgContext`.
class UIGraphicsImageRenderer {
public:
    UIGraphicsImageRenderer(CGSize size, UIGraphicsImageRendererFormat format = {}) : size(size), format(format) {}
    ImageRef image(const std::function<void(Canvas&)>& actions) const;

private:
    CGSize size;
    UIGraphicsImageRendererFormat format;
};

// MARK: - UIKit's calls, into the current canvas

/// `color.setFill()`
void setFill(Color color);
void UIRectFill(CGRect rect);

/// UIBezierPath: an oval, or straight lines.
class UIBezierPath {
public:
    UIBezierPath() = default;
    /// UIBezierPath(ovalIn:)
    static UIBezierPath ovalIn(CGRect rect);
    void move(CGPoint to);
    void addLine(CGPoint to);
    void close();
    /// Filled with the current fill color.
    void fill() const;

private:
    struct Element {
        int kind;       // 0 move, 1 line, 2 close
        CGPoint p;
    };
    std::vector<Element> elements;
    std::optional<CGRect> oval;
};

/// NSString.draw(at:withAttributes:): one line, its top-left corner at `at`.
void drawString(const std::string& string, CGPoint at, const TextAttributes& withAttributes);
/// NSString.draw(with:options:attributes:context:), with `.usesLineFragmentOrigin`: wrapped to the
/// rectangle's width. With `.truncatesLastVisibleLine`, only the lines that fit its height are drawn,
/// and the last of them ends in an ellipsis if the string goes on. A paragraph style that truncates
/// its tail makes it one line.
void drawString(const std::string& string, CGRect rect, int options, const TextAttributes& attributes);

/// UIImage(cgImage: image).draw(in: rect)
void drawImage(const ImageRef& image, CGRect in);

// MARK: - TextKit

/// A string laid out in a box and kept: NSTextStorage, NSLayoutManager and
/// NSTextContainer in one, as the sources set them up (no padding at the
/// sides; when the string needs more than `maximumNumberOfLines` lines, the
/// last ends in an ellipsis).
class TextLayout {
public:
    /// NSTextStorage(string:attributes:), NSTextContainer(size:) with `maximumNumberOfLines`, and ensureLayout.
    /// The container's height is not looked at: the sources always give all the room there is.
    TextLayout(const std::string& string, const TextAttributes& attributes, CGSize containerSize, int maximumNumberOfLines);

    /// container.size
    CGSize containerSize;
    /// manager.usedRect(for: container)
    CGRect usedRect() const;
    /// manager.drawGlyphs(forGlyphRange: manager.glyphRange(for: container), at: origin): all of it, into the current canvas.
    void drawGlyphs(CGPoint at) const;
    /// manager.characterIndex(for:in:fractionOfDistanceBetweenInsertionPoints:): the character under a
    /// point in the container; past a line's end, that line's last one.
    int characterIndex(CGPoint point) const;
    /// manager.enumerateEnclosingRects(forGlyphRange:withinSelectedGlyphRange:in:): one rectangle a line,
    /// as tall as the line, round the characters of the range that the line shows.
    void enumerateEnclosingRects(CharacterRange range, const std::function<void(CGRect)>& body) const;

private:
    std::string string;
    TextAttributes attributes;
    int lines;
    const TextFrame& frame() const;
};

// MARK: - Pictures

/// CGImage.cropping(to:): the part of a picture inside a rectangle given in its pixels, as a
/// picture of its own. nullptr if the rectangle misses it.
ImageRef cropping(const ImageRef& image, CGRect to);

/// CIImage(cgImage:).clampedToExtent().applyingGaussianBlur(sigma:).cropped(to: extent): the same
/// picture out of focus, its edges carried outward so they do not darken. Mixed in linear light, as
/// Core Image does.
ImageRef gaussianBlur(const ImageRef& image, float sigma);

// MARK: - What the host provides

namespace platform {
/// The system font's measures at a size and weight.
FontMetrics fontMetrics(const Font& font);
/// Lays text out; `layoutText` above describes what is asked. `kern` as in TextAttributes;
/// `lineHeight` is each line's height, or 0 for the font's own (ascent + descent + leading).
/// Line i's top is i line heights down, and its baseline is its bottom less the font's descent.
/// Lines break between words (inside a word only if it is wider than `width` by itself), and each
/// line's width leaves out the spaces it ends with. Called only when the answer isn't already known.
TextFrame layoutText(const std::string& text, const Font& font, std::optional<float> kern, float lineHeight,
                     float width, int maxLines, bool carets);
/// Draws a canvas's commands into a new picture: ceil(size * scale) pixels, RGBA8, premultiplied,
/// row 0 at the top. Text is laid out by the same code as `layoutText`.
ImageRef rasterize(const Canvas& canvas);
}
