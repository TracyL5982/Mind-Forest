// The catalog: every piece of the library (films, works, notes), their tags, and what a card asks about.
#pragma once
#include <cmath>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "../base.h"
#include "../json.h"
#include "../vecmath.h"
#include "stage.h"
#include "library.h"

// What the ocean holds (ocean.json, written by hand for now; later the
// gardener's side writes it): films, museum works, notes and tags, and what
// the gardener offers beside each one. A node is anything with a title, a
// body and tags; a film is one kind of body, a work another, a note a third.
//
// Films and works are the ocean's pieces. The catalog keeps them in one
// list, films first, so that anything worked out from tags (what is near,
// what came before, what is the opposite) crosses from one kind to the other.

// A file whose key a type needs is missing or holds the wrong kind of value is not read at all:
// every `from` here gives nullopt then. These are the pieces they are written with. Each returns
// false on such a key; the ones that fill an optional are `decodeIfPresent` (a missing key or a
// null is empty, anything of the wrong kind still fails).
namespace decode {
inline bool string(const Json& j, std::string& out) {
    if (!j.isString()) return false;
    out = j.string();
    return true;
}
inline bool boolean(const Json& j, bool& out) {
    if (!j.isBool()) return false;
    out = j.boolean();
    return true;
}
inline bool number(const Json& j, double& out) {
    if (!j.isNumber()) return false;
    out = j.number();
    return true;
}
inline bool real(const Json& j, float& out) {
    if (!j.isNumber()) return false;
    out = float(j.number());
    return true;
}
/// An Int: a number with nothing after the point.
inline bool integer(const Json& j, int& out) {
    if (!j.isNumber()) return false;
    double n = j.number();
    if (n != std::floor(n) || n < -2147483648.0 || n > 2147483647.0) return false;
    out = int(n);
    return true;
}
inline bool tone(const Json& j, Tone& out) {
    if (!j.isString()) return false;
    std::optional<Tone> t = toneFrom(j.string());
    if (!t) return false;
    out = *t;
    return true;
}
/// A Vec2: an array of exactly two numbers.
inline bool vec2(const Json& j, Vec2& out) {
    if (!j.isArray() || j.size() != 2) return false;
    return real(j[0], out.x) && real(j[1], out.y);
}
inline bool strings(const Json& j, std::vector<std::string>& out) {
    if (!j.isArray()) return false;
    out.clear();
    for (const Json& item : j.array()) {
        std::string s;
        if (!string(item, s)) return false;
        out.push_back(s);
    }
    return true;
}
inline bool integers(const Json& j, std::vector<int>& out) {
    if (!j.isArray()) return false;
    out.clear();
    for (const Json& item : j.array()) {
        int i = 0;
        if (!integer(item, i)) return false;
        out.push_back(i);
    }
    return true;
}
inline bool numbers(const Json& j, std::vector<double>& out) {
    if (!j.isArray()) return false;
    out.clear();
    for (const Json& item : j.array()) {
        double n = 0;
        if (!number(item, n)) return false;
        out.push_back(n);
    }
    return true;
}
/// A type with its own `from`.
template <class T>
bool value(const Json& j, T& out) {
    std::optional<T> v = T::from(j);
    if (!v) return false;
    out = *v;
    return true;
}
/// An array of a type with its own `from`.
template <class T>
bool list(const Json& j, std::vector<T>& out) {
    if (!j.isArray()) return false;
    out.clear();
    for (const Json& item : j.array()) {
        std::optional<T> v = T::from(item);
        if (!v) return false;
        out.push_back(*v);
    }
    return true;
}
// decodeIfPresent
inline bool string(const Json& j, std::optional<std::string>& out) {
    out.reset();
    if (j.isNull()) return true;
    std::string s;
    if (!string(j, s)) return false;
    out = s;
    return true;
}
inline bool real(const Json& j, std::optional<float>& out) {
    out.reset();
    if (j.isNull()) return true;
    float v = 0;
    if (!real(j, v)) return false;
    out = v;
    return true;
}
inline bool integer(const Json& j, std::optional<int>& out) {
    out.reset();
    if (j.isNull()) return true;
    int v = 0;
    if (!integer(j, v)) return false;
    out = v;
    return true;
}
template <class T>
bool value(const Json& j, std::optional<T>& out) {
    out.reset();
    if (j.isNull()) return true;
    std::optional<T> v = T::from(j);
    if (!v) return false;
    out = v;
    return true;
}
}  // namespace decode

