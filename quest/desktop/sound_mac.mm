// platform.h's sound on the Mac preview: AVAudioEngine's input for the microphone, converted to 16 kHz mono,
// and AVAudioPlayer for files.
#import <AVFoundation/AVFoundation.h>

#include <atomic>
#include <mutex>

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
    if (!player || ![player play]) {
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

}  // namespace platform
