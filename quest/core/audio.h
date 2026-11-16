// Sound: a small mixer for the ocean's own sounds (not a film's: that is the
// VideoPlayer's). Not a port: the visionOS app has no sounds of its own yet.
//
// The sounds are files made by quest/sound/synth.py: "sounds/manifest.json"
// names each one, how loud it is played and whether it is a loop, and
// "sounds/<name>.wav" holds it (48 kHz, 16 bit, stereo). They are read on a
// thread of their own after launch; a sound asked for before it is read is
// simply not heard.
//
// The scene asks for sounds on the frame thread. The host owns the device
// and calls `render` from its audio thread; nothing in `render` waits on
// the frame thread, takes a lock or asks for memory.
#pragma once
#include <string>

namespace audio {

constexpr int sampleRate = 48000;

/// Reads the manifest and starts reading the sounds. Without the files
/// (or with `-mute` or `-noSound`) there is no sound and every call below
/// does nothing. `-sound <0…1>` sets how loud it all is (0.8 unless said).
void start();
/// Whether there are sounds to play.
bool on();

/// Plays a sound once. `gain` is on top of the sound's own; `after` is
/// seconds from now; `pan` is -1 (left) … 1 (right).
void play(const std::string& name, float gain = 1, double after = 0, float pan = 0);
/// How loud a loop is, 0 (silent, and stopped) … 1 (as it was made; up to 2 can be asked): it goes there over
/// about `over` seconds. A loop starts from its beginning when it is
/// raised from nothing. Asking for the level it already has costs nothing.
void level(const std::string& name, float level, float over = 0.1f);

/// For the host's audio thread: the next `frames` frames, interleaved
/// stereo, -1…1.
void render(float* out, int frames);
/// For the log: how many sounds have been played, how many are sounding,
/// the loudest sample so far, and how many were dropped.
std::string describe();

}  // namespace audio

/// The device, which each host provides (audio_android.cpp, audio_mac.mm).
namespace hostaudio {
/// Opens the output and starts calling audio::render. Safe to call twice.
void start();
/// Closes it. Safe to call when it is not open.
void stop();
}
