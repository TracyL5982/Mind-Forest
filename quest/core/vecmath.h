// Vector math for the Quest app: the handful of simd types and functions the
// scene uses.
//
//   Vec2, Vec3, Vec4, Quat, Mat3, Mat4
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>

/// Pi as a float: the float just below pi (float(M_PI) rounds to the one just above).
constexpr float floatPi = 0x1.921fb4p+1f;

struct Vec2 {
    float x = 0, y = 0;
    constexpr Vec2() = default;
    constexpr Vec2(float x, float y) : x(x), y(y) {}
    static constexpr Vec2 repeating(float v) { return {v, v}; }
    static constexpr Vec2 zero() { return {0, 0}; }
    static constexpr Vec2 one() { return {1, 1}; }
    float& operator[](int i) { return i == 0 ? x : y; }
    float operator[](int i) const { return i == 0 ? x : y; }
    float min() const { return std::min(x, y); }
    float max() const { return std::max(x, y); }
};

struct Vec3 {
    float x = 0, y = 0, z = 0;
    constexpr Vec3() = default;
    constexpr Vec3(float x, float y, float z) : x(x), y(y), z(z) {}
    constexpr Vec3(Vec2 v, float z) : x(v.x), y(v.y), z(z) {}
    static constexpr Vec3 repeating(float v) { return {v, v, v}; }
    static constexpr Vec3 zero() { return {0, 0, 0}; }
    static constexpr Vec3 one() { return {1, 1, 1}; }
    float& operator[](int i) { return i == 0 ? x : i == 1 ? y : z; }
    float operator[](int i) const { return i == 0 ? x : i == 1 ? y : z; }
    float min() const { return std::min(x, std::min(y, z)); }
    float max() const { return std::max(x, std::max(y, z)); }
    Vec2 xy() const { return {x, y}; }
};

struct Vec4 {
    float x = 0, y = 0, z = 0, w = 0;
    constexpr Vec4() = default;
    constexpr Vec4(float x, float y, float z, float w) : x(x), y(y), z(z), w(w) {}
    constexpr Vec4(Vec3 v, float w) : x(v.x), y(v.y), z(v.z), w(w) {}
    static constexpr Vec4 zero() { return {0, 0, 0, 0}; }
    float& operator[](int i) { return i == 0 ? x : i == 1 ? y : i == 2 ? z : w; }
    float operator[](int i) const { return i == 0 ? x : i == 1 ? y : i == 2 ? z : w; }
    Vec3 xyz() const { return {x, y, z}; }
};

inline Vec2 operator+(Vec2 a, Vec2 b) { return {a.x + b.x, a.y + b.y}; }
inline Vec2 operator-(Vec2 a, Vec2 b) { return {a.x - b.x, a.y - b.y}; }
inline Vec2 operator*(Vec2 a, Vec2 b) { return {a.x * b.x, a.y * b.y}; }
inline Vec2 operator/(Vec2 a, Vec2 b) { return {a.x / b.x, a.y / b.y}; }
inline Vec2 operator*(Vec2 a, float s) { return {a.x * s, a.y * s}; }
inline Vec2 operator*(float s, Vec2 a) { return {a.x * s, a.y * s}; }
inline Vec2 operator/(Vec2 a, float s) { return {a.x / s, a.y / s}; }
inline Vec2 operator-(Vec2 a) { return {-a.x, -a.y}; }
inline Vec2& operator+=(Vec2& a, Vec2 b) { return a = a + b; }
inline Vec2& operator-=(Vec2& a, Vec2 b) { return a = a - b; }
inline Vec2& operator*=(Vec2& a, Vec2 b) { return a = a * b; }
inline Vec2& operator*=(Vec2& a, float s) { return a = a * s; }
inline Vec2& operator/=(Vec2& a, float s) { return a = a / s; }
inline bool operator==(Vec2 a, Vec2 b) { return a.x == b.x && a.y == b.y; }
inline bool operator!=(Vec2 a, Vec2 b) { return !(a == b); }

