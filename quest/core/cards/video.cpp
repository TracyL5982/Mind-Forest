// components/video.js: a print of a clip. Tight corners, the poster to the edge under a round play mark,
// the caption on a plate below.
#include <algorithm>
#include <regex>

#include "kind.h"
#include "media.h"

namespace cards {

namespace {

constexpr int WIDTH = 272;
constexpr int POSTER = 153;
constexpr Setting NOTE{13.5f, 18.9f};

std::string caption(const Item& item, const Json& props) {
    std::string given = text(props["caption"]);
    return !given.empty() ? given : item.title;
}

int captionLines(const Item& item, const Json& props) {
    std::string c = caption(item, props);
    return c.empty() ? 0 : fold(points(c), WIDTH - SIDES, TEXT_LETTER, 2);
}

Footprint size(const Item& item, const Json& props) {
    int lines = captionLines(item, props);
    return {WIDTH, POSTER + 2 + (lines ? 19 + lines * TEXT : 0)};
}

/// `.media-play`: a dark disc with a hairline edge and a light triangle, centred on (cx, cy) px.
void playMark(const Pen& pen, float cx, float cy) {
    CGRect disc = pen.px(cx - 23, cy - 23, 46, 46);
    pen.ctx.setFillColor(Color{11 / 255.f, 13 / 255.f, 17 / 255.f, 0.7f});
    pen.ctx.fillEllipse(disc);
    pen.ctx.setStrokeColor(palette::line2);
    pen.ctx.setLineWidth(pen.k);
    pen.ctx.strokeEllipse(disc.insetBy(pen.k / 2, pen.k / 2));
    play(pen, cx - 23 + 1 + 18, cy - 23 + 1 + 13, 14, 18, palette::ink);
}

void draw(const Pen& pen, const Look&, const Item& item, const Json& props, float width, float) {
    CGRect frame = pen.px(1, 1, width - 2, POSTER);
    pen.ctx.setFillColor(palette::media);
    pen.ctx.fill(frame);
    std::string poster = text(props["poster"]);
    std::optional<Picture> known = pictureAt(poster);
    if (known && known->missing) {
        // A clip whose poster is missing keeps its play mark, with the words below it.
        unavailable(pen, frame, item.words, 14);
    } else if (!poster.empty()) {
        pen.picture(poster, frame, true, item.words);
    }
    playMark(pen, width / 2, 1 + POSTER / 2.f);
    if (int lines = captionLines(item, props)) pen.words(caption(item, props), 16, 1 + POSTER + 9, width - 32, lines, setting::text, palette::ink);
}

/// The opened card's player. The headset plays no clip, so a clip it could play shows its poster under
/// the play mark, and one with no file shows its poster and says so, as the web does.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    static const std::regex youtube("^https://www\\.youtube\\.com/embed/[\\w-]{11}$");
    std::string embed = text(item.data["embed"]), src = text(props["src"]), poster = text(props["poster"]);
    bool embedded = std::regex_match(embed, youtube), plays = embedded || !src.empty();
    std::optional<Picture> known = pictureAt(poster);
    bool missing = known && known->missing;
    std::optional<float> aspect = embedded ? std::optional(16.f / 9) : aspectOf(poster);
    // A player shows a poster it cannot have as no picture at all; a picture shows it as one unavailable.
    bool shown = !poster.empty() && !(plays && missing);
    float tall = !plays && poster.empty() ? 0 : !plays && missing ? 120 : std::min(Sheet::width / aspect.value_or(16.f / 9), 420.f);
    std::string note = plays ? "" : item.words.chinese ? "这段视频没有可播放的文件。" : "This clip has no file to play.";
    float noteTall = note.empty() ? 0 : 12 + heightOf(note, Sheet::width - 28, 0, NOTE, sheet.k) + 12;
    if (tall > 0) sheet.picture = CGRect{Sheet::left * sheet.k, (sheet.y + Sheet::gap) * sheet.k, Sheet::width * sheet.k, tall * sheet.k};
    Words words = item.words;
    sheet.part(tall + noteTall, [=](const Pen& pen, float y) {
        CGRect box = pen.px(Sheet::left, y, Sheet::width, tall + noteTall);
        pen.ctx.setFillColor(Color::hex(0x0F1115));
        pen.ctx.fill(box);
        CGRect frame = pen.px(Sheet::left, y, Sheet::width, tall);
        if (shown) pen.picture(poster, aspect && !missing ? contained(frame, *aspect) : frame, false, words);
        if (plays) playMark(pen, Sheet::left + Sheet::width / 2, y + tall / 2);
        pen.words(note, Sheet::left + 14, y + tall + 12, Sheet::width - 28, 0, NOTE, palette::ink2);
        pen.mask(box, 14 * pen.k, palette::glass);
    });
    if (!note.empty()) sheet.said.push_back(note);
    std::string c = text(props["caption"]);
    if (c != item.title && c != item.summary) sheet.paragraph(c, setting::caption, palette::ink2);
}

std::vector<std::string> pictures(const Json& props) { return {text(props["poster"])}; }

Kind make() {
    Kind k{"video", size, {}, draw, detail, pictures};
    k.radius = 4;
    k.chipInset = 12;
    k.chipBottom = 10;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