struct Ref {
    enum class Kind { film, work, note, tag };
    Kind kind = Kind::film;
    int index = 0;          // film: index into the clip library; work: index into the work library
    std::string id;         // note, tag

    static Ref film(int i) {
        Ref r;
        r.kind = Kind::film;
        r.index = i;
        return r;
    }
    static Ref work(int i) {
        Ref r;
        r.kind = Kind::work;
        r.index = i;
        return r;
    }
    static Ref note(const std::string& id) {
        Ref r;
        r.kind = Kind::note;
        r.id = id;
        return r;
    }
    static Ref tag(const std::string& id) {
        Ref r;
        r.kind = Kind::tag;
        r.id = id;
        return r;
    }

    /// `init?(_ s: String)`: "film:3", "note:watched-brief".
    static std::optional<Ref> make(const std::string& s);

    std::string key() const;

    /// As a file holds it: its key, a single string.
    static std::optional<Ref> from(const Json& j);
    Json json() const;

    // Hashable
    bool operator==(const Ref& o) const { return kind == o.kind && index == o.index && id == o.id; }
    bool operator!=(const Ref& o) const { return !(*this == o); }
    /// An order, so refs can be kept in a std::set; it means nothing.
    bool operator<(const Ref& o) const {
        if (kind != o.kind) return kind < o.kind;
        if (index != o.index) return index < o.index;
        return id < o.id;
    }
};

struct OceanTag {
    std::string id;
    std::string name;
    Tone kind = Tone::story;
    std::vector<int> films;
    std::vector<int> works;
    /// Everything it gathers, as places in the catalog's one list of pieces,
    /// films and works taking turns. (Set by the catalog.)
    std::vector<int> pieces;

    OceanTag() = default;
    OceanTag(const std::string& id, const std::string& name, Tone kind, const std::vector<int>& films = {}, const std::vector<int>& works = {})
        : id(id), name(name), kind(kind), films(films), works(works) {}

    /// Keys: id, name, kind, films, works; `films` and `works` may be missing.
    static std::optional<OceanTag> from(const Json& j);

    /// What it gathers, in words: "5 films", "12 works", "5 films and 12 works".
    std::string gathers() const;
};

struct NoteLink {
    std::string to;
    std::string why;
    static std::optional<NoteLink> from(const Json& j);
    Json json() const;
};

/// Numbers to draw as bars: what an answer shows instead of saying.
struct ChartSpec {
    std::vector<std::string> labels;
    std::vector<double> values;
    std::optional<std::string> unit;        // after each value, e.g. "films"
    std::optional<int> mark;                // the bar the note is about
    std::optional<std::string> source;      // where the numbers come from, under the chart
    static std::optional<ChartSpec> from(const Json& j);
    Json json() const;
};

/// Somewhere outside the ocean an answer points to.
struct LinkSpec {
    std::string url;
    std::string site;           // as shown, e.g. "en.wikipedia.org"
    static std::optional<LinkSpec> from(const Json& j);
    Json json() const;
};

/// Anything in the ocean that isn't a film or a tag: a card led by words.
/// What it carries besides its words decides what kind of card it is:
/// - nothing more: a text note, with an optional line drawing (`diagram`)
/// - `image`: a picture with its headline and a line about it
/// - `clip`: a video that plays when the card is open, with a description
/// - `chart`: bars
/// - `link`: a page outside, which the open card can send you to
struct OceanNote {
    std::string id;
    std::string kicker;
    Tone tone = Tone::note;
    std::string headline;
    std::string highlight;
    std::string summary;
    std::optional<std::string> diagram;
    std::vector<std::string> tags;
    std::vector<NoteLink> links;
    std::optional<std::string> image;       // a picture file in the app's ocean folder, or "still:<film index>"
    std::optional<float> aspect;            // the picture's width over its height, if it isn't a film's
    std::optional<int> clip;                // a film from the library, shown as a video with this note's own words
    std::optional<ChartSpec> chart;
    std::optional<LinkSpec> link;

    enum class Kind { text, image, video, chart, link };

    Kind kind() const {
        if (clip) return Kind::video;
        if (image) return Kind::image;
        if (chart) return Kind::chart;
        if (link) return Kind::link;
        return Kind::text;
    }

