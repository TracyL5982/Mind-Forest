// The Mac's side of canvas.h: CoreGraphics draws, CoreText sets the type.
// No AppKit: the system font comes from CoreText by size and weight.
//
// canvas.h has its own CGPoint, CGSize and CGRect (the ported sources use
// them as the Swift does), which are not Apple's structs. So that both can
// be seen in this one file, Apple's three are given other names while its
// headers are read; its functions (CGRectMake, CGContextFillRect…) keep
// theirs and take and give the renamed structs. Any other Objective-C++
// file that needs both canvas.h and Apple's geometry has to do the same.
#define CGPoint AppleCGPoint
#define CGSize AppleCGSize
#define CGRect AppleCGRect
#import <CoreFoundation/CoreFoundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreText/CoreText.h>
#undef CGPoint
#undef CGSize
#undef CGRect

#include <algorithm>
#include <cmath>
#include <map>
#include <vector>

#include "base.h"
#include "canvas.h"

namespace {

// MARK: - Fonts

/// The system font at a size and weight. Kept for good: there are a few dozen at most.
CTFontRef systemFont(const Font& font) {
    static std::map<std::pair<float, int>, CTFontRef> known;
    auto key = std::make_pair(font.pointSize, int(font.weight));
    auto it = known.find(key);
    if (it != known.end()) return it->second;
    CTFontRef made = CTFontCreateUIFontForLanguage(kCTFontUIFontSystem, font.pointSize, nullptr);
    if (made && font.weight != Font::Weight::regular) {
        // The same font, asked for again by its weight (UIFont.Weight's own numbers).
        CGFloat weight = rawValue(font.weight);
        CFNumberRef number = CFNumberCreate(nullptr, kCFNumberCGFloatType, &weight);
        const void* traitKeys[] = {kCTFontWeightTrait};
        const void* traitValues[] = {number};
        CFDictionaryRef traits = CFDictionaryCreate(nullptr, traitKeys, traitValues, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
        const void* keys[] = {kCTFontTraitsAttribute};
        const void* values[] = {traits};
        CFDictionaryRef attributes = CFDictionaryCreate(nullptr, keys, values, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
        CTFontDescriptorRef plain = CTFontCopyFontDescriptor(made);
        CTFontDescriptorRef heavy = CTFontDescriptorCreateCopyWithAttributes(plain, attributes);
        CTFontRef weighted = CTFontCreateWithFontDescriptor(heavy, font.pointSize, nullptr);
        if (weighted) {
            CFRelease(made);
            made = weighted;
        }
        CFRelease(heavy);
        CFRelease(plain);
        CFRelease(attributes);
        CFRelease(traits);
        CFRelease(number);
    }
    known[key] = made;
    return made;
}

// MARK: - Text

CFStringRef makeString(const std::string& text) {
    CFStringRef s = CFStringCreateWithBytes(nullptr, reinterpret_cast<const UInt8*>(text.data()), CFIndex(text.size()), kCFStringEncodingUTF8, false);
    return s ? s : CFStringCreateWithCString(nullptr, "", kCFStringEncodingUTF8);
}

/// The attributes CoreText is given: the font, the kern if one was asked for (0 turns pair
/// kerning off, as it does in UIKit), and a color when the text is about to be drawn.
CFDictionaryRef makeAttributes(CTFontRef font, std::optional<float> kern, CGColorRef color) {
    const void* keys[3];
    const void* values[3];
    CFIndex n = 0;
    keys[n] = kCTFontAttributeName;
    values[n++] = font;
    CFNumberRef number = nullptr;
    if (kern) {
        CGFloat k = *kern;
        number = CFNumberCreate(nullptr, kCFNumberCGFloatType, &k);
        keys[n] = kCTKernAttributeName;
        values[n++] = number;
    }
    if (color) {
        keys[n] = kCTForegroundColorAttributeName;
        values[n++] = color;
    }
    CFDictionaryRef d = CFDictionaryCreate(nullptr, keys, values, n, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    if (number) CFRelease(number);
    return d;
}

/// A line's width as it shows: without the spaces it ends with.
double shownWidth(CTLineRef line) {
    return std::max(0.0, CTLineGetTypographicBounds(line, nullptr, nullptr, nullptr) - CTLineGetTrailingWhitespaceWidth(line));
}

/// Lays text out: canvas.h's `platform::layoutText` says how. With `keep`, the CTLines are handed
/// back too, one for each line of the frame, for drawing; the caller releases them.
TextFrame lay(const std::string& text, const Font& font, std::optional<float> kern, float lineHeight, float width, int maxLines,
              bool carets, CGColorRef color, std::vector<CTLineRef>* keep) {
    CTFontRef ct = systemFont(font);
    double descent = CTFontGetDescent(ct);
    double natural = CTFontGetAscent(ct) + descent + CTFontGetLeading(ct);
    double advance = lineHeight > 0 ? lineHeight : natural;
    bool unlimited = !(width < 1e6f);
    double wrap = unlimited ? 1e7 : std::max(1.0, double(width));

    TextFrame frame;
    CFStringRef string = makeString(text);
    CFIndex length = CFStringGetLength(string);
    if (length == 0) {
        // No words still take a line (TextKit's extra line fragment).
        TextLine line;
        line.height = float(advance);
        line.baseline = float(advance - descent);
        if (carets) line.carets = {0};
        frame.lines.push_back(line);
        frame.height = float(advance);
        if (keep) {
            CFDictionaryRef attributes = makeAttributes(ct, kern, color);
            CFAttributedStringRef attributed = CFAttributedStringCreate(nullptr, string, attributes);
            keep->push_back(CTLineCreateWithAttributedString(attributed));
            CFRelease(attributed);
            CFRelease(attributes);
        }
        CFRelease(string);
        return frame;
    }

    CFDictionaryRef attributes = makeAttributes(ct, kern, color);
    CFAttributedStringRef attributed = CFAttributedStringCreate(nullptr, string, attributes);
    CTTypesetterRef typesetter = CTTypesetterCreateWithAttributedString(attributed);

    CFIndex start = 0;
    int n = 0;
    while (start < length) {
        bool last = maxLines > 0 && n == maxLines - 1;
        CFIndex count = CTTypesetterSuggestLineBreak(typesetter, start, wrap);
        if (count <= 0) count = 1;
        TextLine line;
        line.y = float(n * advance);
        line.height = float(advance);
        line.baseline = float(n * advance + advance - descent);
        line.start = int(start);
        line.end = int(start + count);
        CTLineRef made = nullptr;
        if (last && start + count < length && !unlimited) {
            // The string goes on: this line takes the rest of its paragraph and is cut short with an ellipsis.
            CFIndex stop = start;
            while (stop < length) {
                UniChar c = CFStringGetCharacterAtIndex(string, stop);
                if (c == '\n' || c == '\r' || c == 0x2028 || c == 0x2029) break;
                stop++;
            }
            if (stop <= start) stop = start + count;
            CTLineRef whole = CTTypesetterCreateLine(typesetter, CFRangeMake(start, stop - start));
            const UniChar ellipsis = 0x2026;
            CFStringRef dot = CFStringCreateWithCharacters(nullptr, &ellipsis, 1);
            CFAttributedStringRef dots = CFAttributedStringCreate(nullptr, dot, attributes);
            CTLineRef token = CTLineCreateWithAttributedString(dots);
            made = CTLineCreateTruncatedLine(whole, wrap, kCTLineTruncationEnd, token);
            if (!made) made = (CTLineRef)CFRetain(token);
            double shown = shownWidth(made);
            double room = shown - CTLineGetTypographicBounds(token, nullptr, nullptr, nullptr) + 0.5;
            bool cut = CTLineGetTypographicBounds(whole, nullptr, nullptr, nullptr) > wrap + 0.01;
            line.truncated = cut;
            // The characters still showing: those that end before the ellipsis begins.
            CFIndex end = stop;
            if (cut) {
                end = start;
                while (end < stop && CTLineGetOffsetForStringIndex(whole, end + 1, nullptr) <= room) end++;
            }
            line.end = int(end);
            if (carets) {
                for (CFIndex i = start; i <= end; i++) {
                    line.carets.push_back(float(std::min(CTLineGetOffsetForStringIndex(whole, i, nullptr), shown)));
                }
            }
            line.width = float(shown);
            CFRelease(token);
            CFRelease(dots);
            CFRelease(dot);
            CFRelease(whole);
        } else {
            made = CTTypesetterCreateLine(typesetter, CFRangeMake(start, count));
            line.width = float(shownWidth(made));
            if (carets) {
                for (CFIndex i = start; i <= start + count; i++) {
                    line.carets.push_back(float(CTLineGetOffsetForStringIndex(made, i, nullptr)));
                }
            }
        }
        frame.width = std::max(frame.width, line.width);
        frame.lines.push_back(std::move(line));
        if (keep) keep->push_back(made); else CFRelease(made);
        start += count;
        n++;
        if (last) break;
    }
    frame.height = float(n * advance);

    CFRelease(typesetter);
    CFRelease(attributed);
    CFRelease(attributes);
    CFRelease(string);
    return frame;
}

// MARK: - Pictures

CGColorSpaceRef sRGB() {
    static CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    return space;
}

/// An Image's pixels as a CGImage. It reads the Image's own memory, so the Image must outlive it.
CGImageRef makeImage(const Image& image) {
    CGDataProviderRef provider = CGDataProviderCreateWithData(nullptr, image.rgba.data(), image.rgba.size(), nullptr);
    CGImageRef made = CGImageCreate(size_t(image.width), size_t(image.height), 8, 32, size_t(image.width) * 4, sRGB(),
                                    CGBitmapInfo(kCGImageAlphaPremultipliedLast) | kCGBitmapByteOrderDefault, provider, nullptr, true,
                                    kCGRenderingIntentDefault);
    CGDataProviderRelease(provider);
    return made;
}

}  // namespace

// MARK: - What canvas.h asks of the host

FontMetrics platform::fontMetrics(const Font& font) {
    CTFontRef ct = systemFont(font);
    return {float(CTFontGetAscent(ct)), float(CTFontGetDescent(ct)), float(CTFontGetLeading(ct))};
}

TextFrame platform::layoutText(const std::string& text, const Font& font, std::optional<float> kern, float lineHeight, float width,
                               int maxLines, bool carets) {
    Cost::Scope cost(Cost::layout);
    return lay(text, font, kern, lineHeight, width, maxLines, carets, nullptr, nullptr);
}

ImageRef platform::rasterize(const Canvas& canvas) {
    Cost::Scope cost(Cost::raster);
    int w = std::max(1, int(std::ceil(canvas.size.width * canvas.scale)));
    int h = std::max(1, int(std::ceil(canvas.size.height * canvas.scale)));
    auto image = std::make_shared<Image>();
    image->width = w;
    image->height = h;
    image->scale = canvas.scale;
    image->rgba.assign(size_t(w) * size_t(h) * 4, 0);
    // Bytes in memory are R, G, B, A, premultiplied; the first row is the picture's top.
    CGContextRef ctx = CGBitmapContextCreate(image->rgba.data(), size_t(w), size_t(h), 8, size_t(w) * 4, sRGB(),
                                             CGBitmapInfo(kCGImageAlphaPremultipliedLast) | kCGBitmapByteOrderDefault);
    if (!ctx) return nullptr;
    if (canvas.opaque) {
        CGContextSetRGBFillColor(ctx, 0, 0, 0, 1);
        CGContextFillRect(ctx, CGRectMake(0, 0, w, h));
    }
    // UIKit's coordinates: the origin at the top left, y downward, in points.
    CGContextTranslateCTM(ctx, 0, h);
    CGContextScaleCTM(ctx, canvas.scale, -canvas.scale);
    CGContextSetShouldSmoothFonts(ctx, false);
    CGContextSetInterpolationQuality(ctx, kCGInterpolationHigh);
    // CGContext's own first state.
    CGContextSetRGBFillColor(ctx, 0, 0, 0, 1);
    CGContextSetRGBStrokeColor(ctx, 0, 0, 0, 1);
    CGContextSetLineWidth(ctx, 1);

    const std::vector<float>& c = canvas.commands;
    size_t i = 0;
    auto number = [&]() { return i < c.size() ? c[i++] : 0.f; };
    auto rect = [&]() {
        float x = number(), y = number(), rw = number(), rh = number();
        return CGRectMake(x, y, rw, rh);
    };
    while (i < c.size()) {
        Canvas::Op op = Canvas::Op(int(number()));
        switch (op) {
        case Canvas::Op::save: CGContextSaveGState(ctx); break;
        case Canvas::Op::restore: CGContextRestoreGState(ctx); break;
        case Canvas::Op::clip: CGContextClipToRect(ctx, rect()); break;
        case Canvas::Op::fillColor: {
            float r = number(), g = number(), b = number(), a = number();
            CGContextSetRGBFillColor(ctx, r, g, b, a);
            break;
        }
        case Canvas::Op::strokeColor: {
            float r = number(), g = number(), b = number(), a = number();
            CGContextSetRGBStrokeColor(ctx, r, g, b, a);
            break;
        }
        case Canvas::Op::lineWidth: CGContextSetLineWidth(ctx, number()); break;
        case Canvas::Op::lineJoin: {
            int join = int(number());
            CGContextSetLineJoin(ctx, join == 1 ? kCGLineJoinRound : join == 2 ? kCGLineJoinBevel : kCGLineJoinMiter);
            break;
        }
        case Canvas::Op::lineCap: {
            int cap = int(number());
            CGContextSetLineCap(ctx, cap == 1 ? kCGLineCapRound : cap == 2 ? kCGLineCapSquare : kCGLineCapButt);
            break;
        }
        case Canvas::Op::lineDash: {
            float phase = number();
            int n = int(number());
            std::vector<CGFloat> lengths;
            for (int k = 0; k < n; k++) lengths.push_back(number());
            CGContextSetLineDash(ctx, phase, lengths.empty() ? nullptr : lengths.data(), lengths.size());
            break;
        }
        case Canvas::Op::move: {
            float x = number(), y = number();
            CGContextMoveToPoint(ctx, x, y);
            break;
        }
        case Canvas::Op::line: {
            float x = number(), y = number();
            CGContextAddLineToPoint(ctx, x, y);
            break;
        }
        case Canvas::Op::close: CGContextClosePath(ctx); break;
        case Canvas::Op::strokePath: CGContextStrokePath(ctx); break;
        case Canvas::Op::fillPath: CGContextFillPath(ctx); break;
        case Canvas::Op::fillRect: CGContextFillRect(ctx, rect()); break;
        case Canvas::Op::copyRect: {
            CGContextSaveGState(ctx);
            CGContextSetBlendMode(ctx, kCGBlendModeCopy);
            CGContextFillRect(ctx, rect());
            CGContextRestoreGState(ctx);
            break;
        }
        case Canvas::Op::strokeRect: CGContextStrokeRect(ctx, rect()); break;
        case Canvas::Op::fillEllipse: CGContextFillEllipseInRect(ctx, rect()); break;
        case Canvas::Op::strokeEllipse: CGContextStrokeEllipseInRect(ctx, rect()); break;
        case Canvas::Op::image: {
            size_t index = size_t(number());
            float x = number(), y = number(), iw = number(), ih = number();
            if (index >= canvas.images.size() || !canvas.images[index]) break;
            CGImageRef picture = makeImage(*canvas.images[index]);
            if (!picture) break;
            // A CGImage is drawn bottom-up; turned over here so its top row lands at the rectangle's top.
            CGContextSaveGState(ctx);
            CGContextTranslateCTM(ctx, x, y + ih);
            CGContextScaleCTM(ctx, 1, -1);
            CGContextDrawImage(ctx, CGRectMake(0, 0, iw, ih), picture);
            CGContextRestoreGState(ctx);
            CGImageRelease(picture);
            break;
        }
        case Canvas::Op::text: {
            size_t index = size_t(number());
            float x = number(), y = number(), width = number();
            int maxLines = int(number());
            float size = number();
            int weight = int(number());
            bool kerned = number() != 0;
            float kern = number(), lineHeight = number();
            float r = number(), g = number(), b = number(), a = number();
            if (index >= canvas.strings.size()) break;
            CGFloat parts[4] = {r, g, b, a};
            CGColorRef color = CGColorCreate(sRGB(), parts);
            std::vector<CTLineRef> lines;
            TextFrame frame = lay(canvas.strings[index], Font{size, Font::Weight(weight)}, kerned ? std::optional<float>(kern) : std::nullopt,
                                  lineHeight, width, maxLines, false, color, &lines);
            // Glyphs are drawn y-up; the text matrix turns them over to match the canvas.
            CGContextSetTextMatrix(ctx, CGAffineTransformMakeScale(1, -1));
            for (size_t k = 0; k < lines.size(); k++) {
                if (k < frame.lines.size()) {
                    CGContextSetTextPosition(ctx, x + frame.lines[k].x, y + frame.lines[k].baseline);
                    CTLineDraw(lines[k], ctx);
                }
                CFRelease(lines[k]);
            }
            CGColorRelease(color);
            break;
        }
        default:
            // Not a command: the list can't be read any further.
            i = c.size();
            break;
        }
    }
    CGContextRelease(ctx);
    return image;
}
