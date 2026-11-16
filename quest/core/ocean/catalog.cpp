// Port of visionos/MindPalace/Ocean/Catalog.swift.
#include "catalog.h"

#include <algorithm>
#include <cstdlib>

#include "../platform.h"
#include "tree.h"

namespace {

// MARK: Strings, as Swift has them

/// `s.unicodeScalars`: the Unicode scalars of a UTF-8 string.
std::vector<uint32_t> unicodeScalars(const std::string& s) {
    std::vector<uint32_t> out;
    size_t i = 0;
    while (i < s.size()) {
        unsigned char c = (unsigned char)s[i];
        int more = c >= 0xF0 ? 3 : c >= 0xE0 ? 2 : c >= 0xC0 ? 1 : 0;
        uint32_t v = more == 3 ? c & 0x07 : more == 2 ? c & 0x0F : more == 1 ? c & 0x1F : c;
        i += 1;
        for (int k = 0; k < more && i < s.size(); k++, i++) v = (v << 6) | ((unsigned char)s[i] & 0x3F);
        out.push_back(v);
    }
    return out;
}

void append(std::string& out, uint32_t v) {
    if (v < 0x80) {
        out += char(v);
    } else if (v < 0x800) {
        out += char(0xC0 | (v >> 6));
        out += char(0x80 | (v & 0x3F));
    } else if (v < 0x10000) {
        out += char(0xE0 | (v >> 12));
        out += char(0x80 | ((v >> 6) & 0x3F));
        out += char(0x80 | (v & 0x3F));
    } else {
        out += char(0xF0 | (v >> 18));
        out += char(0x80 | ((v >> 12) & 0x3F));
        out += char(0x80 | ((v >> 6) & 0x3F));
        out += char(0x80 | (v & 0x3F));
    }
}

/// `s.count` and `s.prefix(n)`.
/// NOTE(port): Swift counts Characters (what a reader sees as one letter); these count Unicode
/// scalars. They are the same unless the text holds combining marks or joined emoji.
int count(const std::string& s) { return int(unicodeScalars(s).size()); }

std::string prefix(const std::string& s, int n) {
    std::string out;
    std::vector<uint32_t> scalars = unicodeScalars(s);
    for (int i = 0; i < n && i < int(scalars.size()); i++) append(out, scalars[size_t(i)]);
    return out;
}

/// `s.lowercased()`.
/// NOTE(port): Swift lowers every letter Unicode knows. This lowers Latin (ASCII, Latin-1,
/// Latin Extended-A), Greek and Cyrillic capitals, which is every capital the library's titles
/// and tag names hold; anything else is left as it is.
std::string lowercased(const std::string& s) {
    std::string out;
    for (uint32_t v : unicodeScalars(s)) {
        if (v >= 'A' && v <= 'Z') v += 32;
        else if (v >= 0xC0 && v <= 0xDE && v != 0xD7) v += 32;
        else if ((v >= 0x100 && v <= 0x12F) || (v >= 0x132 && v <= 0x137) || (v >= 0x14A && v <= 0x177)) v |= 1;
        else if ((v >= 0x139 && v <= 0x148) || (v >= 0x179 && v <= 0x17E)) v += v % 2;
        else if (v == 0x178) v = 0xFF;
        else if (v >= 0x391 && v <= 0x3A9 && v != 0x3A2) v += 32;
        else if (v >= 0x410 && v <= 0x42F) v += 32;
        else if (v >= 0x400 && v <= 0x40F) v += 80;
        append(out, v);
    }
    return out;
}

bool hasPrefix(const std::string& s, const std::string& prefix) { return s.compare(0, prefix.size(), prefix) == 0; }

/// `said.contains(name)`
bool contains(const std::string& s, const std::string& part) { return s.find(part) != std::string::npos; }

template <class T>
bool contains(const std::vector<T>& list, const T& item) { return std::find(list.begin(), list.end(), item) != list.end(); }

/// `Int(s)`: digits, with a sign before them if any, and nothing else.
/// NOTE(port): a Swift Int is 64 bits; a number past an int's range is not read here.
std::optional<int> parseInt(const std::string& s) {
    size_t i = 0;
    bool negative = false;
    if (i < s.size() && (s[i] == '+' || s[i] == '-')) {
        negative = s[i] == '-';
        i += 1;
    }
    if (i >= s.size()) return std::nullopt;
    int64_t v = 0;
    for (; i < s.size(); i++) {
        if (s[i] < '0' || s[i] > '9') return std::nullopt;
        v = v * 10 + (s[i] - '0');
        if (v > 2147483648LL) return std::nullopt;
    }
    if (negative) v = -v;
    if (v > 2147483647LL) return std::nullopt;
    return int(v);
}

/// `String(value, radix: 36)`
std::string radix36(uint64_t value) {
    if (value == 0) return "0";
    std::string out;
    while (value > 0) {
        out.insert(out.begin(), "0123456789abcdefghijklmnopqrstuvwxyz"[value % 36]);
        value /= 36;
    }
    return out;
}

/// `list.joined(separator:)`
std::string joined(const std::vector<std::string>& list, const std::string& separator) {
    std::string out;
    for (size_t i = 0; i < list.size(); i++) {
        if (i > 0) out += separator;
        out += list[i];
    }
    return out;
}

/// `score.sorted { ($0.value, -$0.key) > ($1.value, -$1.key) }.map(\.key)`: the highest first,
/// and of two the same, the earlier piece.
std::vector<int> byScore(const std::map<int, float>& score) {
    std::vector<std::pair<int, float>> all(score.begin(), score.end());
    std::stable_sort(all.begin(), all.end(), [](const std::pair<int, float>& a, const std::pair<int, float>& b) {
        if (a.second != b.second) return a.second > b.second;
        return -a.first > -b.first;
    });
    std::vector<int> out;
    for (const auto& [key, value] : all) out.push_back(key);
    return out;
}

}  // namespace

// MARK: - Ref

