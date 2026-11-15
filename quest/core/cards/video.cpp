// components/video.js: a print of a clip. Tight corners, the poster to the edge under a round play mark,
// the caption on a plate below.
#include <algorithm>
#include <regex>

#include "face.h"
#include "kind.h"
#include "media.h"

namespace cards {

namespace {

constexpr int WIDTH = 272;
constexpr int POSTER = 153;
constexpr Setting NOTE{15, 21, Font::Weight::medium};

std::string caption(const Item& item, const Json& props) {
    std::string given = text(props["caption"]);
    return !given.empty() ? given : item.title;
}

int captionLines(const Item& item, const Json& props) {
    std::string c = caption(item, props);
    return c.empty() ? 0 : fold(points(c), WIDTH - SIDES, TEXT_LETTER, 2);
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


/// The poster at 16:9 to the edges with its play mark, then the caption on a plate.
void lay(Col& c, const Item& item, const Json& props) {
    // The caption is the title: on the plate in up to two lines, and the poster gives way to it.
    std::string said = caption(item, props), poster = text(props["poster"]);
    Titled plate = titled(said, face::COL, Measure::body);
    float tall = said.empty() ? std::round(float(face::W - 2) * 9 / 16) : std::min(103.f, float(face::H) - 2 - 19 - float(plate.lines * face::BODY));
    if (c.pen) {
        CGRect frame = c.pen->px(1, 1, face::W - 2, tall);
        c.pen->ctx.setFillColor(palette::media);
        c.pen->ctx.fill(frame);
        c.pen->picture(poster, frame, true, item.words);
        playMark(*c.pen, face::W / 2.f, 1 + tall / 2);
    }
    c.y = 1 + tall + 1;
    if (!said.empty()) {
        c.y += 9;
        c.say(plate.said, setting::faceBody, plate.lines, c.x, c.y, c.width, palette::ink);
        c.y += float(plate.lines * face::BODY);
        c.y += 10;
    }
    c.y -= face::BOTTOM;
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
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
    float tall = !plays && poster.empty() ? 0 : !plays && missing ? 120 : std::min(Sheet::width / aspect.value_or(16.f / 9), std::min(420.f, sheet.most));
    std::string note = plays ? "" : item.words.chinese ? "这段视频没有可播放的文件。" : "This clip has no file to play.";
    float noteTall = note.empty() ? 0 : 12 + heightOf(note, Sheet::width - 28, 0, NOTE, sheet.k) + 12;
    if (tall > 0) sheet.picture = CGRect{Sheet::left * sheet.k, (sheet.y + Sheet::gap) * sheet.k, Sheet::width * sheet.k, tall * sheet.k};
    Words words = item.words;
    sheet.part(tall + noteTall, [=](const Pen& pen, float y) {
        CGRect box = pen.px(Sheet::left, y, Sheet::width, tall + noteTall);
        pen.ctx.setFillColor(palette::media);
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
    k.opens = Kind::Opens::picture;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
