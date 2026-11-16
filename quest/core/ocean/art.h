// Port of visionos/MindPalace/Ocean/Art.swift, Notes.swift and Works.swift.
// All three are `Art` (the last two extend it) and the small types beside it;
// each file's functions are in their own .cpp: art.cpp, notes.cpp, works.cpp.
//
// NOTE(port): UIKit's drawing is canvas.h. A `CGContext` is a `Canvas&`; a `UIFont` is a `Font`;
// a dictionary of text attributes is a `TextAttributes`; an `(s as NSString).draw(...)` is
// `drawString(s, ...)` and `.size(withAttributes:)` is `stringSize(s, ...)`.
// NOTE(port): the fonts are the host's (SF on the Mac, Roboto on the Quest), so words are not as
// wide as on visionOS. Nothing here assumes a width: every size is measured, as in the Swift.
// NOTE(port): a function with defaulted arguments before its last ones (`piece`, `attributes`,
// `label`, `text`, `line`) takes them in the Swift's order; a call that skips one writes its default.
#pragma once
#include <cmath>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "../base.h"
#include "../vecmath.h"
#include "../scene.h"
#include "../canvas.h"
#include "stage.h"
#include "library.h"
#include "catalog.h"
#include "tree.h"

// MARK: - Art.swift

/// A drawn piece of a card: its texture, its size in meters, and where its
/// middle sits from the card's origin.
struct Piece {
    TextureRef texture;
    Vec2 size;
    Vec2 offset = Vec2::zero();
};

// MARK: - Notes.swift

// NOTE(port): TextBlock and NoteLayout open Notes.swift; they stand here, before Art, because a
// C++ class has to see the types its functions name.

/// A run of wrapped text on an open note, laid out once and kept: the same
/// layout draws the words and later says which of them a hand marked.
class TextBlock {
public:
    const std::string string;
    const CGPoint origin;               // its top-left corner on the note, in pixels

private:
    // NOTE(port): `storage`, `manager` and `container` (NSTextStorage, NSLayoutManager,
    // NSTextContainer) are one TextLayout: no side padding, at most `lines` lines, the last
    // ending in an ellipsis if the string goes on.
    const TextLayout layout;

public:
    const float height;

    TextBlock(const std::string& string, CGPoint origin, float width, int lines, const TextAttributes& attributes);

    float width() const;

    void draw() const;

    CGRect frame() const;

    /// The words between two points on the note (pixels), whole words only,
    /// with the rectangles that cover them line by line.
    struct Words {
        std::string text;
        std::vector<CGRect> rects;
    };
    std::optional<Words> words(CGPoint a, CGPoint b) const;
};

/// Where everything sits on an open note, in pixels from its top-left.
struct NoteLayout {
    CGSize size;
    std::optional<CGRect> picture;                      // an image or a video's frame
    std::vector<std::shared_ptr<TextBlock>> blocks;     // the text that can be marked
    std::vector<std::function<void(Canvas&)>> draw;

    /// A point on the note in pixels to a point on the card in meters (its middle is the origin, y up).
    Vec2 meters(CGPoint p) const;

    CGPoint pixels(Vec2 m) const;
};

// MARK: - Art.swift

/// Draws everything that has words on it. Flat rectangles only: a picture, a
/// dark label, a colored label, in the manner of the reference film. Every
/// texture is opaque rectangles on clear, so it's cut out, never blended.
class Art {
public:
    static constexpr float ppm = 2000;                          // texture pixels per meter
    static constexpr Color ink = Color::hex(0x0B0D11);          // the dark of labels and panels
    static constexpr Color paper = Color::hex(0xF4F1EA);
    static constexpr Color hot = Color::hex(0xFF5A36);          // the one accent: where you are, what you marked, what you send