    /// The film whose still stands for the picture, if it is one of the library's.
    std::optional<int> stillFilm() const;

    static std::optional<OceanNote> from(const Json& j);
    Json json() const;
};

struct Brief {
    std::string id;
    std::string line;
    std::string title;
    std::string root;
    static std::optional<Brief> from(const Json& j);
};

enum class Maker { gardener, you, both };

/// `maker.label`
inline const char* label(Maker m) {
    switch (m) {
    case Maker::gardener: return "Momo";
    case Maker::you: return "You";
    case Maker::both: return "Momo + you";
    }
    return "";
}

/// `maker.rawValue` and `Maker(rawValue:)`, as the JSON files spell them.
inline const char* rawValue(Maker m) {
    switch (m) {
    case Maker::gardener: return "gardener";
    case Maker::you: return "you";
    case Maker::both: return "both";
    }
    return "";
}

inline std::optional<Maker> makerFrom(const std::string& raw) {
    for (Maker m : {Maker::gardener, Maker::you, Maker::both}) {
        if (raw == rawValue(m)) return m;
    }
    return std::nullopt;
}

struct SavedSpec {
    std::string title;
    Maker maker = Maker::gardener;
    std::vector<std::string> steps;
    static std::optional<SavedSpec> from(const Json& j);
};

/// Something the gardener puts beside a step.
struct Offer {
    Ref ref;
    std::string why;        // the label on its thread: why it's here
    Tone tone;
    bool chip;              // a tag, set beside the open card instead of around it
};

// `Ask` and `Mark` stand here because the catalog has to see them first.

// MARK: - Asking

/// A question you can put to the gardener about the open card.
struct Ask {
    std::string key;
    std::string question;
};

// MARK: - Marking

/// A part of a card you have marked, to ask about that part alone.
struct Mark {
    enum class Kind { words, time, region };
    Kind kind = Kind::words;
    std::string text;           // words: a stretch of a note's text
    double from = 0, to = 0;    // time: seconds of a video
    Vec2 center, size;          // region: part of a picture, 0…1 across and down

    static Mark words(const std::string& s) {
        Mark m;
        m.kind = Kind::words;
        m.text = s;
        return m;
    }
    static Mark time(double from, double to) {
        Mark m;
        m.kind = Kind::time;
        m.from = from;
        m.to = to;
        return m;
    }
    static Mark region(Vec2 center, Vec2 size) {
        Mark m;
        m.kind = Kind::region;
        m.center = center;
        m.size = size;
        return m;
    }

    std::string key() const;

    // Equatable
    bool operator==(const Mark& o) const {
        if (kind != o.kind) return false;
        switch (kind) {
        case Kind::words: return text == o.text;
        case Kind::time: return from == o.from && to == o.to;
        case Kind::region: return center == o.center && size == o.size;
        }
        return false;
    }
    bool operator!=(const Mark& o) const { return !(*this == o); }
};

class Catalog {
public:
    std::vector<Clip> clips;
    std::vector<Work> works;
    /// Says which works these are, in this order: saved trees name a work by its place among them.
    std::optional<std::string> worksKey;
    std::vector<Brief> briefs;
    std::vector<SavedSpec> saved;
    std::map<std::string, OceanTag> tags;
    std::map<std::string, OceanNote> notes;
    /// Notes the gardener wrote while you worked (answers), which ocean.json doesn't hold.
    std::set<std::string> made;

private:
    std::vector<std::vector<std::string>> pieceTags;

public:
    /// How wide a tag's label is drawn, m (set by the scene, which can measure type).
    std::function<float(const std::string&)> chipWidth = [](const std::string&) { return 0.12f; };
    /// A card's size when small, m: the tree's layout and its drawing agree on it.
    std::function<Vec2(const Ref&)> smallSize = [](const Ref&) { return Vec2{0.19f, 0.12f}; };

    /// `init?(clips:works:)`
    static std::shared_ptr<Catalog> make(const std::vector<Clip>& clips, const std::shared_ptr<WorkLibrary>& library = nullptr);

    /// The stretch of time a year is filed under: a decade since 1850, a
    /// century before that, and two long stretches before 1400.
    struct Era {
        std::string id;
        std::string name;
        int from;
    };
    static Era era(int year);

    static std::string counted(int films, int works);

    // MARK: Pieces: films and works in one list

    Ref ref(int p) const { return p < int(clips.size()) ? Ref::film(p) : Ref::work(p - int(clips.size())); }

