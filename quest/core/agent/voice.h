// Talking to the agent on the headset, as in the web client: its name wakes it ("hey Momo"), what follows is recorded,
// transcribed by the service (POST /api/transcribe) and sent as an `utter`, and the agent's replies (`say`) are heard
// through the service's voice (GET /api/speak). Nothing it hears leaves the headset unless it began with what
// its spotter took for the name; the service checks the sound of each wake, and drops what was not the name.
//
// When the service has a live voice (hello's `live`, and its /live socket), the words go another way: the name opens a
// conversation, and while it is open whatever the user says streams to the service as a turn, until the service says the
// turn is over, with no name needed. Momo's voice streams back and plays as it arrives, and the user talking over it stops
// it at once (`start`). The conversation closes once nobody has talked for 8 seconds. Without /live, or while it is
// closed, everything is as above.
//
// It also says what it is doing, for Momo's presence in the scene (`presence`). Momo has three sounds of its own: the
// chime as the name is heard, a short tone as the user's turn is sent, and a quiet loop while Momo thinks, until the
// first sound of the answer. They are synth.py's (momo_chime, momo_sent, momo_thinking), in the ocean's key, and play
// through its mixer (audio.h). `-mute` silences all of them, and Momo's voice.
//
// The microphone, or `-wakeClip <file.wav>` in its place, feeds the listener on the host's sound thread. The frame
// thread asks things of the listener through a queue, applied by whichever thread holds the listener next, and hears
// what came of it through another; it never waits for the sound thread.
#pragma once
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "client.h"
#include "crew.h"
#include "json.h"
#include "listener.h"
#include "platform.h"
#include "presence.h"

namespace agent {

/// GUIDE: one of the app's lines recorded in Momo's voice (media `voice/<file>`), as `voice/manifest.json` lists it: where
/// it is, its words exactly as said, and how long it is. Read once; nothing when the app does not carry it.
struct RecordedLine {
    std::string path, text;
    double seconds = 0;
};
std::optional<RecordedLine> recordedLine(const std::string& name);
/// A recorded line's sound: 16-bit PCM, one channel, at `rate`. Read through the platform, which reads a file inside
/// the APK as well as one pushed beside it (a media player given the APK's path cannot open it: WS78 on the headset).
/// Nothing, and why in `why`, when it can't be read.
struct RecordedSound {
    std::vector<int16_t> samples;
    int rate = 0;
};
std::optional<RecordedSound> recordedSound(const RecordedLine& line, std::string& why);
/// GUIDE: a recorded line played alone, where there is no voice to say it as Momo's (no service in this copy): through the
/// same stream player her replies use. Null when it can't be.
platform::StreamRef playRecordedAlone(const RecordedLine& line, std::function<void(bool played)> done);

class Voice {
public:
    /// `scene` says where the user is when they speak. `clip` feeds a recording instead of the microphone. `muted`
    /// plays no sound at all, yet takes the time Momo's voice would.
    Voice(Client& client, std::function<Scene()> scene, std::optional<std::string> clip, bool muted);
    ~Voice();
    Voice(const Voice&) = delete;
    /// WS103 (the user: "momo should be mute when that tree is closed"): whether no tree stands. While none does, what a
    /// piece of work brings is not said or shown; an answer to what the user said always is.
    std::function<bool()> away;
    Voice& operator=(const Voice&) = delete;

    /// Every connect: the name to listen for, whether the service reads replies aloud, whether it has a live voice, and
    /// this connection's id, which /live names so that what Momo starts is this headset's own. The first starts listening.
    /// /live is opened only while the last hello offered it, and again when the connection's id changes.
    void joined(const Settings& settings, bool serviceSpeaks, bool live, const std::string& connection = "");
    void renamed(const std::string& name);
    /// A reply to speak. One that arrives while the user is recorded waits until the recording ends. While /live is
    /// ready the service voices it there, and this only logs it.
    void say(const std::string& text);
    /// A question picked or typed under a card, which the service took: it is sent, and Momo thinks until the first
    /// sound of an answer or until the work on it starts.
    void asked(const std::string& question);
    /// Work the agent began or ended.
    void activity(const Activity& a);
    /// Once a frame, on the frame thread, with the frame's clock in seconds.
    void frame(double now);
    /// What it is doing, as of the last frame.
    const Presence& presence() const { return shown; }

