// components/audio.js: a recording. A round play mark beside its waveform and its length, over the first
// words of its transcript.
#include <algorithm>
#include <cmath>

#include "face.h"
#include "kind.h"
#include "media.h"

namespace cards {

namespace {

constexpr int WIDTH = 272;
constexpr int COLUMN = WIDTH - SIDES;
/// The strip that holds the play mark, the waveform and the length.
constexpr int STRIP = 40;
/// The gap `.card-body` leaves between its parts.
constexpr int GAP = 6;
/// One bar of the waveform and the space after it, in the units of its view box, which is stretched to the room it has.
constexpr float BAR = 2, STEP = 3, WAVE = 24;
constexpr Setting NOTE{15, 21, Font::Weight::medium};

/// A length in seconds as a clock writes it: 0:20, 12:05, 1:02:03.
std::string clock(double seconds) {
    long whole = long(std::floor(seconds + 0.5));
    long hours = whole / 3600, minutes = whole / 60 % 60, rest = whole % 60;
    char out[32];
    if (hours > 0) snprintf(out, sizeof out, "%ld:%02ld:%02ld", hours, minutes, rest);
    else snprintf(out, sizeof out, "%ld:%02ld", minutes, rest);
    return out;
}

std::string lengthOf(const Json& props) {
    double seconds = number(props["seconds"]);
    return std::isfinite(seconds) && seconds > 0 ? clock(seconds) : "";
}

std::vector<float> peaksOf(const Json& props) {
    std::vector<float> peaks;
    for (const Json& peak : props["peaks"].array()) {
        double v = number(peak);
        if (std::isfinite(v)) peaks.push_back(float(std::clamp(v, 0.0, 1.0)));
    }
    return peaks;
}

/// The transcript as the card writes it: on one run, without the title when it opens with the title's words.
std::string heard(const Item& item) {
    Text words = squash(points(item.text)), heading = squash(points(item.title));
    if (heading.empty()) return utf8(words);
    if (words == heading) return "";
    bool opens = words.size() > heading.size() && words.compare(0, heading.size(), heading) == 0 && words[heading.size()] == U' ';
    return utf8(opens ? words.substr(heading.size() + 1) : words);
}

struct Plan {
    std::string body, length;
    int titleLines = 1, bodyLines = 0;
};

Plan plan(const Item& item, const Json& props) {
    Plan p;
    p.body = heard(item);
    p.length = lengthOf(props);
    p.titleLines = wrap(points(item.titleOrUntitled()), COLUMN, TITLE_LETTER, 2);
    p.bodyLines = p.body.empty() ? 0 : wrap(points(p.body), COLUMN, TEXT_LETTER, 3);
    return p;
}

/// The loudness of each slice as a bar about the middle line, stretched across `box` (pixels), or a flat
/// line when nobody measured it.
void wave(const Pen& pen, const std::vector<float>& peaks, CGRect box, Color color) {
    pen.ctx.setFillColor(color);
    float rise = box.height() / WAVE;
    if (peaks.empty()) {
        pen.ctx.fill(CGRect{box.minX(), box.midY() - 0.75f * rise, box.width(), 1.5f * rise});
        return;
    }
    float across = box.width() / std::max(float(peaks.size()) * STEP - (STEP - BAR), 1.f);
    for (size_t i = 0; i < peaks.size(); i++) {
        float tall = std::max(1.5f, peaks[i] * WAVE) * rise;
        pen.ctx.fill(CGRect{box.minX() + float(i) * STEP * across, box.midY() - tall / 2, BAR * across, tall});
    }
}

/// `.audio-strip` with its top at y px, from x to `right`.
void strip(const Pen& pen, const Look& look, const std::vector<float>& peaks, const std::string& length, float x, float y, float right,
           const Setting& said = setting::body) {
    disc(pen, look, pen.px(x, y + 4, 32, 32));
    play(pen, x + 12, y + 4 + 9, 11, 14, look.accent);
    float end = right;
    if (!length.empty()) {
        float w = pen.width(length, said);
        pen.words(length, right - w, y + (STRIP - said.lead) / 2.f, w + 1, 1, said, look.ink2);
        end -= w + 10;
    }
    wave(pen, peaks, pen.px(x + 32 + 10, y + (STRIP - WAVE) / 2, end - (x + 32 + 10), WAVE), mix(look.accent, 0.58f, look.fill));
}

/// The browser's own player (`<audio controls>`) as a drawing, `w` px wide with its top-left at (x, y): a
/// pill with a play mark, the time and the track. The headset plays nothing.
void player(const Pen& pen, const std::string& length, float x, float y, float w) {
    constexpr Setting TIME{13, 18};
    pen.ctx.setFillColor(Color::white(1, 0.13f));
    pen.rounded(pen.px(x, y, w, STRIP), STRIP / 2.f * pen.k);
    pen.ctx.fillPath();
    play(pen, x + 21, y + 13, 11, 14, palette::ink);
    std::string time = length.empty() ? "0:00" : "0:00 / " + length;
    float timeWidth = pen.width(time, TIME), from = x + 47 + timeWidth + 16, to = x + w - 24;
    pen.words(time, x + 47, y + (STRIP - TIME.lead) / 2, timeWidth + 1, 1, TIME, palette::ink);
    if (to <= from) return;
    pen.ctx.setFillColor(Color::white(1, 0.55f));
    pen.rounded(pen.px(from, y + STRIP / 2.f - 2, to - from, 4), 2 * pen.k);
    pen.ctx.fillPath();
}


/// The title, the strip of play mark, waveform and length, the first words of the transcript, and the cue.
void lay(Col& c, const Item& item, const Json& props) {
    std::string words = heard(item);
    c.lines(item.titleOrUntitled(), Measure::title, 2, palette::ink, face::GAP + STRIP);
    c.gap(face::GAP);
    if (c.pen) strip(*c.pen, c.look, peaksOf(props), lengthOf(props), c.x, c.y, c.x + c.width, setting::faceMeta);
    c.gap(STRIP);
    if (!words.empty() && c.room() >= face::GAP + face::BODY) {
        c.gap(face::GAP);
        c.lines(words, Measure::body, 99, c.look.ink2);
    } else if (!words.empty()) {
        c.more = true;
    }
    if (c.more) c.cue(cueMore(c.words));
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}



/// `.detail-audio`, and every word of the transcript as it was heard.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    std::string src = trimmed(props["src"]), length = lengthOf(props);
    std::vector<float> peaks = peaksOf(props);
    std::string note = !src.empty() ? "" : item.words.chinese ? "这段录音没有可播放的文件。" : "This recording has no file to play.";
    float inner = Sheet::width - 26;
    float content = !note.empty() ? heightOf(note, inner, 0, NOTE, sheet.k) : peaks.empty() ? STRIP : 56 + 10 + STRIP;
    float tall = 1 + 12 + content + 12 + 1;
    Look look = sheet.look;
    look.fill = palette::face;
    sheet.part(tall, [=](const Pen& pen, float y) {
        CGRect box = pen.px(Sheet::left, y, Sheet::width, tall);
        pen.ctx.setFillColor(palette::sunk);
        pen.rounded(box, 12 * pen.k);
        pen.ctx.fillPath();
        float line = pen.k;
        pen.ctx.setStrokeColor(look.accent.withAlphaComponent(0.3f));
        pen.ctx.setLineWidth(line);
        pen.rounded(box.insetBy(line / 2, line / 2), 12 * pen.k - line / 2);
        pen.ctx.strokePath();
        float x = Sheet::left + 13, top = y + 13;
        if (!note.empty()) {
            pen.words(note, x, top, inner, 0, NOTE, palette::ink2);
            return;
        }
        if (!peaks.empty()) {
            wave(pen, peaks, pen.px(x, top, inner, 56), mix(look.accent, 0.58f, look.fill));
            top += 56 + 10;
        }
        player(pen, length, x, top, inner);
    });
    if (!note.empty()) sheet.said.push_back(note);
    sheet.paragraph(utf8(trim(points(item.text))), setting::body, palette::ink2);
}

const Kind kind{"audio", size, {}, draw, detail};
const Registered registered{kind};

}  // namespace

}  // namespace cards