    /// A film's or a work's place in the one list; nil for a note or a tag.
    std::optional<int> piece(const Ref& ref) const;

    int pieceCount() const { return int(clips.size()) + int(works.size()); }

    int year(int p) const;

    /// When it was made, as said on a label.
    std::string when(int p) const;

    /// A few words for it.
    std::string name(int p) const;

    /// What sort of thing it is: a film's genre, a work's kind.
    std::string sort(int p) const;

    /// What to say of it beside a tag: a film's scene, who made a work (or what it is).
    std::string line(int p) const;

    /// How many films and works are among some pieces, in words.
    std::string counted(const std::vector<int>& pieces) const;

    /// Takes back an answer kept with a saved tree.
    void keep(const OceanNote& note);

    /// How wide a note's picture is to how tall.
    float aspect(const OceanNote& note) const;

    /// The picture on an open image or video note, m.
    Vec2 pictureSize(const OceanNote& note) const;

    /// An open note, m. Its width never changes; its height goes with what it carries.
    Vec2 openSize(const OceanNote& note) const;
    /// The same for a kind of note, which a card opens as (core/cards).
    static Vec2 openSize(OceanNote::Kind kind, bool diagram, float aspect);
    static Vec2 pictureSize(float aspect);

    /// A piece's tags: what it is about first, each kind's rarest first.
    /// (`tags` is also the field.)
    std::vector<OceanTag> tagsOf(int piece) const;

    std::string title(const Ref& ref) const;

    /// A few words for a crumb or a thumbnail.
    /// `short` is a C++ keyword, hence the underscore.
    std::string short_(const Ref& ref) const;

    Tone tone(const Ref& ref) const;

    /// What the gardener sets beside `ref`, leaving out what the tree already
    /// holds: its tags as chips, then up to seven films, works and notes around it.
    std::vector<Offer> offers(const Ref& ref, const std::set<Ref>& held) const;

private:
    Catalog() = default;

    /// Pieces that share the most with `f`, each with the tag that best says
    /// why. A rare tag counts for more than a common one, a time or a place
    /// for less, and no single tag brings more than two.
    std::vector<std::pair<int, OceanTag>> related(int f) const;

    // MARK: - Asking

    float weight(const OceanTag& tag) const;

public:
    /// What two pieces share, the most telling first; their time last.
    std::vector<OceanTag> shared(int a, int b) const;

private:
    /// A piece, and the tag that says why it is there.
    struct Tied {
        int film;
        OceanTag tag;
    };

    /// Pieces tied to `f` by something other than their time, from before it or after.
    std::vector<Tied> lineage(int f, bool earlier, const std::set<Ref>& held = {}) const;

    /// Pieces that share nothing at all with `f`: another kind, another
    /// time. A film's opposites are one film and two works where it can be,
    /// and the other way round, so an opposite also crosses to the other kind.
    std::vector<int> opposites(int f, const std::set<Ref>& held = {}) const;

    /// The tag a tag or note is about, for the questions asked of those.
    std::optional<OceanTag> subject(const Ref& ref) const;

    /// The pieces a card is about: itself, what a tag gathers, what a note points to and is filed under.
    std::vector<int> seeds(const Ref& ref) const;

    /// Pieces near the ones a card is about that the tree doesn't hold yet,
    /// each with the tag that best says why. Never more than three.
    std::vector<Tied> nearby(const Ref& ref, const std::set<Ref>& held) const;

public:
    /// The questions on offer beside an open card. `previous` is the film
    /// or work before it on the path (its place among the pieces), if there
    /// is one. There is always a question: no card is a dead end.
    std::vector<Ask> asks(const Ref& ref, std::optional<int> previous) const;

    /// The gardener's answer: a note, with the films and works it points to. (Worked
    /// out from the library's own tags for now; later, the agent's.)
    std::optional<OceanNote> answer(const Ask& ask, const Ref& ref, const std::set<Ref>& held = {});

    // MARK: - Marking

    static std::string clock(double seconds);

    /// What the gardener makes of a marked part of a card. It can't look at
    /// a picture or listen to a scene yet, so for those it answers from what
    /// the card is filed under; for marked words it looks the words up.
    /// (This is the seam: the mark is all the agent needs.)
    std::optional<OceanNote> answer(const Mark& mark, const Ref& ref, const std::set<Ref>& held = {});
};
