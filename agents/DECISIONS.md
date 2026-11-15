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

## 29. Mindstorm: a dump joins the knowledge base, and starts a tree only when asked

**Decision.** Everything dropped becomes items, and every item is part of the user's knowledge base. A plain dump starts no tree. The Filer asks the model whether an item plainly belongs under one card of a tree, with a strength from 0 to 1. At 0.8 or above (the setting `strongTie`, shared with the Scout) the item is hung there once, as a dashed pick with a `why`, origin `{by: 'agent', role: 'filer', tool: 'mindstorm'}`. Otherwise it is placed nowhere. A tree is started only when the dump or the user asks for one, and its root then gets its first round. The web client lists what no tree holds under "Knowledge base" in its tree row, and says where a drop went.

**Why.** The user asked for the mindstorm to be a knowledge base that trees draw on, not a pile that turns every drop into a tree.

**Also changed.** The Filer no longer falls back to search when the model fails. A wrong placement is noise and a drop left in the knowledge base costs nothing, so the safe answer is no placement. Taking away a pick that holds what the user dropped, as making room in a full round does, leaves the item in the knowledge base. Deleting a kept card still archives its item. `Mindstorm.inbox()` is `unplaced()` now: those items are not waiting to be filed. Only the root of a tree the user asked for is scouted on arrival, so `EAGER_SCOUTS` is gone.

**Measured.** On a copy of the user's data (4 trees, 1,014 library items), a dropped line about the Reservoir Dogs standoff became a pick under "The standoff" in "Standoffs", and no tree was made. On an earlier run of the same drop it went under "The cut is the event" in the same tree.

**Alternative.** Let the Filer's model decide that a dump asks for a tree. It would understand more phrasings and languages, but it cannot take the asking words off the content, and the offline stand-in would need its own rule anyway.

## 30. Mindstorm: a request for a tree is heard by plain rules, and by the Conductor for other words

**Decision.** `src/core/tree-request.ts` hears a request at the start or the end of a text: "make a tree about Kubrick", "start a tree on this: …", "… make a tree from this", "make this a tree: …". The words are taken off what was dropped. The pipeline applies it to text dumps, and the Conductor to utterances before any model call. Other words ("build me something around Hitchcock's films") reach the Conductor's model, which now has a `tree` kind. "This" means what was just dropped, until the user opens a card, and otherwise the open card. "Make a tree about X" where X is the title of something the user already has makes that item the root, so a tree about Vertigo is rooted in the library's Vertigo rather than a new card that would repeat it.

**Why.** Free, deterministic and testable, and it works in the offline stand-in. "Build a treehouse", "a family tree" and "plant a tree for every newborn" ask for nothing (tested).

**Cost.** English phrasings only. A dump that starts "make a tree from cardboard: …" is read as a request.

## 31. Mindstorm: every round draws on everything the user has, and the Scout stops drawing links

**Decision.** Each Scout run searches the whole mindstorm (dumps, cards of other trees, the library) with the card's title, its title and tags, and the request, keeps up to 20 candidates that share half the words, and asks the model to rate them. Those rated 0.8 or above come into the round as nodes holding the existing item, strongest first, at most 8, in the run's first delivery. New content fills the rest: what the user set as picks per run, never fewer than 2, never past 10. Unkept agent picks elsewhere are suggestions, not knowledge, and are not offered. A library item keeps origin tool `library`; anything else the user had gets tool `mindstorm`. One tool name, one meaning.

**Why.** The user asked that what they already have and is strongly tied always be among a new tree's content, with room left for new material.

**Replaced.** Before, a strong tie to a card of another tree was drawn as a link across trees, and only library items were hung in place, at most 2 per run. Both now come in place, the same way. `maxLinksPerRun` is gone and `linkThreshold` is `strongTie`.

**Also changed.** A run brings at most the new picks asked for. Before, a run asked for one direction more than the count and kept every find, so 5 asked could bring 7. Under a cap of 10, the extra would push older picks out on every "more".

**Measured.** On the copy of the user's data, "make a tree about Stanley Kubrick" rooted the tree in the library's Kubrick card and brought The Shining, Dr. Strangelove and 2001 from the library, then 5 new picks: 8 in the round, nothing repeated. 95 s, 12 Meta calls (25,363 tokens in, 13,450 out), 1 OpenAI web search (8,846 in, 389 out), 1 generated picture.

