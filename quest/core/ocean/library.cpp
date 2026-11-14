// Port of visionos/MindPalace/Content/ClipLibrary.swift and Content/WorkLibrary.swift.
#include "library.h"

#include "../platform.h"

namespace {

/// How many characters a string has.
/// NOTE(port): Swift counts Characters (what a reader sees as one letter); this counts Unicode
/// scalars. They are the same unless the text holds combining marks or joined emoji.
int count(const std::string& s) {
    int n = 0;
    for (unsigned char c : s) {
        if ((c & 0xC0) != 0x80) n += 1;
    }
    return n;
}

bool hasPrefix(const std::string& s, const std::string& prefix) { return s.compare(0, prefix.size(), prefix) == 0; }

}  // namespace

// MARK: - ClipLibrary.swift

std::optional<ClipTag> ClipTag::from(const Json& j) {
    ClipTag t;
    if (!decode::string(j["short"], t.short_) || !decode::string(j["headline"], t.headline) ||
        !decode::string(j["description"], t.description)) return std::nullopt;
    return t;
}

std::optional<FullClipInfo> FullClipInfo::from(const Json& j) {
    FullClipInfo f;
    if (!decode::string(j["src"], f.src) || !decode::integer(j["width"], f.width) || !decode::integer(j["height"], f.height) ||
        !decode::number(j["duration"], f.duration)) return std::nullopt;
    return f;
}

std::optional<Clip> Clip::from(const Json& j) {
    Clip c;
    if (!decode::integer(j["index"], c.index) || !decode::string(j["imdbid"], c.imdbid) || !decode::string(j["title"], c.title) ||
        !decode::integer(j["year"], c.year) || !decode::string(j["genre"], c.genre) || !decode::strings(j["cast"], c.cast) ||
        !decode::string(j["scene"], c.scene) || !decode::real(j["aspect"], c.aspect) || !decode::real(j["loopAspect"], c.loopAspect) ||
        !decode::integers(j["tile"], c.tile) || !decode::value(j["full"], c.full) || !decode::value(j["tag"], c.tag)) return std::nullopt;
    return c;
}

std::optional<AtlasInfo> AtlasInfo::from(const Json& j) {
    AtlasInfo a;
    if (!decode::string(j["src"], a.src) || !decode::integer(j["width"], a.width) || !decode::integer(j["height"], a.height) ||
        !decode::number(j["loop"], a.loop) || !decode::number(j["blend"], a.blend)) return std::nullopt;
    return a;
}

namespace {
struct ClipManifest {
    AtlasInfo atlas;
    std::vector<Clip> clips;
    static std::optional<ClipManifest> from(const Json& j) {
        ClipManifest m;
        if (!decode::value(j["atlas"], m.atlas) || !decode::list(j["clips"], m.clips)) return std::nullopt;
        return m;
    }
};
}  // namespace

std::shared_ptr<ClipLibrary> ClipLibrary::make() {
    // NOTE(port): the bundle's "clips" folder is not looked up on its own: a host finds files, by
    // name. Whether it is there is whether its clips.json can be read.
    std::string folder = "clips";
    std::optional<std::string> data = platform::readText(folder + "/clips.json");
    if (!data) return nullptr;
    std::optional<Json> json = Json::parse(*data);
    if (!json) return nullptr;
    std::optional<ClipManifest> manifest = ClipManifest::from(*json);
    if (!manifest) return nullptr;
    std::shared_ptr<ClipLibrary> self(new ClipLibrary());
    self->folder = folder;
    self->atlas = manifest->atlas;
    self->clips = manifest->clips;
    return self;
}

std::string ClipLibrary::url(const std::string& src) const {
    return platform::resourcePath(folder + "/" + (hasPrefix(src, "clips/") ? src.substr(6) : src));
}

/// The clip's tile as a UV rect (u0, v0, width, height), v pointing up.
Vec4 ClipLibrary::tileUV(const Clip& clip) const {
    float x = float(clip.tile[0]), y = float(clip.tile[1]), w = float(clip.tile[2]), h = float(clip.tile[3]);
    float W = float(atlas.width), H = float(atlas.height);
    return {x / W, 1 - (y + h) / H, w / W, h / H};
}

