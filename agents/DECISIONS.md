# Decisions made during the overnight build

Each entry: what was decided, why, and what you could choose instead.

## 1. Search index in plain TypeScript, not SQLite full-text search
Node 22.13's built-in SQLite on this Mac has no FTS5 module (`Error: no such module: fts5`, measured). The index is BM25 in `src/core/search.ts`. It also runs in a browser, which suits a later move onto Quest.
Instead: add the `better-sqlite3` package, which bundles FTS5 but needs a native build.

## 2. The model is Meta's Model API, `muse-spark-1.3`
`MODEL_API_KEY` from `~/.muse-garden.env` works against `https://api.meta.ai/v1` (measured: chat completion 200, web search 200). Endpoint and model name come from the sibling Muse Garden project. Structured output, web search (`web_search` tool on the Responses API), image generation (`muse-image-1.0`) and transcription (`muse-voice-transcribe-1.0`) all go through the same key.
Instead: set `MUSE_LLM_MODEL` to `muse-wonder-1.0` (stronger, about 3x the price) or `muse-ember-1.0` (cheaper).

## 3. Web search ships for real
The plan allowed a stub. The model API's built-in `web_search` returned live results in a test, so the Scout uses it.

## 4. State is a log of change sets, rebuilt in memory
Every write is a change set of commands. Applying one yields patches (entity, before, after). Clients apply patches. Undo applies them reversed. SQLite stores the change sets only. This keeps the core free of any database and makes the Swift and web clients trivial: five id-keyed maps.
Instead: normalised SQL tables per entity. More query power, more code, harder to port.

## 5. `replacePicks` is not a command
The plan listed it. A change set already applies several commands atomically, so replacing picks is `deleteNode` plus `addItem` plus `addNode` in one set. One less command to keep correct.

## 6. Composites are `Group` records, set with `setGroup`
The plan folded them into `setView`. A composite spans several nodes, so it needs its own record with members and an anchor.

## 7. Web search is held to one search and no page reading
Measured in the first live end-to-end run: left free, the model opened every page it found. One search took 50 s on average and the whole run used 8.4 million tokens across 23 searches, roughly $10 of API spend at list price. With "run exactly one search, do not open any page" in the prompt, the same search takes about 14 s and about 4,000 tokens (measured), and still returns a real URL, title and snippet per hit.
Instead: let it read pages again for richer summaries, at about 90 times the cost and four times the wait.

## 8. "Muse code" is the Muse model writing a code sketch
Muse Code is a terminal coding agent with no request API in the docs. The Scout's code tool asks `muse-spark-1.3` for one small self-contained sketch and files it as a `code` item.
Instead: shell out to the Muse Code CLI on the host, if you want real multi-file output.

## 9. Speech is transcribed by the client, with a service fallback
The web client uses the browser's speech recognition for live partial transcripts. Where that is missing it records audio and posts it to `/api/transcribe`, which calls `muse-voice-transcribe-1.0`. The realtime transcription socket in the Meta API is not used yet.
Instead: stream microphone audio to the realtime endpoint for partials on every device.

## 10. Only the first three cards of a dump are scouted at once
Scouting every card of a large dump would cost a search each. The first three get picks straight away. Any other card gets its picks the first time the user opens it.
Instead: raise `EAGER_SCOUTS` in `src/core/pipeline.ts`.

## 11. Every schema goes to the model in strict form
Measured on the live model: the Organizer's reply schema had optional keys and open objects, and the model answered a rename with dozens of invented keys ("title Lima", "title Swagger", …) and no title. The rename failed 4 times out of 4. The model client now closes every object, requires every key, and makes optional keys nullable before sending (`strictSchema` in `src/node/model-meta.ts`), then drops the nulls from the reply. The same request then succeeded 4 times out of 4.
This is fixed at the one place requests leave, so no role can reintroduce it.