## 32. Mindstorm: the round rules are held where changes are applied

**Decision.** `admit` in `src/core/round.ts` runs on every Scout delivery and every Filer change, against the mindstorm as it is at that moment. Around each card it keeps at most 10 unkept picks, at most 8 of them things the user already had, by deleting unkept picks in the same change: the least related to the conversation first, since entry 34, and the oldest among equals. Nothing inside a tree repeats: not the same item, not the same `source.url`, `data.mediaUrl` or `source.asset`, not the same title once case, punctuation and a leading article are set aside. Something the user already had takes the place of an unkept pick that brought the same thing new. An agent's item that is left out goes with its node; a dropped item stays in the knowledge base.

**Why "a layer" is one card's round.** In the headset a layer holds several cards' rounds. A limit per layer would starve each card as the tree grows.

**Why at application.** Two Scout runs on two cards of one tree, or a drop filed while a run is out, could each bring the same thing. Checked when applied, in one synchronous step, neither can. The Scout also checks as it composes, so a repeat does not take a slot it could have filled.

**Tested.** Three deliberate breakages (no `admit`, 10 known places, no title key) each fail the new tests.

## 33. Mindstorm: an id the model writes back with the word before it is still read

**Finding.** In the first live run the Kubrick round brought nothing the user had, although search offered The Shining, Dr. Strangelove and 2001 and the model rated them 0.9 and 0.95. Shown `- item library:film:53 "The Shining"`, the model answered `"itemId": "item library:film:53"`, and every rating was dropped as naming nothing offered. The library's ids contain colons, unlike the service's own ids. The tie rating before this change had the same prompt line, so a library film was most likely never hung live.

**Decision.** `idFrom` drops a leading "item", "node" or "tree" and surrounding quotes or brackets from an id a model wrote. The Scout and the Filer read ids through it. With it, the same run brought all three films.

## 34. Mindstorm: opening a card shows it, and only conversation grows its round

**Decision.** `focus` never starts a Scout run. Picks come from conversation about a card (`ask`, `more`, an utterance the Conductor routes to either) and from the first round of a tree the user asked for. A run never replaces the round: the Scout's `refresh` mode is gone, and new picks join what is there. When the round could pass 10, the same model call that rates candidates also rates the picks already around the card against the question and the recent conversation, and the run stores each rating as the pick's `importance` (`setWhy`). New picks of the run get importance 1, since they were made for the question. `admit` lets the lowest go first, the oldest first among equals, so what gives way is what is least related to what the user is talking about, not what came first. Kept cards never count and are never removed.

**Why.** The user: a tap should expand a card to show its details, not start a new layer; a layer starts with conversation, and at the cutoff of 10 the nodes most distant from the user's questions go.

**Why importance.** It already meant how much a node matters, and the Renderer already keeps the most important of a crowded set out of its "more" stack. Stored on the node, the rating survives to the next change: a drop the Filer hangs at a full card between conversations makes room by the last rating. A rating that came back for a pick the guard then removes is dropped with it; applied after the removal, it had failed the whole delivery.

**Cost.** One rating call per conversational run once the round is near full, even when nothing the user has is a candidate.

**Measured live once.** On a copy of the user's data, the Kubrick tree's first round held 7 picks. Asked "how does he set music against the picture", the run re-rated the 7 against the question (0.15 to 0.55, where they had been 0.95 and 1), 4 new picks joined, and the one rated lowest, the TMDB film "2010", made room: 10 picks, nothing repeated. The picture generations of that run failed with their connection cut mid-reply, which this change does not touch; the earlier two runs made their pictures.

**Web client.** Opening a card already showed its details with Ask and More. It still sends `focus`, which now brings nothing. The empty page's text says a new tree gets a first round and asking brings more.

**Alternative.** Let the Scout delete the least related picks itself before delivering. It would have to guess how many of its finds will arrive, and two runs at once would each guess against a stale round.

## 35. Rows: the lines under an open card are questions the service writes for that card and that conversation

**Decision.** When a client opens a card it sends `{t: 'questions', nodeId}`. The service answers that connection alone with `{t: 'questions', nodeId, questions}`: at most four short questions or requests, written by a new role from the card's title, summary, text and reason for being there, the titles above it, under it and beside it, and the last six turns of the conversation. Picking one sends it as an `ask`. A client shows its own rows until the reply comes and keeps them when the list is empty. The web client shows the questions as dashed amber buttons above its Ask box, the look of everything the agent suggests, and drops one once it is asked.