    /// Seconds before each try to open the microphone again after it failed. The last repeats.
    static constexpr double reopenDelays[] = {1, 2, 4, 8, 15};
    /// Seconds before each try to open /live again after it closed or was refused.
    static constexpr double liveRetry = 5;
    /// Seconds the turn shows as sent before Momo thinks.
    static constexpr double sentFor = 0.4;
    /// Seconds Momo thinks at most, should nothing ever end it.
    static constexpr double longestThought = 20;
    /// Seconds the note on a microphone that is off shows (`addressedWithoutMicrophone`), and once the user refuses it.
    static constexpr double refusalShown = 10;
    /// s Momo's words run ahead of her voice, when the service says how long a reply's recording is (a demo take's line).
    /// The user, 2026-11-17: "I'd rather transcript to be a little ahead of realtime speech than being laggy".
    static constexpr double wordsAhead = 0.3;
    /// The same for her live voice, whose words come from the service a little after the sound they belong to, so they
    /// are shown further ahead of what has been heard. The user, 2026-11-18: "momo speaks faster than transcription appears".
    static constexpr double liveAhead = 0.6;

    /// nullopt while it does not listen: until the model is ready and sound comes, while the microphone is down, and
    /// for good once the user refuses it.
    std::optional<Listener::State> state() const;
    /// The name it answers to, as said: "Momo".
    std::string name() const;
    /// The reply being spoken, while one is.
    const std::string& saying() const { return spoken; }

