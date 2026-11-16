// The Mac preview's sound output: the default output device, asking
// audio::render for what to play (core/audio.h).
#include <AudioToolbox/AudioToolbox.h>

#include "audio.h"
#include "base.h"

namespace hostaudio {
namespace {

AudioUnit unit = nullptr;

OSStatus onRender(void*, AudioUnitRenderActionFlags*, const AudioTimeStamp*, UInt32, UInt32 frames, AudioBufferList* data) {
    audio::render(static_cast<float*>(data->mBuffers[0].mData), int(frames));
    return noErr;
}

}  // namespace

void start() {
    if (unit) return;
    AudioComponentDescription want{kAudioUnitType_Output, kAudioUnitSubType_DefaultOutput, kAudioUnitManufacturer_Apple, 0, 0};
    AudioComponent component = AudioComponentFindNext(nullptr, &want);
    if (!component || AudioComponentInstanceNew(component, &unit) != noErr) {
        logLine("[sound] no output device");
        unit = nullptr;
        return;
    }
    AudioStreamBasicDescription format{};
    format.mSampleRate = audio::sampleRate;
    format.mFormatID = kAudioFormatLinearPCM;
    format.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
    format.mChannelsPerFrame = 2;
    format.mBitsPerChannel = 32;
    format.mBytesPerFrame = 8;
    format.mBytesPerPacket = 8;
    format.mFramesPerPacket = 1;
    AURenderCallbackStruct callback{onRender, nullptr};
    OSStatus status = AudioUnitSetProperty(unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0, &format, sizeof format);
    if (status == noErr) status = AudioUnitSetProperty(unit, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0, &callback, sizeof callback);
    if (status == noErr) status = AudioUnitInitialize(unit);
    if (status == noErr) status = AudioOutputUnitStart(unit);
    if (status != noErr) {
        logLine(fmt("[sound] could not open the output (%d)", int(status)));
        AudioComponentInstanceDispose(unit);
        unit = nullptr;
    }
}

void stop() {
    if (!unit) return;
    AudioOutputUnitStop(unit);
    AudioUnitUninitialize(unit);
    AudioComponentInstanceDispose(unit);
    unit = nullptr;
}

}  // namespace hostaudio