## 12. Installed XcodeGen and regenerated the Xcode project
The Ocean adapter adds five Swift files. `MindPalace.xcodeproj` lists files one by one, so without regenerating it the app would not build at all on your next pull. `xcodegen` is the project's own generator (`visionos/project.yml`) and was not installed on this Mac. I installed it with Homebrew (`brew install xcodegen`, 7.8 MB) and ran `xcodegen generate`. The project file's diff is 38 added lines, all for the five new files.
Instead: `brew uninstall xcodegen` removes it. The generated project stays valid.

## 13. The Ocean adapter was checked further than the plan promised, but still not built
The plan said "never compiled". The delegate found a visionOS 2.5 simulator SDK on this Mac and typechecked the whole app against it: only the two errors the app already had on that older SDK. It also ran the real `Tree.swift`, `Catalog.swift` and the bridge on macOS against the fake service, 21 of 21 checks. It has still never been built for visionOS 26 or run on a headset. Voice in the headset is entirely untested.

## 14. The Scout extends ideas itself and stops collecting links

After the first hands-on session the picks were judged dull: every pick was a web search hit shown as a link card, and the Scout never saw the dropped picture, only its title.

- **Now.** One model call looks at the card (the picture itself when there is one), where it sits, what was said and what was asked, and returns directions that each go somewhere different. Each direction is made real as content shown in place: a written idea, steps, a generated picture, a set of pictures, a real work looked up in Wikipedia with its picture brought in, or a YouTube video that plays in the card. Written ideas are delivered first, about 12 s after asking; pictures follow.
- **Why.** The search-then-choose design could only return what a search engine ranks, described from a snippet. Extension in different directions is a thinking job, not a retrieval job.
- **Cost of this choice.** Written ideas come from the model's own knowledge and carry no source. A named reference is only shown when Wikipedia has an entry for it, and its picture only when the model confirms the picture shows it. Each run may generate up to four pictures.
- **Alternative.** Keep search as the source and read each page for depth. Measured earlier at about 50 s and 350,000 tokens a search.
- **Also changed.** With a card open, a short line typed into the Add box goes to the Conductor as a request about that card. Before, it always became a new tree. The Conductor is told that a stated want with a card in focus is a request about that card.

## 15. Real works come from museum collections, not Wikipedia

**Decision.** The Scout's "reference" format is gone. An "artwork" direction carries a short catalogue search. The service asks four open museum collections at once (Art Institute of Chicago, The Met, Cleveland Museum of Art, V&A), the model chooses up to three works that carry the direction, and each is shown as its picture with maker, date, medium and museum.

**Why.** The user called Wikipedia a terrible source. Its lead pictures were encyclopedic and sometimes wrong. Museum records are curated, the picture belongs to the record, and none of the four needs a key. Measured live: four collections answer in about half a second.

**Alternative.** Keep Wikipedia for things that are not artworks (films, places, people). Those now arrive only as written ideas with no source. Instagram keyword search was probed and refused: the token lacks the "Instagram Public Content Access" review. Reading a named public account's posts does work with the current token.

## 16. A registry of sources, and a Scout that reads the subject first

**Decision.** Museums became one of eleven sources behind one interface (`Tools.sources`, adapters in `src/node/sources.ts`). Each source tells the model what it is good for and how to search it. The Scout first states what the card is and what the user is doing with it, then picks angles, formats and sources to match. For every search the model chooses among the returned records and quotes the passage that matters. A quoted passage is shown only when it is really in the record. For sources of things to look at, the pictures are brought in first and the model chooses by sight.

**Why.** The user pointed out that every suggestion was about art, while the app is for any kind of thinking. That bias came from tuning the Scout on one test picture.

**Sources.** The web (searched by the model, pages read by the service), OpenAlex, Open Library, Our World in Data, Hacker News, GitHub, Stack Overflow, four museums, Are.na, Apple podcast search, TheMealDB. None needs a key.

