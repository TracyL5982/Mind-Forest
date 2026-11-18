// The small diagrams drawn on notes.
#pragma once
#include <string>

#include "../canvas.h"
#include "stage.h"

/// The small drawings some notes carry, so a glance gets the idea before the
/// words do. Line drawings in white, with the note's color on the one thing
/// that matters.
struct Diagrams {
    /// `draw(_:in:ctx:tone:unit:caption:)`
    static void draw(const std::string& name, CGRect box, Canvas& ctx, Tone tone, float u, const TextAttributes& caption);

private:
    static void arrow(Canvas& ctx, CGPoint a, CGPoint b, float u, Color color);
};