**Names.** `questions` names what is delivered, not how it is drawn: the Quest draws rows, the web client buttons. Reply and request share the name, as `settings` and `handoff` do, and the field repeats it as `{t: 'settings', settings}` does. `asks` was the other candidate, from the Quest's `Ask` rows, and was left because it differs from `ask` by one letter.

**Kept until something changes.** The service keeps each card's questions with the exact input they were written from, the card's brief and the conversation. The same input answers from what was kept, at no cost. Any change to either writes them afresh on the next open, so there is no list of things that must clear the store. A failed call is not kept. Two connections opening one card at once share one call.

**An ask joins the conversation.** A typed or picked `ask` now enters the history the Conductor, the Scout and these questions read, as a spoken one already did. Without it the next questions could repeat the one just picked. A spoken ask is not added twice: the pipeline sends it to the Scout directly.

**A quick model.** On `muse-spark-1.3` the questions took 7.0 to 15.3 s in seven live calls, because it reasoned for 750 to 1,500 tokens to write about 40. Minimal effort barely changed that (7.6 s, 716 reasoning tokens), and the API refuses `none`. `muse-ember-1.0` at minimal effort wrote questions as specific in 0.74 to 3.0 s over eight live calls, 1.2 s typically, with 100 to 230 reasoning tokens. A request marked `quick` goes to that model, set by `MIND_PALACE_QUICK_MODEL`. Each call took 680 to 860 tokens, 480 to 600 of them the prompt. The card's texts are clipped (title 100 characters, summary 300, text 400, ten titles under it, six beside), so a long card costs no more.

**Measured with** `scripts/questions-probe.ts` on a copy of the user's mindstorm, three cards and one conversation in Chinese, which the questions followed, and once through the service's socket, where the other connection heard nothing.

**Alternatives.** Send the questions in answer to `focus`: the Quest sends no `focus` for a card opened where it stands, and every client would hear the questions for a card only one of them opened. Fixed rows: the request this answers. Write them ahead for every card: a call per card that may never be opened.

## 36. Contact: Mind Palace is a Telegram contact

**Decision.** `src/node/contact.ts` names the one place a contact plugs in. A `Channel` pairs and delivers handoffs, and hands what arrives to a `Desk`: `dump(dumps)`, which answers in words where the drop went, `keep(bytes)` for a file, `transcribe` when the service can hear, and `latest()` for a resend. Telegram (`src/node/telegram.ts`) is the only Channel. It reads the bot with long polling (`getUpdates`), so the Mac needs no public address. The service starts it when `TELEGRAM_BOT_TOKEN` is set, and `npm run dev:fake` never does, so the stand-in never competes with the real service for the bot.

**Pairing.** Settings asks for a link, `https://t.me/<bot>?start=<code>`. The code works once, for 10 minutes, and a new Pair replaces it. Pressing Start in Telegram with it pairs that account, in its private chat with the bot. `data/telegram.json` keeps the pairing (Telegram user id, chat id, name), the read position, and the bot's numeric id, so a token for another bot starts both afresh. Only that user in that chat is heard. Anyone else gets no reply at all, even to a used or expired code. Pair and unpair sit behind the access token.