    // GUIDE: added for the welcome walk's two steps with Momo (core/ocean/oceanmodel_guide.cpp). While a tutor is
    // set, what the user says after the name goes to it and not to the service, and turns are recorded and
    // transcribed, never streamed to /live: there Momo would act on the words before the walk had seen them.
    struct Tutor {
        std::function<void()> woke;                             // the name was heard
        std::function<void(const std::string& words)> said;     // what followed it; empty when nothing could be made of it
    };
    void tutor(std::optional<Tutor> t);
    /// Whether it can hear, and if not why: for the walk to say so. `unasked`: the microphone has never been asked for on
    /// this install, and is asked for where it is first needed (WS95); `refused`: the user did not allow it, and the
    /// system would ask them again; `settingsOnly`: it has stopped asking, and only its Settings can allow it.
    enum class Hearing { ready, starting, unasked, asking, refused, settingsOnly, off };
    Hearing hearing() const;
    /// WS87, WS95: the one way the microphone is asked for, first and again: by the walk's lessons by speaking as they
    /// begin, by the greeting after the walk, by Momo addressed without it (`addressedWithoutMicrophone`), and by the
    /// buttons for it (the note's "Allow microphone", the walk's "Open Settings").
    /// - Never asked on this install: the system asks now, Momo's caption saying `why` while it does (by default, "Allow
    ///   the microphone to talk to Momo"). Before the listener's model has loaded, it asks once it has.
    /// - Refused (its window missed, or answered no): listening starts over and the system asks again.
    /// - Where the system no longer asks, and `orSettings` (a button was pressed: nothing else sends the user out of the
    ///   app), its Settings for this app open; where they can't be, `settingsWontOpen`.
    /// Nothing where the microphone is allowed.
    void askForMicrophone(bool orSettings = false, const std::string& why = "");
    /// As `askForMicrophone`, only where it has never been asked for on this install: the greeting after the walk (WS95),
    /// which never asks again for one refused.
    void askForMicrophoneFirst(const std::string& why);
    /// The microphone is not allowed: Momo shows a quiet mark for it.
    bool microphoneOff() const { return microphoneRefusedAt >= 0; }
    /// Momo addressed by what works without the microphone, her name being unheard without it: a pinch on her or her
    /// mark, a question picked. Never asked, the microphone is asked for now; refused, her note shows what is wrong, with
    /// "Allow microphone", for `refusalShown` or until her reply sounds. Nothing while the microphone is allowed.
    void addressedWithoutMicrophone();
    /// "Open Settings" could not open them: the words for where to switch the microphone on stand alone.
    bool settingsWontOpen() const { return settingsUnopened; }
    /// GUIDE: a line of the walk's own, recorded in Momo's voice and carried in the app (`recordedLine`): spoken as a reply
    /// of hers is, through her stream player, with or without the service, its words shown as she says them. How long it
    /// is, s; nothing when there is no such line or its sound can't be read (said in the log).
    std::optional<double> tellRecorded(const std::string& name);
    /// How many recorded lines could not be played once their turn came: the walk need not wait for one that won't sound.
    int recordedFailures() const { return failedRecordings; }
    /// GUIDE: the sketch lesson's words, put to the live Momo with what the lesson shows (agents/docs/protocol.md, the
    /// `lesson` frame). She answers as she answers anything. Where she can't be reached, says nothing for the turn
    /// (`quiet`), or has made no sound `lessonWait` s after, the recorded line `fallback` is said instead.
    struct LessonAsk {
        std::string words, picture;
        std::vector<std::pair<std::string, std::string>> cards;     // each card's title, and what it says
    };
    void askLesson(const LessonAsk& ask, const std::string& fallback);
    static constexpr double lessonWait = 4;
    /// GUIDE: the walk has moved on from a lesson of Momo's (WS80): nothing of hers for it starts after (a transcript
    /// under way for the walk, a recorded line waiting its turn, the lesson's live answer or its fallback), and what of it
    /// is playing is cut short with a quick fade (`walkFade`).
    void leaveWalkTurn();
    /// s her lines for the walk are fed to the player ahead of being heard, which is how soon a fade can begin; and s the
    /// fade takes.
    static constexpr double walkAhead = 0.2, walkFade = 0.12;
    /// A reply has come from the service and has not begun to sound yet: Momo is about to speak. At most `lineWait`.
    bool lineComing() const { return lineAt >= 0 && clock - lineAt < lineWait; }
    static constexpr double lineWait = 5;

private:
    struct Done {};
    struct AskToSpeak {};
    struct ReplyEnded {};
    struct ChimeStarted {};
    struct ChimeEnded {};
    struct Respell {
        std::unique_ptr<Spotter> spotter;
    };
    struct SetMode {
        Listener::Mode mode;
    };
    struct TurnOver {};
    struct NotNamed {};
    struct ReplyStreams {};
    struct MomoThinks {
        bool thinking = false;
    };
    using Command = std::variant<Done, AskToSpeak, ReplyEnded, ChimeStarted, ChimeEnded, Respell, SetMode, TurnOver, NotNamed, ReplyStreams, MomoThinks>;
    /// The listener and what crosses to it: the sound thread hears; the frame thread sends commands and takes events.
    struct Ears;
    struct Transcript {
        bool ok = false;
        std::string text;
        std::string why;
        int walk = -1;              // GUIDE: recorded for the walk's ears, as they were lent then (`tutorEpoch`); -1 when not
        /// The service found the name at the start of the recording. Without it, what woke the headset was not the name.
        bool named = true;
    };
    struct Fetched {
        int reply = 0;
        bool ok = false;
        std::string file;
        std::string why;
    };
    /// What the service says on /live, read on the socket's thread.
    struct LiveReady {
        int rate = 0;
    };
    struct LiveOver {
        int turn = 0;
    };
    struct LiveAudio {
        std::string id;
        std::vector<int16_t> pcm;
    };
    struct LiveHeard {
        int turn = 0;
        std::string text;
        bool final = false;
    };
    struct LiveQuiet {
        int turn = 0;
    };
    struct LiveText {
        std::string id;
        int turn = 0;               // the turn it answers, when it answers one
        std::string text;
        bool results = false;       // what a piece of work brought, not the answer to what was just said
        double length = 0;          // s: the whole recording's, when the text came whole with it (`ms`); 0 for the live voice
        double from = 0;            // s into the recording its sound starts at (`from`): past 0 when the take began mid-line
    };
    struct LiveDone {
        std::string id;
    };
    /// The service's check of the sound that woke the headset: whether it was the name (agents/DECISIONS.md 70).
    struct LiveNamed {
        bool ok = true;
    };
    struct LiveFailed {
        std::string why;
    };
    struct LiveClosed {
        std::string why;
    };
    using LiveFrame = std::variant<LiveReady, LiveOver, LiveHeard, LiveQuiet, LiveAudio, LiveText, LiveDone, LiveNamed, LiveFailed, LiveClosed>;
    /// Which socket said it: one closed or replaced is not listened to.
    struct FromLive {
        int socket = 0;
        LiveFrame frame;
    };
    /// What host threads hand back to the frame thread.
    struct Inbox {
        std::mutex lock;
        std::vector<Transcript> transcripts;
        std::vector<Fetched> fetched;
        std::vector<int> played;
        std::vector<FromLive> live;
        std::vector<int> streamsPlayed;
        bool microphoneFailed = false;
        bool microphoneRefused = false;
        bool microphoneAsking = false;
    };

