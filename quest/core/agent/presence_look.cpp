#include "presence_look.h"

#include <algorithm>
#include <cmath>

namespace agent {
namespace {

constexpr float pi = 3.14159265f;
float rad(float degrees) { return degrees * pi / 180; }
float deg(float radians) { return radians * 180 / pi; }

/// Degrees from `a` to `b` the short way round, -180…180.
float turnFrom(float a, float b) { return std::fmod(std::fmod(b - a, 360.f) + 540.f, 360.f) - 180.f; }

/// Toward `target` as a critically damped spring goes, in about `time` s, never past it (Unity's SmoothDamp).
float damp(float current, float target, float& speed, float time, float fastest, float dt) {
    float omega = 2 / std::max(0.0001f, time);
    float x = omega * dt;
    float decay = 1 / (1 + x + 0.48f * x * x + 0.235f * x * x * x);
    float most = fastest * time;
    float change = clamp(current - target, -most, most);
    float goal = current - change;
    float pull = (speed + omega * change) * dt;
    speed = (speed - omega * pull) * decay;
    float out = goal + (change + pull) * decay;
    if ((target - current > 0) == (out > target)) {
        out = target;
        speed = 0;
    }
    return out;
}

/// Eases `v` toward `target`, `tau` s to get most of the way.
void ease(float& v, float target, float tau, float dt) { v += (target - v) * (1 - std::exp(-dt / tau)); }

Vec3 direction(float yaw, float pitch) {
    float y = rad(yaw), p = rad(pitch);
    return {std::sin(y) * std::cos(p), std::sin(p), -std::cos(y) * std::cos(p)};
}

}  // namespace

// MARK: - Follow

void Follow::update(const Mat4& head, float dt) {
    Vec3 f = head.forward();
    float headYaw = deg(std::atan2(f.x, -f.z));
    float headPitch = deg(std::asin(clamp(f.y, -1.f, 1.f)));
    float wantYaw = headYaw + aside;
    float wantPitch = clamp(headPitch - below, lowest, highest);
    Vec3 at = head.position();
    if (!placed) {
        placed = true;
        yaw_ = wantYaw;
        pitch_ = wantPitch;
        eye = at;
        return;
    }
    if (!(dt > 0)) return;
    eye = {damp(eye.x, at.x, eyeSpeed.x, 0.25f, 4, dt), damp(eye.y, at.y, eyeSpeed.y, 0.25f, 4, dt), damp(eye.z, at.z, eyeSpeed.z, 0.25f, 4, dt)};
    float yawOff = turnFrom(yaw_, wantYaw);
    if (!coming) {
        float above = pitch_ - headPitch;           // how far above the line of sight it is
        bool past = std::fabs(yawOff) > slackYaw || above < -below - slackDown || above > slackUp;
        out = past ? out + dt : 0;
        coming = out >= delay;
    }
    if (!coming) return;
    yaw_ += damp(0, yawOff, yawSpeed, glide, fastest, dt);
    yaw_ = turnFrom(0, yaw_);
    pitch_ = damp(pitch_, wantPitch, pitchSpeed, glide, fastest, dt);
    if (std::fabs(turnFrom(yaw_, wantYaw)) < 0.5f && std::fabs(wantPitch - pitch_) < 0.5f) {
        coming = false;
        out = 0;
        yawSpeed = pitchSpeed = 0;
    }
}

Vec3 Follow::position() const { return eye + direction(yaw_, pitch_) * distance; }

Quat Follow::orientation() const {
    Vec3 z = -direction(yaw_, pitch_);
    Vec3 x = normalize(cross({0, 1, 0}, z));
    return Quat(Mat3(x, cross(z, x), z));
}

// MARK: - Glow

namespace {

/// What the orb settles into in each state, in the order of `Presence::State`.
struct Pose {
    float shown, glow, size, warmth, shimmer, breath, hears;
};
constexpr Pose poses[] = {
    /* off */        {0, 0.0f, 0.8f, 1, 0, 0, 0},
    /* waiting */    {1, 0.28f, 0.78f, 1, 0, 0, 0},
    /* listening */  {1, 0.8f, 1.0f, 0, 0, 0, 1},
    /* sent */       {1, 0.95f, 0.85f, 0.5f, 0, 0, 0},
    /* thinking */   {1, 0.62f, 0.9f, 1, 1, 0, 0},
    /* responding */ {1, 0.85f, 1.0f, 1, 0, 0, 1},
    /* working */    {1, 0.4f, 0.84f, 1, 0, 1, 0},
};

}  // namespace

void Glow::update(const Presence& p, double now, float dt) {
    const Pose& to = poses[int(p.state)];
    if (p.state == Presence::State::sent && last != Presence::State::sent) sentAt = now;
    last = p.state;
    if (!(dt > 0)) return;
    ease(look_.shown, to.shown, to.shown > look_.shown ? 0.25f : 0.35f, dt);
    ease(look_.glow, to.glow, 0.22f, dt);
    ease(look_.size, to.size, 0.22f, dt);
    ease(look_.warmth, to.warmth, 0.35f, dt);
    ease(look_.shimmer, to.shimmer, 0.4f, dt);
    ease(look_.breath, to.breath, 0.6f, dt);
    ease(hears, to.hears, 0.12f, dt);
    // A voice rises at once and falls away slowly, as a meter does, so the orb swells with each word and does not flicker.
    float heard = clamp(p.level, 0, 1);
    ease(level, heard, heard > level ? 0.04f : 0.2f, dt);
    look_.voice = level * hears;
    double since = now - sentAt;
    look_.gather = since >= 0 && since < gathering ? float(since / gathering) : -1;
}

// MARK: - Caption

Caption::Caption(std::function<float(const std::string&)> width, float most) : measure(std::move(width)), most(most) {
    space = std::max(0.f, measure("x x") - measure("xx"));
}

float Caption::wordWidth(const std::string& word) {
    auto known = widths.find(word);
    if (known != widths.end()) return known->second;
    float w = measure(word);
    widths[word] = w;
    return w;
}

void Caption::startTurn(double now) {
    // What rests of the last turn stays above the new one's words, which push it out.
    std::vector<Entry> kept;
    size_t all = history.size() + entries.size();
    for (size_t i = all > size_t(rows) ? all - size_t(rows) : 0; i < all; i++) {
        Entry e = i < history.size() ? history[i] : entries[i - history.size()];
        if (e.part != Part::user && e.part != Part::momo) continue;
        e.current = false;
        kept.push_back(std::move(e));
    }
    history = std::move(kept);
    historyUntil = now + linger;
    entries.clear();
    runs.clear();
    user.clear();
    momo.clear();
    userFinal = false;
    widths.clear();
    turn++;
}

void Caption::wrap() {
    entries.clear();
    for (const Run& r : runs) {
        std::string line;
        float w = 0;
        int index = 0;
        auto put = [&] {
            if (line.empty()) return;
            int key = (turn << 16) | (int(r.part) << 12) | std::min(index, 4095);
            entries.push_back(Entry{key, r.part, line, w, true});
            index++;
            line.clear();
            w = 0;
        };
        size_t at = 0;
        while (at < r.text.size()) {
            size_t start = r.text.find_first_not_of(" \t\n", at);
            if (start == std::string::npos) break;
            size_t end = r.text.find_first_of(" \t\n", start);
            if (end == std::string::npos) end = r.text.size();
            std::string word = r.text.substr(start, end - start);
            at = end;
            float ww = wordWidth(word);
            if (!line.empty() && w + space + ww > most) put();
            if (!line.empty()) {
                line += ' ';
                w += space;
            }
            line += word;
            w += ww;
        }
        put();
    }
}

float Caption::tone(const Entry& e) const {
    switch (e.part) {
    case Part::hint: return 0.5f;
    case Part::listening: return 0.5f;
    case Part::thinking: return 0.7f;
    case Part::user: return e.current && !userFinal ? 0.8f : 1;
    case Part::momo: return 1;
    }
    return 1;
}

void Caption::update(const Presence& p, const std::string& name, double now, float dt) {
    using S = Presence::State;
    auto active = [](S s) { return s == S::listening || s == S::sent || s == S::thinking || s == S::responding; };
    if (p.state == S::listening && state != S::listening) startTurn(now);
    if (active(state) && !active(p.state)) {
        quietSince = now;
        // Woken, and nothing said: the hint may help again.
        if (user.empty()) hintEarned = true;
    }
    state = p.state;
    if (!p.userText.empty() && p.userText != user) {
        user = p.userText;
        hintEarned = false;
    }
    userFinal = p.userFinal;
    if (!p.momoText.empty() && p.momoText != momo) momo = p.momoText;
    if (state == S::off || (!history.empty() && now > historyUntil)) history.clear();
    if (name != hintName) {
        hintName = name;
        hint = "Say “Hey " + name + "”";
    }

    static const std::string listening = "Listening…", thinking = "Thinking…";
    struct Wanted {
        Part part;
        const std::string* text;
    };
    Wanted want[2];
    int count = 0;
    auto add = [&](Part part, const std::string& text) { want[count++] = {part, &text}; };
    bool turnShows = now < quietSince + linger && (!user.empty() || !momo.empty());
    bool hinting = false;
    switch (state) {
    case S::off: break;
    case S::waiting:
    case S::working:
        if (turnShows) {
            if (!user.empty()) add(Part::user, user);
            if (!momo.empty()) add(Part::momo, momo);
        } else if (state == S::waiting && hintEarned) {
            hinting = true;
            if (!hintFrom) hintFrom = now;
            if (now < *hintFrom + hintFor) add(Part::hint, hint);
        }
        break;
    case S::listening:
    case S::sent: add(user.empty() ? Part::listening : Part::user, user.empty() ? listening : user); break;
    case S::thinking:
        if (!user.empty()) add(Part::user, user);
        add(Part::thinking, thinking);
        break;
    case S::responding:
        if (!user.empty()) add(Part::user, user);
        add(momo.empty() ? Part::thinking : Part::momo, momo.empty() ? thinking : momo);
        break;
    }
    if (!hinting) hintFrom.reset();

    bool same = int(runs.size()) == count;
    for (int i = 0; same && i < count; i++) same = runs[size_t(i)].part == want[i].part && runs[size_t(i)].text == *want[i].text;
    if (!same) {
        runs.resize(size_t(count));
        for (int i = 0; i < count; i++) runs[size_t(i)] = Run{want[i].part, *want[i].text};
        wrap();
    }
    place(dt);
}

void Caption::place(float dt) {
    int n = int(history.size() + entries.size());
    int atRest = std::min(n, rows);
    float middle = float(atRest - 1) * 0.5f;
    for (Line& l : lines_) l.seen = false;
    size_t old = lines_.size();
    for (int i = 0; i < n; i++) {
        const Entry& e = i < int(history.size()) ? history[size_t(i)] : entries[size_t(i) - history.size()];
        int slot = n - 1 - i;
        float toY, toOpacity;
        if (slot < rows) {
            toY = float(slot) - middle;
            toOpacity = tone(e) * (slot == 0 ? 1 : upper);
        } else {
            toY = float(atRest) - middle + float(slot - rows);
            toOpacity = 0;
        }
        auto found = std::find_if(lines_.begin(), lines_.end(), [&](const Line& l) { return l.key == e.key; });
        if (found == lines_.end()) {
            if (toOpacity == 0) continue;
            Speaker who = e.part == Part::user ? Speaker::user : e.part == Part::momo || e.part == Part::thinking ? Speaker::momo : Speaker::aside;
            // It rises into its place as it comes.
            lines_.push_back(Line{e.key, who, e.text, e.width, toY - 0.45f, 0});
            found = lines_.end() - 1;
        } else if (found->text != e.text) {
            found->text = e.text;
            found->width = e.width;
        }
        found->toY = toY;
        found->toOpacity = toOpacity;
        found->seen = true;
    }
    auto inTheWay = [&](const Line& l) {
        return std::any_of(lines_.begin(), lines_.end(), [&](const Line& o) {
            return !o.seen && o.opacity > 0.03f && std::fabs(o.y - l.toY) < 0.6f;
        });
    };
    for (size_t i = old; i < lines_.size(); i++) lines_[i].yields = inTheWay(lines_[i]);
    for (Line& l : lines_) {
        if (!l.seen) l.toOpacity = 0;
        if (!(dt > 0)) continue;
        l.y = damp(l.y, l.toY, l.ySpeed, 0.16f, 20, dt);
        if (l.yields && inTheWay(l)) continue;
        l.yields = false;
        // A line that is gone, or replaced, goes quickly, so the one in its place is not kept waiting.
        ease(l.opacity, l.toOpacity, l.toOpacity > l.opacity ? 0.1f : l.seen ? 0.12f : 0.05f, dt);
    }
    lines_.erase(std::remove_if(lines_.begin(), lines_.end(), [](const Line& l) { return l.toOpacity == 0 && l.opacity < 0.01f; }),
                 lines_.end());
}

float Caption::width() const {
    float w = 0;
    for (const Line& l : lines_) {
        if (l.toOpacity > 0) w = std::max(w, l.width);
    }
    return w;
}

int Caption::resting() const {
    return int(std::count_if(lines_.begin(), lines_.end(), [](const Line& l) { return l.toOpacity > 0; }));
}

}  // namespace agent