**What arrives.** A message becomes the dumps the web page sends for the same thing: a text, a link when the text is one web address (Intake's own rule), a file as an asset (a photo at its largest size), and the caption as a text beside the file in the same drop. The caption is the instruction because the pipeline already reads "start a tree on this" from any text of a drop and takes the words off (`askedForTree`), so a photo captioned that way roots a new tree with no new rule. A voice note is transcribed with the card titles as likely words, and its words are dumped. With no transcriber, or a failed one, the recording itself is kept and the reply says why. "/handoff" and "send me the handoff", typed or in a voice note, resend the latest and add nothing. A file over 20 MB, by its stated size or by Telegram's "file is too big", gets a reply that points to the web page.

**Where it went.** `Pipeline.dump` and `makeTree` now answer with what a drop became, `Filed` (its items and the new nodes that hold them), where they answered with node ids that left an unplaced item out. `whereItWent` turns it into the reply: "Added “X”. It is in your knowledge base.", "… It went under “P” in “T”.", "… It started the tree “T”." Any later contact gets the same words.

**Out.** The server delivers on every handoff the pipeline announces, so Handoff on the web page, the headset's clap and the Conductor's handoff intent all reach the chat: a message, "Handoff ready: <title>" and a line for the agent, then the file by `sendDocument`. A resend reads the newest `.md` in `data/handoffs`, so it works after a restart.

**At most once.** The read position is saved before a message is acted on. A message lost to a crash is one the user sees no "Added" for and sends again. One taken twice would be a card made twice.

**The token.** Every Bot API address holds the bot token. `request` in `telegram.ts` is the one place a request is made, and every error that leaves it has the token replaced by `<bot token>`. This is not hypothetical: Node's fetch puts the whole address in its error for an address it cannot parse ("Failed to parse URL from …/bot<token>/getMe"). The token is never saved.

**Failures.** Telegram answers 409 while another program reads the same bot. The service logs that once and tries again every 30 s. Other failures are logged once per run of failures, with a hint for a refused token, and the wait doubles from 1 s to a minute.

**Tested** against a stand-in for the Bot API, `test/fake-bot.ts`, with no network: 9 tests, and one browser check of the Settings row.

**Alternatives.** A webhook needs a public HTTPS address on the Mac. A caption given to Intake as context for the picture's description would make one card of a captioned photo instead of two, but changes Intake's prompt and the dump shape every client sends. A caption that asks for nothing becomes its own card, as a text and a file dropped together on the web page do. A QR code on the page needs a library or a hand-written encoder. The link opens Telegram on the device that shows the page, and the chat then reaches every device of the account.

## 37. Handoff: the Markdown file travels alone

**Decision.** The Packager writes the handoff twice. `markdown` names no file. A node with a picture says "picture: not attached. The summary and text here describe it.", and a video or another file says the same with its own noun. The address a picture came from is its `url`, or its `media` address when that is on the web. A picture an agent generated is described only. "Attached files" becomes "Pictures and files". `bundled` is the zip's `handoff.md`, with its `assets/<id>` paths beside the files. The `<name>.md` written beside the zip is the travelling file, and it is the file a paired chat receives.

**Why.** The user shares one file into any agent app. `assets/<id>` means nothing to an agent that gets the file alone. A picture's description is already in the item's summary and text, written by Intake when it looked at the picture.

**Name.** The file keeps the name the zip and the web page already use, `<tree>-handoff-<date>.md`, rather than the plan's `<tree>.md`. It is still named after the tree, and the date tells two handoffs of one tree apart in an agent's file list.

**Also.** Both files give a `media` field for a node whose picture or recording has its own web address. A service address such as `/assets/<id>` is never printed. `Handoff.title` carries what the handoff is about, for the chat message.

**Tested.** The Packager test checks that the travelling file has no `assets/`, each kind of line, and that the bundle keeps every path. The Telegram test checks that the delivered file has no `assets/` and is the same as `<name>.md`.

## 38. Wake word: "hey Momo" is heard on the device by sherpa-onnx's keyword spotter

**Decision.** The agent is called Momo unless renamed (`settings.agentName`, also in the web client's Settings). A client listens for "hey Momo" or "hi Momo" on the device with sherpa-onnx's keyword spotter (v1.13.8) and its English model `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01`. No sound leaves the device before the phrase. After it, the client records until the speaker pauses for 1.2 seconds and posts that recording to `/api/transcribe`. The service drops a leading "hey Momo" from what it acts on, tells the Conductor its name, and tells the transcriber to expect it.

**Why.** The user wants to talk without pressing anything, and without the page sending everything they say. A keyword spotter is a small streaming recognizer that reports only the phrases it is given. A new name needs no training, and the same C library runs on Android for the Quest.

**Tuned.** Keywords `▁HE Y ▁MO MO`, `▁HI ▁MO MO` and `▁HIGH ▁MO MO`, because the model often hears "hi" as "high". Boost 1.5, threshold 0.05, 1 trailing blank, 4 active paths. The boost is what matters: thresholds from 0.02 to 0.1 caught the same clips. Waking on something that only sounds like the phrase matters more to the user than catching voices nobody speaks with, so the boost is the lowest that keeps real-sounding voices: at 1.5, 1.75 and 2.0, voices that sound like people (10 native macOS voices and 6 OpenAI voices) caught 156, 157 and 155 phrases of 168, and near misses woke it 1, 3 and 5 times of 444. A boost of 2.0 also woke on "Hey mama" in two accented voices, "Hey Moe" and "Hi Moe". Adding "hey Mo Mo" as two words woke on "Hey Mo, more!" 24 times, so it is not used.

**Measured.** 842 synthetic clips (`scripts/wake-clips.ts`), each heard clean and with pink noise 20 dB and 10 dB below the speech, in 100 ms pieces like a microphone, with the web client's fresh-stream rule below (`scripts/wake-measure.py`). The phrase was said alone, before a command, and after other talk.

| | Clean | Noise 20 dB | Noise 10 dB |
|---|---|---|---|
| The phrase caught, 10 native English macOS voices (of 120) | 110 | 85 | 31 |
| The phrase caught, 6 OpenAI voices, 4 with a Mandarin, Indian, Spanish or French accent (of 48) | 46 | 47 | 38 |
| The phrase caught, 7 non-English macOS voices reading English (of 84) | 12 | 15 | 11 |
| False wakes in 2.36 hours of talk, commands and the agent's replies | 1 | 1 | 0 |
| Near misses that woke it (of 444, such as "hey mama", "hi mom", "Hey Moe", "Mo Mo's bakery", "memo", "momentum") | 1 | 1 | 1 |

The one false wake was this record read aloud, at its list of near misses ("Hi Mo, Hi Moe and Hey Moe"). The talk without it, 8 voices reading everyday conversation and the repository's other documents, woke it no times. The near miss that woke it was "Hey mama" in the Indian-accented OpenAI voice, and in 10 dB noise "Hey, no more." in the French macOS voice. "Hi mom", "memo", "momentum" and "Mo Mo's bakery" never woke it. The phrase is caught a median 0.44 seconds after it ends (at most 0.55). One false wake in 2.36 hours puts the rate under about 2 an hour at 95% confidence. More hours of talk are needed to say how far under.

In a real browser with a fake microphone (`scripts/wake-check.ts`), OpenAI's transcription of a Mandarin-accented "Hey Momo, show me more like this." reached the Conductor as "Show me more like this." After other talk ("I was reading about winter bread all morning. Hey Momo, bring more on sourdough."), the recording started one tenth of a second before "Hey", and the Conductor got "Bring more on sourdough." While waiting for its name, the whole browser used 0.09 to 0.15 of one core in twelve 30-second runs, against 0.005 to 0.010 with the microphone off. The spotter itself took 39 to 65 ms per second of sound, so it is about half of that. The rest is presumably the browser's capture with echo cancellation, the AudioWorklet and the messages, which were not profiled. The spread is not explained: other work kept the Mac's load average between 4 and 29.

**What limits it.** The model has 3.3 million parameters, and its ear decides. Asked to transcribe the clips, it hears "Momo" as "moment", "monot" or "mamo" in some voices, and as "more more" in the non-English ones. The Indian voice Rishi catches 7 phrases of 12 and the South African voice Tessa 8, while seven other native voices catch all 12. Noise at 10 dB costs most of what it catches, and even a hiss 60 dB down cost 7 phrases of 60. A reply that names the agent ("Hi, I'm Momo") woke it once in noise at a higher boost, which is why a client does not listen while a reply plays.

**The spotter clears itself after 1.5 seconds without speech.** A phrase that begins as it does is lost. After 1.5 or 3 seconds of digital silence, the plain spotter caught 7 and 0 phrases of 60 in 10 native voices, against 54 to 58 after other lengths of quiet, and with a faint hiss 9 and 10 (`scripts/wake-quiet.py`). The first sweep, with 0.3 seconds of quiet before each clip, never met this. A user waits in quiet, so a client starts a fresh stream after each second without speech, before the spotter clears itself: then 52 and 57 of 60 were caught, 51 and 50 with the hiss, and the other lengths did not change. Its timestamps also restart when it clears itself while `start_time` does not, so they cannot say how long ago the phrase began.

**Also found.** The model's `-mobile` variant fails on every decode in sherpa-onnx 1.13.8, with an onnxruntime Reshape error in the encoder, so the regular model is used. sherpa-onnx publishes no browser build of the keyword spotter. `npm run fetch-wake` builds one from the v1.13.8 source with Emscripten 4.0.23, both pinned to their commits, into the git-ignored `client/vendor/sherpa-onnx/`. Without those files the page keeps tap-to-talk and says why.

**In the web client.** An AudioWorklet brings the microphone to 16 kHz, and a Worker runs the spotter and keeps the last 3 seconds of sound. On the phrase the page chimes and starts the recording a tenth of a second before the phrase, so the words right after it are kept whole and the words before it stay on the device. The latest the phrase can have begun is its span between first and last word piece plus 0.45 seconds before it was spotted. From there the start moves back to where that sound begins, at most half a second, or forward past quiet to it. A short command said straight after the name ("hey Momo, more") can end before the name is spotted. So the phrase is taken to end at its first dip in loudness once its span has passed, and a sound as loud as a word after that starts the command. The service strips the phrase from the transcript. If nothing is said within 8 seconds, nothing is sent. A reply that arrives while the user is being recorded waits until the recording ends. On a page that cannot listen for the name, the first press only says why, and the next press records once. The service gives up a spoken reply that OpenAI has not started within 15 seconds, so a stalled reply cannot keep the microphone waiting.

**Reviewed.** A second reader found six ways the page could misbehave: sound from before the phrase sent after the spotter cleared itself, a first press that recorded on a page that cannot listen, the microphone left open when listening was turned off during the permission prompt, the page left deaf after turning listening off and on just as a reply ended, a recording lost when a reply started as the phrase was heard, and a quick "hey Momo, more" dropped. Each has a browser check in `test/client.e2e.ts` that fails on the reviewed code and passes now.

**Cost.** About 4 minutes of OpenAI speech for the clips, made twice, roughly 12 cents.

**Not measured.** Real voices, a real room, a microphone across the room, and the Quest. Synthetic speech is clean and evenly paced, so real use is likely worse. Names other than Momo.

**Alternative.** Picovoice Porcupine needs an account and a key on every device. openWakeWord needs a model trained for each name. Both fix the name in advance.

## 39. One home: a source's recording is a film or a sound by its file, and plays from the service

**Decision.** `tracy/agents` holds the Quest app, the service and the card libraries in one line, merged from `tracy/quest-net`. Both lines had decided what a source's playable record becomes, and the merge keeps both rules. A record whose file is a film (`.mp4`, `.m4v` or `.webm`) is a video item. Any other is an audio item, with the length its source gives as `sound.seconds`, which the audio card draws. Either way its file is linked as a service asset and its cover is stored, so a client loads only the service's own addresses (entry 26).

**Why.** The card library line made a podcast episode an audio card that played from the episode's own address. The Quest line made every playable record a video streamed through the service, because it had no audio kind and every address a card loads must be the service's. The same `Found.media` field carries Internet Archive films and podcast episodes, so the file's type tells them apart.

**The headset.** Its card registry (`quest/core/cards`) knows the note, quote and image cards and draws any other component as a note. A podcast pick is a note there, as a video card it was before the merge.

**Also.** The browser checks from the card library line that dropped a recording or pasted an explainer now ask for a tree first, since a drop starts no tree unless asked (entry 29). The check that opening a card brings nothing compares the card's children before and after, since the Every shape tree now hangs a map under that card.

## 40. One home: the Vision Pro adapter stays out

**Decision.** The merge keeps `visionos/` as the Quest line has it, without the adapter in `visionos/MindPalace/Ocean/Agent/` and its hooks in `OceanModel.swift`, `Notes.swift` and `Info.plist`.

**Why.** The Quest line left the adapter out on purpose when the service joined it (1dc37a6, 14 November), and every merge since kept it out. Its `OceanModel.swift` differs from the agents line's by 388 changed lines, so the adapter's hooks do not apply as they were. The Quest app is the final home, and Vision Pro was the prototype.

**To bring it back.** The five files and the hooks are as they were at 088452d. Putting them back means writing the hooks again against the Quest line's `OceanModel.swift` and typechecking with the visionOS 2.5 simulator SDK, since visionOS 26 cannot be built on this Mac.

## 41. Live voice: Momo hears and speaks through OpenAI's realtime model, and the pipeline still decides

**Decision.** After the wake phrase a client streams its microphone to the service on `/live`, and the service relays it to `gpt-realtime-2.1-mini` in one realtime session per client (`src/node/live.ts`). The model is Momo's ears and voice. It speaks a short preamble in its own words and calls its one tool, `act`, with the user's request, which the service hands to the pipeline as a final `utter` in the client's scene. The Conductor and the rest decide what happens. The first `say` after an `act` goes back as that call's result, and every other `say`, and every `say` with `kind: 'results'`, goes in as news. The model voices both in the same session, so announcements need no `/api/speak`. Its voice streams back as 24 kHz PCM and plays as it arrives. The wake phrase stays on the device (38). The model's semantic turn detection, at its most eager, ends the turn, in place of the 1.2 s pause rule. While Momo speaks no microphone sound is sent, because the headset has no echo cancelling, but the phrase is still listened for: saying it stops Momo and starts a new turn, except while what Momo is saying names itself. Without a live voice (no OpenAI key, `MIND_PALACE_LIVE=off`) `/live` is refused and the clients use 38's path.

**Why.** The user waited about 15 s to hear anything on the Quest (headset build 36914c7): the 1.2 s pause rule ended the recording 4.0 s after the wake, transcription took 1.4 s, the Conductor 9.9 s and fetching the speech 1.6 s. They want Momo to register them almost at once, never with a canned phrase, and chose a real-time speech model over a fast text model with streamed speech.

**Measured.** `scripts/live-measure.ts` streams spoken clips to a running service at the pace they were said, against a copy of the user's data with the real models. From the end of speech to Momo's first sound:

| Model, turn detection | Turns | First sound | Of it, after the model heard the end | Per turn |
|---|---|---|---|---|
| mini, semantic (eager), three runs | 17 | 1.07 to 1.84 s; run medians 1.11, 1.49, 1.61 s | 0.36 to 0.77 s | $0.0045 to $0.0058 |
| mini, server VAD at 500 ms | 5 | 1.04 to 1.15 s | 0.30 to 0.38 s | $0.0046 |
| full `gpt-realtime-2.1`, server VAD at 500 ms | 7 | 1.33 to 1.54 s | 0.63 to 0.83 s | $0.025 |
| mini, semantic, Mac preview with `-wakeClip`, headset clock | 6 | 1.13 to 1.59 s, median 1.35 s | 0.30 to 0.62 s | about $0.005 |

The rest of each number is the turn detection waiting for the user to be done, 0.7 to 1.2 s. The model's own part moved between runs, from 0.3 to 0.4 s in one run to 0.5 to 0.8 s in the next, with the same clips. That spread is on OpenAI's side and is not explained. Mini is faster than the full model and a fifth of its cost, and on these clips it called `act` and spoke as well, so it is the default (`MIND_PALACE_LIVE_MODEL`). Server VAD was up to 0.4 s faster but ended "I'd like to see … something about old maps" at an 800 ms pause inside it. Semantic detection kept that sentence whole in both runs that heard it, so it is the default (`MIND_PALACE_LIVE_TURN=server:<ms>` for the other). Reasoning effort is `minimal`. A turn costs about half a cent: the user's audio, Momo's voice at 1 token per 50 ms, and the instructions. All the measuring used about $0.40 of the realtime model.

**Found by measuring.**
- After "Hey Momo." and a pause, both kinds of turn detection ended the turn on the name, and Momo greeted the user while the request was lost. So a client sends nothing until the first word after the phrase, and then from 0.8 s before it. The phrase is sent only when the request follows straight on.
- The model called `act` without a word until it was told to speak a preamble first, since `act` takes seconds. It added the scene to the request, said "Hey Momo" back to the user, said "I've found an ocean wave picture" when the reply only said it was looking, and once answered "show me more like this" without `act`. The instructions now say each of these, in the labelled parts OpenAI's prompting guide for its realtime models suggests.
- A call the pipeline never answers (it drops a repeated utterance while it acts) left the model saying it was "still waiting". A call still open when the user speaks again is now closed as still working, and its late reply is news.
- On the Mac a local service answered `/live` before the listener's model had loaded, and the first wake was recorded the old way.

**Not done.** A reply played while the user is cut off is not truncated in the conversation, so the model may think the user heard all of it. Answers to "what is this card about?" ran 13 to 15 s despite the instructions. Nothing caps them.

**Alternative.** GPT-Live (`gpt-live-1`) is OpenAI's newer full-duplex voice model with "client delegation". It costs $0.05 a minute of open session, and its delegation event carries no request text, so the service would match transcripts itself. With a turn holding a session for 15 to 20 s, that is about 1.5 cents a turn (inferred, not measured), three times mini's. The realtime API bills only tokens, so an idle session costs nothing and can wait for the results announcement.

**Not measured.** The Quest itself: its network, AudioTrack's start-up, the room, and real voices. The headset's stream player has not been compiled yet.
