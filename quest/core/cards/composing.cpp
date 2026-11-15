// A card whose look the service is still choosing (`view.composing`): what kind of thing it is and where it
// came from, over three soft bars, and none of its title or its words, since the card it becomes may set them
// otherwise. The scene runs a soft shimmer across it (`cards::ocean::composing`) until the finished card comes.
#include "face.h"
#include "kind.h"

namespace cards {

namespace {

/// The bars stand for lines still to come: as tall as a line of body text is set, at the widths a paragraph's lines end.
constexpr int BAR = 10, BAR_GAP = 10;
constexpr float BARS[] = {1.f, 0.86f, 0.54f};
constexpr int HEIGHT = face::TOP + face::META + 12 + 3 * BAR + 2 * BAR_GAP + face::BOTTOM;

std::string kindWord(const Item& item) {
    const bool zh = item.words.chinese;
    if (item.kind == "file") return zh ? "文件" : "File";
    if (item.kind == "link") return zh ? "链接" : "Link";
    if (item.kind == "image") return zh ? "图片" : "Picture";
    if (item.kind == "video") return zh ? "影片" : "Film";
    if (item.kind == "audio") return zh ? "录音" : "Recording";
    if (item.kind == "chat") return zh ? "对话" : "Conversation";
    if (item.kind == "code") return zh ? "代码" : "Code";
    return zh ? "笔记" : "Note";
}

/// The site an item came from, as its address names it, or where the user put it in from.
std::string fromWord(const Item& item) {
    std::string url = item.url;
    for (const char* scheme : {"https://", "http://"}) {
        if (url.rfind(scheme, 0) == 0) url = url.substr(std::char_traits<char>::length(scheme));
    }
    url = url.substr(0, url.find_first_of("/?#"));
    if (url.rfind("www.", 0) == 0) url = url.substr(4);
    if (!url.empty()) return url;
    if (item.agent) return item.words.chinese ? "为你找到" : "Found for you";
    return item.words.chinese ? "刚放入" : "Dropped in";
}

/// What the in-progress card says of its item: its kind and where it came from, "Link · nytimes.com".
std::string composingLine(const Item& item) { return kindWord(item) + " \xC2\xB7 " + fromWord(item); }

Footprint size(const Item&, const Json&) { return {face::W, HEIGHT}; }

void draw(const Pen& pen, const Look& look, const Item& item, const Json&, float, float) {
    pen.words(composingLine(item), face::LEFT, face::TOP, face::COL, 1, setting::faceMeta, look.ink3);
    float y = face::TOP + face::META + 12;
    pen.ctx.setFillColor(Color::white(1, 0.08f));
    for (float share : BARS) {
        pen.rounded(pen.px(face::LEFT, y, face::COL * share, BAR), BAR / 2.f * pen.k);
        pen.ctx.fillPath();
        y += BAR + BAR_GAP;
    }
}

void detail(Sheet& sheet, const Item& item, const Json&) {
    sheet.paragraph(composingLine(item), setting::body, palette::ink2);
    sheet.paragraph(item.words.chinese ? "正在排版这张卡片。" : "This card is being laid out.", setting::body, palette::ink3);
}

const Kind kind{"composing", size, {}, draw, detail};
const Registered registered{kind};

}  // namespace

}  // namespace cards