    /// The five sizes of type, m. Nothing is set smaller than `micro`:
    /// under a centimeter, words can't be read from where you stand.
    struct Size {
        static constexpr float micro = 0.011f;          // kickers and tabs, in capitals
        static constexpr float label = 0.0125f;         // tags, names under pictures, questions, buttons
        static constexpr float body = 0.0135f;          // sentences
        static constexpr float lead = 0.016f;           // the one line to take away; a brief
        static constexpr float title = 0.024f;          // an open card's headline
    };
    /// The room words keep inside a flat label, m: side, and top and bottom.
    static constexpr Vec2 pad{0.006f, 0.0035f};
    static constexpr Vec2 buttonPad{0.01f, 0.007f};

    std::vector<Clip> clips;
    ImageRef atlas;
    TextureRef atlasTexture;
    Vec2 atlasSize;

private:
    std::map<std::string, Piece> cache;

public:
    // The museum works (Works.swift): their library, and every one of them small in one picture.
    std::shared_ptr<WorkLibrary> workLibrary;
    ImageRef workAtlas;
    TextureRef workAtlasTexture;
    std::optional<Material> workMaterial;
    const std::vector<Work>& works() const;

    /// `init?(library:)`
    static std::shared_ptr<Art> make(const std::shared_ptr<ClipLibrary>& library);

private:
    Art() = default;

    float stillScale = 1;

public:
    // MARK: - Building blocks

    float px(float m) const { return std::round(m * ppm); }

    Font font(float m, Font::Weight weight) const { return Font::systemFont(m * ppm, weight); }

    /// `piece(_:width:height:ppm:offset:draw:)`. `ppm` and `offset` have defaults in the Swift and
    /// the closure comes last, so the shorter forms are written out.
    std::optional<Piece> piece(const std::optional<std::string>& key, float width, float height, float ppm, Vec2 offset,
                               const std::function<void(Canvas&, CGSize)>& draw);
    std::optional<Piece> piece(const std::optional<std::string>& key, float width, float height,
                               const std::function<void(Canvas&, CGSize)>& draw) {
        return piece(key, width, height, Art::ppm, Vec2::zero(), draw);
    }
    std::optional<Piece> piece(const std::optional<std::string>& key, float width, float height, Vec2 offset,
                               const std::function<void(Canvas&, CGSize)>& draw) {
        return piece(key, width, height, Art::ppm, offset, draw);
    }
    std::optional<Piece> piece(const std::optional<std::string>& key, float width, float height, float ppm,
                               const std::function<void(Canvas&, CGSize)>& draw) {
        return piece(key, width, height, ppm, Vec2::zero(), draw);
    }

    TextAttributes attributes(Font font, Color color, float kern = 0, std::optional<float> lineHeight = std::nullopt,
                              bool truncate = false) const;

    float width(const std::string& text, Font font, float kern = 0) const;

    /// One flat label: a rectangle hugging one line of text. Returns its size.
    CGSize label(const std::string& text, CGPoint p, Font font, Color fg, Color bg, float padX, float padY,
                 float maxWidth = INFINITY, bool draw = true) const;

    /// Wrapped text. Returns the height it took.
    float text(const std::string& string, CGRect rect, Font font, Color color, float lineHeight, float kern = 0,
               bool draw = true) const;

    void still(const Clip& clip, CGRect rect) const;

    // MARK: - Films

    Vec2 filmSize(const Clip& clip, bool open) const;

    /// A film, small: its picture and its title. The card's origin is the
    /// middle of the picture. (Why it is here rides on its thread.)
    std::optional<Piece> filmSmall(const Clip& clip);

    /// What sits under an open film: one panel the picture's width, built
    /// like a note. Why it is here, its title and year, and what happens
    /// in the scene.
    std::optional<Piece> filmCaption(const Clip& clip, const std::string& why, Tone tone);

    /// A film lifted out of the ocean far enough to see what it is: picture,
    /// title, scene, and its tags as flat labels. Origin: the picture's middle.
    std::optional<Piece> filmPeek(const Clip& clip, const std::vector<OceanTag>& tags);

