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

// MARK: - Face

Face::Face(uint32_t seed) : seed(seed ? seed : 1) {
    nextBlink = random(blinkMin, blinkMax);
    nextDart = random(dartMin, dartMax);
}

float Face::random(float lo, float hi) {
    // A small generator of its own, so a face blinks the same way each run and the tests can count on it.
    seed ^= seed << 13;
    seed ^= seed >> 17;
    seed ^= seed << 5;
    return lo + float(seed & 0xFFFFFF) / float(0x1000000) * std::max(0.f, hi - lo);
}

void Face::update(const Presence& p, float dt) {
    using S = Presence::State;
    if (!(dt > 0)) return;
    clock += dt;
    Look& l = look_;
    ease(l.shown, p.state == S::off ? 0.f : 1.f, p.state == S::off ? 0.35f : 0.25f, dt);

    // AgentSphere: the level follows the voice up fast and down slower, so the rings breathe and do not flicker. Listening
    // it is the user's voice, which moves the ring; speaking, Momo's, which also parts it into colour.
    bool hears = p.state == S::listening || p.state == S::responding;
    float heard = hears ? clamp(p.level, 0, 1) : 0;
    float k = heard > l.voice ? attack : release;
    l.voice += (heard - l.voice) * std::min(1.f, k * dt);
    ease(colour, p.state == S::responding ? 1.f : 0.f, 0.15f, dt);
    // AgentRing.update.
    l.time = std::fmod(l.time + (quietSpeed + (loudSpeed - quietSpeed) * l.voice) * dt, 256.f);
    l.distortion = quietDistortion + (loudDistortion - quietDistortion) * l.voice;
    l.divergence = colour * std::pow(l.voice, std::max(0.01f, divergenceExponent)) * divergence;
    l.scale += (1 + speakPulse * l.voice - l.scale) * std::min(1.f, 12 * dt);

    // AgentRing.updateEyes: a blink closes and opens the eyes, then waits a while.
    l.openness = 1;
    if (blinkStart >= 0) {
        float t = (clock - blinkStart) / std::max(0.01f, blinkDuration);
        if (t >= 1) {
            blinkStart = -1;
        } else {
            l.openness = std::max(0.f, 1 - std::sin(pi * t));
        }
    } else if (clock >= nextBlink) {
        blinkStart = clock;
        nextBlink = clock + blinkDuration + random(blinkMin, blinkMax);
    }

    // Searching, the eyes look about: from side to side, a little up or down, easing there more slowly than a dart.
    // Otherwise they dart now and then, as in CurioCity, and hold, and come back.
    bool wasSearching = searching;
    searching = p.searching();
    if (searching != wasSearching) {
        target = {};
        centred = true;
        slow = true;
        nextDart = searching ? clock : clock + random(dartMin, dartMax);
    }
    if (searching) {
        if (clock >= nextDart) {
            side = -side;
            target = {side * (side < 0 ? glanceToMonocle : glanceAmount) * random(0.75f, 1), glanceAmount * random(-0.3f, 0.35f)};
            nextDart = clock + random(glanceMin, glanceMax);
        }
        l.gaze += (target - l.gaze) * std::min(1.f, glanceEase * dt);
    } else {
        if (clock >= nextDart) {
            if (centred) {
                float a = random(0, 2 * pi), r = (0.4f + random(0, 0.6f)) * dartAmount;
                target = {std::cos(a) * r, std::sin(a) * r * 0.6f};
                centred = false;
                slow = false;
                nextDart = clock + std::max(0.05f, dartHold);
            } else {
                target = {};
                centred = true;
                nextDart = clock + random(dartMin, dartMax);
            }
        }
        // Back from a glance as slowly as it went; a dart is quick, as a saccade is.
        l.gaze += (target - l.gaze) * std::min(1.f, (slow ? glanceEase : 25) * dt);
    }
    ease(l.monocle, searching ? 1.f : 0.f, 0.18f, dt);

    // Thinking, from the moment the turn is sent until Momo answers or the work begins, the dots come and pulse.
    bool thinks = p.state == S::sent || p.state == S::thinking;
    if (thinks && l.dots < 0.02f) l.rising = 0;
    if (thinks) l.rising += dt;
    ease(l.dots, thinks ? 1.f : 0.f, thinks ? 0.12f : 0.1f, dt);
}

// MARK: - Caption

Caption::Caption(Measure width, float most) : measure(std::move(width)), most(most) {
    space = std::max(0.f, measure("x x", Speaker::user) - measure("xx", Speaker::user));
}

float Caption::wordWidth(const std::string& word, Speaker who) {
    auto key = std::make_pair(word, who);
    auto known = widths.find(key);
    if (known != widths.end()) return known->second;
    float w = measure(word, who);
    widths[key] = w;
    return w;
}