**Alternatives and things dropped.** World Bank data was tried first and its series endpoint hung, so Our World in Data replaced it. Places (OpenStreetMap) were left out: a name and coordinates is not content until the client can draw a map. Semantic Scholar, Google Books and GDELT refused unauthenticated calls.

## 17. Why searches came back empty, and what was done

**Finding.** Reading what the model was offered and what it chose, across three subjects, the choosing step was fair. The misses came from before it. Searches were too long for keyword catalogues. The Scout sent questions to sources that could not hold the answer, such as monthly visitors to Japan asked of a source of world totals. One source had refused this machine after a burst of requests and that was reported as "has nothing".

**Decision.** Each find writes two or three short searches and tries the next only while the pool is thin. Each source states what it does not hold. A find that ends with nothing is tried once on the web. One direction more than the count is asked for. Every made direction is delivered the moment it is ready. The web source leaves out encyclopedia entries.

**Measured.** On five subjects, directions lost went from about half of all finds to 1 of 21. Every run brought 5 to 7 picks. The last pick arrives at 44 to 56 seconds.

**Cost.** A miss now costs a second search and a second choosing call. Each delivery is its own undo step.

## 18. One undo for a whole Scout run, Apple Books for books, a steered web search

**Decision.** Change sets carry an optional `part`. The deliveries of one Scout run share it, and undo takes them back together. When an earlier part was changed since, for example a pick was kept, undo takes back the latest part alone. Books come from Apple's book search in one request. The web search is told which kinds of pages to favour and to leave out, reads five pages where it read four, and starts early when a catalogue returns fewer than three records.

**Why.** Delivering each direction when ready had made undo take several presses. Open Library refused this machine after a burst of requests and stayed closed. Web picks leaned on pages written to rank in search.

**Measured.** On five subjects, no direction was lost in 22 finds, and the last pick arrived at 33 to 45 seconds where it had been 44 to 56. In the real client, one run of six picks arrived in four deliveries and one undo removed all six.

**Alternative.** A fast search service with its own key (Brave Search has a free tier) would take about 12 seconds off every web pick. No keyless search engine answered: DuckDuckGo and Marginalia both refused.

## 19. Sources that need a key

**Decision.** `YOUTUBE_API_KEY`, `TMDB_API_KEY` and `EUROPEANA_API_KEY` are read from the env file. With a YouTube key, videos come from YouTube's own search and only embeddable ones are returned. TMDB and Europeana are sources in the registry and are offered to the model only when their key is present. The film source searches by title and by subject keyword, because TMDB's plain search matches titles only.

**Why.** The user added the keys to cover video, film and historical material. Without a key the video path found a playable video in none of the live runs.

**Safety.** Each key travels in the request address to its own provider. Failures report the status code only, so a key cannot end up in a note or a log.

## 20. The web is searched through OpenAI when its key is present

**Decision.** With `OPENAI_API_KEY` set, the web source searches through OpenAI's Responses API with its web search tool (`src/node/search-openai.ts`). Without the key it uses the Meta model's search as before. Every other role still runs on the Meta model.

**Measured.** Six searches run through both at the same moment (`scripts/search-compare.ts`). OpenAI took 3.7 to 4.6 seconds, Meta 8.7 to 11.4. OpenAI returned more primary sources: journals, government energy pages, a university research unit. Meta returned more vendor and ranking pages. On five subjects the last pick arrived at 21 to 29 seconds, where it had been 33 to 45.

**Cost.** About 9,000 tokens a search on OpenAI against about 4,000 on Meta, plus OpenAI's fee per search call. These are not counted in the service's token budget.

**Also changed.** Many pages refuse to be read by a program. All eight hits are now tried and the first five that answer are kept. PDFs are skipped.


## 21. Replies are read aloud by OpenAI's speech model when its key is present

