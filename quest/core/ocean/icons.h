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
