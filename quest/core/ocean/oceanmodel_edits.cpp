// What the pen (`layTools`) marks on an open card of the agent service's: highlights
// behind words and lines over the rest, kept with the card by the service (agents/docs/protocol.md, Edits).
//
// A highlight is words of one run of the content's text, found again by its words and which of their appearances it is.
// A line is points 0 to 1 across and down the whole content, however far it is scrolled. Both are drawn where the
// content now stands in its window, as two meshes: see-through amber behind the words, red lines over them.
#include "oceanmodel.h"

#include <cmath>
#include <random>

#include "../agent/bridge.h"
#include "../cards/cards.h"
#include "../cards/ocean.h"

namespace {

/// Momo's amber, see-through behind the words.
constexpr Color amber = Color::hex(0xF2C27A);
constexpr float highlightOpacity = 0.4f;
/// A line is 2 of the web's px wide, px on the content.
constexpr float lineWide = 2 * cards::ocean::openScale;
/// The least move that adds a point to a line, px on the content.
constexpr float pointStep = 4;
/// Most points in a line, as the service keeps them (agents/src/core/domain.ts, STROKE_POINTS).
constexpr size_t mostPoints = 512;
/// Most edits on one card (MAX_EDITS).
constexpr size_t mostEdits = 100;

/// How many times `q` stands in `in`, not overlapping, starting before `before`.
int appearances(const std::u16string& in, const std::u16string& q, size_t before = std::u16string::npos) {
    int n = 0;
    for (size_t at = in.find(q); !q.empty() && at != std::u16string::npos && at < before; at = in.find(q, at + q.size())) n++;
    return n;
}

/// The part of a segment between two heights, if any.
std::optional<std::pair<CGPoint, CGPoint>> within(CGPoint a, CGPoint b, float lo, float hi) {
    if (a.y > b.y) std::swap(a, b);
    if (b.y < lo || a.y > hi) return std::nullopt;
    auto at = [&](float y) {
        float t = b.y - a.y > 1e-4f ? (y - a.y) / (b.y - a.y) : 0;
        return CGPoint{a.x + (b.x - a.x) * t, y};
    };
    return std::make_pair(a.y < lo ? at(lo) : a, b.y > hi ? at(hi) : b);
}

std::string newEditId() {
    static std::mt19937 random{std::random_device{}()};
    static unsigned made = 0;
    return fmt("e%08x%04x", unsigned(random()), ++made & 0xffff);
}

const char* noun(const CardEdit& e) { return e.kind == CardEdit::Kind::highlight ? "a highlight" : e.kind == CardEdit::Kind::stretch ? "a stretch" : "a line"; }

}  // namespace

void OceanModel::buildEdits(CardView& c) {
    if (!(art && c.openPanel && agentBridge && agentBridge->editable(c.id))) return;
    // Their pictures are drawn in the background: each is asked for now, so it is there the moment it shows.
    for (int step = 0; step <= Art::holdSteps; step++) art->holdRing(step);
    if (std::optional<Piece> piece = art->holdRing(0)) {
        c.holdRing = art->quad(*piece);
        c.holdRing->isEnabled = false;
        c.openHolder->addChild(c.holdRing);
        c.holdShown = 0;
    }
    c.highlights = art->swatch(amber, {0.001f, 0.001f}, highlightOpacity);
    c.highlights->position.z = 0.0042f;
    // The user's own lines are in the accent, as Kai's marker draws on a picture (`drawInk`): what you marked.
    c.lines = art->swatch(Art::hot, {0.001f, 0.001f});
    c.lines->position.z = 0.0046f;
    for (const EntityRef& e : {c.highlights, c.lines}) {
        e->isEnabled = false;
        c.openHolder->addChild(e);
    }
    c.edits = agentBridge->edits(c.id);
    drawEdits(c);
    syncStretch(c);
}

void OceanModel::editFrame() {
    std::optional<int> focus = tree ? tree->focus() : std::nullopt;
    if (drawing && focus != drawing->card) drawing.reset();
    CardRef c = focus ? card(*focus) : nullptr;
    if (!(c && c->highlights) || editsOpen == focus) return;
    editsOpen = focus;
    if (!c->edits.empty()) logLine(fmt("[cards] opened with %d edits: %s", int(c->edits.size()), catalog ? catalog->title(c->ref).c_str() : "a card"));
}