/// Dot color is the film's genre, in pigments from the watercolor reference.
Color genreColor(const std::string& genre) {
    uint32_t hex = 0x9A9A9A;
    if (genre == "Drama") hex = 0x2F6DB1;
    else if (genre == "Comedy") hex = 0xF0B533;
    else if (genre == "Action") hex = 0xE2483B;
    else if (genre == "Adventure") hex = 0xEE7B30;
    else if (genre == "Horror") hex = 0x8A4C9E;
    else if (genre == "Sci-Fi") hex = 0x43B2C6;
    else if (genre == "Thriller" || genre == "Mystery") hex = 0x5552B0;
    else if (genre == "Crime") hex = 0x8B6A57;
    else if (genre == "Romance") hex = 0xD8698E;
    else if (genre == "Musical" || genre == "Music") hex = 0xEFA3A1;
    else if (genre == "Western" || genre == "Sport") hex = 0xE79B6B;
    else if (genre == "War" || genre == "History" || genre == "Biography") hex = 0xB4AE8A;
    else if (genre == "Animation" || genre == "Family") hex = 0x7DBA4F;
    else if (genre == "Fantasy") hex = 0x2F9C6A;
    return Color{float((hex >> 16) & 0xFF) / 255, float((hex >> 8) & 0xFF) / 255, float(hex & 0xFF) / 255, 1};
}

// MARK: - WorkLibrary.swift

/// When it was made, short enough for a label.
std::string Work::when() const {
    if (!date.empty() && count(date) <= 18) return date;
    return Work::say(year);
}

/// Museums write 1046 BC as the year -1046.
std::string Work::say(int year) { return year < 0 ? fmt("%d BCE", -year) : fmt("%d", year); }

std::optional<Work> Work::from(const Json& j) {
    Work w;
    if (!decode::integer(j["index"], w.index) || !decode::string(j["id"], w.id) || !decode::string(j["museum"], w.museum) ||
        !decode::string(j["title"], w.title) || !decode::string(j["short"], w.short_) || !decode::string(j["maker"], w.maker) ||
        !decode::string(j["date"], w.date) || !decode::integer(j["year"], w.year) || !decode::string(j["place"], w.place) ||
        !decode::string(j["medium"], w.medium) || !decode::string(j["kind"], w.kind) || !decode::string(j["about"], w.about) ||
        !decode::string(j["url"], w.url) || !decode::real(j["aspect"], w.aspect) || !decode::integers(j["tile"], w.tile) ||
        !decode::string(j["file"], w.file) || !decode::integer(j["width"], w.width) || !decode::integer(j["height"], w.height)) return std::nullopt;
    return w;
}

namespace {
struct WorkManifest {
    struct Atlas {
        std::string src;
        int width = 0;
        int height = 0;
        static std::optional<Atlas> from(const Json& j) {
            Atlas a;
            if (!decode::string(j["src"], a.src) || !decode::integer(j["width"], a.width) || !decode::integer(j["height"], a.height)) return std::nullopt;
            return a;
        }
    };
    Atlas atlas;
    std::vector<Work> works;
    std::vector<OceanTag> tags;
    static std::optional<WorkManifest> from(const Json& j) {
        WorkManifest m;
        if (!decode::value(j["atlas"], m.atlas) || !decode::list(j["works"], m.works) || !decode::list(j["tags"], m.tags)) return std::nullopt;
        return m;
    }
};
}  // namespace

WorkLibrary::WorkLibrary() = default;
WorkLibrary::~WorkLibrary() = default;

std::shared_ptr<WorkLibrary> WorkLibrary::make() {
    // NOTE(port): as in ClipLibrary: the "works" folder is there if its works.json can be read.
    std::string folder = "works";
    std::optional<std::string> data = platform::readText(folder + "/works.json");
    if (!data) return nullptr;
    std::optional<Json> json = Json::parse(*data);
    if (!json) return nullptr;
    std::optional<WorkManifest> manifest = WorkManifest::from(*json);
    if (!manifest) return nullptr;
    std::shared_ptr<WorkLibrary> self(new WorkLibrary());
    self->folder = folder;
    self->atlasURL = platform::resourcePath(folder + "/" + manifest->atlas.src);
    self->atlasSize = {float(manifest->atlas.width), float(manifest->atlas.height)};
    self->works = manifest->works;
    self->tags = manifest->tags;
    return self;
}

std::string WorkLibrary::fullURL(const Work& work) const { return platform::resourcePath(folder + "/" + work.file); }
