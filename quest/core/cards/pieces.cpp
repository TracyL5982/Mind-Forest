#include "pieces.h"

#include <algorithm>
#include <cstdlib>

#include "../ocean/catalog.h"
#include "../platform.h"
#include "measure.h"

namespace cards {

namespace {

/// `toLowerCase()` for the letters the library's names hold: Latin, with its accented capitals.
std::string lower(const std::string& s) {
    Text t = points(s);
    for (char32_t& c : t) {
        if ((c >= 'A' && c <= 'Z') || (c >= 0xC0 && c <= 0xDE && c != 0xD7)) c += 32;
    }
    return utf8(t);
}

/// `[...new Set(names)]`
Json unique(const std::vector<std::string>& names) {
    Json out = Json::list();
    std::vector<std::string> seen;
    for (const std::string& name : names) {
        if (std::find(seen.begin(), seen.end(), name) != seen.end()) continue;
        seen.push_back(name);
        out.push(name);
    }
    return out;
}

/// `parts.filter(Boolean).join(between)`
std::string joined(const std::vector<std::string>& parts, const std::string& between) {
    std::string out;
    for (const std::string& part : parts) {
        if (part.empty()) continue;
        out += (out.empty() ? "" : between) + part;
    }
    return out;
}

/// The tags of ocean.json and works.json that gather a piece. The catalog's eras are its own, and the import does not read them.
std::vector<const OceanTag*> tagsGathering(const Catalog& catalog, Ref::Kind kind, int index) {
    std::vector<const OceanTag*> out;
    for (const auto& [id, tag] : catalog.tags) {
        const std::vector<int>& pieces = kind == Ref::Kind::film ? tag.films : tag.works;
        if (tag.kind != Tone::era && std::count(pieces.begin(), pieces.end(), index)) out.push_back(&tag);
    }
    return out;
}

/// `named(ids)`
std::vector<std::string> named(const std::vector<const OceanTag*>& tags) {
    std::vector<std::string> out;
    for (const OceanTag* tag : tags) out.push_back(lower(tag->name));
    return out;
}

/// A piece's tags as the chips under its card: its people (`data.people`) and its place (`data.where`).
void chips(const std::vector<const OceanTag*>& tags, Json& data) {
    Json people = Json::list();
    std::string where;
    for (const OceanTag* tag : tags) {
        if (tag->kind == Tone::people) people.push(tag->name);
        if (tag->kind == Tone::place && where.empty()) where = tag->name;
    }
    if (!people.array().empty()) data.set("people", people);
    if (!where.empty()) data.set("where", where);
}

Json libraryRef(const char* kind, Json key) {
    Json ref = Json::object();
    ref.set("kind", kind).set("key", std::move(key));
    return ref;
}

/// An item as `libraryDraft` makes it: the user's, from the library. The headset has no import time, so `capturedAt` is empty.
Json item(const std::string& id, const char* kind, const std::string& title, const std::string& summary, const std::string& text, Json tags,
          Json data, const std::string& url) {
    Json source = Json::object(), origin = Json::object(), out = Json::object();
    source.set("from", "library").set("capturedAt", "");
    if (!url.empty()) source.set("url", url);
    origin.set("by", "user");
    out.set("id", id).set("kind", kind).set("title", title).set("text", text).set("summary", summary).set("tags", std::move(tags));
    out.set("data", std::move(data)).set("source", source).set("origin", origin).set("archived", false).set("revision", 0);
    return out;
}

Json view(const char* component, Json props) {
    Json out = Json::object();
    out.set("component", component).set("props", std::move(props)).set("by", "default");
    return out;
}

std::string still(int film) { return "still:" + std::to_string(film); }

/// A film's own file, where the headset has it: what the import plays (`mediaUrl`).
std::string playable(const Clip& clip) { return platform::resourcePath(clip.full.src).empty() ? "" : clip.full.src; }

/// components/video.js: the film's file, and its still.
Json videoView(const std::string& src, int film) {
    Json props = Json::object();
    if (!src.empty()) props.set("src", src);
    props.set("poster", still(film));
    return view("video", props);
}

OceanCard film(const Catalog& catalog, int f) {
    const Clip& c = catalog.clips[size_t(f)];
    std::vector<const OceanTag*> tags = tagsGathering(catalog, Ref::Kind::film, f);
    std::vector<std::string> names;
    for (const std::string& genre : c.genres) names.push_back(lower(genre));
    for (const std::string& name : named(tags)) names.push_back(name);
    std::string cast;
    for (size_t i = 0; i < std::min<size_t>(c.cast.size(), 4); i++) cast += (i ? ", " : "") + c.cast[i];
    std::string genres;
    for (size_t i = 0; i < c.genres.size(); i++) genres += (i ? ", " : "") + c.genres[i];
    std::string text = joined({c.description, cast.empty() ? "" : "With " + cast + ".", std::to_string(c.year) + ". " + genres + "."}, " ");
    std::string src = playable(c);
    Json data = Json::object();
    data.set("when", std::to_string(c.year)).set("from", "Your film library").set("library", libraryRef("film", f));
    if (!src.empty()) data.set("mediaUrl", src);
    data.set("thumbnailUrl", still(f));
    chips(tags, data);
    std::string url = c.videoid.empty() ? "" : "https://www.youtube.com/watch?v=" + c.videoid;
    Json made = item("library:film:" + std::to_string(f), src.empty() ? "text" : "video", c.title, c.scene + ": " + c.description, text,
                     unique(names), data, url);
    return OceanCard{Ref::film(f).key(), videoView(src, f), made, c.aspect};
}

/// components/artwork.js, where the import's default view is a plain image: the work with its maker, date, medium and museum.
OceanCard work(const Catalog& catalog, int i) {
    const Work& w = catalog.works[size_t(i)];
    std::vector<const OceanTag*> tags = tagsGathering(catalog, Ref::Kind::work, i);
    std::vector<std::string> names{lower(w.kind)};
    if (!w.place.empty()) names.push_back(lower(w.place));
    for (const std::string& name : named(tags)) names.push_back(name);
    std::string line = joined({w.maker, w.date, w.medium, w.museum}, ", ");
    Json data = Json::object();
    data.set("by", w.maker).set("date", w.date).set("from", w.museum).set("when", std::to_string(w.year)).set("library", libraryRef("work", w.id));
    chips(tags, data);
    Json props = Json::object();
    props.set("src", "work:" + std::to_string(i));
    auto given = [&](const char* key, const std::string& value) {
        if (!value.empty()) props.set(key, value);
    };
    given("maker", w.maker);
    given("date", w.date);
    given("medium", w.medium);
    given("holder", w.museum);
    Json made = item("library:work:" + w.id, "image", w.title, line, joined({line, w.about}, "\n\n"), unique(names), data, w.url);
    return OceanCard{Ref::work(i).key(), view("artwork", props), made, w.aspect};
}

/// The words a note quotes: its highlight, when the whole of it stands in quotation marks (a marked passage the gardener answers).
std::optional<std::string> quoted(const OceanNote& note) {
    const std::string open = "\xE2\x80\x9C", close = "\xE2\x80\x9D";
    const std::string& h = note.highlight;
    if (h.size() <= open.size() + close.size() || h.compare(0, open.size(), open) != 0 || h.compare(h.size() - close.size(), close.size(), close) != 0)
        return std::nullopt;
    return h.substr(open.size(), h.size() - open.size() - close.size());
}

OceanCard note(const Catalog& catalog, const OceanNote& n) {
    std::vector<const OceanTag*> tags;
    for (const std::string& id : n.tags) {
        if (auto tag = catalog.tags.find(id); tag != catalog.tags.end()) tags.push_back(&tag->second);
    }
    std::string brief;
    for (const Brief& b : catalog.briefs) {
        if (b.root == "note:" + n.id) brief = b.title + ": " + b.line;
    }
    std::optional<int> f = n.stillFilm();
    bool ofFilm = f && *f >= 0 && *f < int(catalog.clips.size());
    Json data = Json::object();
    data.set("kicker", n.kicker).set("library", libraryRef("note", n.id));
    if (n.chart) {
        Json chart = Json::object();
        chart.set("labels", Json::list(std::vector<Json>(n.chart->labels.begin(), n.chart->labels.end())));
        chart.set("values", Json::list(std::vector<Json>(n.chart->values.begin(), n.chart->values.end())));
        data.set("chart", chart);
    }
    if (n.link) data.set("site", n.link->site);
    chips(tags, data);

    // The import's kind: a picture or a video it has no file for is a text note.
    const char* kind = "text";
    std::optional<float> aspect;
    Json drawnAs = view("note", Json::object());
    switch (n.kind()) {
    case OceanNote::Kind::video: {
        if (!ofFilm) break;
        std::string src = playable(catalog.clips[size_t(*f)]);
        if (!src.empty()) {
            kind = "video";
            data.set("mediaUrl", src).set("thumbnailUrl", still(*f));
        }
        drawnAs = videoView(src, *f);
        aspect = catalog.aspect(n);
        break;
    }
    case OceanNote::Kind::image: {
        bool there = ofFilm || !platform::resourcePath(*n.image).empty();
        if (there) kind = "image";
        aspect = catalog.aspect(n);
        Json props = Json::object();
        props.set("src", ofFilm ? still(*f) : "file:" + *n.image).set("aspect", *aspect);
        drawnAs = view("image", props);
        break;
    }
    case OceanNote::Kind::chart: {
        Json props = Json::object();
        props.set("chart", "bar").set("labels", data["chart"]["labels"]).set("values", data["chart"]["values"]);
        if (n.chart->mark) props.set("mark", *n.chart->mark);
        if (n.chart->unit) props.set("unit", *n.chart->unit);
        drawnAs = view("chart", props);
        break;
    }
    case OceanNote::Kind::link: {
        Json props = Json::object();
        props.set("url", n.link->url).set("site", n.link->site);
        if (!n.summary.empty()) props.set("description", n.summary);
        drawnAs = view("link", props);
        break;
    }
    case OceanNote::Kind::text:
        if (std::optional<std::string> words = quoted(n)) {
            Json props = Json::object();
            props.set("text", *words);
            drawnAs = view("quote", props);
        }
        break;
    }
    Json made = item("library:note:" + n.id, kind, n.headline, n.summary, joined({brief, n.highlight, n.summary}, "\n\n"), unique(named(tags)), data,
                     n.link ? n.link->url : "");
    return OceanCard{n.id, drawnAs, made, aspect};
}

}  // namespace

std::optional<OceanCard> oceanCard(const Catalog& catalog, const Ref& ref) {
    switch (ref.kind) {
    case Ref::Kind::film:
        if (ref.index >= 0 && ref.index < int(catalog.clips.size())) return film(catalog, ref.index);
        return std::nullopt;
    case Ref::Kind::work:
        if (ref.index >= 0 && ref.index < int(catalog.works.size())) return work(catalog, ref.index);
        return std::nullopt;
    case Ref::Kind::note:
        if (auto n = catalog.notes.find(ref.id); n != catalog.notes.end()) return note(catalog, n->second);
        return std::nullopt;
    case Ref::Kind::tag: return std::nullopt;
    }
    return std::nullopt;
}

std::optional<OceanPicture> oceanPicture(const std::string& src) {
    auto after = [&](const char* scheme) -> std::optional<std::string> {
        std::string s = scheme;
        return src.compare(0, s.size(), s) == 0 ? std::optional(src.substr(s.size())) : std::nullopt;
    };
    if (std::optional<std::string> f = after("still:")) return OceanPicture{OceanPicture::Kind::still, std::atoi(f->c_str()), ""};
    if (std::optional<std::string> w = after("work:")) return OceanPicture{OceanPicture::Kind::work, std::atoi(w->c_str()), ""};
    if (std::optional<std::string> file = after("file:")) return OceanPicture{OceanPicture::Kind::file, 0, *file};
    return std::nullopt;
}

}  // namespace cards
