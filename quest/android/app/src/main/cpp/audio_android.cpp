// The Quest's sound output: one AAudio stream that asks audio::render for
// what to play (core/audio.h). A film's sound does not come this way: that
// is MediaPlayer's (Media.kt).
#include <aaudio/AAudio.h>

#include <time.h>

#include <atomic>
#include <mutex>
#include <thread>

#include "audio.h"
#include "base.h"

namespace hostaudio {
namespace {

std::mutex guard;
AAudioStream* stream = nullptr;
bool wanted = false;
/// How far the stream's own count of frames is ahead of the mixer's (a stream opened again starts from nothing).
std::atomic<int64_t> streamAhead{0};

aaudio_data_callback_result_t onData(AAudioStream* s, void*, void* data, int32_t frames) {
    streamAhead.store(AAudioStream_getFramesWritten(s) - audio::rendered(), std::memory_order_relaxed);
    audio::render(static_cast<float*>(data), frames);
    return AAUDIO_CALLBACK_RESULT_CONTINUE;
}

void open();

/// The output went away (the headset's audio was handed to something else): open it again,
/// from a thread that is not AAudio's own, as its documentation asks.
void onError(AAudioStream*, void*, aaudio_result_t error) {
    logLine(fmt("[sound] the output stopped (%s), opening it again", AAudio_convertResultToText(error)));
    std::thread([] {
        std::lock_guard<std::mutex> lock(guard);
        if (stream) {
            AAudioStream_close(stream);
            stream = nullptr;
        }
        if (wanted) open();
    }).detach();
}

/// (With `guard` held.)
void open() {
    AAudioStreamBuilder* builder = nullptr;
    if (AAudio_createStreamBuilder(&builder) != AAUDIO_OK) return;
    AAudioStreamBuilder_setDirection(builder, AAUDIO_DIRECTION_OUTPUT);
    AAudioStreamBuilder_setSharingMode(builder, AAUDIO_SHARING_MODE_SHARED);
    AAudioStreamBuilder_setPerformanceMode(builder, AAUDIO_PERFORMANCE_MODE_LOW_LATENCY);
    AAudioStreamBuilder_setUsage(builder, AAUDIO_USAGE_GAME);
    AAudioStreamBuilder_setContentType(builder, AAUDIO_CONTENT_TYPE_SONIFICATION);
    AAudioStreamBuilder_setFormat(builder, AAUDIO_FORMAT_PCM_FLOAT);
    AAudioStreamBuilder_setChannelCount(builder, 2);
    AAudioStreamBuilder_setSampleRate(builder, audio::sampleRate);
    AAudioStreamBuilder_setDataCallback(builder, onData, nullptr);
    AAudioStreamBuilder_setErrorCallback(builder, onError, nullptr);
    aaudio_result_t result = AAudioStreamBuilder_openStream(builder, &stream);
    AAudioStreamBuilder_delete(builder);
    if (result != AAUDIO_OK) {
        logLine(fmt("[sound] could not open the output: %s", AAudio_convertResultToText(result)));
        stream = nullptr;
        return;
    }
    result = AAudioStream_requestStart(stream);
    logLine(fmt("[sound] output open: %d Hz, %d channels, %d frames a burst%s", AAudioStream_getSampleRate(stream),
                AAudioStream_getChannelCount(stream), AAudioStream_getFramesPerBurst(stream),
                result == AAUDIO_OK ? "" : fmt(", but it would not start: %s", AAudio_convertResultToText(result)).c_str()));
}

}  // namespace

void start() {
    std::lock_guard<std::mutex> lock(guard);
    wanted = true;
    if (!stream) open();
}

void stop() {
    std::lock_guard<std::mutex> lock(guard);
    wanted = false;
    if (!stream) return;
    AAudioStream_requestStop(stream);
    AAudioStream_close(stream);
    stream = nullptr;
}

std::optional<double> heardAt(int64_t count) {
    std::lock_guard<std::mutex> lock(guard);
    if (!stream) return std::nullopt;
    // A frame the device has already played, and when: the one asked about is so many frames from it.
    int64_t position = 0, nanoseconds = 0;
    if (AAudioStream_getTimestamp(stream, CLOCK_MONOTONIC, &position, &nanoseconds) != AAUDIO_OK) return std::nullopt;
    int64_t frame = count + streamAhead.load(std::memory_order_relaxed);
    return double(nanoseconds) / 1e9 + double(frame - position) / AAudioStream_getSampleRate(stream);
}

}  // namespace hostaudio
