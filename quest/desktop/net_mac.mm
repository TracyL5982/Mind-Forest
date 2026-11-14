// platform.h's network on the Mac preview: NSURLSession's WebSocket and data tasks.
#import <Foundation/Foundation.h>

#include <atomic>

#include "platform.h"

namespace {

class MacSocket;

}  // namespace

@interface MPSocketDelegate : NSObject <NSURLSessionWebSocketDelegate>
@property(nonatomic, assign) std::weak_ptr<MacSocket> owner;
@end

namespace {

class MacSocket : public platform::Socket, public std::enable_shared_from_this<MacSocket> {
public:
    explicit MacSocket(platform::SocketEvents events) : events(std::move(events)) {}

    void start(const std::string& url) {
        NSURL* address = [NSURL URLWithString:[NSString stringWithUTF8String:url.c_str()]];
        if (!address) {
            finish("not an address: " + url);
            return;
        }
        delegate = [MPSocketDelegate new];
        delegate.owner = weak_from_this();
        NSURLSessionConfiguration* config = [NSURLSessionConfiguration ephemeralSessionConfiguration];
        config.timeoutIntervalForRequest = 10;
        session = [NSURLSession sessionWithConfiguration:config delegate:delegate delegateQueue:nil];
        task = [session webSocketTaskWithURL:address];
        task.maximumMessageSize = 64 * 1024 * 1024;
        [task resume];
        receive();
    }

    bool send(const std::string& text) override {
        if (done) return false;
        NSURLSessionWebSocketMessage* message =
            [[NSURLSessionWebSocketMessage alloc] initWithString:[NSString stringWithUTF8String:text.c_str()]];
        auto self = shared_from_this();
        [task sendMessage:message
            completionHandler:^(NSError* error) {
              if (error) self->finish(std::string("send failed: ") + error.localizedDescription.UTF8String);
            }];
        return true;
    }

    void close() override {
        if (done) return;
        [task cancelWithCloseCode:NSURLSessionWebSocketCloseCodeNormalClosure reason:nil];
        finish("closed by the app");
    }

    void opened() {
        if (done) return;
        startPings();
        if (events.opened) events.opened();
    }

    /// Ends it once, whichever of the paths that can end it comes first.
    void finish(const std::string& why) {
        if (done.exchange(true)) return;
        if (ping) dispatch_source_cancel(ping);
        [session invalidateAndCancel];
        if (events.closed) events.closed(why);
    }

private:
    void receive() {
        auto self = shared_from_this();
        [task receiveMessageWithCompletionHandler:^(NSURLSessionWebSocketMessage* message, NSError* error) {
          if (error) {
              self->finish(error.localizedDescription.UTF8String);
              return;
          }
          if (message.type == NSURLSessionWebSocketMessageTypeString) {
              if (self->events.text) self->events.text(message.string.UTF8String);
          } else if (self->events.text) {
              self->events.text(std::string((const char*)message.data.bytes, message.data.length));
          }
          if (!self->done) self->receive();
        }];
    }

    void startPings() {
        std::weak_ptr<MacSocket> weak = weak_from_this();
        ping = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_global_queue(QOS_CLASS_UTILITY, 0));
        dispatch_source_set_timer(ping, dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_SEC), 20 * NSEC_PER_SEC, NSEC_PER_SEC);
        dispatch_source_set_event_handler(ping, ^{
          auto self = weak.lock();
          if (!self || self->done) return;
          [self->task sendPingWithPongReceiveHandler:^(NSError* error) {
            if (error) self->finish("no answer to a ping");
          }];
        });
        dispatch_resume(ping);
    }

    platform::SocketEvents events;
    std::atomic<bool> done{false};
    MPSocketDelegate* delegate = nil;
    NSURLSession* session = nil;
    NSURLSessionWebSocketTask* task = nil;
    dispatch_source_t ping = nil;
};

}  // namespace

@implementation MPSocketDelegate
- (void)URLSession:(NSURLSession*)session webSocketTask:(NSURLSessionWebSocketTask*)task didOpenWithProtocol:(NSString*)protocol {
    if (auto owner = self.owner.lock()) owner->opened();
}
- (void)URLSession:(NSURLSession*)session
         webSocketTask:(NSURLSessionWebSocketTask*)task
    didCloseWithCode:(NSURLSessionWebSocketCloseCode)code
              reason:(NSData*)reason {
    if (auto owner = self.owner.lock()) owner->finish("closed by the service (" + std::to_string(long(code)) + ")");
}
- (void)URLSession:(NSURLSession*)session task:(NSURLSessionTask*)task didCompleteWithError:(NSError*)error {
    if (auto owner = self.owner.lock()) owner->finish(error ? error.localizedDescription.UTF8String : "ended");
}
@end

namespace platform {

SocketRef openSocket(const std::string& url, SocketEvents events) {
    auto socket = std::make_shared<MacSocket>(std::move(events));
    socket->start(url);
    return socket;
}

void fetch(Request request, std::function<void(Response)> done) {
    NSURL* address = [NSURL URLWithString:[NSString stringWithUTF8String:request.url.c_str()]];
    if (!address) {
        Response r;
        r.error = "not an address: " + request.url;
        done(r);
        return;
    }
    NSMutableURLRequest* req = [NSMutableURLRequest requestWithURL:address];
    req.HTTPMethod = [NSString stringWithUTF8String:request.method.c_str()];
    req.timeoutInterval = request.timeout;
    for (const auto& [name, value] : request.headers) {
        [req setValue:[NSString stringWithUTF8String:value.c_str()] forHTTPHeaderField:[NSString stringWithUTF8String:name.c_str()]];
    }
    if (!request.body.empty()) req.HTTPBody = [NSData dataWithBytes:request.body.data() length:request.body.size()];
    std::string saveTo = request.saveTo;
    NSURLSessionDataTask* task = [[NSURLSession sharedSession]
        dataTaskWithRequest:req
          completionHandler:^(NSData* data, NSURLResponse* response, NSError* error) {
            Response r;
            if (error) {
                r.error = error.localizedDescription.UTF8String;
            } else {
                NSHTTPURLResponse* http = (NSHTTPURLResponse*)response;
                r.status = int(http.statusCode);
                NSString* type = http.allHeaderFields[@"Content-Type"];
                if (type) r.contentType = type.UTF8String;
                if (!saveTo.empty()) {
                    if (r.status >= 200 && r.status < 300 && ![data writeToFile:[NSString stringWithUTF8String:saveTo.c_str()] atomically:YES]) {
                        r.error = "could not write " + saveTo;
                    }
                } else if (data) {
                    r.body.assign((const char*)data.bytes, data.length);
                }
            }
            done(r);
          }];
    [task resume];
}

}  // namespace platform

namespace platform {

// The preview has no keyboard of its own to bring up; `-agentType <words>` stands in for typing there.
bool showKeyboard(const std::string&, KeyboardEvents) { return false; }
void hideKeyboard() {}

}  // namespace platform

