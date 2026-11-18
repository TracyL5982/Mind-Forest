// AGENT (WS89): what the user marks on a picture is shown to Momo, so what she says of it is about what is inside the line.
//
// On a card of the service's the pen's lines are kept as points 0…1 of the card's whole content (oceanmodel_edits.cpp). A
// moment after a line is drawn, the marks are taken off, or a card with lines opens, they are put on the box the card shows
// its picture in (the picture is shown whole in it, so a narrow one leaves the box's sides empty) and handed to the bridge,
// which cuts out the part, makes the two JPEGs off the frame thread and sends them (`look`): the service shows them to her
// with the user's next words about the card (agents/src/node/live.ts).
// On the welcome walk the sketch lesson's strokes go the same way as the sketch is sent, with the picture the card shows.
#include "oceanmodel.h"

#include "../agent/bridge.h"
#include "../cards/cards.h"
#include "../cards/ocean.h"
#include "../cards/paint.h"

void OceanModel::lookFrame() {
    if (!(lookDue && time >= lookDue->second)) return;
    int id = lookDue->first;
    lookDue.reset();
    if (CardRef c = card(id)) seeMarks(*c);
}

void OceanModel::seeMarks(CardView& c) {
    if (!agentBridge) return;
    // The lines are on the content; the box the picture is shown in is where the card's layout puts it, in the same pixels,
    // while all of it is in view at the top, as it is while it can be drawn on.
    bool anyLine = std::any_of(c.edits.begin(), c.edits.end(), [](const CardEdit& e) { return e.kind == CardEdit::Kind::stroke; });
    if (!anyLine) {
        agentBridge->look(c.id, {}, 0);
        return;
    }
    if (!(c.layout && c.layout->picture) || c.content.frame.width <= 0 || c.content.tall <= 0) {
        logLine("[cards] the lines on " + (catalog ? catalog->title(c.ref) : std::string("a card")) + " are not on its picture as it shows now, so Momo is not shown them");
        return;
    }
    CGRect picture = *c.layout->picture;
    std::vector<std::vector<Vec2>> lines;
    for (const CardEdit& e : c.edits) {
        if (e.kind != CardEdit::Kind::stroke || e.points.size() < 2) continue;
        std::vector<Vec2> line;
        for (Vec2 p : e.points) {
            float x = p.x * c.content.frame.width, y = p.y * c.content.tall;
            line.push_back({(x - picture.minX()) / picture.width(), (y - picture.minY()) / picture.height()});
        }
        lines.push_back(std::move(line));
    }
    agentBridge->look(c.id, lines, picture.width() / std::max(1.f, picture.height()));
}

void OceanModel::seeSketch(const CardView& c, int work) {
    auto ink = inks.find(c.id);
    if (!agentBridge || ink == inks.end() || ink->second.strokes.empty()) return;
    std::optional<cards::Picture> shown = cards::pictureAt(fmt("work:%d", work));
    if (!(shown && shown->image && !shown->missing)) {
        logLine("[guide] the sketch's picture is not drawn yet, so Momo is not shown the sketch");
        return;
    }
    // The strokes are on the card's open face, m from its middle, y up; the picture is where the face shows it.
    PictureFrame picture = pictureFrame(c);
    Vec2 lo = picture.center - picture.size / 2;
    std::vector<std::vector<Vec2>> lines;
    for (const std::vector<Vec2>& stroke : ink->second.strokes) {
        std::vector<Vec2> line;
        for (Vec2 p : stroke) line.push_back({(p.x - lo.x) / picture.size.x, 1 - (p.y - lo.y) / picture.size.y});
        if (line.size() >= 2) lines.push_back(std::move(line));
    }
    std::string title = catalog && work >= 0 && work < int(catalog->works.size()) ? catalog->works[size_t(work)].title : "the picture";
    agentBridge->look(shown->image, lines, picture.size.x / std::max(1e-4f, picture.size.y), title);
}
