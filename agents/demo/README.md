# The walkthrough demo

One prepared tree, "Brainstorming in a headset", for recording the film. It is the walkthrough board made real: 31 rounds of asking, 154 cards, each round a layer of the tree.

- You go to any round from a page on the Mac. The tree then stands on the headset as it was just before that round, and you record from there.
- Each round is a fixed take: the same cards at the same moments, the same labels of the agents at work, and Momo saying the same lines, every time. You start it by saying the round's line in the headset, or with one Play button on the page, and a bar on the page moves through it like a film's.
- Nothing in the app is special-cased. The cards are ordinary cards (pictures, artworks, papers, notes, links), drawn by the app's own card system.

![The control page: the rounds in recording order, the chart, and the round that is picked](docs/control-page.jpg)

![The whole tree in the app, each round a layer and each branch its own colour](docs/tree-in-the-app.jpg)

## Where it is

The demo is on the branch `demo/walkthrough`, which holds `tracy/agents` as it stood late on 2026-11-16 (a817e83: the fist, the knife, the welcome walk's lessons, the looser "Hi Momo" and Momo's new look) and adds the demo to the service. The app's own code is the same as on `tracy/agents`.

- **On Kai's Mac** it is already checked out, in a second folder beside the main one, so the main folder and the work under way in it are left alone:

  ```bash
  cd <the demo's folder>
  ```

  Every command below is run from that folder. A release APK built from it on 2026-11-16 is at `quest/android/app/build/outputs/apk/release/app-release.apk`. An earlier build from this branch, without Momo's new look, was installed on Kai's headset that afternoon for the test below.

- **On another Mac:**

  ```bash
  git fetch origin && git switch demo/walkthrough && git lfs pull
  ```

## Set up, once

1. **Keys.** `~/.muse-garden.env` needs two lines: `MODEL_API_KEY=...` and `OPENAI_API_KEY=...`. Without the OpenAI key the demo runs but Momo can neither hear nor speak, and the page says "Momo's voice off". A key file kept somewhere else is named when the service is started: `MIND_PALACE_ENV=<file> npm run demo` (it is then the only one read). When the service starts with the key it prints `voice  Momo is live`.
2. **The service's packages.**

   ```bash
   cd agents && npm install
   ```