    Client& client;
    std::function<Scene()> scene;
    std::string hushedResults;      // WS103: what a piece of work brought while no tree stood, not said: its id
    std::optional<std::string> clip;
    bool muted;
    std::shared_ptr<Ears> ears;
    std::shared_ptr<Inbox> inbox = std::make_shared<Inbox>();
    platform::MicrophoneRef microphone;
    bool askingForMicrophone = false;   // the user is asked to allow it and has not answered
    double microphoneRefusedAt = -1;
    bool microphoneSettingsOnly = false;    // refused, and the system no longer asks
    bool settingsUnopened = false;          // the system's Settings could not be opened from here
    bool microphoneUnasked = false;         // never asked for on this install: nothing is opened until it is wanted
    bool askWhenLoaded = false;             // wanted before the listener's model had loaded: asked for once it has
    std::string askingWhy;                  // what the caption says while the system asks
    double noteUntil = -1;                  // the note on a microphone that is off shows until then
    int microphoneFailures = 0;     // in a row, since sound last came
    double reopenAt = -1;
    std::shared_ptr<const Vocabulary> vocabulary;
    std::string modelDir;
    bool started = false;
    std::string spelled = "momo";   // the name the spotter listens for
    std::string wanted = "momo";    // the name the service gave
    std::string refused;            // a name the spotter cannot spell, already said so
    bool serviceSpeaks = false;
    std::optional<std::string> pending;     // a reply waiting for the listener's leave to play
    int reply = 0;                  // the reply playing or on its way; earlier ones are let go
    platform::SoundRef sound;
    std::string spoken;
    /// GUIDE: a recorded line waiting for the listener's leave to play, its words and its sound.
    std::optional<std::pair<RecordedLine, RecordedSound>> pendingRecorded;
    int failedRecordings = 0;
    /// GUIDE: the sketch lesson put to the live Momo: its turn, when, what to say if she doesn't, and her reply's id
    /// once its words come.
    struct Lesson {
        int turn = 0;
        double sentAt = 0;
        std::string fallback, id;
    };
    std::optional<Lesson> lesson;
    std::string lateLesson;         // a lesson's reply that came too late to be heard: its id, and its turn
    int lateTurn = 0;
    void playRecorded(const RecordedLine& line, const RecordedSound& sound);

    /// /live: shut until a retry while the last hello offered it, connecting, or ready.
    struct Shut {
        double retryAt = 0;
    };
    struct Connecting {
        platform::SocketRef socket;
        int number = 0;
    };
    struct Ready {
        platform::SocketRef socket;
        int number = 0;
        int rate = 0;
    };
    std::variant<Shut, Connecting, Ready> link = Shut{};
    bool liveOffered = false;       // the last hello said the service has a live voice
    std::string connection;         // the /ws connection's id, as the last hello gave it
    int sockets = 0;
    std::string liveWhy;            // why /live last closed, already logged
    int turns = 0;
    /// The turn whose microphone streams to the service, if one does.
    std::optional<int> streaming;
    double lastWord = 0;            // when the turn's last word was heard, on `mediaTime`'s clock; 0 before one
    std::optional<double> answering;  // a turn is over and Momo's first sound for it has not come: its last word
    /// The response Momo is giving on /live, for the label.
    struct LiveReply {
        std::string id;
        std::string text;
        double length = 0, from = 0;    // as its text came (LiveText)
        int player = 0;             // the number of the player its first sound started; 0 before it
        /// Its sound while an earlier reply still plays out, so the two are heard one after the other.
        std::vector<int16_t> held;
        bool finished = false;      // all of it came while it was held
    };
    std::optional<LiveReply> live;
    /// `-mute`'s stand-in for the host's stream player.
    class Unheard;
    /// `-mute`'s stand-in for a reply file: it plays nothing, and is heard to its end once its words would have been said.
    struct UnheardFile : platform::Sound {
        void stop() override {}
    };
    struct UnheardReply {
        int number = 0;
        double until = 0;
    };
    std::optional<UnheardReply> unheardReply;
    /// The player sounding: the last one started, which a finished response's may still be as the next one's text comes.
    /// While it sounds the listener is told a reply plays.
    struct Sounding {
        int number = 0;
        platform::StreamRef player;
        std::shared_ptr<Unheard> unheard;   // the player, when muted
        int rate = 0;
        std::string text;           // what the response says, all of it so far
        /// s: its whole recording, and where in it the sound starts, when the service said (a demo take's line): its words
        /// then show by how far into that the voice is. 0: by how much of the sound come so far has been heard.
        double length = 0, from = 0;
        bool recorded = false;      // GUIDE: a line of the walk's own (`tellRecorded`), not a reply from the service
        /// GUIDE: hers for the walk (a recorded line, or the lesson's live answer): fed to the player `walkAhead` at a
        /// time from `queued`, so it can be faded; finished once `ending` and all of it fed.
        bool walk = false, ending = false, finishedFeeding = false;
        std::vector<int16_t> queued;
        size_t fed = 0;
        size_t written = 0;
        /// Seconds of it heard by now, as far as the frame clock tells: never ahead of what was written.
        double played = 0;
        /// The loudness of what was written, a fiftieth of a second at a time, for the presence's level.
        std::vector<float> loudness;
        double sum = 0;             // of squares, of the fiftieth being written
        int summed = 0;
        void write(const int16_t* samples, size_t count);
    };
    std::optional<Sounding> sounding;
    int players = 0;
    double chimeEnds = -1;          // when the chime playing ends, on the frame clock
    double busyLogged = 0;
    double clock = 0;               // the last frame's
    double lineAt = -1;             // when the reply that has not begun to sound came, or -1
    bool thinkingTold = false;      // what the listener was last told of Momo thinking