std::optional<Ref> Ref::make(const std::string& s) {
    // s.split(separator: ":", maxSplits: 1): empty parts are left out, so colons at the very
    // start are passed over, and a key with nothing after its colon has no second part.
    std::vector<std::string> parts;
    size_t start = 0, end = 0;
    while (end != s.size()) {
        if (s[end] == ':') {
            bool didAppend = start != end;
            if (didAppend) parts.push_back(s.substr(start, end - start));
            end += 1;
            start = end;
            if (didAppend && parts.size() == 1) break;
            continue;
        }
        end += 1;
    }
    if (start != s.size()) parts.push_back(s.substr(start));
    if (parts.size() != 2) return std::nullopt;
    if (parts[0] == "film") {
        std::optional<int> i = parseInt(parts[1]);
        if (!i) return std::nullopt;
        return Ref::film(*i);
    }
    if (parts[0] == "work") {
        std::optional<int> i = parseInt(parts[1]);
        if (!i) return std::nullopt;
        return Ref::work(*i);
    }
    if (parts[0] == "note") return Ref::note(parts[1]);
    if (parts[0] == "tag") return Ref::tag(parts[1]);
    return std::nullopt;
}

std::string Ref::key() const {
    switch (kind) {
    case Kind::film: return fmt("film:%d", index);
    case Kind::work: return fmt("work:%d", index);
    case Kind::note: return "note:" + id;
    case Kind::tag: return "tag:" + id;
    }
    return "";
}

std::optional<Ref> Ref::from(const Json& j) {
    if (!j.isString()) return std::nullopt;
    return Ref::make(j.string());
}

Json Ref::json() const { return Json(key()); }

// MARK: - OceanTag

std::optional<OceanTag> OceanTag::from(const Json& j) {
    OceanTag t;
    if (!decode::string(j["id"], t.id) || !decode::string(j["name"], t.name) || !decode::tone(j["kind"], t.kind)) return std::nullopt;
    // decodeIfPresent(...) ?? []
    if (!j["films"].isNull() && !decode::integers(j["films"], t.films)) return std::nullopt;
    if (!j["works"].isNull() && !decode::integers(j["works"], t.works)) return std::nullopt;
    return t;
}

/// What it gathers, in words: "5 films", "12 works", "5 films and 12 works".
std::string OceanTag::gathers() const { return Catalog::counted(int(films.size()), int(works.size())); }

std::optional<NoteLink> NoteLink::from(const Json& j) {
    NoteLink l;
    if (!decode::string(j["to"], l.to) || !decode::string(j["why"], l.why)) return std::nullopt;
    return l;
}

Json NoteLink::json() const {
    Json j = Json::object();
    j.set("to", to);
    j.set("why", why);
    return j;
}

std::optional<ChartSpec> ChartSpec::from(const Json& j) {
    ChartSpec c;
    if (!decode::strings(j["labels"], c.labels) || !decode::numbers(j["values"], c.values) || !decode::string(j["unit"], c.unit) ||
        !decode::integer(j["mark"], c.mark) || !decode::string(j["source"], c.source)) return std::nullopt;
    return c;
}

Json ChartSpec::json() const {
    Json j = Json::object();
    Json labelList = Json::list();
    for (const std::string& l : labels) labelList.push(l);
    j.set("labels", labelList);
    Json valueList = Json::list();
    for (double v : values) valueList.push(v);
    j.set("values", valueList);
    if (unit) j.set("unit", *unit);
    if (mark) j.set("mark", *mark);
    if (source) j.set("source", *source);
    return j;
}

std::optional<LinkSpec> LinkSpec::from(const Json& j) {
    LinkSpec l;
    if (!decode::string(j["url"], l.url) || !decode::string(j["site"], l.site)) return std::nullopt;
    return l;
}

Json LinkSpec::json() const {
    Json j = Json::object();
    j.set("url", url);
    j.set("site", site);
    return j;
}

// MARK: - OceanNote

/// The film whose still stands for the picture, if it is one of the library's.
std::optional<int> OceanNote::stillFilm() const {
    if (clip) return clip;
    if (!image || !hasPrefix(*image, "still:")) return std::nullopt;
    return parseInt(image->substr(6));
}

std::optional<OceanNote> OceanNote::from(const Json& j) {
    OceanNote n;
    if (!decode::string(j["id"], n.id) || !decode::string(j["kicker"], n.kicker) || !decode::tone(j["tone"], n.tone) ||
        !decode::string(j["headline"], n.headline) || !decode::string(j["highlight"], n.highlight) ||
        !decode::string(j["summary"], n.summary) || !decode::string(j["diagram"], n.diagram) || !decode::strings(j["tags"], n.tags) ||
        !decode::list(j["links"], n.links) || !decode::string(j["image"], n.image) || !decode::real(j["aspect"], n.aspect) ||
        !decode::integer(j["clip"], n.clip) || !decode::value(j["chart"], n.chart) || !decode::value(j["link"], n.link)) return std::nullopt;
    return n;
}

Json OceanNote::json() const {
    Json j = Json::object();
    j.set("id", id);
    j.set("kicker", kicker);
    j.set("tone", rawValue(tone));
    j.set("headline", headline);
    j.set("highlight", highlight);
    j.set("summary", summary);
    if (diagram) j.set("diagram", *diagram);
    Json tagList = Json::list();
    for (const std::string& t : tags) tagList.push(t);
    j.set("tags", tagList);
    Json linkList = Json::list();
    for (const NoteLink& l : links) linkList.push(l.json());
    j.set("links", linkList);
    if (image) j.set("image", *image);
    if (aspect) j.set("aspect", *aspect);
    if (clip) j.set("clip", *clip);
    if (chart) j.set("chart", chart->json());
    if (link) j.set("link", link->json());
    return j;
}

std::optional<Brief> Brief::from(const Json& j) {
    Brief b;
    if (!decode::string(j["id"], b.id) || !decode::string(j["line"], b.line) || !decode::string(j["title"], b.title) ||
        !decode::string(j["root"], b.root)) return std::nullopt;
    return b;
}

std::optional<SavedSpec> SavedSpec::from(const Json& j) {
    SavedSpec s;
    std::string maker;
    if (!decode::string(j["title"], s.title) || !decode::string(j["maker"], maker) || !makerFrom(maker) ||
        !decode::strings(j["steps"], s.steps)) return std::nullopt;
    s.maker = *makerFrom(maker);
    return s;
}

namespace {
struct OceanFile {
    std::vector<OceanTag> tags;
    std::vector<OceanNote> notes;
    std::vector<Brief> briefs;
    std::vector<SavedSpec> saved;
    static std::optional<OceanFile> from(const Json& j) {
        OceanFile f;
        if (!decode::list(j["tags"], f.tags) || !decode::list(j["notes"], f.notes) || !decode::list(j["briefs"], f.briefs) ||
            !decode::list(j["saved"], f.saved)) return std::nullopt;
        return f;
    }
};
}  // namespace