OceanModel::Press::Claim OceanModel::beginMark(CardView& c, Vec2 at) {
    std::vector<Mark::Kind> kinds = markKinds(c);
    PictureFrame picture = pictureFrame(c);
    bool onFilm = std::find(kinds.begin(), kinds.end(), Mark::Kind::time) != kinds.end() &&
                  std::fabs(at.x - picture.center.x) <= picture.size.x / 2 && std::fabs(at.y - picture.center.y) <= picture.size.y / 2;
    if (c.highlights && !onFilm) {
        beginEdit(c, at);
        if (!drawing) return Press::Claim::spent;
        sound("mark_begin");
        return Press::Claim::edit;
    }
    // A video's stretch on a service card, and every mark on a card of the headset's own, is Kai's mark (`markBegin`).
    // A new stretch takes the old one's place, so only a card without one can be full.
    bool full = c.highlights && c.edits.size() >= mostEdits &&
                std::none_of(c.edits.begin(), c.edits.end(), [](const CardEdit& e) { return e.kind == CardEdit::Kind::stretch; });
    if (full) return Press::Claim::spent;
    markBegin(c.id, at, c.highlights ? std::optional<Mark::Kind>(Mark::Kind::time) : std::nullopt);
    if (!marking) return Press::Claim::spent;
    sound("mark_begin");
    return Press::Claim::mark;
}

bool OceanModel::marked(int id) const {
    if (marks.count(id)) return true;
    auto c = cards.find(id);
    return c != cards.end() && c->second && !c->second->edits.empty();
}

std::string OceanModel::tellMoreAbout(const CardView& c) const {
    std::string quotes;
    int marked = 0, lines = 0;
    std::optional<CardEdit> stretch;
    for (const CardEdit& e : c.edits) {
        marked++;
        if (e.kind == CardEdit::Kind::stroke) lines++;
        else if (e.kind == CardEdit::Kind::stretch) stretch = e;
        else if (quotes.size() < 600) quotes += (quotes.empty() ? "\"" : "; \"") + e.quote + "\"";
    }
    std::vector<std::string> parts;
    if (!quotes.empty()) parts.push_back(quotes);
    if (lines > 0) parts.push_back(lines == 1 ? "the part I drew on" : "the parts I drew on");
    if (stretch) parts.push_back("the stretch from " + Catalog::clock(stretch->from) + " to " + Catalog::clock(stretch->to));
    if (parts.empty()) return "";
    std::string out = marked == 1 ? "Tell me more about this part: " : "Tell me more about these parts: ";
    for (size_t i = 0; i < parts.size(); i++) out += (i ? "; " : "") + parts[i];
    return out;
}

void OceanModel::keepStretch(CardView& c, const Mark& made) {
    // A card keeps one stretch: the service puts the new one in the old one's place, in one change.
    c.edits.erase(std::remove_if(c.edits.begin(), c.edits.end(), [](const CardEdit& e) { return e.kind == CardEdit::Kind::stretch; }), c.edits.end());
    // To hundredths of a second, as the service keeps it, so what it sends back changes nothing here.
    auto hundredths = [](double v) { return std::round(v * 100) / 100; };
    CardEdit kept{.id = newEditId(), .kind = CardEdit::Kind::stretch, .from = hundredths(made.from), .to = hundredths(made.to)};
    marks[c.id] = Mark::time(kept.from, kept.to);
    c.edits.push_back(kept);
    if (agentBridge) agentBridge->edited(c.id, kept);
    logLine("[cards] marked the stretch from " + Catalog::clock(kept.from) + " to " + Catalog::clock(kept.to));
}

void OceanModel::syncStretch(CardView& c) {
    auto s = std::find_if(c.edits.begin(), c.edits.end(), [](const CardEdit& e) { return e.kind == CardEdit::Kind::stretch; });
    auto had = marks.find(c.id);
    if (s == c.edits.end()) {
        if (had == marks.end()) return;
        marks.erase(had);
        if (c.markHolder) c.markHolder->removeFromParent();
        c.markHolder = nullptr;
        if (screenNode == c.id) screen->loop(std::nullopt);
        c.changed();
        logLine("[cards] the card's stretch is gone");
        return;
    }
    bool moved = had == marks.end() || had->second.from != s->from || had->second.to != s->to;
    marks[c.id] = Mark::time(s->from, s->to);
    if (moved) {
        if (screenNode == c.id) screen->loop(Screen::Span{s->from, s->to});
        logLine("[cards] the card shows the stretch from " + Catalog::clock(s->from) + " to " + Catalog::clock(s->to));
    }
    PictureFrame picture = pictureFrame(c);
    double duration = markDuration(c);
    float left = picture.center.x - picture.size.x / 2;
    auto x = [&](double t) { return left + float(std::clamp(t / duration, 0.0, 1.0)) * picture.size.x; };
    drawStretch(c, x(s->from), x(s->to), true, s->from, s->to);
}

void OceanModel::eraseAll(CardView& c) {
    std::vector<std::string> ids;
    for (const CardEdit& e : c.edits) ids.push_back(e.id);
    if (ids.empty()) return;
    c.edits.clear();
    if (agentBridge) agentBridge->erasedAll(c.id, ids);
    drawEdits(c);
    syncStretch(c);
    sound("step_out", 0.6f);
    touch(time + 0.4);
    logLine(fmt("[cards] erased %d marks", int(ids.size())));
}