    /// The user's turn, as Momo's presence shows it: from the name, or the first words in an open conversation, to the
    /// first sound of Momo's answer. Outside a turn the presence is read from whether Momo's voice sounds and from the
    /// work in progress.
    struct Idle {};
    struct Listening {};
    /// Between turns, the conversation is open and nothing sounds: Momo hears the user without its name.
    struct Open {};
    /// The turn is sent and its tone plays; after `sentFor` Momo thinks. `endsWithWork`: no answer will be heard,
    /// so thinking also ends when the work starts. `settled`: what ends thinking came while it was sent.
    struct Sent {
        double at = 0;
        bool endsWithWork = false;
        bool settled = false;
    };
    /// Until the first sound of the answer, with the loop playing.
    struct Thinking {
        double since = 0;
        bool endsWithWork = false;
    };
    using Turn = std::variant<Idle, Listening, Open, Sent, Thinking>;
    Turn turn = Idle{};
    std::optional<Tutor> tutoring;      // GUIDE
    int tutorEpoch = 0;                 // GUIDE: counts each lending or taking back of the ears (WS80)
    std::string walkReply;              // GUIDE: the id of the lesson's live answer, once it sounds
    /// GUIDE: feeds the walk's sounding its next `walkAhead` of sound, and finishes it when all is fed.
    void feedWalk();
    /// The live turn whose words the presence shows, from `heard`; 0 for none.
    int wordsOf = 0;
    /// The agents at work, for their lines and Momo's monocle.
    Crew crew;
    Presence shown;

    /// Loads the listener's model, then opens the microphone where it is allowed, or `ask`ed for (WS95: never at launch
    /// unasked; a microphone refused on an earlier run stays refused, with its mark, until asked for again).
    void start(bool ask = false);
    /// Every change of turn goes through here: leaving thinking stops its loop, and being sent plays the tone.
    void turnTo(Turn next);
    /// No answer is coming, or the work began: thinking ends, once the turn has shown as sent.
    void endThinking();
    /// The turn is sent and its answer has not begun.
    bool awaiting() const { return std::holds_alternative<Sent>(turn) || std::holds_alternative<Thinking>(turn); }
    /// One of Momo's own sounds, unless muted.
    void own(const char* name);
    /// Plays a sound file, unless muted.
    platform::SoundRef play(const std::string& path, std::function<void(bool)> done);
    /// The presence, from the turn, Momo's voice and the work in progress.
    void show();
    void openMicrophone();
    /// After a refusal: listening starts over, from loading the listener's model, as at first.
    void listenAgain();
    void respell();
    void send(Command command);
    void transcribe(const std::string& wav, int walk = -1);
    void speak(const std::string& text);
    void openLive(double now);
    /// /live closed, or the service has no live voice: the old path from now on, tried again in `liveRetry` while the
    /// last hello offered it.
    void liveDown(const std::string& why, double now);
    bool sendLive(const Json& frame);
    void heardLive(LiveFrame& frame, double now);
    /// The user began talking: a new turn streams, and what Momo is saying stops.
    void beginTurn();
    void endTurn();
    /// Stops the live reply at once; its end, when the host reports it, is let go.
    void hushLive();
    LiveReply& liveReply(const std::string& id);
    /// Starts the player for the live reply, with what it held. False when the host cannot play.
    bool startPlayer(LiveReply& reply);
};

/// The first `share` of `text`, ending on a whole word, or on a whole character in words without spaces, as Chinese: as
/// much of Momo's words as her voice has come to.
std::string revealed(const std::string& text, double share);

}  // namespace agent
