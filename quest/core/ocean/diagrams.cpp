// Port of visionos/MindPalace/Ocean/Diagrams.swift.
#include "diagrams.h"

#include <algorithm>
#include <cmath>
#include <utility>
#include <vector>

void Diagrams::draw(const std::string& name, CGRect box, Canvas& ctx, Tone tone, float u, const TextAttributes& caption) {
    ctx.saveGState();
    // NOTE(port): `defer { ctx.restoreGState() }`: nothing below leaves early, so it is the last line.
    ctx.setLineWidth(1.6f * u);
    ctx.setLineJoin(Canvas::LineJoin::round);
    ctx.setLineCap(Canvas::LineCap::round);
    Color white = Color::white(1, 0.85f), dim = Color::white(1, 0.32f);
    auto words = [&](const std::string& s, float x, float y) {
        CGSize size = stringSize(s, caption);
        drawString(s, CGPoint{x - size.width / 2, y}, caption);
    };
    float captionHeight = 16 * u;
    CGRect area{box.minX(), box.minY(), box.width(), box.height() - captionHeight - 4 * u};

    if (name == "dollyZoom") {
        // Two frames: the same face, the doorway behind it grown to fill the frame.
        float w = (area.width() - 44 * u) / 2;
        const float grows[] = {0.34f, 0.86f};
        for (int k = 0; k < 2; k++) {
            float grow = grows[k];
            CGRect frame{area.minX() + float(k) * (w + 44 * u), area.minY(), w, area.height()};
            ctx.setStrokeColor(white);
            ctx.stroke(frame);
            CGRect door{frame.midX() - frame.width() * grow / 2, frame.midY() - frame.height() * grow / 2, frame.width() * grow,
                        frame.height() * grow};
            ctx.setStrokeColor(dim);
            for (const std::pair<CGPoint, CGPoint>& line : std::vector<std::pair<CGPoint, CGPoint>>{
                     {CGPoint{frame.minX(), frame.minY()}, CGPoint{door.minX(), door.minY()}},
                     {CGPoint{frame.maxX(), frame.minY()}, CGPoint{door.maxX(), door.minY()}},
                     {CGPoint{frame.minX(), frame.maxY()}, CGPoint{door.minX(), door.maxY()}},
                     {CGPoint{frame.maxX(), frame.maxY()}, CGPoint{door.maxX(), door.maxY()}}}) {
                CGPoint a = line.first, b = line.second;
                ctx.move(a);
                ctx.addLine(b);
            }
            ctx.strokePath();
            ctx.setStrokeColor(color(tone));
            ctx.stroke(door);
            // The face: the same size in both.
            ctx.setFillColor(white);
            float head = 11 * u;
            ctx.fillEllipse(CGRect{frame.midX() - head, frame.maxY() - 52 * u, 2 * head, 2 * head});
            ctx.fill(CGRect{frame.midX() - 19 * u, frame.maxY() - 27 * u, 38 * u, 27 * u});
            words(k == 0 ? "Start" : "End: same face, wider world", frame.midX(), area.maxY() + 5 * u);
        }
        arrow(ctx, CGPoint{area.midX() - 15 * u, area.midY()}, CGPoint{area.midX() + 15 * u, area.midY()}, u, white);

    } else if (name == "rig") {
        // From above: the camera rolls back along its track while its view narrows onto the subject.
        float y = area.midY();
        CGPoint subject{area.maxX() - 26 * u, y};
        ctx.setStrokeColor(dim);
        ctx.setLineDash(0, {5 * u, 5 * u});
        ctx.move(CGPoint{area.minX() + 8 * u, area.maxY() - 6 * u});
        ctx.addLine(CGPoint{area.midX() + 30 * u, area.maxY() - 6 * u});
        ctx.strokePath();
        ctx.setLineDash(0, {});
        const float xs[] = {area.midX() + 10 * u, area.minX() + 30 * u};
        for (int k = 0; k < 2; k++) {
            float x = xs[k];
            float spread = k == 0 ? 0.62f : 0.2f;
            CGPoint cam{x, y};
            ctx.setStrokeColor(k == 0 ? dim : color(tone));
            for (float s : {-1.0f, 1.0f}) {
                ctx.move(cam);
                ctx.addLine(CGPoint{area.maxX(), y + s * (area.maxX() - x) * spread / 2});
            }
            ctx.strokePath();
            ctx.setFillColor(k == 0 ? dim : white);
            ctx.fill(CGRect{x - 16 * u, y - 9 * u, 18 * u, 18 * u});
        }
        ctx.setFillColor(white);
        ctx.fillEllipse(CGRect{subject.x - 8 * u, subject.y - 8 * u, 16 * u, 16 * u});
        arrow(ctx, CGPoint{area.midX() - 14 * u, area.minY() + 10 * u}, CGPoint{area.minX() + 34 * u, area.minY() + 10 * u}, u, white);
        words("Camera rolls back, lens zooms in", area.midX() - 30 * u, area.maxY() + 5 * u);
        words("Subject", subject.x - 4 * u, area.maxY() + 5 * u);

    } else if (name == "frames") {
        // Four things a watcher looks through.
        const char* names[] = {"Window", "Peephole", "Monitor", "Glass"};
        float cell = area.width() / 4;
        for (int k = 0; k < 4; k++) {
            CGPoint c{area.minX() + cell * (float(k) + 0.5f), area.midY()};
            CGRect r{c.x - 30 * u, c.y - 30 * u, 60 * u, 60 * u};
            ctx.setStrokeColor(white);
            switch (k) {
            case 0:
                ctx.stroke(r);
                ctx.move(CGPoint{c.x, r.minY()}); ctx.addLine(CGPoint{c.x, r.maxY()});
                ctx.move(CGPoint{r.minX(), c.y}); ctx.addLine(CGPoint{r.maxX(), c.y});
                ctx.strokePath();
                break;
            case 1:
                ctx.strokeEllipse(r.insetBy(4 * u, 4 * u));
                ctx.strokeEllipse(r.insetBy(18 * u, 18 * u));
                break;
            case 2:
                ctx.stroke(CGRect{r.minX() - 6 * u, r.minY() + 6 * u, 72 * u, 42 * u});
                ctx.move(CGPoint{c.x, r.minY() + 48 * u}); ctx.addLine(CGPoint{c.x, r.maxY()});
                ctx.move(CGPoint{c.x - 14 * u, r.maxY()}); ctx.addLine(CGPoint{c.x + 14 * u, r.maxY()});
                ctx.strokePath();
                break;
            default:
                ctx.stroke(r.insetBy(6 * u, 0));
                ctx.setStrokeColor(dim);
                ctx.move(CGPoint{r.minX() + 14 * u, r.maxY() - 12 * u}); ctx.addLine(CGPoint{r.maxX() - 22 * u, r.minY() + 10 * u});
                ctx.strokePath();
                break;
            }
            // The watcher, in the note's color.
            ctx.setFillColor(color(tone));
            ctx.fillEllipse(CGRect{c.x - 5 * u + (k == 0 ? 15 * u : 0), c.y - 5 * u + (k == 0 ? -15 * u : 0), 10 * u, 10 * u});
            words(names[k], c.x, area.maxY() + 5 * u);
        }

    } else if (name == "lenses") {
        // From above: a long lens sees a sliver, a wide lens sees the room.
        float half = area.width() / 2;
        const float spreads[] = {0.16f, 0.95f};
        for (int k = 0; k < 2; k++) {
            float spread = spreads[k];
            CGPoint cam{area.minX() + float(k) * half + 14 * u, area.midY()};
            float far = area.minX() + float(k + 1) * half - 22 * u;
            ctx.setStrokeColor(color(tone));
            for (float s : {-1.0f, 1.0f}) {
                ctx.move(cam);
                ctx.addLine(CGPoint{far, cam.y + s * (far - cam.x) * spread / 2});
            }
            ctx.strokePath();
            ctx.setFillColor(white);
            ctx.fill(CGRect{cam.x - 12 * u, cam.y - 8 * u, 14 * u, 16 * u});
            // Three things in a row: pressed together, or strung out.
            for (int j = 0; j < 3; j++) {
                float t = float(j) / 2;
                float x = k == 0 ? far - 30 * u + t * 22 * u : cam.x + 46 * u + t * (far - cam.x - 58 * u);
                float d = (k == 0 ? 7 : 5 + (1 - t) * 6) * u;
                ctx.fillEllipse(CGRect{x - d, cam.y - d, 2 * d, 2 * d});
            }
            words(k == 0 ? "Long lens: pressed flat" : "Wide lens: strung out", area.minX() + (float(k) + 0.5f) * half, area.maxY() + 5 * u);
        }

    } else {
    }
    ctx.restoreGState();
}

void Diagrams::arrow(Canvas& ctx, CGPoint a, CGPoint b, float u, Color color) {
    ctx.setStrokeColor(color);
    ctx.move(a);
    ctx.addLine(b);
    CGPoint d{b.x - a.x, b.y - a.y};
    float l = std::max(1.f, std::hypot(d.x, d.y));
    CGPoint n{d.x / l, d.y / l};
    for (float s : {-1.0f, 1.0f}) {
        ctx.move(b);
        ctx.addLine(CGPoint{b.x - n.x * 7 * u - s * n.y * 5 * u, b.y - n.y * 7 * u + s * n.x * 5 * u});
    }
    ctx.strokePath();
}