inline Vec3 operator+(Vec3 a, Vec3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline Vec3 operator-(Vec3 a, Vec3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 operator*(Vec3 a, Vec3 b) { return {a.x * b.x, a.y * b.y, a.z * b.z}; }
inline Vec3 operator/(Vec3 a, Vec3 b) { return {a.x / b.x, a.y / b.y, a.z / b.z}; }
inline Vec3 operator*(Vec3 a, float s) { return {a.x * s, a.y * s, a.z * s}; }
inline Vec3 operator*(float s, Vec3 a) { return {a.x * s, a.y * s, a.z * s}; }
inline Vec3 operator/(Vec3 a, float s) { return {a.x / s, a.y / s, a.z / s}; }
inline Vec3 operator-(Vec3 a) { return {-a.x, -a.y, -a.z}; }
inline Vec3& operator+=(Vec3& a, Vec3 b) { return a = a + b; }
inline Vec3& operator-=(Vec3& a, Vec3 b) { return a = a - b; }
inline Vec3& operator*=(Vec3& a, Vec3 b) { return a = a * b; }
inline Vec3& operator*=(Vec3& a, float s) { return a = a * s; }
inline Vec3& operator/=(Vec3& a, float s) { return a = a / s; }
inline bool operator==(Vec3 a, Vec3 b) { return a.x == b.x && a.y == b.y && a.z == b.z; }
inline bool operator!=(Vec3 a, Vec3 b) { return !(a == b); }

inline Vec4 operator+(Vec4 a, Vec4 b) { return {a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w}; }
inline Vec4 operator-(Vec4 a, Vec4 b) { return {a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w}; }
inline Vec4 operator*(Vec4 a, float s) { return {a.x * s, a.y * s, a.z * s, a.w * s}; }
inline bool operator==(Vec4 a, Vec4 b) { return a.x == b.x && a.y == b.y && a.z == b.z && a.w == b.w; }

inline float dot(Vec2 a, Vec2 b) { return a.x * b.x + a.y * b.y; }
inline float dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline float dot(Vec4 a, Vec4 b) { return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w; }
inline Vec3 cross(Vec3 a, Vec3 b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
inline float length_squared(Vec2 a) { return dot(a, a); }
inline float length_squared(Vec3 a) { return dot(a, a); }
inline float length(Vec2 a) { return std::sqrt(dot(a, a)); }
inline float length(Vec3 a) { return std::sqrt(dot(a, a)); }
/// simd's normalize: a zero vector gives NaN there; callers in the sources guard for it, so this does not.
inline Vec2 normalize(Vec2 a) { return a / length(a); }
inline Vec3 normalize(Vec3 a) { return a / length(a); }
inline float distance(Vec2 a, Vec2 b) { return length(a - b); }     // simd_distance
inline float distance(Vec3 a, Vec3 b) { return length(a - b); }
inline Vec2 vmin(Vec2 a, Vec2 b) { return {std::min(a.x, b.x), std::min(a.y, b.y)}; }                       // simd_min
inline Vec2 vmax(Vec2 a, Vec2 b) { return {std::max(a.x, b.x), std::max(a.y, b.y)}; }                       // simd_max
inline Vec3 vmin(Vec3 a, Vec3 b) { return {std::min(a.x, b.x), std::min(a.y, b.y), std::min(a.z, b.z)}; }
inline Vec3 vmax(Vec3 a, Vec3 b) { return {std::max(a.x, b.x), std::max(a.y, b.y), std::max(a.z, b.z)}; }
inline float clamp(float v, float lo, float hi) { return std::min(std::max(v, lo), hi); }                   // simd_clamp
inline Vec2 clamp(Vec2 v, Vec2 lo, Vec2 hi) { return vmin(vmax(v, lo), hi); }
inline Vec3 clamp(Vec3 v, Vec3 lo, Vec3 hi) { return vmin(vmax(v, lo), hi); }
inline float mix(float a, float b, float t) { return a + (b - a) * t; }                                     // simd_mix
inline Vec2 mix(Vec2 a, Vec2 b, float t) { return a + (b - a) * t; }
inline Vec3 mix(Vec3 a, Vec3 b, float t) { return a + (b - a) * t; }
inline Vec2 vabs(Vec2 a) { return {std::fabs(a.x), std::fabs(a.y)}; }
inline Vec3 vabs(Vec3 a) { return {std::fabs(a.x), std::fabs(a.y), std::fabs(a.z)}; }
/// simd_smoothstep(edge0, edge1, x)
inline float smoothstep(float e0, float e1, float x) {
    float t = clamp((x - e0) / (e1 - e0), 0.f, 1.f);
    return t * t * (3 - 2 * t);
}

struct Mat3 {
    Vec3 columns[3] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};
    constexpr Mat3() = default;
    /// simd_float3x3(columns: (a, b, c))
    constexpr Mat3(Vec3 a, Vec3 b, Vec3 c) : columns{a, b, c} {}
};
inline Vec3 operator*(const Mat3& m, Vec3 v) { return m.columns[0] * v.x + m.columns[1] * v.y + m.columns[2] * v.z; }

/// simd_quatf: `imag` is (ix, iy, iz) and `real` is r.
struct Quat {
    Vec3 imag;
    float real = 1;
    constexpr Quat() = default;
    constexpr Quat(float ix, float iy, float iz, float r) : imag(ix, iy, iz), real(r) {}
    static Quat identity() { return {}; }
    /// simd_quatf(angle:axis:); the axis must be a unit vector.
    static Quat angleAxis(float angle, Vec3 axis) {
        float s = std::sin(angle / 2);
        return {axis.x * s, axis.y * s, axis.z * s, std::cos(angle / 2)};
    }
    /// simd_quatf(simd_float3x3): from a rotation matrix.
    explicit Quat(const Mat3& m) {
        const Vec3 &a = m.columns[0], &b = m.columns[1], &c = m.columns[2];
        float trace = a.x + b.y + c.z;
        if (trace > 0) {
            float s = std::sqrt(trace + 1) * 2;
            real = s / 4;
            imag = {(b.z - c.y) / s, (c.x - a.z) / s, (a.y - b.x) / s};
        } else if (a.x > b.y && a.x > c.z) {
            float s = std::sqrt(1 + a.x - b.y - c.z) * 2;
            real = (b.z - c.y) / s;
            imag = {s / 4, (b.x + a.y) / s, (c.x + a.z) / s};
        } else if (b.y > c.z) {
            float s = std::sqrt(1 + b.y - a.x - c.z) * 2;
            real = (c.x - a.z) / s;
            imag = {(b.x + a.y) / s, s / 4, (c.y + b.z) / s};
        } else {
            float s = std::sqrt(1 + c.z - a.x - b.y) * 2;
            real = (a.y - b.x) / s;
            imag = {(c.x + a.z) / s, (c.y + b.z) / s, s / 4};
        }
    }
    /// simd_quatf(from:to:): the shortest turn that takes unit vector `from` to unit vector `to`.
    static Quat fromTo(Vec3 from, Vec3 to) {
        float d = dot(from, to);
        if (d > 0.999999f) return {};
        if (d < -0.999999f) {
            Vec3 axis = cross(Vec3(1, 0, 0), from);
            if (length(axis) < 1e-4f) axis = cross(Vec3(0, 1, 0), from);
            return angleAxis(float(M_PI), normalize(axis));
        }
        Vec3 c = cross(from, to);
        Quat q{c.x, c.y, c.z, 1 + d};
        return q.normalized();
    }
    Quat normalized() const {
        float n = std::sqrt(dot(imag, imag) + real * real);
        return n > 0 ? Quat{imag.x / n, imag.y / n, imag.z / n, real / n} : Quat{};
    }
    Quat conjugate() const { return {-imag.x, -imag.y, -imag.z, real}; }
    Quat inverse() const { return conjugate(); }        // unit quaternions only, as everywhere in the sources
    /// Rotates a vector: simd_act / q.act(v).
    Vec3 act(Vec3 v) const {
        Vec3 t = cross(imag, v) * 2;
        return v + t * real + cross(imag, t);
    }
    float angle() const { return 2 * std::atan2(length(imag), real); }
    Vec3 axis() const {
        float n = length(imag);
        return n > 1e-8f ? imag / n : Vec3{0, 0, 1};
    }
    Mat3 matrix() const { return {act({1, 0, 0}), act({0, 1, 0}), act({0, 0, 1})}; }
};
inline Quat operator*(Quat a, Quat b) {
    Vec3 v = cross(a.imag, b.imag) + b.imag * a.real + a.imag * b.real;
    return {v.x, v.y, v.z, a.real * b.real - dot(a.imag, b.imag)};
}
/// simd_slerp: the short way round.
inline Quat slerp(Quat a, Quat b, float t) {
    float d = dot(a.imag, b.imag) + a.real * b.real;
    if (d < 0) {
        b = {-b.imag.x, -b.imag.y, -b.imag.z, -b.real};
        d = -d;
    }
    if (d > 0.9995f) {
        Quat q{a.imag.x + (b.imag.x - a.imag.x) * t, a.imag.y + (b.imag.y - a.imag.y) * t,
               a.imag.z + (b.imag.z - a.imag.z) * t, a.real + (b.real - a.real) * t};
        return q.normalized();
    }
    float th = std::acos(d), s = std::sin(th);
    float wa = std::sin((1 - t) * th) / s, wb = std::sin(t * th) / s;
    return {a.imag.x * wa + b.imag.x * wb, a.imag.y * wa + b.imag.y * wb, a.imag.z * wa + b.imag.z * wb,
            a.real * wa + b.real * wb};
}

struct Mat4 {
    Vec4 columns[4] = {{1, 0, 0, 0}, {0, 1, 0, 0}, {0, 0, 1, 0}, {0, 0, 0, 1}};
    constexpr Mat4() = default;
    constexpr Mat4(Vec4 a, Vec4 b, Vec4 c, Vec4 d) : columns{a, b, c, d} {}
    static Mat4 identity() { return {}; }       // matrix_identity_float4x4
    /// Scale, then rotate, then move: what Transform(scale:rotation:translation:).matrix gives.
    static Mat4 trs(Vec3 t, Quat r, Vec3 s) {
        Mat3 m = r.matrix();
        return {Vec4(m.columns[0] * s.x, 0), Vec4(m.columns[1] * s.y, 0), Vec4(m.columns[2] * s.z, 0), Vec4(t, 1)};
    }
    /// The extensions the sources add to simd_float4x4.
    Vec3 position() const { return columns[3].xyz(); }
    Vec3 forward() const { return -normalize(columns[2].xyz()); }
    Vec3 right() const { return normalize(columns[0].xyz()); }
    Vec3 up() const { return normalize(columns[1].xyz()); }
    /// A point, moved by this matrix.
    Vec3 point(Vec3 p) const {
        return (columns[0] * p.x + columns[1] * p.y + columns[2] * p.z + columns[3]).xyz();
    }
    /// A direction, turned (and scaled) by it.
    Vec3 direction(Vec3 d) const { return (columns[0] * d.x + columns[1] * d.y + columns[2] * d.z).xyz(); }
    Mat4 inverse() const;
    const float* data() const { return &columns[0].x; }
};
inline Vec4 operator*(const Mat4& m, Vec4 v) {
    return m.columns[0] * v.x + m.columns[1] * v.y + m.columns[2] * v.z + m.columns[3] * v.w;
}
inline Mat4 operator*(const Mat4& a, const Mat4& b) {
    return {a * b.columns[0], a * b.columns[1], a * b.columns[2], a * b.columns[3]};
}
inline bool operator==(const Mat4& a, const Mat4& b) {
    return a.columns[0] == b.columns[0] && a.columns[1] == b.columns[1] && a.columns[2] == b.columns[2] && a.columns[3] == b.columns[3];
}
inline bool operator!=(const Mat4& a, const Mat4& b) { return !(a == b); }
inline Mat4 Mat4::inverse() const {
    const float* m = data();
    float inv[16];
    inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
    inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
    inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
    inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
    inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
    inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
    inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
    inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
    inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
    inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
    inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
    inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
    inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
    inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
    inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
    inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
    float det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
    Mat4 out;
    if (std::fabs(det) < 1e-20f) return out;
    float* o = &out.columns[0].x;
    for (int i = 0; i < 16; i++) o[i] = inv[i] / det;
    return out;
}

/// A transform: scale, rotation and translation.
struct Transform {
    Vec3 scale{1, 1, 1};
    Quat rotation;
    Vec3 translation;
    Mat4 matrix() const { return Mat4::trs(translation, rotation, scale); }
};

/// An axis-aligned bounding box.
struct BoundingBox {
    Vec3 min, max;
    Vec3 center() const { return (min + max) * 0.5f; }
    Vec3 extents() const { return max - min; }
};