**Decision.** With `OPENAI_API_KEY` set, the service reads each reply aloud with `gpt-4o-mini-tts` (`src/node/speech-openai.ts`) and streams the MP3 to the client through `GET /api/speak`. The voice is `marin` unless `MIND_PALACE_VOICE` names another. `hello.voice` tells the client whether the service has a voice. Without one, the browser's own voice reads replies as before, and no request is made.

**Why.** The browser voice sounded bad to the user. Meta's API offers transcription only, so OpenAI is the one key in hand with a speech model.

**Measured.** First audio bytes arrive about 1.1 seconds after the request, on a 60 and a 195 character reply. In the web client a reply started playing 1.5 to 1.9 seconds after it was sent (`scripts/voice-check.ts`). Streaming saves about 1.3 seconds on a long reply against waiting for the whole file.

**Alternative.** Pick a better browser voice. Free, but it still depends on what each device has installed, and the Quest browser's voices are unknown.

**Safety.** The reply text goes to OpenAI. Replies come from the user's content.

## 22. With the OpenAI key, the service hears the user, told their card titles

**Decision.** With `OPENAI_API_KEY` set, `hello.hearing` is `service`. The page records, stops by itself 1.2 seconds after the speaker goes quiet, and posts the audio to `/api/transcribe`. The service sends it to `gpt-4o-transcribe` with the titles of the cards in view, every tree and the newest cards as hints (`src/node/speech-openai.ts`). Without the key, Chrome's own recognition is used as before.

**Why.** The user found Chrome's recognition mishearing a lot. It cannot be told what words to expect, and its text went to the agent unchecked. The service also acted early on a partial that held still, which made a wrong partial more costly.

**Measured.** 24 spoken commands in three synthetic voices (`scripts/asr-compare.ts`). Meta's transcription, OpenAI's three models, and OpenAI with card titles scored 2%, 1 to 4%, and 0% word errors. The errors were names and topic words, and on the hardest voice Meta heard "Undo" as "Although". The card titles removed nearly all of them. OpenAI answered in about 0.7 seconds, Meta in about 2.5. Chrome could not be scored: its recognition ignores a fake microphone, so it reported no speech. In a real browser with a fake microphone (`scripts/hearing-check.ts`), the page stopped by itself and the text came back 2 to 4 seconds after the speech ended.

**Cost.** Live words while speaking are gone in this mode, and the service no longer acts on a partial. The text arrives later than Chrome's would.

**Not measured.** Real voices in a real room. Synthetic speech is easier than a person, so these error rates are a floor.

**Alternative.** OpenAI's live transcription models stream words as they are spoken. Not tried.

## 23. The headset's library joins the mindstorm as items keyed by the library's own ids

**Decision.** `npm run import-library` adds 100 films, 750 works, 17 notes, 147 tags and the 2 saved trees as one change set. Each item's id comes from the library (`library:film:25`, `library:work:met-258425`), so a second run adds nothing and a saved tree the user deleted is not brought back. Library items have `source.from = "library"` and `data.library = {kind, key}`. They never wait in the inbox, are never archived when their last card goes, and are never handed to the Filer. Filing and the Conductor's list of matching cards search only items a tree holds. The import refuses while a service runs on the same data folder: the service writes `service.pid` there, and its next change set would collide with the import's.

**Measured.** First run 19.3 s, 49 MB of pictures and records. Second run 1.0 s, nothing added.

**Why tags are items.** Three of the eight saved-tree steps are tags (`tag:standoff`, `tag:editing`, `tag:kubrick`), so `tag` joins `film`, `work` and `note` as a `data.library` kind. Tags from `ocean.json` and `works.json` with the same id are merged, as the app's catalog does. A tag in `works.json` names works by their place in the file. The import turns that place into the work's id.

**Why filing searches placed items only.** In a test, six library films titled "Dolly zoom" filled the Filer's fallback search, and a dump that belonged under the user's "Dolly zoom shots" card started a new tree instead.

**Alternative.** Keep tags as words on each film and work only. The saved trees would then lose three of their cards.

