// Written by tools/icons.py: do not edit. The icons on the app's buttons, as the lines of their strokes.
//
// From Lucide (https://lucide.dev). ISC License. Copyright (c) for portions of Lucide are held by Cole Bemis
// 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
// Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is
// hereby granted, provided that the above copyright notice and this permission notice appear in all copies.
//
// Each is 24 units square (y down), to be drawn with a stroke 2 units wide, round at its ends and corners.
#pragma once
#include <vector>

namespace icons {
struct Line {
    std::vector<float> xy;      // x, y, x, y, …
    bool closed;
};

inline const std::vector<Line>& pencil() {
    static const std::vector<Line> lines{
        {{21.174f, 6.812f, 21.400f, 6.557f, 21.593f, 6.277f, 21.751f, 5.976f, 21.872f, 5.657f, 21.954f, 5.327f, 21.995f, 4.989f, 21.995f, 4.649f, 21.954f, 4.311f, 21.872f, 3.980f, 21.752f, 3.662f, 21.594f, 3.360f, 21.400f, 3.080f, 21.174f, 2.826f, 20.920f, 2.600f, 20.640f, 2.406f, 20.338f, 2.248f, 20.020f, 2.127f, 19.689f, 2.046f, 19.352f, 2.005f, 19.011f, 2.005f, 18.673f, 2.046f, 18.343f, 2.127f, 18.024f, 2.248f, 17.723f, 2.406f, 17.443f, 2.599f, 17.188f, 2.825f, 3.842f, 16.174f, 3.631f, 16.422f, 3.463f, 16.701f, 3.342f, 17.004f, 2.021f, 21.356f, 2.015f, 21.622f, 2.147f, 21.853f, 2.378f, 21.984f, 2.644f, 21.978f, 6.997f, 20.658f, 7.300f, 20.538f, 7.579f, 20.371f, 7.827f, 20.161f}, true},
        {{15.000f, 5.000f, 19.000f, 9.000f}, false},
    };
    return lines;
}

inline const std::vector<Line>& eraser() {
    static const std::vector<Line> lines{
        {{7.000f, 21.000f, 2.700f, 16.700f, 2.430f, 16.386f, 2.220f, 16.049f, 2.070f, 15.695f, 1.980f, 15.330f, 1.950f, 14.962f, 1.980f, 14.598f, 2.070f, 14.242f, 2.220f, 13.903f, 2.430f, 13.587f, 2.700f, 13.300f, 12.300f, 3.700f, 12.614f, 3.430f, 12.951f, 3.220f, 13.305f, 3.070f, 13.670f, 2.980f, 14.038f, 2.950f, 14.402f, 2.980f, 14.758f, 3.070f, 15.097f, 3.220f, 15.413f, 3.430f, 15.700f, 3.700f, 21.300f, 9.300f, 21.570f, 9.614f, 21.780f, 9.951f, 21.930f, 10.305f, 22.020f, 10.670f, 22.050f, 11.037f, 22.020f, 11.402f, 21.930f, 11.758f, 21.780f, 12.097f, 21.570f, 12.413f, 21.300f, 12.700f, 13.000f, 21.000f}, false},
        {{22.000f, 21.000f, 7.000f, 21.000f}, false},
        {{5.000f, 11.000f, 14.000f, 20.000f}, false},
    };
    return lines;
}

inline const std::vector<Line>& send() {
    static const std::vector<Line> lines{
        {{14.536f, 21.686f, 14.725f, 21.918f, 15.013f, 22.000f, 15.296f, 21.903f, 15.473f, 21.662f, 21.973f, 2.662f, 21.991f, 2.386f, 21.857f, 2.143f, 21.614f, 2.009f, 21.338f, 2.027f, 2.338f, 8.527f, 2.097f, 8.704f, 2.000f, 8.987f, 2.082f, 9.275f, 2.314f, 9.464f, 10.244f, 12.644f, 10.533f, 12.788f, 10.795f, 12.976f, 11.023f, 13.204f, 11.212f, 13.465f, 11.356f, 13.754f}, true},
        {{21.854f, 2.147f, 10.914f, 13.086f}, false},
    };
    return lines;
}

inline const std::vector<Line>& micOff() {
    static const std::vector<Line> lines{
        {{12.000f, 19.000f, 12.000f, 22.000f}, false},
        {{15.000f, 9.340f, 15.000f, 5.000f, 14.978f, 4.653f, 14.915f, 4.310f, 14.814f, 3.977f, 14.674f, 3.659f, 14.499f, 3.358f, 14.290f, 3.080f, 14.050f, 2.828f, 13.783f, 2.605f, 13.491f, 2.415f, 13.180f, 2.260f, 12.852f, 2.142f, 12.513f, 2.062f, 12.168f, 2.023f, 11.820f, 2.024f, 11.474f, 2.065f, 11.136f, 2.145f, 10.809f, 2.265f, 10.498f, 2.421f, 10.207f, 2.613f, 9.941f, 2.836f, 9.702f, 3.090f, 9.494f, 3.369f, 9.320f, 3.670f}, false},
        {{16.950f, 16.950f, 16.701f, 17.187f, 16.441f, 17.411f, 16.170f, 17.623f, 15.889f, 17.821f, 15.599f, 18.004f, 15.300f, 18.174f, 14.993f, 18.328f, 14.679f, 18.468f, 14.358f, 18.591f, 14.032f, 18.699f, 13.701f, 18.791f, 13.366f, 18.866f, 13.027f, 18.925f, 12.686f, 18.967f, 12.344f, 18.992f, 12.000f, 19.001f, 11.657f, 18.992f, 11.314f, 18.967f, 10.973f, 18.925f, 10.634f, 18.866f, 10.299f, 18.791f, 9.968f, 18.699f, 9.642f, 18.591f, 9.321f, 18.468f, 9.007f, 18.328f, 8.700f, 18.174f, 8.401f, 18.005f, 8.111f, 17.821f, 7.830f, 17.623f, 7.559f, 17.411f, 7.299f, 17.187f, 7.050f, 16.950f, 6.813f, 16.701f, 6.589f, 16.441f, 6.377f, 16.170f, 6.180f, 15.889f, 5.996f, 15.599f, 5.826f, 15.300f, 5.672f, 14.993f, 5.533f, 14.679f, 5.409f, 14.358f, 5.301f, 14.032f, 5.210f, 13.701f, 5.134f, 13.366f, 5.076f, 13.027f, 5.034f, 12.686f, 5.008f, 12.343f, 5.000f, 12.000f, 5.000f, 10.000f}, false},
        {{18.890f, 13.230f, 18.938f, 12.925f, 18.972f, 12.617f, 18.993f, 12.309f, 19.000f, 12.000f, 19.000f, 10.000f}, false},
        {{2.000f, 2.000f, 22.000f, 22.000f}, false},
        {{9.000f, 9.000f, 9.000f, 12.000f, 9.019f, 12.336f, 9.076f, 12.667f, 9.169f, 12.990f, 9.298f, 13.301f, 9.461f, 13.595f, 9.655f, 13.869f, 9.879f, 14.119f, 10.130f, 14.343f, 10.405f, 14.538f, 10.699f, 14.700f, 11.009f, 14.829f, 11.332f, 14.922f, 11.664f, 14.978f, 12.000f, 14.997f, 12.335f, 14.979f, 12.667f, 14.922f, 12.990f, 14.829f, 13.301f, 14.701f, 13.595f, 14.538f, 13.869f, 14.344f, 14.120f, 14.120f}, false},
    };
    return lines;
}

inline const std::vector<Line>& x() {
    static const std::vector<Line> lines{
        {{18.000f, 6.000f, 6.000f, 18.000f}, false},
        {{6.000f, 6.000f, 18.000f, 18.000f}, false},
    };
    return lines;
}

// The app's own (not Lucide's): the pen of the marking gesture's diagram.
inline const std::vector<Line>& marker() {
    static const std::vector<Line> lines{
        {{6.857f, 17.439f, 8.416f, 11.846f, 17.455f, 1.000f, 21.115f, 4.051f, 12.077f, 14.897f}, true},
        {{8.416f, 11.846f, 12.077f, 14.897f}, false},
        {{15.195f, 3.712f, 18.856f, 6.762f}, false},
        {{2.885f, 21.853f, 7.298f, 23.000f, 12.594f, 21.588f, 17.890f, 22.735f}, false},
    };
    return lines;
}

}  // namespace icons