    // MARK: - Tags

    float chipWidth(const std::string& name) const;

    /// A tag: one flat colored label.
    std::optional<Piece> chip(const OceanTag& tag);

    /// A tag in focus: the same label, large, and what it gathers.
    std::optional<Piece> tagOpen(const OceanTag& tag);

    // MARK: - The path, the strip, the shelf

    /// A step's number, on the first card of the layer you work on.
    std::optional<Piece> badge(int n, bool current);

    /// On a card that holds a folded layer: two sheets, one over the other.
    std::optional<Piece> foldBadge();

    /// An earlier step of the path, as it shows from the layers above: its
    /// number and a few words, large enough to read from there. The same
    /// number-and-name the step cards carry.
    std::optional<Piece> stepLabel(int n, const std::string& words);
    // NOTE(port): added for Quest (the guide, oceanmodel_guide.cpp). What greets you after the welcome tree's
    // walk stands free in the room, on no ground of its own: `lettering`, a word in the display face (Fraunces),
    // white and large; `plain`, a line of the usual face, white (or dimmed), likewise on nothing; and `way`, one of the
    // ways to begin: its number on a disc of the accent beside its name, and a line under them. Each is `size`
    // metres of type and is made coarse enough to be large (`ppm` pixels a metre). Then a button: words on a
    // rounded ground.
    std::optional<Piece> lettering(const std::string& word, float size, float ppm = 900);
    std::optional<Piece> plain(const std::string& words, float size, Font::Weight weight, float alpha = 1, float ppm = 1200);
    std::optional<Piece> way(int number, const std::string& name, const std::string& note, float size, float ppm = 1200);
    std::optional<Piece> pill(const std::string& words, float size, Color ground = hot);
    // NOTE(port): added for Quest. A button that is an icon (icons.h: "marker", "eraser", "send") on a rounded
    // square `size` metres across, the icon in `mark` on `ground`.
    std::optional<Piece> iconButton(const std::string& icon, float size, Color ground, Color mark);

    /// Any one-line flat label.
    std::optional<Piece> line(const std::string& words, float size, Font::Weight weight = Font::Weight::medium, Color fg = Color::white(),
                              Color bg = Art::ink, Vec2 pad = Art::pad);

    /// A small heading in capitals on its color: it names the lines under it, once.
    std::optional<Piece> heading(const std::string& words, Tone tone);

    /// The gardener's line you can pick: a brief, in quotes.
    std::optional<Piece> brief(const std::string& words);

    /// One line under an open card that can be picked: a question for the gardener, or something to do.
    std::optional<Piece> row(const std::string& words);

    /// An empty frame with a label: where a pressed tree lands on its way out.
    std::optional<Piece> tray(const std::string& words);

    // MARK: - A pressed tree

    struct PressedItem {
        Ref ref;
        Vec2 center;                    // 0…1 across the card, y down
        float width;                    // share of the card's width
        std::optional<int> step;        // its number on the path
        std::optional<int> parent;      // index of the item it hangs from
    };

    /// What stands under a tree's cover on the shelf: its name, who made it,
    /// and whether it has been sent, as flat labels side by side.
    std::optional<Piece> coverCaption(const std::string& title, Maker maker, bool sent);

private:
    /// Paints a tree's items into a box: threads first, then the least
    /// important items, so the path's steps end on top.
    void paint(const std::vector<PressedItem>& items, float w, float h, Canvas& ctx, const std::shared_ptr<Catalog>& catalog) const;

public:
    /// One layer of a tree as a small picture: the step, large, with what
    /// hangs from it around it. For the stack of steps under the tree.
    ImageRef layerImage(const std::vector<PressedItem>& items, const std::shared_ptr<Catalog>& catalog) const;