Speaker Caption::speaker(Part part) {
    switch (part) {
    case Part::user: return Speaker::user;
    case Part::momo: return Speaker::momo;
    case Part::hint:
    case Part::listening:
    case Part::thinking: return Speaker::status;
    }
    return Speaker::status;
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
    std::vector<std::string> words;
    for (const Run& r : runs) {
        Speaker who = speaker(r.part);
        words.clear();
        for (size_t at = r.text.find_first_not_of(" \t\n"); at != std::string::npos; at = r.text.find_first_not_of(" \t\n", at)) {
            size_t end = std::min(r.text.find_first_of(" \t\n", at), r.text.size());
            words.push_back(r.text.substr(at, end - at));
            at = end;
        }
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
        auto fits = [&](size_t i, float room) { return line.empty() || w + space + wordWidth(words[i], who) <= room; };
        auto add = [&](size_t i) {
            w += (line.empty() ? 0 : space) + wordWidth(words[i], who);
            line += (line.empty() ? "" : " ") + words[i];
        };
        for (size_t i = 0; i < words.size(); i++) {
            if (!fits(i, most)) put();
            add(i);
        }
        put();
    }
}

float Caption::tone(const Entry& e) const {
    switch (e.part) {
    case Part::hint: return 0.75f;
    case Part::listening: return 0.9f;
    case Part::thinking: return 1;
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
            // It rises into its place as it comes.
            lines_.push_back(Line{e.key, speaker(e.part), e.part, e.text, e.width, toY - 0.45f, 0});
            found = lines_.end() - 1;
        } else if (found->text != e.text) {
            found->text = e.text;
            found->width = e.width;
        }
        found->toY = toY;
        found->toOpacity = toOpacity;
        found->seen = true;
        found->gone = false;
    }
    // A line waits for the one whose place it takes to be gone.
    auto inTheWay = [&](const Line& l) {
        return std::any_of(lines_.begin(), lines_.end(), [&](const Line& o) { return !o.seen && o.opacity > 0.03f && std::fabs(o.y - l.toY) < 0.6f; });
    };
    for (size_t i = old; i < lines_.size(); i++) lines_[i].yields = inTheWay(lines_[i]);
    for (Line& l : lines_) {
        if (!l.seen) {
            l.toOpacity = 0;
            l.gone = true;
        }
        if (!(dt > 0)) continue;
        l.y = damp(l.y, l.toY, l.ySpeed, 0.16f, 20, dt);
        if (l.yields && inTheWay(l)) continue;
        l.yields = false;
        // A line that is gone, or replaced, goes quickly, so the one in its place is not kept waiting.
        float tau = l.toOpacity > l.opacity ? 0.1f : l.seen ? 0.12f : 0.05f;
        ease(l.opacity, l.toOpacity, tau, dt);
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

// MARK: - Roster

Roster::Roster(Measure width, float most) : measure(std::move(width)), most(most) {}

void Roster::write(Line& line, const AgentLine& agent) const {
    line.from = agent;
    std::string name = agent.name + " · ";
    std::string step = agent.finished ? finished : agent.step;
    line.name = agent.name.size();
    line.text = name + step;
    line.width = measure(line.text);
    if (line.width <= most) return;
    // One line, cut short at a word, where it must be.
    std::string kept = step;
    while (!kept.empty()) {
        size_t space = kept.find_last_of(' ');
        kept = space == std::string::npos ? "" : kept.substr(0, space);
        line.text = name + kept + "…";
        line.width = measure(line.text);
        if (line.width <= most) return;
    }
}

void Roster::update(const std::vector<AgentLine>& agents, float dt) {
    for (Line& l : lines_) l.toOpacity = 0;
    for (size_t i = 0; i < agents.size(); i++) {
        const AgentLine& a = agents[i];
        auto found = std::find_if(lines_.begin(), lines_.end(), [&](const Line& l) { return l.role == a.role; });
        if (found == lines_.end()) {
            Line l;
            l.role = a.role;
            write(l, a);
            // It rises into its place as it comes.
            l.y = float(i) - 0.45f;
            lines_.push_back(std::move(l));
            found = lines_.end() - 1;
        } else if (!(found->from == a)) {
            write(*found, a);
        }
        found->toY = float(i);
        found->toOpacity = 1;
    }
    if (!(dt > 0)) return;
    for (Line& l : lines_) {
        l.y = damp(l.y, l.toY, l.ySpeed, 0.2f, 20, dt);
        // A line that goes, goes quickly, so the lines above can take its place without the two standing together.
        ease(l.opacity, l.toOpacity, l.toOpacity > l.opacity ? 0.15f : 0.07f, dt);
    }
    std::erase_if(lines_, [](const Line& l) { return l.toOpacity == 0 && l.opacity < 0.01f; });
}

int Roster::resting() const {
    return int(std::count_if(lines_.begin(), lines_.end(), [](const Line& l) { return l.toOpacity > 0; }));
}

float Roster::width() const {
    float w = 0;
    for (const Line& l : lines_) {
        if (l.toOpacity > 0) w = std::max(w, l.width);
    }
    return w;
}

}  // namespace agent
