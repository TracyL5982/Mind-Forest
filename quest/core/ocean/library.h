// Port of visionos/MindPalace/Content/ClipLibrary.swift and Content/WorkLibrary.swift.
#pragma once
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "../base.h"
#include "../json.h"
#include "../vecmath.h"
#include "../scene.h"

// NOTE(port): a URL is a std::string here: the path of a file, as platform::resourcePath gives
// it ("" when the file isn't there). A library's `folder` is the folder's name among the
// resources ("clips", "works"), not a path: a file in it is platform::resourcePath(folder + "/" + name).

// NOTE(port): every `from` reads one value as JSONDecoder would and gives nullopt where it
// would throw (see `decode` in catalog.h).

// MARK: - ClipLibrary.swift

// The film scenes, built by library/tools/clips/build.py into library/clips and
// bundled as the "clips" folder: clips.json, atlas.mp4 (every 4 s loop in one
// grid video), and full/<id>.mp4 (30 s clips with sound).

struct ClipTag {
    std::string short_;         // NOTE(port): `short` in the Swift and in clips.json; a C++ keyword
    std::string headline;
    std::string description;
    static std::optional<ClipTag> from(const Json& j);
};

struct FullClipInfo {
    std::string src;
    int width = 0;
    int height = 0;
    double duration = 0;
    static std::optional<FullClipInfo> from(const Json& j);
};

struct Clip {
    int index = 0;
    std::string imdbid;
    std::string title;
    int year = 0;
    std::string genre;
    std::vector<std::string> cast;
    std::string scene;
    float aspect = 0;           // the full clip's picture
    float loopAspect = 0;       // the loop tile's picture
    std::vector<int> tile;      // x, y, w, h in atlas pixels, top-left origin
    FullClipInfo full;
    ClipTag tag;
    /// NOTE(port): added for Quest. What the service's library import says of a film besides (core/cards/pieces.h).
    std::vector<std::string> genres;
    std::string description;
    std::string videoid;
    int id() const { return index; }
    static std::optional<Clip> from(const Json& j);
};

struct AtlasInfo {
    std::string src;
    int width = 0;
    int height = 0;
    double loop = 0;
    double blend = 0;
    static std::optional<AtlasInfo> from(const Json& j);
};

class ClipLibrary {
public:
    std::string folder;
    AtlasInfo atlas;
    std::vector<Clip> clips;

    /// `init?()`
    static std::shared_ptr<ClipLibrary> make();

    std::string atlasURL() const { return url(atlas.src); }
    std::string fullURL(const Clip& clip) const { return url(clip.full.src); }

private:
    ClipLibrary() = default;
    std::string url(const std::string& src) const;

public:
    /// The clip's tile as a UV rect (u0, v0, width, height), v pointing up.
    Vec4 tileUV(const Clip& clip) const;
};

/// Dot color is the film's genre, in pigments from the watercolor reference.
Color genreColor(const std::string& genre);

// MARK: - WorkLibrary.swift

// The museum works, built by scripts/works into public/works and bundled as
// the "works" folder: works.json, atlas.jpg (every work small, in one
// picture, for the ocean) and full/<id>.heic (each work at up to 1600 px,
// for a card and for looking closely).

struct Work {
    int index = 0;
    std::string id;             // the museum and its own number, e.g. "met-436535"
    std::string museum;         // as shown, e.g. "The Met"
    std::string title;
    std::string short_;         // a few words, for a small card. NOTE(port): `short` in the Swift and in works.json; a C++ keyword
    std::string maker;          // may be empty: much of the world's making is unsigned
    std::string date;           // as the museum writes it, e.g. "ca. 1889"
    int year = 0;               // the earliest it can be; BCE is negative
    std::string place;
    std::string medium;
    std::string kind;           // Painting, Print, Photograph, Textile…
    std::string about;          // the museum's own first words on it, if it has any
    std::string url;
    float aspect = 0;
    std::vector<int> tile;      // x, y, w, h in atlas pixels, top-left origin
    std::string file;
    int width = 0;
    int height = 0;

    /// When it was made, short enough for a label.
    std::string when() const;

    /// Museums write 1046 BC as the year -1046.
    static std::string say(int year);

    static std::optional<Work> from(const Json& j);
};

struct OceanTag;        // catalog.h, which the end of this file brings in

class WorkLibrary {
public:
    std::string folder;
    std::string atlasURL;
    Vec2 atlasSize;
    std::vector<Work> works;
    std::vector<OceanTag> tags;

    /// `init?()`
    static std::shared_ptr<WorkLibrary> make();
    ~WorkLibrary();

    std::string fullURL(const Work& work) const;

private:
    WorkLibrary();
};

// The works' manifest carries tags (OceanTag, from Catalog.swift), and the catalog holds clips
// and works: each of the two headers needs the other, so each brings the other in.
#include "catalog.h"