    /// One step of the path as a picture that fills its card: the layer's
    /// first card, as large as it goes. A film or a picture fills the frame;
    /// a note is its headline; a tag is its label. `more` is how many other
    /// cards the layer holds.
    ImageRef stepImage(const Ref& ref, const std::shared_ptr<Catalog>& catalog, int more) const;

    // NOTE(port): `blurContext` (a CIContext) has nothing to stand for it: the blur is canvas.h's gaussianBlur.

    /// The same picture, out of focus: how a card under glass looks.
    ImageRef blurred(const ImageRef& image) const;

    // MARK: - Meshes and materials

    Material material(const TextureRef& texture, float white = 1) const;

    /// A flat rectangle showing a piece, set where the piece belongs.
    EntityRef quad(const Piece& piece) const;

    /// Shows the same piece dimmer (a suggestion) or at full brightness, never see-through.
    void shade(const EntityRef& quad, const TextureRef& texture, float dim) const;

    /// `private(set) lazy var atlasMaterial`: made the first time it is asked for.
    Material atlasMaterial();

private:
    std::optional<Material> atlasLook;

public:
    /// A picture read at the size it shows. An atlas keeps every picture at
    /// each smaller size as well; drawn small (a piece on the ocean, some
    /// twenty pixels wide), it is read from the copy nearest that size, a
    /// few texels a pixel, not from the full one, which costs the GPU
    /// more and shimmers. Said here outright, so it doesn't rest on a default.
    static TextureRef sized(const TextureRef& texture);

    /// A rectangle showing one film's still, cut from the atlas.
    MeshRef stillMesh(const Clip& clip, Vec2 size) const;

    // MARK: - Notes.swift

    // Notes: every card that is led by words. A text note, a picture, a video,
    // a chart and a link are all one card with a different middle.
private:
    static std::map<std::string, ImageRef> pictures;
    static std::map<std::string, NoteLayout> layouts;

public:
    /// A picture kept in the app (any file among its resources), by name.
    ImageRef picture(const std::string& name) const;

private:
    /// Draws a note's picture: a file of its own, or a film's still.
    void drawPicture(const OceanNote& note, CGRect rect) const;

    std::string kickerWords(const OceanNote& note) const;

public:
    // MARK: Small

    /// The body of a note, small: a picture for the notes that have one, a panel for the rest.
    Vec2 noteSmallSize(const OceanNote& note, const std::shared_ptr<Catalog>& catalog) const;

    std::optional<Piece> noteSmall(const OceanNote& note, const std::shared_ptr<Catalog>& catalog);

    // MARK: Open

    /// Where an open note's parts sit. Worked out once per note.
    NoteLayout noteLayout(const OceanNote& note, const std::shared_ptr<Catalog>& catalog) const;

    /// A note, open.
    std::optional<Piece> noteOpen(const OceanNote& note, const std::shared_ptr<Catalog>& catalog);

    /// Bars, flat: one per value, the one the note is about in its color.
    /// With `labels`, each bar carries its value above and its name below.
    void bars(const ChartSpec& chart, CGRect box, Canvas& ctx, Tone tone, const std::optional<TextAttributes>& labels) const;

    // MARK: Marks

    /// The outline of a circled part of a picture, drawn at its own size so the line stays even.
    std::optional<Piece> ring(Vec2 size);

    /// A flat rectangle of one color: a highlighter stroke (see-through) or a timeline's bar.
    EntityRef swatch(Color color, Vec2 size, float opacity = 1) const;

    // MARK: Glow

private:
    static std::optional<Material> glowMaterial;

    /// One small picture of a soft rectangle of light, stretched to fit any
    /// card: bright along the card's edge, gone within two centimeters.
    std::optional<Material> glowLook() const;

public:
    /// A soft edge of light for a card whose face is `size`. Its corners
    /// keep their shape whatever the card's proportions: only the
    /// stretches between them are stretched.
    EntityRef glow(Vec2 size) const;