const std::vector<std::shared_ptr<TextBlock>>& OceanModel::contentRuns(CardView& c) {
    std::optional<std::string> id = cards::ocean::cardOf(c.ref);
    int drawn = id ? cards::generation(*id) : -1;
    if (drawn == c.runsDrawn) return c.runs;
    c.runsDrawn = drawn;
    c.runs.clear();
    if (std::optional<cards::Opened> o = id ? cards::ocean::opened(*id) : std::nullopt) {
        for (const cards::Run& run : o->runs) c.runs.push_back(std::make_shared<TextBlock>(run.text, run.at, run.width, run.lines, run.attributes));
        c.content = CardView::Content{o->size, o->window, std::max(1.f, o->contentTall)};
    }
    return c.runs;
}

std::optional<CGPoint> OceanModel::onContent(const CardView& c, Vec2 at, bool inWindowOnly) const {
    std::optional<std::string> id = cards::ocean::cardOf(c.ref);
    if (!id || c.runsDrawn < 0) return std::nullopt;
    const CardView::Content& o = c.content;
    CGPoint p{at.x * Art::ppm + o.frame.width / 2, o.frame.height / 2 - at.y * Art::ppm};
    if (inWindowOnly && !o.window.contains(p)) return std::nullopt;
    p.x = std::clamp(p.x, o.window.minX(), o.window.maxX());
    p.y = std::clamp(p.y, o.window.minY(), o.window.maxY());
    return CGPoint{p.x, p.y + cards::ocean::scroll(*id) * cards::ocean::openScale};
}

int OceanModel::runAt(CardView& c, CGPoint p) {
    const std::vector<std::shared_ptr<TextBlock>>& runs = contentRuns(c);
    for (size_t i = 0; i < runs.size(); i++) {
        if (runs[i]->frame().insetBy(-10, -10).contains(p)) return int(i);
    }
    return -1;
}

namespace {

/// Where a highlight's words are on the content: their run and where they start in it (UTF-16), the appearance it names
/// or, failing that, the first.
std::optional<std::pair<size_t, int>> locate(const std::vector<std::shared_ptr<TextBlock>>& runs, const CardEdit& e) {
    std::u16string q = utf16(e.quote);
    std::optional<std::pair<size_t, int>> first;
    int seen = 0;
    for (size_t r = 0; r < runs.size(); r++) {
        std::u16string in = utf16(runs[r]->string);
        for (size_t at = in.find(q); !q.empty() && at != std::u16string::npos; at = in.find(q, at + q.size())) {
            if (!first) first = std::make_pair(r, int(at));
            if (seen++ == e.occurrence) return std::make_pair(r, int(at));
        }
    }
    return first;
}

}  // namespace

void OceanModel::drawEdits(CardView& c) {
    std::optional<std::string> id = cards::ocean::cardOf(c.ref);
    if (!(id && c.highlights && c.lines)) return;
    const std::vector<std::shared_ptr<TextBlock>>& runs = contentRuns(c);
    const CardView::Content& o = c.content;
    float off = cards::ocean::scroll(*id) * cards::ocean::openScale;
    float lo = o.window.minY() + off, hi = o.window.maxY() + off;
    auto meters = [&](CGPoint p) { return Vec3{(p.x - o.frame.width / 2) / Art::ppm, (o.frame.height / 2 - (p.y - off)) / Art::ppm, 0}; };
    std::vector<CardEdit> shown = c.edits;
    if (drawing && drawing->card == c.id) shown.push_back(drawing->edit);
    struct Mesh_ {
        std::vector<Vec3> positions;
        std::vector<uint32_t> indices;
        void quad(Vec3 a, Vec3 b, Vec3 cc, Vec3 d) {
            uint32_t n = uint32_t(positions.size());
            positions.insert(positions.end(), {a, b, cc, d});
            indices.insert(indices.end(), {n, n + 1, n + 2, n, n + 2, n + 3});
        }
    } amberMesh, redMesh;
    for (const CardEdit& e : shown) {
        if (e.kind == CardEdit::Kind::stretch) continue;
        if (e.kind == CardEdit::Kind::highlight) {
            std::optional<std::pair<size_t, int>> where = locate(runs, e);
            if (!where) continue;
            for (const CGRect& r : runs[where->first]->rects(where->second, int(utf16(e.quote).size()))) {
                float top = std::max(r.minY(), lo), bottom = std::min(r.maxY(), hi);
                if (bottom <= top) continue;
                float x0 = r.minX() - 2, x1 = r.maxX() + 2;
                amberMesh.quad(meters({x0, bottom}), meters({x1, bottom}), meters({x1, top}), meters({x0, top}));
            }
            continue;
        }
        for (size_t i = 0; i + 1 < e.points.size(); i++) {
            CGPoint a{e.points[i].x * o.frame.width, e.points[i].y * o.tall}, b{e.points[i + 1].x * o.frame.width, e.points[i + 1].y * o.tall};
            std::optional<std::pair<CGPoint, CGPoint>> part = within(a, b, lo, hi);
            if (!part) continue;
            Vec3 p = meters(part->first), q = meters(part->second);
            Vec3 along = q - p;
            float n = length(along);
            // Each piece runs half a width past its ends, so the bends between pieces are closed.
            Vec3 dir = n > 1e-6f ? along / n : Vec3{1, 0, 0};
            Vec3 side = Vec3{-dir.y, dir.x, 0} * (lineWide / Art::ppm / 2);
            Vec3 ext = dir * (lineWide / Art::ppm / 2);
            redMesh.quad(p - ext - side, q + ext - side, q + ext + side, p - ext + side);
        }
    }
    for (auto [entity, mesh] : {std::pair{c.highlights, &amberMesh}, std::pair{c.lines, &redMesh}}) {
        entity->isEnabled = !mesh->indices.empty();
        if (mesh->indices.empty()) continue;
        std::vector<Vec2> uvs(mesh->positions.size(), Vec2::zero());
        entity->model->mesh = Mesh::generate(std::move(mesh->positions), std::move(uvs), std::move(mesh->indices));
        c.remade(entity);
    }
    c.changed();
    touch(time + 0.1);
}

