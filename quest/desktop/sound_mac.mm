// platform.h's sound on the Mac preview: AVAudioEngine's input for the microphone, converted to 16 kHz mono,
// AVAudioPlayer for files, and an AVAudioPlayerNode of its own engine for each stream.
#import <AVFoundation/AVFoundation.h>

#include <atomic>
#include <mutex>
#include <set>

#include "base.h"
#include "platform.h"

namespace {

/// What the tap and `stop` share, so nothing is heard once `stop` has returned.
struct Tap {
    std::mutex lock;
    bool stopped = false;
    platform::MicrophoneEvents events;
};

class MacMicrophone : public platform::Microphone {
public:
    AVAudioEngine* engine = nil;
    std::shared_ptr<Tap> tap;

    void stop() override {
        {
            std::lock_guard<std::mutex> g(tap->lock);
            if (tap->stopped) return;
            tap->stopped = true;
        }
        [engine.inputNode removeTapOnBus:0];
        [engine stop];
    }
};

/// Once, whichever of its endings comes first.
struct Ending {
    std::atomic<bool> fired{false};
    std::function<void(bool)> done;
    void finish(bool played) {
        if (!fired.exchange(true) && done) done(played);
    }
};

}  // namespace

@interface MPSoundDelegate : NSObject <AVAudioPlayerDelegate>
@property(nonatomic, strong) AVAudioPlayer* player;
@property(nonatomic, assign) std::shared_ptr<Ending> ending;
@end

namespace {

/// The sounds playing, kept alive until each ends: AVAudioPlayer holds its delegate weakly.
NSMutableSet<MPSoundDelegate*>* playing() {
    static NSMutableSet<MPSoundDelegate*>* set = [NSMutableSet new];
    return set;
}

void ended(MPSoundDelegate* d, bool played) {
    @synchronized(playing()) {
        [playing() removeObject:d];
    }
    d.ending->finish(played);
}

class MacSound : public platform::Sound {
public:
    MPSoundDelegate* delegate = nil;
    void stop() override {
        MPSoundDelegate* d = delegate;
        dispatch_async(dispatch_get_main_queue(), ^{
          [d.player stop];
          ended(d, false);
        });
    }
};

/// A stream's engine and what its buffers' completions share. The host keeps it until it ends.
struct StreamState {
    AVAudioEngine* engine = nil;
    AVAudioPlayerNode* node = nil;
    AVAudioFormat* format = nil;
    std::shared_ptr<Ending> ending;
    std::mutex lock;
    int queued = 0;             // buffers scheduled and not yet played
    bool finished = false;
    bool stopped = false;
};

std::mutex streamsLock;
std::set<std::shared_ptr<StreamState>> streams;

/// Once: says how it ended, then lets the engine go on the main queue, never inside one of its own callbacks.
void endStream(const std::shared_ptr<StreamState>& s, bool played) {
    if (s->ending->fired) return;
    s->ending->finish(played);
    std::shared_ptr<StreamState> keep = s;
    dispatch_async(dispatch_get_main_queue(), ^{
      [keep->node stop];
      [keep->engine stop];
      std::lock_guard<std::mutex> g(streamsLock);
      streams.erase(keep);
    });
}

class MacStream : public platform::Stream {
public:
    std::shared_ptr<StreamState> state;

    void write(const int16_t* samples, size_t count) override {
        if (count == 0) return;
        {
            std::lock_guard<std::mutex> g(state->lock);
            if (state->stopped || state->finished) return;
            state->queued++;
        }
        AVAudioPCMBuffer* buffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:state->format frameCapacity:AVAudioFrameCount(count)];
        buffer.frameLength = AVAudioFrameCount(count);
        float* out = buffer.floatChannelData[0];
        for (size_t i = 0; i < count; i++) out[i] = float(samples[i]) / 32768.f;
        std::weak_ptr<StreamState> weak = state;
        [state->node scheduleBuffer:buffer
             completionCallbackType:AVAudioPlayerNodeCompletionDataPlayedBack
                  completionHandler:^(AVAudioPlayerNodeCompletionCallbackType) {
                    std::shared_ptr<StreamState> s = weak.lock();
                    if (!s) return;
                    bool last;
                    {
                        std::lock_guard<std::mutex> g(s->lock);
                        s->queued--;
                        last = s->finished && !s->stopped && s->queued == 0;
                    }
                    if (last) endStream(s, true);
                  }];
    }

    void finish() override {
        bool last;
        {
            std::lock_guard<std::mutex> g(state->lock);
            if (state->finished || state->stopped) return;
            state->finished = true;
            last = state->queued == 0;
        }
        if (last) endStream(state, true);
    }

    void stop() override {
        {
            std::lock_guard<std::mutex> g(state->lock);
            if (state->stopped) return;
            state->stopped = true;
        }
        [state->node stop];
        endStream(state, false);
    }
};

}  // namespace