    /// The light that comes up around a card while it is looked at: a band
    /// from the card's edge outward, strongest at the edge. Nothing lies over
    /// the card itself, so what it shows stays clear.
    EntityRef gazeRim(Vec2 size, const std::optional<Material>& material) const;

    /// How a card in the tree answers being looked at: light around it, none on it.
    static Hover gaze() { return Hover::shader(); }

    /// How anything else answers being looked at: plainly brighter, so there is no
    /// doubt which one a pinch will land on.
    static Hover hover() { return Hover::highlight(Color::hex(0xFFE2A8), 2.4f); }

    // MARK: - Works.swift

    // Museum works: the ocean's other kind of piece. A work is a still picture
    // with what the museum knows of it. Small, it is drawn like a film; open,
    // its picture is its own full-size texture, so it can be looked into.

    /// Takes the works' atlas: every work small, in one picture.
    void hold(const std::shared_ptr<WorkLibrary>& library);

private:
    /// A work's place in the atlas, in the atlas picture's own pixels.
    std::optional<CGRect> tile(const Work& work) const;

public:
    /// Draws a work from the atlas: quick, and only good small.
    void thumb(const Work& work, CGRect rect) const;

    /// A work's picture read from its own file, no larger than `pixels` on its long side.
    ImageRef picture(const Work& work, int pixels) const;

    static ImageRef read(const std::string& url, std::optional<int> pixels);

private:
    /// Draws a work from its file where there is one, from the atlas otherwise.
    void drawPicture(const Work& work, CGRect rect) const;

public:
    /// The work's picture at full size, read and made off the main thread's time.
    TextureRef fullTexture(const Work& work) const;
    // NOTE(port): added for Quest. Unpacking a work's own file takes several frames' time on the
    // headset's chip, so both sizes can be asked for ahead (on a background thread) and waited for:
    // the full picture an open work shows, and the small one a small card draws.
    /// Where a work's picture is read from when it is wanted no larger than `pixels`, and the size to ask
    /// the file for (0: as it is). Up to 520 px that is a small copy made for the headset
    /// ("works-small/<id>.jpg", 512 px, by tools/push_media.sh) where there is one: unpacking the 1600 px
    /// original for a card a few centimetres wide costs the headset about 55 ms a picture.
    struct Source {
        std::string url;
        int maxPixel = 0;
    };
    Source pictureSource(const Work& work, int pixels) const;
    /// Whether the work's full picture is unpacked and waiting; asks for it if it has not been.
    bool fullReady(const Work& work) const;
    /// The same for the picture `workSmall` draws.
    bool smallReady(const Work& work) const;

    // MARK: Sizes

    /// A work's picture, m. Works come in every shape, so each is given the
    /// same area and keeps its own proportions, within what a card can be.
    Vec2 workPicture(const Work& work, bool open) const;

    /// The open card's top part: the picture, on a dark mount where it is
    /// narrower than its caption needs.
    Vec2 workOpenBody(const Work& work) const;

    // MARK: Cards

    /// A work, small: its picture and a few words. Origin: the picture's middle.
    std::optional<Piece> workSmall(const Work& work);

    /// What sits under an open work: why it is here and where it is kept,
    /// its title, then who made it and when, where, and of what.
    std::optional<Piece> workCaption(const Work& work, const std::string& why, Tone tone);

    /// How wide the picture is on a work lifted for a look, m.
    float workPeekWidth(const Work& work) const;

    /// A work lifted out of the ocean far enough to see what it is: picture,
    /// title, when and by whom, and its tags. Origin: the picture's middle.
    std::optional<Piece> workPeek(const Work& work, const std::vector<OceanTag>& tags);

    // MARK: Meshes

    std::optional<Material> workAtlasMaterial();

    /// A rectangle showing one work, cut from the atlas.
    MeshRef workMesh(const Work& work, Vec2 size) const;

    /// A plain picture, as an open work shows it.
    Material pictureMaterial(const TextureRef& texture) const;
};