## 24. A saved tree is imported as the steps the user walked, hung as the Quest app's replay hangs them

**Finding.** `ocean.json` keeps a saved tree as a list of steps, and the app rebuilds it with `Tree::replay`: each step is found among what the gardener offered around an earlier step, or attached by hand under the current card. Compiled on this Mac against `quest/core`, the replay hangs `film:53` under `film:38` in "Machines that look back", not under `tag:kubrick` as the order of the steps suggests. It also hangs 19 to 26 offers on each tree, among them era chips ("The 1960s") and works tied only by a shared tag.

**Decision.** Each tree comes in as its 4 steps, kept, each under the step the replay hangs it from and with the replay's label on its thread. `scripts/saved-trees.ts` builds `scripts/saved-trees.cpp` against `quest/core` and writes `src/node/library-saved.json`. The import reads that file and refuses when `ocean.json`'s saved trees no longer match it.

**Why.** The offers are ties between pieces of the library, the kind the user asked not to have drawn. When a card of the tree is opened, the Scout brings new material instead.

**Alternative.** Import the whole replay, 30 and 23 cards, as the headset shows these trees today.

## 25. The library's pictures are JPEG assets, and its films play from the repository

**Measured.** The works are HEIC, which Chrome cannot show. `sips`, which every Mac has, turns all 750 into 512 px JPEGs, 42 MB, in 8.6 to 25 s with 8 running at once. The spread came from other work on the machine. The films are 30 s H.264 and AAC MP4s of 1.5 to 17.5 MB that browsers play as they are. Cutting each film's still from `public/clips/atlas.jpg` (the stills the headset itself shows, 256 by 144) took 3.7 s for all 100.

**Decision.** Works' JPEGs and films' stills are stored assets. A film is a linked asset: `/assets/<id>` streams the file in `public/clips/full` with byte ranges, so 569 MB is not copied into each data folder. In Chromium, a saved tree's film stills and a work's picture loaded, and an opened film played its 30 s clip at 1280 by 574.

**Alternatives.** Copy the films into the data folder (569 MB each time). Take stills from the films with `ffmpeg` at full size: sharper, but `ffmpeg` is not on every Mac.

**This ties the import to macOS.** `sips` exists only on a Mac. Run on Linux, for example once the service is hosted, the import still adds every item, but the works come in as text cards and the films have no still. A hosted service would need the import run on a Mac first, or another converter such as `libheif`.

**Guard.** A linked file must be inside `public/clips/full`, with links and `..` followed. This is checked when the link is made and again each time it is served, so a record edited on disk cannot reach the rest of the disk. A remote file is streamed only from the address the service stored for that asset. The request never names one, so the service is not an open proxy. Both kinds need the token, as every asset does.

## 26. Every address a card loads is the service's own

**Decision.** A video's still (a YouTube thumbnail, a podcast's cover, an Internet Archive still) is downloaded and stored as an asset, as the visual sources already did. A recording (a podcast episode, an archive film) is a linked asset: `/assets/<id>` relays it from its source with the client's byte range. `data.mediaUrl` and `data.thumbnailUrl` hold service addresses. Every item that plays has `data.mediaUrl`, dropped videos included. A test runs every kind of pick and checks that each still, picture and recording is an asset of the service.

**Why.** The plan has the headset fetch only from the service: one host, one token. Before this, the headset would have added its token to a podcast host's address.

**Measured.** A 1 KB range through the service took 0.5 s for an archive film and 0.3 s for a podcast episode. One podcast address Apple's search returned answered 404 whoever asked; the service passes such a status on.

**Cost.** A recording's bytes pass through this Mac.

## 27. A client says what it plays, and while the headset is connected videos come from the Internet Archive