// MARK: - Catalog

std::shared_ptr<Catalog> Catalog::make(const std::vector<Clip>& clips, const std::shared_ptr<WorkLibrary>& library) {
    std::optional<std::string> data = platform::readText("ocean.json");
    if (!data) return nullptr;
    std::optional<Json> json = Json::parse(*data);
    if (!json) return nullptr;
    std::optional<OceanFile> file = OceanFile::from(*json);
    if (!file) return nullptr;
    std::shared_ptr<Catalog> made(new Catalog());
    Catalog& self = *made;
    self.clips = clips;
    self.works = library ? library->works : std::vector<Work>{};
    const std::vector<Work>& works = self.works;
    if (!works.empty()) {
        // 64 bits, wrapping.
        uint64_t h = 5381;
        for (const Work& w : works) {
            uint64_t k = h * 31 + 7;
            for (uint32_t scalar : unicodeScalars(w.id)) k = (k * 33) ^ uint64_t(scalar);
            h = k;
        }
        self.worksKey = radix36(h);
    }
    self.briefs = file->briefs;
    self.saved = file->saved;
    self.pieceTags = std::vector<std::vector<std::string>>(clips.size() + works.size());
    // The films' tags, then the works': one that both carry gathers both.
    std::map<std::string, OceanTag> all;
    std::vector<std::string> order;
    std::vector<OceanTag> both = file->tags;
    if (library) both.insert(both.end(), library->tags.begin(), library->tags.end());
    for (const OceanTag& tag : both) {
        auto it = all.find(tag.id);
        if (it != all.end()) {
            OceanTag known = it->second;
            std::vector<int> films, more;
            for (int f : tag.films) {
                if (!contains(known.films, f)) films.push_back(f);
            }
            known.films.insert(known.films.end(), films.begin(), films.end());
            for (int w : tag.works) {
                if (!contains(known.works, w)) more.push_back(w);
            }
            known.works.insert(known.works.end(), more.begin(), more.end());
            all[tag.id] = known;
        } else {
            all[tag.id] = tag;
            order.push_back(tag.id);
        }
    }
    // Every piece also belongs to its time, so none stands alone.
    std::map<std::string, OceanTag> eras;
    std::vector<std::pair<int, std::string>> eraOrder;
    auto put = [&](int year, std::optional<int> film, std::optional<int> work) {
        Era era = Catalog::era(year);
        if (!eras.count(era.id)) {
            eras[era.id] = OceanTag(era.id, era.name, Tone::era);
            eraOrder.push_back({era.from, era.id});
        }
        if (film) eras[era.id].films.push_back(*film);
        if (work) eras[era.id].works.push_back(*work);
    };
    for (const Clip& clip : clips) put(clip.year, clip.index, std::nullopt);
    for (const Work& work : works) put(work.year, std::nullopt, work.index);
    std::vector<std::pair<int, std::string>> eraSorted = eraOrder;
    std::stable_sort(eraSorted.begin(), eraSorted.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
    for (const auto& [from, id] : eraSorted) {
        all[id] = eras[id];
        order.push_back(id);
    }
    for (const std::string& id : order) {
        auto it = all.find(id);
        if (it == all.end()) continue;
        OceanTag tag = it->second;
        std::vector<int> films, kept;
        for (int f : tag.films) {
            if (f >= 0 && f < int(clips.size())) films.push_back(f);
        }
        tag.films = films;
        for (int w : tag.works) {
            if (w >= 0 && w < int(works.size())) kept.push_back(w);
        }
        tag.works = kept;
        // Films and works take turns, so the first few of a tag show both.
        std::vector<int> w;
        for (int k : tag.works) w.push_back(int(clips.size()) + k);
        std::vector<int> turn;
        for (size_t k = 0; k < std::max(tag.films.size(), w.size()); k++) {
            if (k < tag.films.size()) turn.push_back(tag.films[k]);
            if (k < w.size()) turn.push_back(w[k]);
        }
        tag.pieces = turn;
        self.tags[id] = tag;
        for (int p : turn) self.pieceTags[size_t(p)].push_back(id);
    }
    for (const OceanNote& note : file->notes) self.notes[note.id] = note;
    return made;
}

/// The stretch of time a year is filed under: a decade since 1850, a
/// century before that, and two long stretches before 1400.
Catalog::Era Catalog::era(int year) {
    if (year < 500) return {"era-ancient", "Before 500", -9999};
    if (year < 1400) return {"era-500", "500 to 1400", 500};
    if (year < 1800) {
        int c = year / 100;
        return {fmt("era-c%d", c * 100), fmt("%dth century", c + 1), c * 100};
    }
    if (year < 1850) return {"era-1800", "Early 1800s", 1800};
    int d = year / 10 * 10;
    return {fmt("era-%d", d), fmt("The %ds", d), d};
}

std::string Catalog::counted(int films, int works) {
    std::string f = fmt("%d %s", films, films == 1 ? "film" : "films"), w = fmt("%d %s", works, works == 1 ? "work" : "works");
    if (works == 0) return f;
    if (films == 0) return w;
    return f + " and " + w;
}

// MARK: Pieces: films and works in one list

/// A film's or a work's place in the one list; nil for a note or a tag.
std::optional<int> Catalog::piece(const Ref& ref) const {
    switch (ref.kind) {
    case Ref::Kind::film: return ref.index >= 0 && ref.index < int(clips.size()) ? std::optional<int>(ref.index) : std::nullopt;
    case Ref::Kind::work: return ref.index >= 0 && ref.index < int(works.size()) ? std::optional<int>(int(clips.size()) + ref.index) : std::nullopt;
    case Ref::Kind::note:
    case Ref::Kind::tag: return std::nullopt;
    }
    return std::nullopt;
}

int Catalog::year(int p) const { return p < int(clips.size()) ? clips[size_t(p)].year : works[size_t(p) - clips.size()].year; }

/// When it was made, as said on a label.
std::string Catalog::when(int p) const { return p < int(clips.size()) ? fmt("%d", clips[size_t(p)].year) : works[size_t(p) - clips.size()].when(); }

/// A few words for it.
std::string Catalog::name(int p) const { return p < int(clips.size()) ? clips[size_t(p)].tag.short_ : works[size_t(p) - clips.size()].short_; }

/// What sort of thing it is: a film's genre, a work's kind.
std::string Catalog::sort(int p) const { return p < int(clips.size()) ? clips[size_t(p)].genre : works[size_t(p) - clips.size()].kind; }

/// What to say of it beside a tag: a film's scene, who made a work (or what it is).
std::string Catalog::line(int p) const {
    if (p < int(clips.size())) return clips[size_t(p)].scene;
    const Work& w = works[size_t(p) - clips.size()];
    return w.maker.empty() ? (w.place.empty() ? w.kind : w.place) : w.maker;
}

/// How many films and works are among some pieces, in words.
std::string Catalog::counted(const std::vector<int>& pieces) const {
    int f = int(std::count_if(pieces.begin(), pieces.end(), [&](int p) { return p < int(clips.size()); }));
    if (f == int(pieces.size())) return fmt("%d %s", f, f == 1 ? "film" : "films");
    return Catalog::counted(f, int(pieces.size()) - f);
}

/// Takes back an answer kept with a saved tree.
void Catalog::keep(const OceanNote& note) {
    if (notes.count(note.id)) return;
    notes[note.id] = note;
    made.insert(note.id);
}

/// How wide a note's picture is to how tall.
float Catalog::aspect(const OceanNote& note) const {
    std::optional<int> f = note.stillFilm();
    if (f && *f >= 0 && *f < int(clips.size())) return clips[size_t(*f)].aspect;
    return note.aspect.value_or(16.0f / 9);
}

/// The picture on an open image or video note, m.
Vec2 Catalog::pictureSize(const OceanNote& note) const {
    if (note.id.rfind("welcome", 0) == 0) return Metrics::film(Metrics::lessonWidth, Metrics::lessonStage, aspect(note));
    return pictureSize(aspect(note));
}

Vec2 Catalog::pictureSize(float aspect) {
    return Metrics::film(Metrics::openNoteWidth, 0.262f, aspect);
}

/// An open note, m. Its width never changes; its height goes with what it carries.
Vec2 Catalog::openSize(const OceanNote& note) const {
    // NOTE(port): added for Quest: a lesson of the welcome tree is a larger card, with room for a gesture to play on it.
    OceanNote::Kind kind = note.kind();
    bool picture = kind == OceanNote::Kind::image || kind == OceanNote::Kind::video;
    if (picture && note.id.rfind("welcome", 0) == 0) return {Metrics::lessonWidth, pictureSize(note).y + 0.146f};
    return openSize(kind, note.diagram.has_value(), aspect(note));
}

// NOTE(port): the Swift's `openSize(_:)` from its switch on, for a kind of note: a card opens as one (core/cards).
Vec2 Catalog::openSize(OceanNote::Kind kind, bool diagram, float aspect) {
    switch (kind) {
    case OceanNote::Kind::text: return {Metrics::openNoteWidth, diagram ? 0.372f : 0.27f};
    case OceanNote::Kind::chart: return {Metrics::openNoteWidth, 0.372f};
    case OceanNote::Kind::link: return {Metrics::openNoteWidth, 0.218f};
    case OceanNote::Kind::image:
    case OceanNote::Kind::video: return {Metrics::openNoteWidth, pictureSize(aspect).y + 0.146f};
    }
    return {Metrics::openNoteWidth, 0.27f};
}

/// A piece's tags: what it is about first, each kind's rarest first.
std::vector<OceanTag> Catalog::tagsOf(int piece) const {
    static const std::vector<Tone> order{Tone::story, Tone::craft, Tone::people, Tone::place, Tone::era};
    auto rank = [&](Tone kind) {
        auto it = std::find(order.begin(), order.end(), kind);
        return it == order.end() ? 9 : int(it - order.begin());
    };
    std::vector<OceanTag> out;
    for (const std::string& id : pieceTags[size_t(piece)]) {
        auto it = tags.find(id);
        if (it != tags.end()) out.push_back(it->second);
    }
    std::stable_sort(out.begin(), out.end(), [&](const OceanTag& a, const OceanTag& b) {
        int ra = rank(a.kind), rb = rank(b.kind);
        if (ra != rb) return ra < rb;
        return a.pieces.size() < b.pieces.size();
    });
    return out;
}

std::string Catalog::title(const Ref& ref) const {
    switch (ref.kind) {
    case Ref::Kind::film: return clips[size_t(ref.index)].title;
    case Ref::Kind::work: return works[size_t(ref.index)].title;
    case Ref::Kind::note: {
        auto it = notes.find(ref.id);
        return it != notes.end() ? it->second.headline : ref.id;
    }
    case Ref::Kind::tag: {
        auto it = tags.find(ref.id);
        return it != tags.end() ? it->second.name : ref.id;
    }
    }
    return "";
}

/// A few words for a crumb or a thumbnail.
std::string Catalog::short_(const Ref& ref) const {
    switch (ref.kind) {
    case Ref::Kind::film: return clips[size_t(ref.index)].tag.short_;
    case Ref::Kind::work: return works[size_t(ref.index)].short_;
    case Ref::Kind::note: {
        auto it = notes.find(ref.id);
        return it != notes.end() ? it->second.kicker : ref.id;
    }
    case Ref::Kind::tag: {
        auto it = tags.find(ref.id);
        return it != tags.end() ? it->second.name : ref.id;
    }
    }
    return "";
}

Tone Catalog::tone(const Ref& ref) const {
    switch (ref.kind) {
    case Ref::Kind::film:
    case Ref::Kind::work: return Tone::path;
    case Ref::Kind::note: {
        auto it = notes.find(ref.id);
        return it != notes.end() ? it->second.tone : Tone::note;
    }
    case Ref::Kind::tag: {
        auto it = tags.find(ref.id);
        return it != tags.end() ? it->second.kind : Tone::story;
    }
    }
    return Tone::path;
}

/// What the gardener sets beside `ref`, leaving out what the tree already
/// holds: its tags as chips, then up to seven films, works and notes around it.
std::vector<Offer> Catalog::offers(const Ref& ref, const std::set<Ref>& held) const {
    std::vector<Offer> out;
    std::set<Ref> taken = held;
    auto add = [&](const Ref& r, const std::string& why, Tone tone, bool chip = false) {
        if (taken.count(r)) return;
        taken.insert(r);
        out.push_back(Offer{r, why, tone, chip});
    };
    auto ringCount = [&]() { return int(std::count_if(out.begin(), out.end(), [](const Offer& o) { return !o.chip; })); };

    switch (ref.kind) {
    case Ref::Kind::film:
    case Ref::Kind::work: {
        std::optional<int> place = piece(ref);
        if (!place) break;
        int f = *place;
        // A note that points at this piece, if there is one; then the pieces nearest it.
        // (`notes` is kept in the order of its ids, which is the order the Swift sorts it into.)
        const OceanNote* note = nullptr;
        std::string key = ref.key();
        for (const auto& [id, n] : notes) {
            bool points = std::any_of(n.links.begin(), n.links.end(), [&](const NoteLink& l) { return l.to == key; });
            if (points && !taken.count(Ref::note(n.id))) {
                note = &n;
                break;
            }
        }
        std::vector<std::pair<int, OceanTag>> near;
        for (const auto& [g, tag] : related(f)) {
            if (int(near.size()) < (note == nullptr ? 6 : 5) && !taken.count(this->ref(g))) near.push_back({g, tag});
        }
        // Its tags: the ones that are the reason for one of those films come
        // first, so each reason has its tag to stand on the way there.
        std::set<std::string> reasons;
        for (const auto& [g, tag] : near) reasons.insert(tag.id);
        std::vector<OceanTag> mine = tagsOf(f);
        std::vector<OceanTag> ordered;
        for (const OceanTag& tag : mine) {
            if (reasons.count(tag.id)) ordered.push_back(tag);
        }
        for (const OceanTag& tag : mine) {
            if (!reasons.count(tag.id)) ordered.push_back(tag);
        }
        for (size_t k = 0; k < std::min(ordered.size(), size_t(std::max(5, int(reasons.size())))); k++) {
            const OceanTag& tag = ordered[k];
            add(Ref::tag(tag.id), ::name(tag.kind), tag.kind, true);
        }
        if (note) add(Ref::note(note->id), note->kicker, note->tone);
        for (const auto& [g, tag] : near) add(this->ref(g), tag.name, tag.kind);
        break;
    }
    case Ref::Kind::tag: {
        auto it = tags.find(ref.id);
        if (it == tags.end()) break;
        const OceanTag& tag = it->second;
        for (const auto& [id, note] : notes) {
            if (contains(note.tags, ref.id) && ringCount() < 2) add(Ref::note(note.id), note.kicker, note.tone);
        }
        for (int f : tag.pieces) {
            if (ringCount() < 7) add(this->ref(f), line(f), tag.kind);
        }
        break;
    }
    case Ref::Kind::note: {
        auto it = notes.find(ref.id);
        if (it == notes.end()) break;
        const OceanNote& note = it->second;
        for (const std::string& t : note.tags) {
            auto found = tags.find(t);
            if (found != tags.end()) add(Ref::tag(t), ::name(found->second.kind), found->second.kind, true);
        }
        for (const NoteLink& link : note.links) {
            if (!(ringCount() < 7)) continue;
            std::optional<Ref> r = Ref::make(link.to);
            if (!r) continue;
            add(*r, link.why, tone(*r) == Tone::path ? note.tone : tone(*r));
        }
        // Never a dead end: pieces that share the note's tags.
        for (const std::string& t : note.tags) {
            auto found = tags.find(t);
            if (found == tags.end()) continue;
            const OceanTag& tag = found->second;
            for (int f : tag.pieces) {
                if (ringCount() < 4) add(this->ref(f), tag.name, tag.kind);
            }
        }
        break;
    }
    }
    return out;
}

/// Pieces that share the most with `f`, each with the tag that best says
/// why. A rare tag counts for more than a common one, a time or a place
/// for less, and no single tag brings more than two.
std::vector<std::pair<int, OceanTag>> Catalog::related(int f) const {
    std::map<int, float> score;
    std::map<int, std::pair<float, OceanTag>> best;
    for (const OceanTag& tag : tagsOf(f)) {
        float w = weight(tag);
        for (int g : tag.pieces) {
            if (g == f) continue;
            score[g] += w;
            auto b = best.find(g);
            if (w > (b != best.end() ? b->second.first : 0)) best.insert_or_assign(g, std::make_pair(w, tag));
        }
    }
    std::map<std::string, int> perTag;
    std::vector<std::pair<int, OceanTag>> out;
    for (int g : byScore(score)) {
        auto b = best.find(g);
        if (b == best.end()) continue;
        const OceanTag& tag = b->second.second;
        if (!(perTag[tag.id] < 2)) continue;
        perTag[tag.id] += 1;
        out.push_back({g, tag});
    }
    return out;
}

// MARK: - Asking

float Catalog::weight(const OceanTag& tag) const {
    float kind = tag.kind == Tone::era ? 0.3f : (tag.kind == Tone::place ? 0.5f : 1);
    return kind / std::sqrt(float(std::max(1, int(tag.pieces.size()))));
}

/// What two pieces share, the most telling first; their time last.
std::vector<OceanTag> Catalog::shared(int a, int b) const {
    std::vector<OceanTag> out;
    for (const OceanTag& tag : tagsOf(a)) {
        if (contains(tag.pieces, b)) out.push_back(tag);
    }
    std::stable_sort(out.begin(), out.end(), [&](const OceanTag& x, const OceanTag& y) { return weight(x) > weight(y); });
    return out;
}

/// Pieces tied to `f` by something other than their time, from before it or after.
std::vector<Catalog::Tied> Catalog::lineage(int f, bool earlier, const std::set<Ref>& held) const {
    std::map<int, std::pair<float, OceanTag>> best;
    std::map<int, float> score;
    for (const OceanTag& tag : tagsOf(f)) {
        if (tag.kind == Tone::era) continue;
        for (int g : tag.pieces) {
            if (!(g != f && (year(g) < year(f)) == earlier && year(g) != year(f))) continue;
            score[g] += weight(tag);
            auto b = best.find(g);
            if (weight(tag) > (b != best.end() ? b->second.first : 0)) best.insert_or_assign(g, std::make_pair(weight(tag), tag));
        }
    }
    // What the tree doesn't hold yet comes first; one film it does hold may follow, to tie back to.
    std::vector<int> ranked = byScore(score);
    std::vector<int> fresh, known;
    for (int g : ranked) {
        if (!held.count(ref(g)) && fresh.size() < 3) fresh.push_back(g);
    }
    size_t most = fresh.size() < 3 ? 3 - fresh.size() : 1;
    for (int g : ranked) {
        if (held.count(ref(g)) && known.size() < most) known.push_back(g);
    }
    std::vector<int> kept(fresh.begin(), fresh.begin() + long(std::min(fresh.size(), size_t(known.empty() ? 3 : 2))));
    // An answer crosses kinds where it can: among a film's forebears one is a work, and the other way round.
    bool film = f < int(clips.size());
    std::vector<int> all = kept;
    all.insert(all.end(), known.begin(), known.end());
    if (kept.size() >= 2 && std::all_of(all.begin(), all.end(), [&](int g) { return (g < int(clips.size())) == film; })) {
        auto other = std::find_if(ranked.begin(), ranked.end(), [&](int g) { return (g < int(clips.size())) != film && !held.count(ref(g)); });
        if (other != ranked.end()) kept[kept.size() - 1] = *other;
    }
    std::vector<Tied> out;
    all = kept;
    all.insert(all.end(), known.begin(), known.end());
    for (int g : all) {
        auto b = best.find(g);
        if (b != best.end()) out.push_back(Tied{g, b->second.second});
    }
    return out;
}

/// Pieces that share nothing at all with `f`: another kind, another
/// time. A film's opposites are one film and two works where it can be,
/// and the other way round, so an opposite also crosses to the other kind.
std::vector<int> Catalog::opposites(int f, const std::set<Ref>& held) const {
    std::set<std::string> mine(pieceTags[size_t(f)].begin(), pieceTags[size_t(f)].end());
    std::vector<int> far;
    for (int g = 0; g < pieceCount(); g++) {
        const std::vector<std::string>& theirs = pieceTags[size_t(g)];
        if (g != f && !held.count(ref(g)) && !std::any_of(theirs.begin(), theirs.end(), [&](const std::string& t) { return mine.count(t) > 0; })) far.push_back(g);
    }
    std::stable_sort(far.begin(), far.end(), [&](int a, int b) {
        // da > db, where each is (another sort of thing, how far off in years up to 400, -its place)
        int ka = sort(a) == sort(f) ? 0 : 1, kb = sort(b) == sort(f) ? 0 : 1;
        if (ka != kb) return ka > kb;
        int ya = std::min(400, std::abs(year(a) - year(f))), yb = std::min(400, std::abs(year(b) - year(f)));
        if (ya != yb) return ya > yb;
        return -a > -b;
    });
    std::vector<int> same, other;
    for (int g : far) {
        if ((g < int(clips.size())) == (f < int(clips.size()))) same.push_back(g);
        else other.push_back(g);
    }
    std::vector<int> out;
    for (size_t k = 0; k < std::min(same.size(), size_t(1)); k++) out.push_back(same[k]);
    for (size_t k = 0; k < std::min(other.size(), size_t(2)); k++) out.push_back(other[k]);
    return out.size() == 3 ? out : std::vector<int>(far.begin(), far.begin() + long(std::min(far.size(), size_t(3))));
}

/// The tag a tag or note is about, for the questions asked of those.
std::optional<OceanTag> Catalog::subject(const Ref& ref) const {
    switch (ref.kind) {
    case Ref::Kind::tag: {
        auto it = tags.find(ref.id);
        return it != tags.end() ? std::optional<OceanTag>(it->second) : std::nullopt;
    }
    case Ref::Kind::note: {
        auto note = notes.find(ref.id);
        if (note == notes.end() || note->second.tags.empty()) return std::nullopt;
        auto it = tags.find(note->second.tags.front());
        return it != tags.end() ? std::optional<OceanTag>(it->second) : std::nullopt;
    }
    case Ref::Kind::film:
    case Ref::Kind::work: return std::nullopt;
    }
    return std::nullopt;
}

/// The pieces a card is about: itself, what a tag gathers, what a note points to and is filed under.
std::vector<int> Catalog::seeds(const Ref& ref) const {
    switch (ref.kind) {
    case Ref::Kind::film:
    case Ref::Kind::work: {
        std::optional<int> p = piece(ref);
        return p ? std::vector<int>{*p} : std::vector<int>{};
    }
    case Ref::Kind::tag: {
        auto it = tags.find(ref.id);
        return it != tags.end() ? it->second.pieces : std::vector<int>{};
    }
    case Ref::Kind::note: {
        auto it = notes.find(ref.id);
        if (it == notes.end()) return {};
        const OceanNote& note = it->second;
        std::vector<int> out;
        for (const NoteLink& link : note.links) {
            std::optional<Ref> r = Ref::make(link.to);
            std::optional<int> p = r ? piece(*r) : std::nullopt;
            if (p) out.push_back(*p);
        }
        if (std::optional<int> f = note.stillFilm()) out.push_back(*f);
        for (const std::string& t : note.tags) {
            auto tag = tags.find(t);
            if (tag != tags.end()) out.insert(out.end(), tag->second.pieces.begin(), tag->second.pieces.end());
        }
        return out;
    }
    }
    return {};
}

/// Pieces near the ones a card is about that the tree doesn't hold yet,
/// each with the tag that best says why. Never more than three.
std::vector<Catalog::Tied> Catalog::nearby(const Ref& ref, const std::set<Ref>& held) const {
    std::vector<int> seeded = seeds(ref);
    // NOTE(port): the Swift walks a Set, in whatever order it gives that run; here, from the lowest piece up.
    std::set<int> from(seeded.begin(), seeded.end());
    std::map<int, float> score;
    std::map<int, std::pair<float, OceanTag>> best;
    for (int f : from) {
        for (const OceanTag& tag : tagsOf(f)) {
            if (tag.kind == Tone::era) continue;
            float w = weight(tag);
            for (int g : tag.pieces) {
                if (!(!from.count(g) && !held.count(this->ref(g)))) continue;
                score[g] += w;
                auto b = best.find(g);
                if (w > (b != best.end() ? b->second.first : 0)) best.insert_or_assign(g, std::make_pair(w, tag));
            }
        }
    }
    std::map<std::string, int> perTag;
    std::vector<Tied> out;
    for (int g : byScore(score)) {
        auto b = best.find(g);
        if (b == best.end()) continue;
        const OceanTag& tag = b->second.second;
        if (!(perTag[tag.id] < 2)) continue;
        perTag[tag.id] += 1;
        out.push_back(Tied{g, tag});
        if (out.size() == 3) break;
    }
    return out;
}

/// The questions on offer beside an open card. `previous` is the film
/// or work before it on the path (its place among the pieces), if there
/// is one. There is always a question: no card is a dead end.
std::vector<Ask> Catalog::asks(const Ref& ref, std::optional<int> previous) const {
    std::vector<Ask> out;
    // NOTE(port): added for Quest: a lesson of the welcome tree is there to be done, not asked about.
    if (ref.kind == Ref::Kind::note && ref.id.rfind("welcome", 0) == 0) return out;
    switch (ref.kind) {
    case Ref::Kind::film:
    case Ref::Kind::work: {
        std::optional<int> place = piece(ref);
        if (!place) break;
        int f = *place;
        if (previous && *previous != f) out.push_back(Ask{fmt("ties-%d", *previous), "What ties it to " + name(*previous) + "?"});
        if (!lineage(f, true).empty()) out.push_back(Ask{"before", "What came before it?"});
        if (!lineage(f, false).empty()) out.push_back(Ask{"after", "What did it lead to?"});
        out.push_back(Ask{"opposite", "What is its opposite?"});
        break;
    }
    case Ref::Kind::tag:
    case Ref::Kind::note: {
        std::optional<OceanTag> tag = subject(ref);
        if (tag && tag->pieces.size() >= 3) {
            out.push_back(Ask{"first", "Where does it start?"});
            out.push_back(Ask{"latest", "Where is it now?"});
        }
        bool answer = false;
        if (ref.kind == Ref::Kind::note) answer = made.count(ref.id) > 0;
        out.push_back(Ask{"more", answer ? "Go further" : "What else is like this?"});
        break;
    }
    }
    return std::vector<Ask>(out.begin(), out.begin() + long(std::min(out.size(), size_t(3))));
}

/// The gardener's answer: a note, with the films and works it points to. (Worked
/// out from the library's own tags for now; later, the agent's.)
std::optional<OceanNote> Catalog::answer(const Ask& ask, const Ref& ref, const std::set<Ref>& held) {
    std::string id = "ask-" + ref.key() + "-" + ask.key;
    if (auto known = notes.find(id); known != notes.end()) return known->second;
    std::string highlight = "", summary = "";
    std::vector<NoteLink> links;
    std::vector<std::string> about;
    if (ref.kind == Ref::Kind::film || ref.kind == Ref::Kind::work) {
        std::optional<int> place = piece(ref);
        if (!place) return std::nullopt;
        int f = *place;
        std::string mine = name(f);
        std::optional<int> tied = hasPrefix(ask.key, "ties-") ? parseInt(ask.key.substr(5)) : std::nullopt;
        if (tied && *tied < pieceCount()) {
            int p = *tied;
            std::vector<OceanTag> both = shared(f, p);
            std::vector<OceanTag> telling;
            for (const OceanTag& tag : both) {
                if (tag.kind != Tone::era) telling.push_back(tag);
            }
            std::vector<std::string> names;
            for (size_t k = 0; k < std::min(telling.size(), size_t(2)); k++) names.push_back(telling[k].name);
            highlight = telling.empty() ? (both.empty() ? "Nothing direct" : "Only " + lowercased(both[0].name))
                                        : joined(names, " · ");
            summary = telling.empty() ? "They sit apart in the ocean. The path between them is yours."
                                      : mine + " and " + name(p) + " are both filed under " + (telling.size() == 1 ? "this" : "these") + ".";
            links.push_back(NoteLink{this->ref(p).key(), !telling.empty() ? telling.front().name : !both.empty() ? both.front().name : "Your path"});
            for (size_t k = 0; k < std::min(telling.size(), size_t(3)); k++) about.push_back(telling[k].id);
        } else if (ask.key == "before" || ask.key == "after") {
            std::vector<Tied> found = lineage(f, ask.key == "before", held);
            if (found.empty()) return std::nullopt;
            // found.map(\.film).min(by: { (year($0) < year($1)) == (ask.key == "before") })
            int far = found.front().film;
            for (size_t k = 1; k < found.size(); k++) {
                if ((year(found[k].film) < year(far)) == (ask.key == "before")) far = found[k].film;
            }
            highlight = ask.key == "before" ? "Back to " + when(far) : "On to " + when(far);
            std::vector<int> films;
            for (const Tied& t : found) films.push_back(t.film);
            summary = counted(films) + " in your library share" + (found.size() == 1 ? "s" : "") + " an idea with " + mine + ", " +
                (ask.key == "before" ? "earlier" : "later") + ".";
            links.clear();
            for (const Tied& t : found) links.push_back(NoteLink{this->ref(t.film).key(), when(t.film) + " · " + t.tag.name});
        } else {
            std::vector<int> found = opposites(f, held);
            if (found.empty()) return std::nullopt;
            highlight = "Nothing in common, on purpose";
            summary = "No shared people, craft or story with " + mine + ". Good for a contrast.";
            links.clear();
            for (int g : found) links.push_back(NoteLink{this->ref(g).key(), sort(g) + ", " + when(g)});
        }
    } else if (ask.key == "more") {
        std::vector<Tied> found = nearby(ref, held);
        if (found.empty()) return std::nullopt;
        std::set<std::string> nameSet;
        for (const Tied& t : found) nameSet.insert(t.tag.name);
        std::vector<std::string> names(nameSet.begin(), nameSet.end());
        highlight = joined(std::vector<std::string>(names.begin(), names.begin() + long(std::min(names.size(), size_t(2)))), " · ");
        summary = fmt("%d more in your library, close to what this card is about.", int(found.size()));
        links.clear();
        for (const Tied& t : found) links.push_back(NoteLink{this->ref(t.film).key(), t.tag.name});
        std::set<std::string> idSet;
        for (const Tied& t : found) idSet.insert(t.tag.id);
        std::vector<std::string> ids(idSet.begin(), idSet.end());
        about = std::vector<std::string>(ids.begin(), ids.begin() + long(std::min(ids.size(), size_t(2))));
    } else {
        std::optional<OceanTag> tag = subject(ref);
        if (!tag) return std::nullopt;
        std::vector<int> byYear = tag->pieces;
        std::stable_sort(byYear.begin(), byYear.end(), [&](int a, int b) {
            if (year(a) != year(b)) return year(a) < year(b);
            return a < b;
        });
        std::vector<int> found;
        if (ask.key == "first") {
            found = std::vector<int>(byYear.begin(), byYear.begin() + long(std::min(byYear.size(), size_t(2))));
        } else {
            found = std::vector<int>(byYear.end() - long(std::min(byYear.size(), size_t(2))), byYear.end());
            std::reverse(found.begin(), found.end());
        }
        if (found.empty()) return std::nullopt;
        int lead = found.front();
        highlight = name(lead) + ", " + when(lead);
        summary = ask.key == "first" ? "The earliest " + lowercased(tag->name) + " in your library." : "The most recent " + lowercased(tag->name) + " in your library.";
        links.clear();
        for (int g : found) links.push_back(NoteLink{this->ref(g).key(), when(g) + " · " + line(g)});
    }
    OceanNote note;
    note.id = id;
    note.kicker = "You asked";
    note.tone = Tone::question;
    note.headline = ask.question;
    note.highlight = highlight;
    note.summary = summary;
    note.diagram = std::nullopt;
    note.tags = about;
    note.links = links;
    notes[id] = note;
    made.insert(id);
    return note;
}

// MARK: - Marking

std::string Mark::key() const {
    switch (kind) {
    case Kind::words: {
        // 32 bits, wrapping.
        uint32_t h = 5381;
        for (uint32_t scalar : unicodeScalars(text)) h = (h * 33) ^ scalar;
        return fmt("w%u", h % 1000000);
    }
    case Kind::time: return fmt("t%d-%d", int(from * 10), int(to * 10));
    case Kind::region: return fmt("r%d-%d-%d-%d", int(center.x * 100), int(center.y * 100), int(size.x * 100), int(size.y * 100));
    }
    return "";
}

std::string Catalog::clock(double seconds) {
    int s = int(std::round(seconds));
    return fmt("%d:", s / 60) + fmt("%02d", s % 60);
}

/// What the gardener makes of a marked part of a card. It can't look at
/// a picture or listen to a scene yet, so for those it answers from what
/// the card is filed under; for marked words it looks the words up.
/// (This is the seam: the mark is all the agent needs.)
std::optional<OceanNote> Catalog::answer(const Mark& mark, const Ref& ref, const std::set<Ref>& held) {
    std::string id = "mark-" + ref.key() + "-" + mark.key();
    if (auto known = notes.find(id); known != notes.end()) return known->second;
    std::string headline = "", highlight = "", summary = "";
    std::vector<NoteLink> links;
    std::vector<std::string> about;
    switch (mark.kind) {
    case Mark::Kind::words: {
        const std::string& words = mark.text;
        std::string said = lowercased(words);
        // Tags and films the marked words name.
        // NOTE(port): the Swift takes the tags from a dictionary, so two that gather as many
        // pieces come in whatever order that run gives; here, in the order of their ids.
        std::vector<OceanTag> named;
        for (const auto& [key, tag] : tags) {
            if (contains(said, lowercased(tag.name))) named.push_back(tag);
        }
        std::stable_sort(named.begin(), named.end(), [](const OceanTag& a, const OceanTag& b) { return a.pieces.size() < b.pieces.size(); });
        std::vector<Clip> films;
        for (const Clip& clip : clips) {
            if (contains(said, lowercased(clip.title)) && !held.count(Ref::film(clip.index))) films.push_back(clip);
        }
        headline = "More on what you marked";
        highlight = "“" + (count(words) > 64 ? prefix(words, 62) + "…" : words) + "”";
        for (size_t k = 0; k < std::min(films.size(), size_t(2)); k++) links.push_back(NoteLink{Ref::film(films[k].index).key(), "Named in it"});
        for (size_t k = 0; k < std::min(named.size(), size_t(2)); k++) {
            const OceanTag& tag = named[k];
            about.push_back(tag.id);
            for (int f : tag.pieces) {
                std::string to = this->ref(f).key();
                if (!held.count(this->ref(f)) && links.size() < 4 && !std::any_of(links.begin(), links.end(), [&](const NoteLink& l) { return l.to == to; })) {
                    links.push_back(NoteLink{to, tag.name});
                }
            }
        }
        if (links.empty()) {
            for (const Tied& t : nearby(ref, held)) links.push_back(NoteLink{this->ref(t.film).key(), t.tag.name});
        }
        summary = named.empty() && films.empty() ? "Nothing in your library is named in those words. These are near the card they come from."
                                                 : "What your library holds under the words you marked.";
        break;
    }
    case Mark::Kind::time: {
        double a = mark.from, b = mark.to;
        headline = "More on " + Catalog::clock(a) + " to " + Catalog::clock(b);
        highlight = title(ref) + ", " + fmt("%.0f", std::max(1.0, b - a)) + " seconds";
        std::vector<Tied> found = nearby(ref, held);
        for (const Tied& t : found) links.push_back(NoteLink{this->ref(t.film).key(), t.tag.name});
        std::set<std::string> idSet;
        for (const Tied& t : found) idSet.insert(t.tag.id);
        std::vector<std::string> ids(idSet.begin(), idSet.end());
        about = std::vector<std::string>(ids.begin(), ids.begin() + long(std::min(ids.size(), size_t(2))));
        summary = "The gardener can't watch a scene yet. These share what the whole clip is filed under.";
        break;
    }
    case Mark::Kind::region: {
        headline = "More on this part of the frame";
        highlight = title(ref);
        std::vector<Tied> found = nearby(ref, held);
        for (const Tied& t : found) links.push_back(NoteLink{this->ref(t.film).key(), t.tag.name});
        std::set<std::string> idSet;
        for (const Tied& t : found) idSet.insert(t.tag.id);
        std::vector<std::string> ids(idSet.begin(), idSet.end());
        about = std::vector<std::string>(ids.begin(), ids.begin() + long(std::min(ids.size(), size_t(2))));
        summary = "The gardener can't look at a picture yet. These share what the whole picture is filed under.";
        break;
    }
    }
    if (links.empty()) return std::nullopt;
    OceanNote note;
    note.id = id;
    note.kicker = "You marked";
    note.tone = Tone::question;
    note.headline = headline;
    note.highlight = highlight;
    note.summary = summary;
    note.diagram = std::nullopt;
    note.tags = about;
    note.links = links;
    notes[id] = note;
    made.insert(id);
    return note;
}
