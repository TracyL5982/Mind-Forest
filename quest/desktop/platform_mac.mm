// platform.h on the Mac, for the preview window: files straight from the
// repository, pictures through ImageIO, a head and one "hand" from the
// mouse. No video and no hand tracking: the headset is where those are checked.
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#include <sys/stat.h>

#include <cstdio>

#include "base.h"
#include "host_mac.h"
#include "platform.h"

namespace host {
std::string repoRoot;
std::optional<Mat4> head;
platform::Hand hands[2];
}

namespace platform {

std::string resourcePath(const std::string& name) {
    std::string path = name.rfind("clips/", 0) == 0 || name.rfind("works/", 0) == 0
        ? host::repoRoot + "/public/" + name
        : host::repoRoot + "/visionos/MindPalace/Resources/" + name;
    struct stat st;
    if (stat(path.c_str(), &st) == 0) return path;
    // A note's own picture: the visionOS bundle holds Resources/Ocean's files at its top.
    path = host::repoRoot + "/visionos/MindPalace/Resources/Ocean/" + name;
    return stat(path.c_str(), &st) == 0 ? path : "";
}

std::optional<std::string> readFile(const std::string& path) {
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) return std::nullopt;
    std::string out;
    char buf[65536];
    size_t n;
    while ((n = fread(buf, 1, sizeof buf, f)) > 0) out.append(buf, n);
    fclose(f);
    return out;
}

bool writeFile(const std::string& path, const std::string& contents) {
    FILE* f = fopen(path.c_str(), "wb");
    if (!f) return false;
    bool ok = fwrite(contents.data(), 1, contents.size(), f) == contents.size();
    fclose(f);
    return ok;
}

std::optional<std::string> readText(const std::string& name) {
    std::string path = resourcePath(name);
    if (path.empty()) {
        logLine("[ocean] resource missing: " + name);
        return std::nullopt;
    }
    return readFile(path);
}

void openURL(const std::string& url) { logLine("[host] the preview opens no links: " + url); }

std::string dataDirectory() {
    NSString* dir = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/MindPalaceOceanPreview"];
    [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
    return dir.UTF8String;
}

ImageRef decodeImage(const std::string& path, int maxPixel) {
    if (path.empty()) return nullptr;
    Cost::Scope cost(Cost::decode);
    NSURL* url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]];
    CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)url, nullptr);
    if (!source) return nullptr;
    CGImageRef cg = nullptr;
    if (maxPixel > 0) {
        NSDictionary* options = @{(id)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
                                  (id)kCGImageSourceCreateThumbnailWithTransform: @YES,
                                  (id)kCGImageSourceThumbnailMaxPixelSize: @(maxPixel)};
        cg = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options);
    } else {
        cg = CGImageSourceCreateImageAtIndex(source, 0, nullptr);
    }
    CFRelease(source);
    if (!cg) return nullptr;
    auto image = std::make_shared<Image>();
    image->width = int(CGImageGetWidth(cg));
    image->height = int(CGImageGetHeight(cg));
    image->rgba.assign(size_t(image->width) * image->height * 4, 0);
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef context = CGBitmapContextCreate(image->rgba.data(), image->width, image->height, 8, image->width * 4, space,
                                                 kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
    CGContextDrawImage(context, CGRectMake(0, 0, image->width, image->height), cg);
    CGContextRelease(context);
    CGColorSpaceRelease(space);
    CGImageRelease(cg);
    return image;
}

std::optional<Mat4> head() { return host::head; }
const Hand& hand(int which) { return host::hands[which == 0 ? 0 : 1]; }
bool handTrackingSupported() { return false; }

namespace {
/// A film that never has a frame: cards show their still.
class NoVideo : public VideoPlayer {
public:
    void load(const std::string&) override {}
    void play() override { on = true; }
    void pause() override { on = false; }
    void seek(double s) override { at = s; }
    double currentTime() override { return at; }
    double duration() override { return 0; }
    void setVolume(float) override {}
    void setMuted(bool) override {}
    bool playing() override { return on; }
    bool ready() override { return false; }
    TextureRef texture() override { return nullptr; }

private:
    bool on = false;
    double at = 0;
};
}

VideoPlayerRef makeVideoPlayer() { return std::make_shared<NoVideo>(); }

}  // namespace platform

namespace host {
bool savePNG(const std::string& path, int width, int height, const std::vector<uint8_t>& bottomUpRGBA) {
    std::vector<uint8_t> rows(bottomUpRGBA.size());
    for (int y = 0; y < height; y++) {
        memcpy(&rows[size_t(y) * width * 4], &bottomUpRGBA[size_t(height - 1 - y) * width * 4], size_t(width) * 4);
    }
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef context = CGBitmapContextCreate(rows.data(), width, height, 8, width * 4, space, kCGImageAlphaNoneSkipLast | kCGBitmapByteOrder32Big);
    CGImageRef cg = CGBitmapContextCreateImage(context);
    NSURL* url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]];
    CGImageDestinationRef dest = CGImageDestinationCreateWithURL((__bridge CFURLRef)url, CFSTR("public.png"), 1, nullptr);
    bool ok = false;
    if (dest) {
        CGImageDestinationAddImage(dest, cg, nullptr);
        ok = CGImageDestinationFinalize(dest);
        CFRelease(dest);
    }
    CGImageRelease(cg);
    CGContextRelease(context);
    CGColorSpaceRelease(space);
    return ok;
}
}