3. **The app on the headset.** The demo needs nothing special in the app: any copy that is up to date with `tracy/agents` will do. It is recorded on the everyday copy, "Mind Palace Ocean", which is the one kept up to date. To build and install it from this folder, with the headset on the cable, from the repository's root:

   ```bash
   quest/tools/run.sh --build --release
   ```

   That installs over the copy already there and keeps its files (on Kai's headset this was done on 2026-11-16). A headset that never had the app also needs its sounds, fonts and library, about 900 MB, once: `quest/tools/push_media.sh`. Both need two folders git does not hold: `quest/vendor` (`quest/tools/fetch-voice.sh` downloads it, 78 MB) and `media-src/quest/works-small` (`quest/tools/works_small.sh` makes it). In the second folder on Kai's Mac both are links to the main folder's.

   To build the APK without a headset:

   ```bash
   source quest/tools/env.sh && cd quest/android && ./gradlew assembleRelease -PoceanScene=ON
   ```

   It lands in `quest/android/app/build/outputs/apk/release/app-release.apk`, and installs with `adb install -r`.

   Kai's headset holds other copies too. "Mind Palace Ocean (agents)" there is an older build signed on another Mac, which a build from this Mac cannot be installed over: the demo does not use it. Another copy is used by naming its suffix, for example `QUEST_APP_SUFFIX=.film` before the commands here for the filming copy.

## Each recording session

1. **Start the service in demo mode.**

   ```bash
   cd agents && npm run demo
   ```

   It prints two addresses. The one marked `demo` is the control page. It keeps its own data folder, `agents/data-demo`, so your real mindstorm is never touched.

2. **Join the headset**, from the repository's root, with the headset on the cable:

   ```bash
   agents/demo/headset.sh
   ```

   It starts the app on the headset joined to the demo service, and the page's "Headset joined" light turns green. To go cable-free after that, run `agents/demo/headset.sh wifi` (the cable is needed this once), and `agents/demo/headset.sh resume` after the headset slept.

3. **Open the control page** on the Mac: the `demo` address the service printed (`http://localhost:8787/demo#token=...`), or `agents/demo/headset.sh page`, which opens it for you.

When the recording is over, put the app back on the hosted service, or it will go on looking for the demo on this Mac each time it is opened:

```bash
agents/demo/headset.sh back
```

## On Fly, without the Mac

The same demo can run as a small service of its own on Fly, so that nothing has to run on a Mac while you record: the headset joins it over Wi-Fi, and the control page opens in any browser. It is another Fly app (`mind-palace-walkthrough`), beside the judging service and sharing nothing with it. As of 2026-11-16 it is written and tried on a Mac laid out as its image would be, and **not deployed**: Kai's Mac has no Fly login.

**To put it there** (on the Mac that deploys the judging service, logged in to Fly, with the keys in `~/.muse-garden.env`):

```bash
git fetch origin && git switch demo/walkthrough && git lfs pull
```

```bash
cd agents && npm install && deploy/demo.sh setup
```

`setup` makes the app the first time; later deploys are `deploy/demo.sh` alone (after a change to the code, the script or the trees). The keys go up from that Mac's env file, none printed, and without the Telegram ones. The demo's own address and key are written to `~/.mind-palace/demo.properties`: send that file to whoever records, to keep at the same place on their Mac.

**To use it** (on a Mac that has `~/.mind-palace/demo.properties`):

```bash
agents/demo/headset.sh fly-page
```

opens the control page, and with the headset on the cable, once:

```bash
agents/demo/headset.sh fly
```

starts the app joined to the demo on Fly. The app remembers it: from then on it joins by itself over Wi-Fi whenever it is opened, with no cable and no Mac. `agents/demo/headset.sh back` returns it to the judging service, as after a recording on the Mac. The judging copy of the app, "Mind Palace", is never touched: it always joins the judging service.

What differs from the Mac:

| | On the Mac | On Fly |
|---|---|---|
| While recording | the Mac runs `npm run demo`, the headset on its cable or Wi-Fi adb | nothing runs on a Mac |
| Momo's voice | needs the OpenAI key on the Mac | uses the keys set on Fly |
| Empty stage | the page starts the app again on the headset itself | the page cannot reach the headset: after pressing it, close the app on the headset and open it |
| The stage after the service restarts | kept in `agents/data-demo` | begins again with the showcase trees and no walkthrough tree (it has no volume) |
| The lines you wrote over Momo's | kept in `agents/data-demo` with their recordings | lost when the service restarts, as it has no volume. The page keeps a copy in the browser you wrote them in, sends them again when it next opens, and Momo records them again. Use Save to script to keep them for good. The data folder is one path (`MIND_PALACE_DATA`), so a volume mounted there would keep them with no change to the code |
| Who can reach it | this Mac and its network | anyone with the address and the key |

Everything else is the same code: the rounds, the page, the showcase trees, Show whole.

## Recording a round

1. On the page, click a round: on the chart, or in the list on the left, which is the recording order. The right column shows what to do and say in it, the card it is asked from, and the cards that will arrive.
2. Press **Go to this round**. The bar counts the rounds as they are built on the headset: about half a second each, and 13 seconds for the whole tree. When it is done the headset stands on the layer where the round begins, with the round's card not yet opened.
3. Start recording. Do the steps under "You do", then say the line under "You say", or say it in your own words. Whatever you say next starts this round's take: Momo answers, the Scout's labels run under her, the cards land dashed as suggestions at the pace of a real search, and she tells you about them as they land and wraps up at the end. Or press **Play** on the page, which runs the same take without a word from you.
4. For the next take of the same round, press **Set this round up again**, or drag the bar back to the start.

### A round's take

The right column shows the picked round's take:

- **Play** runs it on the headset from where the bar is: the scene, Momo's voice with its captions, and the agents' labels together. While it runs the button is **Pause**. A paused take stays exactly as it was at that moment.
- **The bar** shows the take's length and where it is. Its three rows mark when Momo speaks, when the agents work and when cards land. It is for jumping to a moment, not for recording while you drag: the bar moves freely on the page, and when you let go, or click on it, the headset is brought to that moment once. The cards that had landed by then stand, later ones are taken away, and the labels are that moment's. The service answers a jump in a few thousandths of a second, and the headset hangs and removes the cards over about a second. If the take was running it goes on from there, and Momo takes her line up at that very point. The arrow keys move it a second at a time, and each line's time is a button that jumps to it.
- **What Momo says** lists her lines in order, each in a box: her answer as the search starts, the first card as it lands, later cards gathered into one remark, and her wrap-up. These are the moments she speaks at in a real round, no more and no fewer. A round you start with a pinch or by tapping a question has no answer line, since nothing was said.
- **Write over any line** and click outside the box. Momo then says your words: the realtime model, the same voice the headset hears live, is asked as Momo to say the line as written, and a take is kept only once it is heard to be your words. She gets five takes of the whole line, then says it a sentence at a time, the sentences joined at their pauses; a long line can take a minute, and the line shows that she is recording. The bar follows the recording's new length. No other voice is ever used. If she still has not said the line as written, the line is marked in red as not ready, and the page shows the closest thing she did say, with the words that are not yours marked. Until the line is ready the take plays that closest take of hers, in her realtime voice, with its own words as the caption: never silence, and never another voice. **Use her wording** makes that the line's text, so the box and what she says agree, and **Try again** has her try your words once more. "Back to Momo's own words" undoes it. An empty box means she says nothing there.
- **Save to script** downloads `lines.json` with every line as Momo says it now, your words among them. That file is how your wording reaches the repository: put it in place of `agents/demo/lines.json` and commit it. Copy the recordings the service made of your words too, from `demo-voice` in its data folder into `agents/demo/voice`; without them each copy of the demo records those lines itself when it first needs them. Until you save, your words are kept by the service while it runs and in the browser you wrote them in.

How long a round takes is mostly Momo: the found cards land 3 to 6.5 seconds in, a written idea from 13 seconds, a made picture at about 30, and she talks for 30 to 50 seconds. The page shows each take's length.

Three more controls:

- **Empty stage** takes the tree away, for recording Round 1, and starts the app again on the headset (see below). **Whole tree** builds everything.
- **Rounds are scripted**, off: the next request is answered by the real Scout, live, and Momo speaks for herself. On again: the next request starts the next round's take.
- **4 other trees in the forest**, off: the showcase trees (below) are taken out, and the headset's app is started again so it lets go of them.

### Recording Round 1

Round 1 starts the tree, so the stage must be empty. Press **Empty stage**. A headset keeps showing a tree after it is deleted, so the service also starts the app again on the headset, which takes about two seconds: you will see the app close and open with nothing standing. If the page says it could not, do it by hand:

```bash
agents/demo/headset.sh restart
```

Then say the line, or press Play. On an empty stage whatever you say starts the tree and Round 1's take with it: if Momo starts no tree herself within a second and a half of answering, the service starts it for her. The first card always reads "How we brainstorm with a VR headset", and the tree is named "Brainstorming in a headset". Round 1's bar cannot go back to before the tree exists, since a headset keeps a tree that is deleted: its start is the tree with its first card alone.

## What is fixed and what is live

| Fixed by the script | Live |
|---|---|
| Which cards a round brings, their words, pictures and order, and the moment each lands | Momo's hearing: she still hears you, and that starts the take |
| The step labels ("Checking what you already have", "Searching Wikimedia Commons", "Making a picture of ...") and when each shows | What she says and does when the open card is not one a round waits on |
| What Momo says in a round, and when: her written lines, said from recordings | Everything she says with "Rounds are scripted" off |
| The questions offered under the card a round is asked from | The questions under every other card |
| Each card's look | Anything you ask after the last round, or with scripting off |

Momo's lines are Momo's own, in her live voice: each round's line was put to the realtime model, with her instructions and her voice, with the tree as it stands at that round, and she was then told of the round's cards in the very notes a real round gives her, at the moments this take lands them (`scripts/demo-lines.ts`). What she answered aloud is the recording, and what she said is the line's text. Each recording was then written out from its sound and compared with its text, and one that differed was said again as written. Her words are in `agents/demo/lines.json`, each line's recording in `agents/demo/voice/`, and `voices.json` there names every recording that is in her realtime voice: a file it does not name is never played. So every copy of the demo says the same. Where many cards land at once she was asked to count them and name her favourite, as the demo has always asked, where a live round asks for every name.

While a round can start or is playing, Momo's own live voice is kept from the headset and she is told nothing of the cards, so the recorded lines are the only voice heard. With no round waiting on the open card she speaks for herself as ever.

How a request finds its round:

1. A question the script names (the four under "How do we build this") plays its round, whenever it is picked.
2. A request on the card a round is asked from plays that round.
3. Any other request plays the next round in order, on whatever card you asked on. You are followed, not the script, so a take never fails because a different card was open.

A stray request therefore also brings the next round. If that happens, go to the round again.

Momo's own rule is that a question gets an answer and no cards, and half the walkthrough's lines are questions ("so how do we keep the information organized?"). So while a round waits on the card you have open, she is told so at the start of your turn, and takes whatever you say next as a request for a new layer on it: a few words of her own, then the search. On any other card she is herself: a question is answered aloud, and a request for things to look at brings the next round.

## When something is off

| What you see | What to do |
|---|---|
| "No headset joined" | Run `agents/demo/headset.sh` again. On Wi-Fi, after the headset slept: `agents/demo/headset.sh resume`. |
| "Momo's voice off" | `OPENAI_API_KEY` is missing from `~/.muse-garden.env`. Add it and start the service again. |
| The headset shows the tree flat, on one layer | It joined after the tree was built. It is set up again by itself a second after joining; if not, press Go to this round. |
| An old tree stays on the headset after Empty stage | Start the app again: `agents/demo/headset.sh restart`. |
| The app on the headset shows your real trees, not the demo | It is joined to the hosted service. Run `agents/demo/headset.sh`. |
| After the recording, the app shows nothing and Momo does not answer | It is still looking for the demo on this Mac. Run `agents/demo/headset.sh back`. |
| You said the line and nothing happened | The card you had open is not the one the round is asked from (the page names it under "Asked from"). Open that card and say it again, or press Play. |
| Play says the tree is not set up for the round | A take hangs its cards on the tree as it stands just before its round. Press Go to this round first. |
| A line says Momo is recording for long | Each take is as long as the line, and she may need up to five. If it never ends, the voice did not answer: click in the box and out again, or check `OPENAI_API_KEY`. Until it is recorded the line is not heard. |
| A line is marked in red as not ready | Momo changed a word in every take. Press Use her wording, or reword the line a little: names in quotation marks and long lists are what she most often changes. |
| Momo says a line you want changed | Write over it in its box on the page. |
| The wrong round arrived | Press Go to this round. |
| The page says the service is not answering | The service stopped: `cd agents && npm run demo`. The tree is kept in `agents/data-demo` and is taken up where it stood. |

## Trying it without a headset, or without keys

```bash
cd agents && npm run demo:fake
```

runs the demo with stand-in roles: no model, no voice, no cost. The page, going to rounds and playing them all work.

The Mac preview of the app joins the same way as a headset (build it first with `quest/desktop/build.sh`):

```bash
quest/desktop/preview -agent ws://127.0.0.1:8787 -agentToken "$(cat agents/data-demo/token)" -cards -mute
```

`cd agents && node --no-warnings --import tsx --test test/demo.test.ts` runs the demo's own tests.

## The showcase trees

Four whole trees stand in the forest beside the walkthrough's, so the space looks lived in. They were made on 2026-11-16 from the Pinterest boards of the profile the request named, plus things found outside:

| Tree | Its first card | Cards | From |
|---|---|---|---|
| Paper architecture | What can one folded sheet build? | 51 | the Paper architecture, Paper sculpture and Architecture sketchbook boards; The Met |
| Seed spirals | Why do seeds grow in spirals? | 45 | the Seed board and five pins of the Graph board; the Art Institute of Chicago, NASA |
| Imaginary planet | What would my imaginary planet look like? | 50 | the imaginery planet, Art inspiration and UI boards; the Cleveland Museum of Art, NASA |
| Constellations | How do scattered dots become one picture? | 46 | the 117 pins of the Graph board that the walkthrough does not use; Wikimedia Commons |

![The forest with the showcase trees put away](docs/showcase-forest.jpg)

![Constellations standing whole](docs/showcase-constellations.jpg)

- They are planted when the service starts, their cards kept, and stay through every set-up. **Empty stage** takes only the walkthrough's tree away, so Round 1 is recorded with these four standing in the forest; switch them off on the page for a bare forest.
- They are not played round by round. Opened on the headset, one is the user's own tree: asked on, the real Scout answers, and Momo is herself.
- A tree that arrives whole lies on one layer in the app, its deeper cards bunched small behind the first layer: a card takes a layer of its own only once it is asked on. To show a tree with every layer standing, press its row under **Other trees in the forest** on the page (**Show whole**): the headset is taken through the tree, which takes a few seconds, and rests on its first card.
- Each tree is a folder of `agents/demo/showcase/`: `tree.json` (the cards as the script writes them, each with the card it hangs from in `parent`) and `media/`. `python3 agents/demo/showcase/check.py <name> --sheet` checks one and writes a sheet of its pictures to look over. A tree must branch: 36 to 52 cards, at least eight cards with two or more under them, and lines of thought four layers deep. A tree whose file does not hold together is left out when the service starts, and the log says why.
- The pins are other people's work, of unknown rights, as in the walkthrough's tree. What was found outside is public domain or openly licensed, and each card records its licence, credit and page. In a few cards the agents that wrote them were unsure of a detail (a date taken from a neighbouring record, a maker named only by Pinterest's title); `agents/demo/docs/showcase-notes.md` lists them.

Tried on the Mac preview of the app: all four plant, are put away in the forest, and stand whole with their layers (pictures above and in `docs/`). Not tried on a headset.

## Changing the tree

Everything the demo shows is in two places:

- `agents/demo/script.json`: the rounds in recording order. Each has `head` (the card it is asked from: a card of an earlier round, or `root`), `say`, `do`, `offers`, an optional `ask` (an offered question that plays it), and `cards`. A card has `kind` (picture, artwork, paper, film, note, link, facts, person, list), `origin` (`ocean` for your own things, `external`, `generated`), `title`, `text` (one or two sentences: Momo tells the user this, and it is a picture's caption), and where it has them `by`, `date`, `from`, `href`, `image`, `w`, `h`.
- `agents/demo/media/`: one picture per card, and one film.

Edit `script.json` by hand for small changes, then start the service again. Two rules the service holds a tree to: no two cards with the same title, and no two with the same address (`href`).

The file was generated from the walkthrough board by `sketches/walkthrough/gen/demo_inventory.py` in the main folder on Kai's Mac, which is not in git (the board's working files live only there). Run again, it writes into this branch's folder. `demo_phases.json` beside it says which card each round is asked from. Where the board names the card ("Pinch the memory palace paper") that card is the head; where it does not, the head is Claude's choice, and each round's "About this round" on the page says which.

## How it works

- `agents/src/demo/script.ts` reads and checks the script. `cards.ts` makes each card the item and node the service keeps, so the usual rules choose its look.
- `take.ts` makes a round its take: the schedule of labels and deliveries from the kinds of cards the round brings, with Momo's lines placed on it. `lines.ts` holds her lines and their recordings, and what you wrote over them.
- `director.ts` does the rest. **Going to a round** deletes the tree's cards and builds the earlier rounds again, kept. A headset decides its own layers from what is asked on it, and cards that all arrive at once land on one layer, so the director takes the headset through the rounds in order: it goes to a round's card, waits for the headset to open it, adds the round's cards, and waits for the headset to give them their layer. **Playing a round** is the Scout role replaced: `Pipeline.runScout` runs as ever (the run's label, the deliveries as picks, the Renderer), and the director runs the round's take inside it: each label for its time, each delivery at its moment, and each of Momo's lines sent to the headset's voice socket from its recording, a tenth of a second at a time, so a pause is heard at once. **Moving the bar** makes the tree match the moment: cards landed by then are hung, later ones deleted, which a headset follows card by card.
- The service's own code changed in five small places: `--demo` in `main.ts`; the director's wiring, the page's routes under `/api/demo` and the page at `/demo` in `server.ts`; `stage`, `go` and `forget` on `Pipeline`; a round's limits as a parameter of `admit` (a prepared round holds up to 13 cards, a live one 10); and `extra` instructions for the live voice.
- The page is `agents/client/demo.html`, `demo.css` and `js/demo.js`.
- On Fly it is `agents/Dockerfile.demo`, `fly.demo.toml` and `deploy/demo.sh` with `deploy/demo-secrets.ts`. `MIND_PALACE_DEMO_RESTART=off` in the image tells the service it cannot start a headset's app.
- `agents/demo/headset.sh` is the headset's side: it runs `quest/tools/agent.sh` and `judging.sh` for the everyday copy with the demo's data folder. The service runs its `restart` itself for an empty stage (`restartHeadset` in `main.ts`), with adb on this Mac.

## What has and has not been tried

**On Kai's headset, 2026-11-16** (a Quest 3 on the cable, lying on a desk and told it was worn; the release build from this branch installed over "Mind Palace Ocean"; the service with the real model and no voice):

- Going to a round: seven rounds built in 3.0 seconds, the whole tree (31 rounds, 150 cards) in 13.0, back from the whole tree to Round 3 in 3.5. Each round stood on its own layer, as the app's own log and pictures of its screen showed.
- The empty stage: one press, and the app was started again and had joined with nothing standing 1.4 seconds later.
- Playing a round from the page: Round 1 started the tree and its twelve cards arrived in four parts over ten seconds, dashed, tagged "Suggested", with "Scout" and "Renderer" lines by Momo's mark.
- A request made on the headset itself: the app was told by a launch flag to hold a pinch on its open card (`-longPinchAt`), which sent "more like this" as a hand does, and the next round arrived there and the view followed.
- Requests as the headset sends them, from a test connection: a long pinch on "Neurones poster" brought "More of this" in 5 seconds, and the words "so how do we keep the information organized?" with Llull's ring open went through the real Conductor ("Looking at how to keep this information organized.") and brought Round 3 in 8.
- The service stopped and started again took the tree up where it stood, and the headset joined again by itself.

The Mac preview of the app, built from this branch, showed the same on 2026-11-16 (pictures above and below). The service's tests pass: 708, with one that is skipped without a key; twelve of them are the demo's.

![A round being played: suggestions arriving on dashed threads round the open card](docs/round-played.jpg)

**Momo's live voice, 2026-11-16** (the service on Kai's Mac with the OpenAI key, no headset: each line said by the Mac's own speech into a file and sent as a headset sends its microphone, nothing played aloud):

- "Let's jam on how we brainstorm with a VR headset", with nothing open: she said "Love that—let's spin up a fresh space for that idea and see what grows", started the tree with the subject as written, and Round 1 arrived.
- With the round's card open, each of these brought its round, with a short line of hers first and no question back: "The analogy of memory palace and data mountain is interesting. Other ideas?", "More of this.", "So how do we keep the information organized?", "That's cool, but seems easy to get lost wandering around.", "Layers?", "So which ones do we keep?".
- Before she was told which card a round waits on, "So how do we keep the information organized?" was answered aloud and brought nothing. That is what happens on a card no round waits on.
- She speaks for 30 to 50 seconds a round in three or four parts: the first card, the rest in a line, and which she would open first.

Not tried:

- **A person's voice and hands in the headset.** Nobody wore it: "Hey Momo" said aloud, pinching a card open, keeping a pick and tapping an offered question were not done by a person. The lines above were a computer voice in a quiet file.
- **The film card.** "Disney's multiplane camera" carries its file (from 2:43 of the source) and shows its poster and play mark on the headset; whether it plays there when the card is gone into was not checked.
- **The mark on the Linux picture.** It is a real stroke on the card; its place was set by calculation, and it is drawn only once the card is gone into.

Seen on the way, and left as they are: the first card of a tree started by voice reads "From: You pasted this" (the service marks every tree started from a subject that way), where one set up from the page reads "You said this"; and before Round 1 the app shows its own three example asks, which are about films.

The pictures are for the film's planning: many are other people's work, in copyright or of unknown rights (pins, film stills, a paper's figure). The repository is private; clear each one before a public cut.