@implementation MPSoundDelegate
- (void)audioPlayerDidFinishPlaying:(AVAudioPlayer*)player successfully:(BOOL)flag {
    ended(self, flag);
}
- (void)audioPlayerDecodeErrorDidOccur:(AVAudioPlayer*)player error:(NSError*)error {
    ended(self, false);
}
@end

namespace platform {

// The Mac's microphone is read as it is, so the preview's own chime comes back through it from the speakers.
bool microphoneHearsOwnSounds() { return true; }

MicrophoneRef openMicrophone(MicrophoneEvents events) {
    auto mic = std::make_shared<MacMicrophone>();
    mic->tap = std::make_shared<Tap>();
    mic->tap->events = std::move(events);
    mic->engine = [AVAudioEngine new];
    AVAudioInputNode* input = mic->engine.inputNode;
    AVAudioFormat* from = [input outputFormatForBus:0];
    if (from.sampleRate <= 0 || from.channelCount == 0) {
        if (mic->tap->events.failed) mic->tap->events.failed("no microphone");
        return nullptr;
    }
    AVAudioFormat* to = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatFloat32 sampleRate:16000 channels:1 interleaved:NO];
    AVAudioConverter* converter = [[AVAudioConverter alloc] initFromFormat:from toFormat:to];
    converter.downmix = YES;
    std::shared_ptr<Tap> tap = mic->tap;
    double rate = from.sampleRate;
    [input installTapOnBus:0
                bufferSize:4096
                    format:from
                     block:^(AVAudioPCMBuffer* buffer, AVAudioTime*) {
                       AVAudioFrameCount room = AVAudioFrameCount(double(buffer.frameLength) * 16000 / rate) + 32;
                       AVAudioPCMBuffer* out = [[AVAudioPCMBuffer alloc] initWithPCMFormat:to frameCapacity:room];
                       __block bool given = false;
                       [converter convertToBuffer:out
                                            error:nil
                               withInputFromBlock:^AVAudioBuffer*(AVAudioPacketCount, AVAudioConverterInputStatus* status) {
                                 if (given) {
                                     *status = AVAudioConverterInputStatus_NoDataNow;
                                     return nil;
                                 }
                                 given = true;
                                 *status = AVAudioConverterInputStatus_HaveData;
                                 return buffer;
                               }];
                       std::lock_guard<std::mutex> g(tap->lock);
                       if (!tap->stopped && out.frameLength > 0 && tap->events.heard) tap->events.heard(out.floatChannelData[0], out.frameLength);
                     }];
    NSError* error = nil;
    [mic->engine prepare];
    if (![mic->engine startAndReturnError:&error]) {
        [input removeTapOnBus:0];
        if (tap->events.failed) tap->events.failed(std::string("the microphone did not start: ") + error.localizedDescription.UTF8String);
        return nullptr;
    }
    return mic;
}

SoundRef playSound(const std::string& path, std::function<void(bool played)> done) {
    auto ending = std::make_shared<Ending>();
    ending->done = std::move(done);
    NSError* error = nil;
    AVAudioPlayer* player = [[AVAudioPlayer alloc] initWithContentsOfURL:[NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]]
                                                                   error:&error];
    if (!player) {
        ending->finish(false);
        return nullptr;
    }
    // `-mute` is every sound the app makes, whoever asks for it: it plays at no volume and ends as it would have.
    if (Flags::has("mute")) player.volume = 0;
    if (![player play]) {
        ending->finish(false);
        return nullptr;
    }
    MPSoundDelegate* d = [MPSoundDelegate new];
    d.player = player;
    d.ending = ending;
    player.delegate = d;
    @synchronized(playing()) {
        [playing() addObject:d];
    }
    auto sound = std::make_shared<MacSound>();
    sound->delegate = d;
    return sound;
}

StreamRef playStream(int rate, std::function<void(bool played)> done) {
    auto state = std::make_shared<StreamState>();
    state->ending = std::make_shared<Ending>();
    state->ending->done = std::move(done);
    state->engine = [AVAudioEngine new];
    state->node = [AVAudioPlayerNode new];
    state->format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:rate channels:1];
    [state->engine attachNode:state->node];
    [state->engine connect:state->node to:state->engine.mainMixerNode format:state->format];
    if (Flags::has("mute")) state->node.volume = 0;
    [state->engine prepare];
    NSError* error = nil;
    if (!state->format || ![state->engine startAndReturnError:&error]) {
        state->ending->finish(false);
        return nullptr;
    }
    [state->node play];
    {
        std::lock_guard<std::mutex> g(streamsLock);
        streams.insert(state);
    }
    auto stream = std::make_shared<MacStream>();
    stream->state = state;
    return stream;
}

}  // namespace platform