void OceanModel::setEdits(int id, const std::vector<CardEdit>& edits) {
    CardRef c = card(id);
    if (!(c && c->highlights) || c->edits == edits) return;
    c->edits = edits;
    drawEdits(*c);
    syncStretch(*c);
    logLine(fmt("[cards] %d edits on %s", int(edits.size()), catalog ? catalog->title(c->ref).c_str() : "a card"));
}

void OceanModel::beginEdit(CardView& c, Vec2 at) {
    contentRuns(c);
    std::optional<CGPoint> p = onContent(c, at, false);
    if (!p || c.edits.size() >= mostEdits) return;
    int r = runAt(c, *p);
    std::optional<TextBlock::Words> found = r >= 0 ? c.runs[size_t(r)]->words(*p, *p) : std::nullopt;
    if (found) {
        drawing = Drawing{c.id, CardEdit{.id = newEditId(), .kind = CardEdit::Kind::highlight}, r, *p};
        moveEdit(c, at);
    } else {
        Vec2 point{p->x / c.content.frame.width, p->y / c.content.tall};
        drawing = Drawing{c.id, CardEdit{.id = newEditId(), .kind = CardEdit::Kind::stroke, .points = {point}}};
        drawEdits(c);
    }
    logLine(std::string("[cards] the pen begins ") + noun(drawing->edit));
}

void OceanModel::moveEdit(CardView& c, Vec2 at) {
    std::optional<CGPoint> p = onContent(c, at, false);
    if (!(p && drawing && drawing->card == c.id)) return;
    CardEdit& e = drawing->edit;
    if (e.kind == CardEdit::Kind::highlight) {
        const std::vector<std::shared_ptr<TextBlock>>& runs = contentRuns(c);
        if (drawing->run < 0 || drawing->run >= int(runs.size())) return;
        std::optional<TextBlock::Words> found = runs[size_t(drawing->run)]->words(drawing->from, *p);
        if (!found || found->text == e.quote) return;
        e.quote = found->text;
        std::u16string q = utf16(found->text);
        int before = 0;
        for (int r = 0; r < drawing->run; r++) before += appearances(utf16(runs[size_t(r)]->string), q);
        e.occurrence = before + appearances(utf16(runs[size_t(drawing->run)]->string), q, size_t(found->at));
    } else {
        Vec2 next{p->x / c.content.frame.width, p->y / c.content.tall};
        Vec2 last = e.points.back();
        float moved = std::hypot((next.x - last.x) * c.content.frame.width, (next.y - last.y) * c.content.tall);
        if (moved < pointStep || e.points.size() >= mostPoints) return;
        e.points.push_back(next);
    }
    drawEdits(c);
}

void OceanModel::endEdit(CardView& c) {
    if (!(drawing && drawing->card == c.id)) return;
    CardEdit made = drawing->edit;
    drawing.reset();
    bool kept = made.kind == CardEdit::Kind::highlight ? !made.quote.empty() : made.points.size() >= 2;
    if (kept) {
        c.edits.push_back(made);
        if (agentBridge) agentBridge->edited(c.id, made);
        if (made.kind == CardEdit::Kind::highlight) logLine("[cards] highlighted \"" + made.quote + "\"");
        else logLine(fmt("[cards] drew a line of %d points", int(made.points.size())));
        sound("mark_made");
    }
    drawEdits(c);
}