**Decision.** A client sends `{t: 'client', media: {embeds, files}}` after connecting. While any connected client cannot show embedded players, a video direction is first looked for in the Internet Archive as an MP4, chosen by the model like any find. When none fits, the YouTube video comes as before, and the headset shows its still and title. A recording whose file type a connected client did not list is left out. The Internet Archive is also a source the Scout can choose for any find. It needs no key.

**Measured.** Six searches with `scripts/source-probe.ts`: 0.65 to 1.2 s each, and 3.9 s for a five-word phrase that needed words dropped, since the catalogue requires every word. Every record had an MP4 and a still. Relevance is mixed: "bread baking" brought a 1990s BBS collection first. The model's choice filters it. In a live Scout run as a headset, one of two archive finds fit and came as a film that plays from the service; the other went to the web.

**Alternative.** YouTube files for a headset. No YouTube API hands out a playable file.

## 28. A change set that changes nothing takes no seq

**Decision.** `Mindstorm.apply` numbers a change set and keeps it in the history only when it has patches or undoes something. A set that changed nothing, such as a format choice equal to the one in place, takes no `seq` and can never be what undo takes back. The `seq` a client receives therefore rises by exactly one each time, and a client that sees any other value knows it missed a change.

**Why.** The C++ client's review found clients receiving 10 and then 12. The service numbered every set but sent only those with patches. An empty set could also become the undo target, so a press of undo did nothing.

**Tested.** Both rules have a test, and both tests fail on the code before the change.

## 29. Rows: the lines under an open card are questions the service writes for that card and that conversation

**Decision.** When a client opens a card it sends `{t: 'questions', nodeId}`. The service answers that connection alone with `{t: 'questions', nodeId, questions}`: at most four short questions or requests, written by a new role from the card's title, summary, text and reason for being there, the titles above it, under it and beside it, and the last six turns of the conversation. Picking one sends it as an `ask`. A client shows its own rows until the reply comes and keeps them when the list is empty. The web client shows the questions as dashed amber buttons above its Ask box, the look of everything the agent suggests, and drops one once it is asked.

**Names.** `questions` names what is delivered, not how it is drawn: the Quest draws rows, the web client buttons. Reply and request share the name, as `settings` and `handoff` do, and the field repeats it as `{t: 'settings', settings}` does. `asks` was the other candidate, from the Quest's `Ask` rows, and was left because it differs from `ask` by one letter.

**Kept until something changes.** The service keeps each card's questions with the exact input they were written from, the card's brief and the conversation. The same input answers from what was kept, at no cost. Any change to either writes them afresh on the next open, so there is no list of things that must clear the store. A failed call is not kept. Two connections opening one card at once share one call.

**An ask joins the conversation.** A typed or picked `ask` now enters the history the Conductor, the Scout and these questions read, as a spoken one already did. Without it the next questions could repeat the one just picked. A spoken ask is not added twice: the pipeline sends it to the Scout directly.

**A quick model.** On `muse-spark-1.3` the questions took 7.0 to 15.3 s in seven live calls, because it reasoned for 750 to 1,500 tokens to write about 40. Minimal effort barely changed that (7.6 s, 716 reasoning tokens), and the API refuses `none`. `muse-ember-1.0` at minimal effort wrote questions as specific in 0.74 to 3.0 s over eight live calls, 1.2 s typically, with 100 to 230 reasoning tokens. A request marked `quick` goes to that model, set by `MIND_PALACE_QUICK_MODEL`. Each call took 680 to 860 tokens, 480 to 600 of them the prompt. The card's texts are clipped (title 100 characters, summary 300, text 400, ten titles under it, six beside), so a long card costs no more.

**Measured with** `scripts/questions-probe.ts` on a copy of the user's mindstorm, three cards and one conversation in Chinese, which the questions followed, and once through the service's socket, where the other connection heard nothing.

**Alternatives.** Send the questions in answer to `focus`: the Quest sends no `focus` for a card opened where it stands, and every client would hear the questions for a card only one of them opened. Fixed rows: the request this answers. Write them ahead for every card: a call per card that may never be opened.
