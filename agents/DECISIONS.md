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

## 41. Voice: the Conductor answers on the quick model

**Decision.** The Conductor's one model call is marked `quick`, so it goes to `MIND_PALACE_QUICK_MODEL` (`muse-ember-1.0`) at minimal effort, as the suggested questions already did (35). The plain rules for instant commands and tree requests are unchanged.

**Why.** On the headset the user said "Hey Momo, help me find something interesting to look at" and reported: "voice response is really really slow". The service log showed the Conductor taking 9.9 s (2,990 tokens) before Momo said a word. The user: "the voice response to register it hears the user needs to be almost instant".

**Measured.** `scripts/conductor-compare.ts` on a copy of the user's data: 22 utterances covering ask, more, navigate, organize, handoff, capture, keep, undo, tree and small talk, two of them in Chinese, each routed twice by each model, the order alternating. Both models routed all 22 to the expected kind, with the same card, tree or picks, on every run. No disagreement in 88 calls, and none between the two runs of the main model either.

| | Calls | Median | Range | Tokens in | Tokens out (reasoning) |
|---|---|---|---|---|---|
| `muse-spark-1.3`, effort low | 44 | 4.8 s | 2.2 to 11.5 s | 80,374 | 25,333 (21,689) |
| `muse-ember-1.0`, effort minimal | 44 | 0.9 s | 0.5 to 3.8 s | 80,374 | 6,845 (3,231) |

The user's own utterance was the slowest on the main model (8.0 and 11.5 s) and took 0.9 and 1.0 s on the quick one. Through the whole pipeline the quick Conductor answered in 0.8 to 2.9 s over 16 runs of that utterance, and the main one in 5.1 to 11.7 s over 14, while the machine's load average was between 8 and 117.

**What differs.** The quick model's lines run longer and name the card ("Looking for something interesting on generative UI for you."), still under the 15-word limit. Its `need` sometimes repeats the card ("examples of generative UI in video games for generative UI"), which the Scout reads the same way. Both answered the Chinese utterances in Chinese. In one pipeline run of 14, the main model answered the user's utterance with a question ("What kind of interesting are you in the mood for?") and started nothing. The quick model started a run in all 16.

**Alternative.** The main model at minimal effort: measured on the questions (35), it barely changed the time.

## 42. Voice: Momo says when results land

**Decision.** When a Scout run ends, the service sends one `say` and, unless the user has turned to something else since asking, a `navigate` to the card just before it. Every Scout run is one the user asked for: an `ask`, a `more`, an utterance the Conductor took for either, or the first round of a tree the user asked for, by voice, by a typed drop or from Telegram. A drop the Filer places runs no Scout and says nothing.

**Why.** The user: "I asked to find something interesting for me, it didn't get back to me with anything". The picks had come, 33 to 46 s after the transcript, under the card open at launch, which the user may not have been looking at, and Momo said nothing.

**The line.** Plain code writes it (`src/core/announce.ts`), at most about 20 words: how many picks came, under which card, and one or two of them by kind and title, real material before written ideas, such as `Five new things under generative UI: a film "Her" and a paper "Predictability and accuracy in adaptive user interfaces".` When two do not fit it names one: `…, including a film "Her".` A kind comes from the source when the source says what a pick is (a film from TMDB is a film though it came as its poster), else from the item. A title loses what follows a colon, a bracket or a bar, and a cut title never ends on "of" or "the". With nothing new: `I found nothing new for generative UI.`, and the view stays where it is.

**When.** The run's end, so the count is whole and "nothing" can be said. The Conductor's reply always comes first, since the run starts after it. A run is over once its slots are full, or only pictures are still being made, or every slot left is held by one (43), so the line comes with the last find that can land, not with work that can no longer land or a picture that takes another 10 to 20 s. That picture lands after the line, with no second line.

**The view.** The pipeline counts each time the user turns to something: opening a card (`focus`), being taken somewhere, asking about a card. A run moves the view to its card only when nothing was turned to since it began, or the latest thing was that card. The user who asked and then went to another tree hears where the picks went without being taken back.

**A newer run on the same card.** It wins, as before: the older run's later picks are dropped, and now its line is too. The picks the older run had already brought stay, and only the newer run is announced, counting its own picks.

**Measured.** In six runs of the user's utterance on the final code, the line came 20.8 to 27.9 s after the transcript, 23.6 s typically. In the four runs timed to the end, the run's picture landed 6.5 to 11.9 s after the line. Before, nothing was said after "I'll find something interesting for you."

**Clients.** The web client already opened a card on `navigate`, so at a run's end its panel shows the card, and asks for its questions afresh, now that the conversation and the cards round it have changed. Its browser checks now expect that, and accept the line cutting the reply short when the stand-in agents' runs end at once. The headset's handling is WS16's.

**Not done.** The line is in English whatever language the user speaks. The Conductor answers Chinese in Chinese, so a Chinese conversation hears English here. A model could write the line in the user's language, at a second and a model call more, and could then say things the picks do not hold.

**Alternatives.** Announce the first delivery: the count would be partial and nothing could be said of a run that brings nothing. Always move the view: it would take the user away from what they turned to.

## 43. Scout: choosing on the quick model, and a run's slots shared among its directions

**Decision.** `scout.curate`, which chooses among the records a search returned, is marked `quick`. Thinking of directions (`scout.ideate`) and rating ties (`scout.rate`) stay on the main model. Because the quick model made the finds arrive in a different order, a run's slots are now shared out:

- Each made direction's first pick lands the moment it is ready, except into a slot held by a picture still being made. A picture is paid for when it is started, so it keeps its slot.
- A further pick of a direction (a second paper, a second film) waits until every direction still out keeps a slot. It lands when a direction comes back empty, or at the end.
- A gallery makes only the pictures it could keep: one, and more only when the run has slots to spare.
- The run is over once its slots are full, or, when picks are delivered as they come, once only pictures are still being made or every slot left is held by one. A find still out then lands after the line only if a picture fails.

**Why the quick model.** On the main model one choosing call took 4.5 to 17.7 s, and a find waited for it before it could be shown.

**Measured, choosing.** `scripts/ask-timing.ts` with `COMPARE_ROLES` asked both models every choosing request of three live runs on the copy (the user's utterance, world building for the rural illustration, horror standoffs): 11 searches of papers, books, films, Hacker News, the Internet Archive, podcasts, Europeana and the web. They chose the same records in 8. In the other 3 the quick model added a second film (ADA beside Her), chose Jim Shepard's novel about Murnau over the 1979 Nosferatu, and chose another essay on Alien. Its notes were as specific. Its excerpts were found word for word in the records it was shown as often (13 of 16 against 11 of 15), and the Scout drops one that is not. It answered in 1.0 to 4.0 s against 6.2 to 16.9 s.

**Why the sharing.** With the quick model alone, the catalogues answered first, and a source that shows two records took two slots. Three runs of the user's utterance brought picks from 3, 3 and 4 directions, against 4, 5 and 5 before, and every one of the nine generated pictures, 32,000 to 51,000 image tokens a run, was thrown away because the slots were full when it came. The run, and so its line, also waited 7 to 21 s more for those pictures. The code before this work kept 7 of the 34 pictures it made in 13 runs, for the same reason.

**Measured, end to end.** The user's utterance on the generative UI card, on the copy, each run starting from the same mindstorm, timed from the transcript by `scripts/ask-timing.ts`. Runs alternated between the code before this work, from a plain copy of 36914c7, and the code after. The last six runs, three each:

| | Before | After |
|---|---|---|
| Momo's reply | 6.3 to 8.6 s, median 8.6 | 1.0 to 2.2 s, median 1.5 |
| First pick | 24.5 to 33.9 s, median 27.1 | 18.4 to 21.0 s, median 19.7 |
| The line saying what came | none | 22.4 to 24.6 s, median 22.6 |
| Last pick | 37.9 to 47.9 s, median 45.7 | 29.2 to 36.5 s, median 29.3, a picture each time |
| Pictures made, kept | 7, 4 | 3, 3 |
| Directions among the five picks | 3, 3, 3 | 5, 5, 5 |

Earlier pairs said the same. An hour before, with the main model twice as slow: before, first pick 31.1 to 40.3 s and last 45.1 to 53.6 s; with choosing and the Renderer on the quick model but no sharing, first 20.3 to 27.8 s and last 24.6 to 30.0 s, with every picture thrown away. In three runs between the sharing and the 20 s wait (`model-meta.ts`), a quick-model request went unanswered until the 120 s limit, and the line came at 144 s once; the retry answered in 1 to 2 s.

**What bounds it.** The first pick waits on thinking of directions, 13 to 30 s on the main model across the runs, because it writes 750 to 1,700 tokens of reasoning and about 800 of directions before any can start. The quick Conductor takes 4 to 11 s off the front of that. The last find comes 1 to 7 s after the directions, from catalogue searches of 0.2 to 5 s and a choosing call of 1 to 4 s. A generated picture takes 8 to 25 s. Between the two halves of an hour the main model's own times halved, so only runs that alternate are compared.

**Cost.** In the last six runs a run used, before, 9 to 10 main-model calls (24,500 tokens in and 12,100 out on average), 1 to 3 pictures (28,200 image tokens in, 4,300 out) and up to one OpenAI search: 75,000 tokens. After, 4 to 5 main-model calls (6,400 in, 6,200 out), 5 to 6 quick-model calls (17,200 in, 1,900 out) and one picture (10,700 in, 1,600 out): 44,000 tokens. The prices are not in this repository. At the roughly $1.20 per million tokens that 2 implies, with the quick model priced no higher, a run went from about $0.09 to about $0.05.

**Alternatives.** Choose on the main model and keep first come, first served: 20 s more to the last find. Count a gallery as one slot: it is three cards. Never generate a picture the run might not keep: with one direction more than the slots, no picture would ever be made.

## 44. Renderer: a card's look does not wait on how its siblings group

**Decision.** Both of the Renderer's calls stay on the main model. The views are handed to the pipeline as soon as the components are chosen, through a `deliver` like the Scout's, and the groups follow when the main model answers. A group or view that no longer holds by then is left out: one naming a card that gave way to a fuller round, one naming a card another pass has grouped meanwhile, or one mixing a pick with a card the user kept. A timeline or comparison is drawn from the siblings that stayed.

**Seen live.** On the user's headset session after the one home merge, three passes failed whole with "invalid: node … is already in group …". With directions delivered one by one, passes over one card's siblings overlap more, and each asked the model before the other's group was applied. `test/renderer.test.ts` holds a second pass to leaving out the group the first one made.

**Why.** Every view, the ones the rules choose included (steps, excerpt, reference), waited for both model calls, and the composites call took 2.9 to 24.8 s. A card that arrived as a plain note turned into its steps or its excerpt 7 to 12 s later. When a card gave way to a fuller round during that wait, the group that named it failed the whole batch, views included: "renderer: failed: missing: no node …" in two of the first three runs.

**The quick model, measured and not kept.** With `COMPARE_ROLES` in the three runs of 43, components took 1.2 to 2.5 s on the quick model against 5.4 to 6.1 s, and chose the same component in all 3 calls. That was on the components prompt before the card library's sizing work (g11) rewrote it into a much stricter one, so the switch was dropped when that work was merged in, and is to be measured again on the new prompt. Composites, 8 calls: the main model proposed a group 3 times (a comparison of two UI wiring options, a comparison of two books, a cluster of three standoff films), the quick model never, so they stay on the main model, now off the path to the card.

## 45. Voice: every line goes through one say, marked reply or results

**Decision.** The pipeline has one private `say`, and every line the agent speaks goes through it, the summary of an organize typed in a client included, which the server used to send itself. Each `say` carries `kind`: `reply` for the answer to what was just said (the Conductor's line, a question back such as "What should the tree be about?") and `results` for what finished work brought (a run's line, an organize's summary, a handoff being ready).

**Why.** A real-time speech model is to become the agent's ears and voice (WS17). It takes what the pipeline says from one place, and a client can now tell the quick answer from the later news, to speak them differently or let the news wait. A client that reads no `kind` speaks both as before. The headset reads `say` for its `text` and ignores other fields.

## 46. Activity: a short label for every step

**Decision.** Each `activity` carries `label`: at most seven words saying what is being done in this step, true of it, for a client to show live. `detail` is optional longer text: what the user asked, a picture's prompt, an error. `message` stays, set to the label or the error, for clients that read it. Roles run their steps through `ctx.step(role, label, body, {nodeId, detail})`, which the pipeline turns into a start and an end. The Scout shows each of its steps on its card: thinking of directions, checking what the user already has, each search ("Searching research papers for adaptive menus"), fetching pictures, reading what a search returned ("Reading 6 results from Hacker News"), making a picture, looking for a video. The Renderer says "Laying out 2 cards", the Conductor "Working out what you mean". Titles in labels are cut at a whole word and never end on "of", "and" or "why" (`src/core/brief.ts`).

**Why.** The user sees what the agent is doing on the headset while it works after the reply. Before, some lines were a whole request ("Looking for: something interesting to look at about generative UI") and some said nothing ("Choosing how to show this", "Listening"). The model's own reading of a card ("reads it as: …") is a `note`, a log line, not an activity.

**Checked.** `test/labels.test.ts` runs every role over a scripted model, a drop, a tree, a spoken ask with a find, a picture and a video, an organize and a handoff, and holds every label to two to seven words in one line, every step to an end, and a Scout run to showing each kind of step on its card.

## 47. Scout: directions are read as the model writes them, and ties are rated on the quick model

**Decision.** The Scout reads the main model's reply with its directions as it is written (`onText` on the request, server-sent events from the Meta API, `completeElements` in `src/core/partial-json.ts`). Each direction is taken the moment it is whole and starts at once: a written idea lands, a find searches, a picture is made. It stays at low effort. The rating of ties to what the user already has moves to the quick model, and what it brings lands as soon as it is rated, before any new content. A run is over while the model is still writing once nothing it could write would land. The model is asked to write a picture direction first, since a picture takes longest.

**Why.** The user: "it needs 30-60 seconds?? really??" The target they set is the first card about 10 s after the request and all of a run's cards within about 20 s, with the suggestions as inventive as before. Thinking of directions was 19 to 25 s of it, and nothing could start until all six were written.

**Measured, the model.** `scripts/ideate-compare.ts` caught the Scout's own request for three cards (the user's "help me find something interesting to look at" on generative UI, world building for the rural illustration with its picture, and "examples of standoffs in horror films") and sent it to each setting twice, alternating.

| Setting | Time to write six directions, 6 runs |
|---|---|
| `muse-spark-1.3`, low effort (kept) | 18.9 to 24.8 s |
| `muse-spark-1.3`, minimal effort | 11.1 to 15.2 s |
| `muse-ember-1.0`, low effort | 3.3 to 4.9 s |
| `muse-ember-1.0`, minimal effort | 2.7 to 4.1 s |
| `gpt-5.4-mini`, low effort | 7.7 to 9.6 s (it refuses minimal) |

The horror request decided against the fast ones. Asked for examples, the main model at either effort named them: The Thing's blood test, Ripley at the airlock, the Get Out teacup, The Shining, the Halloween closet, A Quiet Place. Both quick models and gpt-5.4-mini wrote searches about the subject instead ("Books on the horror showdown tradition", "Essays on horror face-offs"), which the prompt names a failure. On the other two cards they were on topic but more generic. Two blind readers (Opus, not told which setting wrote which set) ranked the six sets of each card. On every card both put a low-effort set first, six rankings out of six. The minimal-effort sets came next and never failed the request, though both of its world-building sets had a find with no search words and one horror set used Get Out twice. A find with no searches, 2 of 22 at minimal effort and none at low, now searches its title as it is on the web and cut to three plain words in a keyword catalogue, where it searched the whole title everywhere. Both readers failed both quick-model horror sets for giving no examples. The directions are side by side at https://claude.ai/artifact/UeTq7jLUhs8bxLQGVV1SAm.

**Measured, the rating.** On the same three cards the quick model rated in 1.3 to 3.7 s against 9.7 to 15.7 s. Neither model brought a tie in any of the twelve runs, and the picks already there were rated alike, the quick model more steadily than the main one, whose two runs on one card disagreed on six of eight picks. A rating on the main model would hold back the first card, which waits for it.

**Measured, end to end.** `scripts/ask-timing.ts`, the user's utterance on the generative UI card, from the transcript, alternating with a plain copy of 36914c7, three runs each per pair. The two pairs ran about half an hour apart, and the provider was slower for the second.

| | Before | Streamed, minimal effort | Before | Streamed, low effort (kept) |
|---|---|---|---|---|
| Momo's reply | median 8.5 s | median 1.0 s | median 11.4 s (6.9 to 12.0) | median 1.1 s (0.9 to 1.1) |
| First card | median 27.0 s | median 12.0 s (7.7 to 13.9) | median 34.9 s (33.4 to 37.8) | median 22.0 s (17.6 to 23.9) |
| The line saying what came | none | median 14.4 s (14.0 to 15.3) | none | median 25.7 s (20.1 to 27.4) |
| Last card | median 39.7 s | median 27.1 s (23.3 to 30.5) | median 53.0 s (52.1 to 59.4) | median 43.8 s (33.5 to 62.7) |

So the kept setting brings the first card 13 s sooner and the line 25 s after the request, and does not reach the 10 s the user asked for. Minimal effort comes within 2 s of it, at the cost the blind readers found. It is one line in `ideate` (`effort: 'minimal'`), left for the user to choose.

**What bounds it.** At low effort the model reasons for 890 to 1,390 tokens before it writes the first direction, 13 to 19 s after the request reaches it. At minimal effort it reasons for 240 to 510 and the first comes 5 to 8 s in. A find lands 1 to 5 s after its direction. A generated picture takes 9 to 43 s on its own, measured at 10.3 to 12.5 s alone with a short prompt and either size, so a run that makes one cannot have every card within 20 s. Its line does not wait for it.

**A wrong first measurement.** The first streamed runs showed every search starting when the directions ended. The timing script read each reply to its end before handing it to the client, which undid the streaming. It now reads its copy on the side.

**Cost.** The minimal-effort pair used, before, about 92,000 tokens a run (32,000 main-model, 54,000 for three pictures a run, none of them kept, 6,000 OpenAI search) and, after, about 63,000 (11,000 main-model, 30,000 quick-model, 19,000 for one picture). At the rate in 2, about $0.11 and $0.075. At low effort the main model writes about 2,500 tokens more a run.

**Alternatives.** The quick model for directions: four times faster, and it loses the concrete examples. Split the six directions over two calls at low effort: each reasons less before it writes, but two calls that cannot see each other repeat angles, and the prompt that keeps them apart would have to be rewritten and judged again; this is the next lever to try. Streaming kept the prompt as it was.

## 48. A tree asked for by its subject is rooted in the subject as said

**Decision.** `makeTree` with a subject of up to 120 characters that is not a link makes the root item itself, titled with the subject as the user said it. A longer subject, or a link, still goes through Intake.

**Why.** On the headset the user said "Can you start a new tree on Dutch artist?". The plain rules heard the request and its subject, but the subject went through Intake like a dropped note, which titled it "Dutch artist reference note", and the tree was rooted in that. The user asked for a tree about Dutch artists, not about a note. It also waited 7 s on Intake's model call before the tree appeared. `test/mindstorm.test.ts` checks that utterance, "start a tree about …", "Make a new tree on …", and one in Chinese the Conductor hears.

## 49. Model client: a request refused for the rate waits for room in the window

**Decision.** `MetaModel` keeps the key's rate window (`src/node/rate-window.ts`). It holds a request while the window has no room, and sends it as soon as it has. Room is the limit less this program's requests in the window, less as many more as a reply counted beyond them, which are other programs'. This program counts each of its requests from when it goes out until a minute and a second after its answer ends, a stream's included. The second covers the clocks' difference. Other programs' requests are taken to stay a minute from the reply that counted them. A refusal the counts do not explain holds every request for the refusal's `retry-after`, or a minute when it has none, as for a request larger than the tokens left. That hold is a second at least, so a shorter `retry-after` does not turn into a request sent again and again. A request is held a minute and a half in all at most, refusals included. One that cannot be let out by then is given up and fails then, or at once when a refusal holds every request for longer, as one of a spent daily quota would with `retry-after: 3600`. The run log then says `gave up waiting for the rate window`. A request says who waits on it with `priority`: `user`, the default, or `background`. Held requests go out the user's first, and background work leaves a tenth of the limit, 6 of 60 requests, to the user. The run log says how long a request was held: `held 41979ms for the rate window`.

**Measured.** The key allows 60 requests and 2,100,000 tokens a minute, shared by every program on it (WS21). Past the limit, 24 of 24 calls failed, since the old retries, 1.6 s and 3.2 s apart, gave up after 5.0 to 5.3 s. One Scout run makes 19 to 21 requests in about 33 s.

**A minute after the answer, not the turn of the minute.** WS21 read the window as resetting on the minute, and the first build here held requests until it turned. Bursts on the real key showed otherwise. Each sent 75 quick requests through one client, 15 every 5 s, and their logs are in the session's scratchpad (`ws26/burst-*.jsonl`).
- Burst 1 ran the minute build from 10:02:01Z. At 10:03:02, just after the minute turned, the replies said 0 left, where a new window would have said 37. At 10:04:01 a reply said 38 left, so the 22 requests let out at 10:03:01 still counted. The burst failed nothing only because the release at the turn fell just as its first wave left the window. One request was refused and held 98.7 s.
- Burst 2 ran a build that counted each request from when it was sent, starting from 10:24:25Z. The 10 requests let out 61 s after the first wave was sent were all refused, since that wave's answers ended 1.0 to 2.4 s after it was sent and counted from then. The replies' counts also showed the refused requests counting. All 10 were sent again 5 s later and answered, after being held 45.5 to 45.9 s.
- The counts lag. 12 of the replies to the first 15 requests, sent together, said all 60 were left, so a request is counted only once it is answered. The client therefore counts its own requests itself and takes from a reply only what is beyond them. A refusal carries `retry-after: 60` and `x-ratelimit-remaining-requests: 0`. No reply carries a reset time.
- `test/model-meta.test.ts` serves a fake with this behaviour. The minute build and the send-time build each fail its tests, and this one passes them.
- Burst 3 ran this build from 10:35:25Z: 0 refusals and 75 of 75 answered, at 10,522 tokens, about $0.013. The 60 requests the limit had room for were not held, and were answered in a median of 981 ms. The 10 user requests held went at 10:36:27, as the first wave's answers, which ended at 10:35:26.0 to 27.0, left the window. They were held 42.0 to 42.3 s and none was refused. The 5 background requests held waited until the limit had room beyond the user's tenth, held 46.6 to 51.5 s. The three bursts together cost about $0.04.

**Which requests are background.** Only the Renderer's composites, which are off the path to the card (44). The ratings of ties stay with the user, though they are background in spirit, because a run's first picks wait for them (`rated` in `scout.ts`). Held behind the reserve, they would hold back the first card. The default is the user's, so a request whose call site does not say never waits behind background work. The fast lane's later directions can say `background` where they are made.

**Not covered.** Transcription goes to another endpoint, whose limit is not known, and is not held. Each program on the key keeps its own log and learns of the others' use only from what the replies count, so two programs that start at once can still meet a refusal. The one refused then waits for room.

## 50. Scout: a fast lane brings the first cards while the main model thinks

**Decision.** Two lanes write a Scout run's directions, and they share its slots.

- **The fast lane** starts with the run. The quick model (`scout.looks`, minimal effort) names two or three catalogues likely to hold the subject, or a video, and what to type into each. Each is searched, the quick model chooses its one best record, and the card lands once ties to what the user has are rated. It never searches the web, never makes a picture, and never retries a find on the web.
- **The inventive lane** is the main model at low effort, streamed, each direction started as it is written, as in 47. It now writes pictures last.
- **Slots.** The fast lane fills at most two slots and never half of them. A third look's card waits and lands only into a slot left free at the end. The inventive lane is taken for one direction more than the slots the fast lane has left it. Its first picks never take a slot the fast lane's finds still out could fill, until the fast lane has lost.
- **Losing the race.** Once the inventive lane has a card ready, the fast lane has lost and keeps no slot. A choice of where to look still unanswered is given up, and its late answer brings nothing. A find of its still out lands only into a slot nobody else claims.
- **Pictures.** While the main model writes, until it has written a picture, one slot is kept for one. A pick that waited for that slot lands first once the model has finished without a picture.
- **No repeats.** The lanes share the addresses taken and the tree's sameness keys, so a record both find lands once (`test/scout.test.ts`).
- The run's line comes when nothing more can land, as before.

**Why.** The user: "It's okay to have some cards that come later, but 20 seconds without any cards landing is not acceptable." Nothing could land before the main model wrote its first direction, and it wrote the picture first. The target set in the voice plan is a first card within 8 s (median), never over 12 s, with the inventive cards still landing.

**Measured.** `scratchpad/ws22/bin/service-runs.mts` ran each request through the real service, a copy started per run on its own port from a fresh copy of the mindstorm, with a client that plays as the headset does. Five requests on five cards (something interesting on generative UI, Dutch art, standoffs in horror films, world building on the rural illustration, what studies found on mixed-initiative interfaces), each twice per side. The sides alternated, the first side alternating by pair, 10 runs each, with 20 s between runs. Load average 2.6 to 6.2 on 8 cores. Every model request was logged with its status: none was refused for the rate limit. Times are from the request to what the client received.

| | Before (22a65ed) | After |
|---|---|---|
| Momo's reply | 1.2 s (0.8 to 2.0) | 1.2 s (0.9 to 1.4) |
| First card | 20.6 s (14.6 to 30.8) | 4.1 s (3.5 to 6.3) |
| First card of the inventive lane | 20.6 s (14.6 to 30.8) | 16.8 s (10.6 to 21.7) |
| Longest wait for a card before the line | 20.6 s (14.6 to 30.8) | 12.1 s (6.2 to 18.0) |
| Cards by 20 s | 0 (0 to 4) | 4 (2 to 5) |
| The line saying what came | 25.7 s (17.7 to 33.0) | 24.2 s (19.1 to 29.4) |
| Last card | 28.4 s (20.8 to 42.5) | 37.8 s (21.2 to 48.7) |
| Cards of each lane | 5 inventive | 1 or 2 fast, 3 or 4 inventive |
| Generated pictures kept | 8 of 10 runs | 7 of 10 runs |
| Model requests a run | 10 (7 to 12) | 14 (9 to 16) |

In one run of Dutch art the rating also brought two paintings of the headset's library at 3.5 s, the only ties in the 20 runs. The runs without a picture are the two on studies, where neither side wrote one, and on the other side one picture the image model refused (400). Three requests failed on their own, none for load: a choosing request too large to send (413) and one refused (400) before, and that picture after. The last card comes later because the picture is now written last: it lands 10.6 s (0 to 27.0) after the line, against 2.6 s.

**What bounds it.** The first card waits on the Conductor (1.2 s median, quick model), the fast lane's choice of catalogues (1.3 s, 1.1 to 1.9), the search (0.1 to 1.2 s), and choosing the record (1.3 s median). A catalogue of pictures fetches up to eight pictures and shows them to the model first, so a run whose three looks were all museums, boards and heritage had its first card at 6.3 s, the slowest. The rating of ties, 1.7 s (1.4 to 2.5), runs beside it and is usually done first. The wait after the fast cards is the main model, which wrote its directions in 23.5 s (18.4 to 28.6).

**Cost.** Four more model requests a run (the choice of catalogues, two or three choosing calls, and a Renderer pass or two more for the earlier deliveries), and about 22,000 more tokens: at the rate in 2, about $0.078 a run against $0.052. With the key's limit of 60 requests a minute shared by every process, one run of the fast lane peaks at 16 in a minute against 12.

**A quick request that hangs.** An independent check of the first version found that a quick request of the fast lane that went unanswered held the inventive lane back. While the quick model chose where to look, two slots were kept for its finds and the line waited for it, and each try waited 20 s, three tries at most. In the check's timeline, scaled from the service's times, one unanswered choice kept two ready inventive cards back until the retry answered at 21.6 s. Then the fast cards took the slots, those two were dropped, and the line came at 23.3 s. Three unanswered tries held cards about 65 s. A fast find whose choosing hung kept a slot the same way. With the race lost once an inventive card is ready, the same timeline lands each inventive card as it is ready, at 14.6 to 17.8 s, and the line comes at 20.0 s. `test/scout.test.ts` checks a choice that answers after the inventive cards are ready, the line not waiting for it, and a fast find whose choosing hangs. All three failed on 4dbf751. The check's fuzz, 1,000 random runs of both lanes with throws, empty answers, pictures and delays, found no run over its slots, no record twice, and no run that did not end.

A quick request is now tried again after 6 s instead of 20 s (`model-meta.ts`). Of the 175 quick requests answered in the 24 runs above, all but two answered within 4.6 s. Those two, both choosing among pictures, took 11.6 and 14.7 s. The user waits on every quick request: the Conductor, the choice of where to look, choosing a record, and the rating, which every card waits for. By the medians above, one unanswered choice of where to look now puts the fast lane's first card at about 12 s (1.2 s, 6 s, the 1.6 s pause before the retry, 1.3 s, a search and a choice), against about 26 s with the 20 s wait. The cost: if those two slow requests are slow on every try, they now fail after about 23 s, where they landed in 11.6 and 14.7 s. The wait starts when a request is sent, after any time it was held for the rate window (49), so a held request does not use up its 6 s (`test/model-meta.test.ts`).

**Alternatives.** Search the user's words with no model in front: words such as "something interesting" name no subject, and on "adaptive menus" only the web and papers gave a usable top record (voice plan). Minimal effort for the main model: first card about 12 s, with the directions the blind readers ranked lower (47); the fast lane brings the first cards sooner and keeps low effort. More than two fast slots: the inventive lane's directions are the ones the readers ranked, so they keep most of the run. Count pictures as any direction: written last, a picture would find every slot full and never be made. A deadline of its own for the fast lane a few seconds in: until the inventive lane has a card ready the fast lane holds no card back, so giving up earlier would only lose the card its retry brings. Still searching where a choice that answers after the race is lost says, for the slots left: the line would wait on those searches, and in each of the 10 runs before the fast lane the inventive lane alone filled all five slots. A quick wait under 6 s: choosing among pictures took up to 4.5 s, and each needless retry sends the pictures again.

## 51. Looks: every card lands in the look it keeps

**Decision.** A node is made with the card the rules choose for its item (`firstView` in `src/core/roles/renderer.ts`), where it was made with a default from the item's kind alone and the Renderer's pass then swapped in the rules' card. The model's look call is asked only about the user's own text of some length that the rules drew as a note or an idea, and only such a card is made composing (`view.composing: true`, documented in `docs/protocol.md`). It lands once, within 12 s (`COMPOSE_MS`): as the model's card, or as the rules drew it when the answer was refused, failed, came after 12 s, or the pass already held 24 cards. A card that landed is final (`by: 'renderer'`) until its item changes, and an edited card the model is asked about again composes first. An idea the Scout writes is never asked about. The Renderer's later passes (`later`, `again`, up to four) are gone, and every card one pass composes, the ones past its 24 too, is left to it by any other pass, as when the user keeps it meanwhile. A card edited while it composes is composed again for its new text, and the answer for the old text never lands. An idea the Scout wrote keeps a look the model gave it before, while that look still stands in its text.

**Why.** The user: "do not show something first then turn it into something else", and "when a card is still being composed, put an in-progress 'composing' card there until the card arrived". An evaluation over a copy of the user's data found 27 of the 28 cards that changed face after landing were rule looks applied in a later pass, and the look call kept all 9 of the Scout's ideas it was asked about in the headset session as notes.

**Measured.** `scratchpad/ws24/replay.ts` replays a copy of `agents/data` (164 change sets, 77 cards on the canvas) through a checkout's own code: every set but the Renderer's and the Archivist's applied again, each new node made as that code makes one, and that code's Renderer run after each set as the pipeline runs it, with a model that keeps the rules' card. Before (22a65ed): 33 cards changed face after landing, 10 note to excerpt, 8 note to steps, 7 image to artwork, 4 note to reference and 4 image to reference. After: none, and 4 composed first. `test/renderer.test.ts` holds the land-once rule: made composing, one landing through the pipeline, a late answer not drawn, a second pass leaving a composing card alone, and nothing asked again after a failed call.

**What it costs.** A drop of more than 24 cards the model would be asked about lands the rest as the rules drew them. A card whose call is slower than 12 s lands as the rules drew it: in the format runs of 54, calls of 8 cards on the main model took 13 to 49 s. A card of the user's that the model would have turned into steps or a callout after a failed call stays a note, where a later pass used to ask again.

**Alternatives.** Keep the kind-only default and have the pass apply the rules: the face changes the user objected to. Keep later passes for cards with no answer: a landed card would turn into another. Wait longer than 12 s: the plan's figure, set against the 3.9 to 7.7 s the call took for single drops in the headset session.

## 52. Looks: the composing card on the headset

**Decision.** The headset draws a composing card as an in-progress card (`quest/core/cards/composing.cpp`): the item's kind and where it came from, "Note · Dropped in" or "Link · nytimes.com", over three soft bars, with a band of light running across it once every 1.6 s. It shows none of the item's title or words, since seven of the shapes the model can choose have no title row, and opened it says the card is being laid out. When the look lands, the card's frame without its words eases over 0.32 s to the finished card's size and place, and the finished card comes up inside it over 0.3 s from a quarter shown, as the words leave (`OceanModel::settleCard`, `startSettle`). The composing card stays whole until the finished card's faces are on the GPU, at most half a second, so the frame is never empty. Nothing fades out and back in, where the redraw used to fade the old face out in 0.15 s.

**How.** The light is 31 flat strips that write no depth. A textured band showed the renderer's grey stand-in for a picture still on its way to the GPU, for as long as a second while the ocean's thumbnails took the upload budget, and a band that wrote depth cut a hole in the face under it whenever it sorted nearer the eye. Pictures from the Mac preview, voice off and muted: `scratchpad/shots/looks/01` to `04`.

**Alternatives.** Draw the finished card over the composing one as a crossfade: the composing card's words showed through the new card's for a fifth of a second in the first try. Show the title while composing: it would disappear when a titleless shape lands.

## 53. Looks: a book shows its cover, and a repository its own description

**Decision.** The reference card takes `cover`, the item's own picture. On the headset's small face a book's cover stands at its left, two by three, with the kind, the year, the title and the first author beside it, and the opened card shows the cover over the details. A code repository the Scout finds is catalogued `kind: 'repository'` by the source, titled with the project's own name, and drawn as a link card with its own short description, where it was an excerpt of that description.

**Why a cover on the reference card.** The reference card already holds what tells one book from another, the authors, the year and where it appeared, and stays the one card for papers and books. The picture card frames a landscape picture at 1.35 to 1, so a portrait cover would stand small in it, and its one caption line has no room for an author or a year. The web's card library is not changed: it ignores `cover`.

**Why a repository is a link.** Its text is what the project says of itself and its star count, a blurb and no passage, and the card that leads with where it lives fits it. A real passage of a page, an answer or an article stays an excerpt.

## 54. Looks: the look call moves to the quick model

**Decision.** The Renderer's look call for a dropped card is marked quick, so the service answers it on `muse-ember-1.0`, at low effort as before. `npm run formats` measures it so, and `npm run formats -- --main` on the main model.

**The bar, set before the runs.** Switch only if the quick model's score on the authors' samples falls within the main model's run-to-run spread, and its score on the reviewers' samples does not drop. Then two blind readers judge the cards the two models disagree on, and the quick model must not be worse there.

**Measured.** Three runs on each model, in turns, on the code of 51 to 53 (`scratchpad/ws24/quick`). The authors' set has 53 samples now, the six explorable `E` items with them, so the spread of 39 to 41 measured on 47 is of another set.

| | Authors' 53 | Reviewers' 120 | Slowest call of a run | Tokens of a run |
|---|---|---|---|---|
| `muse-spark-1.3` | 46, 46, 46 | 108, 111, 109 | 39.8 to 49.2 s | 62,600 to 64,400 |
| `muse-ember-1.0`, quick | 45, 46, 46 | 110, 108, 109 | 4.3 to 6.0 s | 49,300 to 53,100 |

Read strictly, one quick run fell one sample under three main runs that all scored 46. The coordinator read the bar as met, taking the run-to-run spread as the one sample either way the main model has shown, and the reviewers' scores overlap. The two models drew different cards on 9 samples across the six runs. Two blind readers (Opus and Sonnet, `quick/readers.md`, not told which card came from which model) chose one card for each. Counting a sample for the model whose runs drew the chosen card more often, reader A preferred the quick model's on 5 and the main model's on 4, and reader B the quick model's on 7 and the main model's on 2. Both chose the quick model's proscons, sheet for a recipe, list as a sheet and facts, and the main model's note for "Three tiers" and its explorable slider for the field of view.

**Why.** A composing card waits 12 s at most (51). On the main model a call for 8 cards took 13 to 49 s, so in a drop of several notes most landed as the rules drew them; the quick model answered every call in 6 s or less, at four fifths of the tokens.

**Alternatives.** Stay on the main model: the same choices within a sample, with most cards of a multi-note drop landing before their answer. Ask the main model one card per call: shorter calls, at more calls and tokens.

## 55. Looks: every source's records get the card two blind readers chose

**Decision.** Each source says what kind of thing its records are (`Found.kind`, carried to `item.data.kind`), and the rules draw each kind as two blind readers chose for it. A web page, a news article, a Stack Overflow question, a GitHub repository and a film or series are link cards with the record's own words beside the title, a film with its poster. A page a DOI names is a paper's reference card, and OpenAlex's conference papers are papers. An answer is a question and its answer. A recipe is a sheet of its picture, its line of ingredients and its numbered steps, when the sheet can hold them whole. A Europeana painting is an artwork, and one its concepts call a photograph stays a picture. A podcast episode plays beside its cover art, and a Hacker News thread is a note. On the headset a film's poster stands at the right of its link card, an episode's art at the left of its player, and a sheet's picture in a band across its top. A link's picture that is not taller than it is wide, such as a page's own preview picture, lies instead in a band under the card's address bar with the title on one line, since the poster's 60 by 90 px box would show only a sliver of its middle. Until the picture arrives, a film's is drawn as a poster and any other as a band, so the card keeps its shape when it does. A find no source catalogued, as every one already in the user's data, is drawn as before, so no card there changes.

**How it was chosen.** Each of the 15 sources was searched with three queries and no model (`scratchpad/ws24/audit/fetch.ts`), and the first record each could show was made into the item the Scout makes and drawn with the rules. Two readers on different models (Opus and Sonnet), shown the 45 records and the card types but not today's cards, chose the card for each (`audit/readers.md`, `reader-a.md`, `reader-b.md`). They chose the same card type for 36, today's rules drew 20 of those as they chose, and the rules now draw all 36 so. Where they differed, the card kept is the one that holds the whole record and shows more of it:

- Threads: note over chat. The chat card shows a user's side and an answer, and would leave out comments and who wrote each.
- Questions: link over note, which shows the same words and also where they live. An answer: a question and its answer over a note, for the same reason.
- Episodes: with their cover art, which is the episode's own and shows more.
- Recipes: a sheet with the picture over steps. Steps hold the ingredients only as an opening of 280 characters at most, and drop the picture.

**What differs still.** One record of 45: a curry whose line of ingredients runs to 388 characters, past the 280 a sheet's text holds, stays its picture, where the readers chose a sheet or steps. Neither card can hold it whole. The table before and after is `audit/table-final.md`.

**Alternatives.** Change the rules for every find, catalogued or not: cards already in the user's data would turn into others when next touched. Keep excerpts for pages and articles: both readers chose the link for all six, one of them torn on the news.

## 56. Scout: each idea is written in the card that shows it best

**Decision.** The Scout's main model writes each written idea in one of ten formats, the card that shows it best: a note, steps, a list, facts, a quote, a table, a question and its answer (`qa`), a definition, pros and cons, or a callout. It fills the fields that card reads in the same streamed reply, in a few slots every written format shares (`lines`, `pros`, `cons`, `subject`, `passage`, `by`). `FORMS` in `scout.ts` builds the item's text from those fields, and its `data` as the Renderer's extracted rules read it, so the card shows the whole item. No later agent gathers anything. A format is kept only when its fields fill its strict form and `byRule` draws the item as that format:

- steps and a list: three entries at least; facts: two to six, each a label and a value; a table: two heads at least, two rows at least, a cell for every head;
- a quote: the words and who said them; a question and its answer, a term and its meaning: both; pros and cons: two points a side at least; a callout: its warning.

Otherwise the idea lands in its own words, with no structure in its data, drawn from its text alone, and the run log says what it lands as and why: `"Two rooms" lands as a note, not a list: it has only 2 of the 3 entries it needs`, or `… not facts: its card's check refused it`. A figure or a cell written with Chinese marks ("上映：1982", "｜") is read as one, and a meaning that opens with its term ("Parallax is…") is written alone, so the card names the term once. Finds keep the shape their source gives. The Renderer's rules gain a callout and an explorable that a role wrote out with its item (`data.callout`, `data.explorable`), the explorable built as the look call's is and drawn only when its formula reads and gives every result its item states, so the Scout's explorable comes back with one line of its formats once the headset can work its controls. With 51, a Scout idea is made with the rules' card and never asked about, so the card it lands as is its last (`test/scout-shapes.test.ts`).

**Why.** The user wants each item "in the best format possible", not "only a few templates", and asked: "how do we make sure that after search agent picks card type, the agent that follows will gather all info needed to fill in the picked card type?" Written in one reply with its fields, the shape has nothing left to gather. Before, the Scout's ideas were notes or steps, and all 9 the look call saw in the user's headset session stayed notes.

**The cost was thinking, not fields.** `scratchpad/ws25/bin/prompt-compare.mts` sent the directions request of a plain copy of cce96dd and of this branch, on DECISIONS 47's three cards, to `muse-spark-1.3` at low effort, alternating, and read each stream on the side. With a paragraph of rules per format and sliders in explorables, the model reasoned for 1,208 tokens before its first direction against 745 (median, 6 calls each), and its first text came 3.5 s later. The empty slots add about 20 tokens to a direction. With one line per format, explorables of states only, and written ideas first: first direction 7.9 s against 7.2 s, first written idea 7.9 s against 7.8 s (6 each). Today's own median moved 1.6 s between two batches an hour apart.

**Explorables left out.** Asked for sliders, the model set 2 of its 3 over quantities it made up ("Model creativity" from 0 to 1 giving "interface consistency", "Weeks after peak bloom" giving "field still yellow"), which no formula could state, so the measurements below offered states only. Of the 4 explorables of states it then wrote, one blind reader marked 2 as lists (below), and the headset cannot yet work an explorable's controls: its opened card writes its states out as text. So the Scout writes none for now. The Renderer's row keeps the check that a slider's formula gives every stated value within 1 percent, for any role that writes one. Three calls of the prompt without them, on the three cards above, wrote lists and notes, a list of five rules where an explorable had stood.

**Measured, inventiveness.** The same three cards, two sets a side from the batch above, shuffled under letters per card, ranked by two blind readers (Opus and Sonnet) on how inventive, specific and useful the directions are (`scratchpad/ws25/blind-sheet.md`, `reader-a.md`, `reader-b.md`). The mean rank was 2.5 for both prompts; a set of this one stood above one of today's in 12 of the 24 pairs. Its sets were first in 4 of the 6 rankings and last in 4, each last named for generic finds, as today's were on two cards.

**Measured, ten requests,** with explorables of states still offered. `scratchpad/ws25/bin/service-runs.mts`: ten requests on ten cards (WS22's five, and how Kubrick made his films feel cold, where else the grid idea was used, whether "Clippy was the first generative UI" is true, how a scene of The Good, the Bad and the Ugly was made, ideas for a short story like "The machine is scariest when it is polite"), one run each per side, alternating, each through its own copy of the service from a fresh copy of the mindstorm, Telegram off. Another workstream ran four Scout runs on the key meanwhile; no request of these runs was held for the rate window.

| | Before (cce96dd) | After |
|---|---|---|
| Shapes the written ideas took | 2: note 10, steps 1 | 8: note 10, explorable 4, steps 2, quote 2, pros and cons, list, definition, facts 1 each |
| Ideas that fell back to plain text | | 0 of 22 |
| First card | 4.3 s (2.1 to 6.8) | 3.6 s (2.0 to 6.2) |
| First card of the inventive lane | 9.4 s (2.1 to 19.9) | 10.0 s (2.0 to 31.0) |
| First written idea | 10.0 s (7.1 to 13.5, 9 runs) | 11.4 s (8.1 to 31.0) |
| The line saying what came | 14.3 s | 15.6 s |
| Last card | 25.3 s | 29.2 s |
| The directions call | 12.2 s (9.4 to 24.9), 4,200 tokens | 14.7 s (11.4 to 40.1), 5,250 tokens |
| Spend, 10 runs | $0.73 | $0.70 |

Medians, with the range. The first written idea is 1.4 s later, and 1.3 s by the median of the nine requests both sides wrote one for. Written first, an idea lands the moment it is whole, so the inventive lane's first card is 0.6 s later. One directions call of this side ran 40 s, which put that run's first idea at 31 s. On the code before 51, 12 of the 22 ideas landed as notes and took their shape a pass later; with 51 merged each is made in its shape (`test/scout-shapes.test.ts`).

**What bounds it.** The directions call: about 1,000 tokens more, as the model writes fuller ideas, and 2.5 s longer at the median.

**Measured, fit.** Two blind readers (Opus and Sonnet) were shown the 22 ideas of those runs, each with its request and its card, and marked any card where another shape would be clearly better (`scratchpad/ws25/fit-sheet.md`, `fit-reader-a.md`, `fit-reader-b.md`). One marked none. The other marked 2, both explorables that should be lists: three films that are parallel examples of one point, where a switch hides two, and three rules to apply together drawn as a choice between them. The prompt now says a list is for examples or rules that hold together.

**Not done.** Pros and cons are headed in the idea's script (优点 and 缺点, メリット and デメリット, 장점 and 단점) and otherwise "For" and "Against", so an idea in Spanish or French gets English heads. The shapes without explorables were not measured on the ten requests again.

**Alternatives.** A short shape hint with fields only for the shapes that need them, or the fields after the title: they save output tokens, which were not the cost. A later agent that fills a picked shape: it would wait on a second call and on what it gathers, and could fail to fill it after the card had landed. Sliders: above.

## 57. Live voice: Momo hears and speaks through OpenAI's realtime model, and the pipeline still decides

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

## 58. Live voice: the realtime model is Momo's ears and mouth only, and the device has two sounds of its own

**Decision.** This replaces 57's preamble and its `act` tool. The realtime model never answers the user. Its semantic turn detection (eager) ends the turn with `create_response: false`, and its input transcription (`gpt-4o-transcribe`, told the name and the card titles as `/api/transcribe` is) writes the turn down. The service tells the device `over` at once, sends the words as they are written (`heard`, partial then final), and hands the final to the pipeline as `utter(text, scene, true)`. The pipeline decides everything. Each `say` is then spoken in a response of its own outside the model's conversation (`conversation: 'none'`, `input: []`), so the model reads nothing but the line and a few words of context, in one voice per session. A turn's reply goes before any results line waiting with it. `quiet` tells the device no reply is coming: only the name was said, the Conductor failed or had nothing to say, or 15 s passed. Saying the name while Momo speaks cancels the response, and the service keeps of each line only what the device had played of it by then, which is all the model is ever told of it. A reply that comes after the user spoke over the turn it answers is not said. `settings.voiceStyle` is `verbatim` (the line as written) or `own words` (every fact, name and number kept, nothing added, about as short, in the language the user last spoke, opening differently from the last few lines). The device plays a short falling tone at `over` and a quiet loop from the end of `sent` until the first sound of the reply, and nothing while the agent works. It shows waiting, listening, sent, thinking, responding and working on the orb (and in the web page's caption and microphone button). A question picked or typed under a card goes straight to sent, and its thinking ends at a reply or when the work starts, since the pipeline answers an `ask` with no spoken reply. The headset opens `/live` only while `hello.live` is true. `-mute` silences every sound of the app's, and Momo's unheard voice still takes its time on the orb.

**Why.** The user wants to be registered almost at once and accepted about 2 s to the first word, with a sound when their turn is sent and another while Momo thinks. One voice, the realtime model's, speaks everything, so nothing sounds as if it came from two models. They asked whether Momo should say the agent's lines in its own words, and chose to hear both.

**Measured.** On the Mac, against a copy of the user's data, with the real models. End of speech to each stage, by `scripts/live-measure.ts`:

| Pipeline | Turns | Over (the tone) | Transcript | Reply said by the pipeline | Reply first heard | Results line first heard |
|---|---|---|---|---|---|---|
| WS15's Conductor (tracy/quest-fast merged in a throwaway tree) | 5 | 0.77 to 1.09 s | 1.20 to 1.63 s | 1.21 and 1.50 s by rule, 2.81 to 3.16 s by the model (its call 1.27 to 1.53 s) | 1.64 to 1.84 s by rule, 3.15 to 3.50 s by the model | 24.3 to 31.7 s |
| This branch's Conductor, two runs | 11 | 0.68 to 1.47 s | 1.06 to 1.77 s | at once by rule; the model's call took 4.6 to 22.4 s | 1.59 to 1.85 s by rule in four of six (the others 2.62 and 4.11 s), 6.4 to 7.3 s by the model | none is said |

The Mac preview with `-wakeClip` and `-mute`, on the headset's clock, ended the turn 1.18 s after the last word and heard Momo 2.07 s after it. From the service asking for a line to its first sound took 0.31 to 0.53 s in 16 of 19 lines; three in the first run took 0.92 to 2.15 s, and a probe of the service's event loop in the later runs found it never held more than 107 ms, so those three are not explained. The words come only once the turn is over, never while the user speaks, and the whole transcript 0.29 to 0.64 s after it. A turn costs about $0.001 to write down (at the 2025 list price of `gpt-4o-transcribe`), $0.0005 to $0.0013 for the reply and $0.0024 to $0.0032 for a results line: about $0.002 for a command and $0.004 to $0.005 with a results line.

**Own words or as written.** `scripts/voice-fidelity.ts` said 30 of the pipeline's lines (16 Conductor replies, 14 results lines, one of each in Chinese) twice in each style, checked every name and number, and asked `gpt-5.4` whether anything was added, lost or changed. As written passed 58 of 60; both misses were the judge faulting the line itself ("three new things" naming two). Own words passed 53 of 60 (replies 26 of 32, results 27 of 28). The exact checks found nothing in either, but own words changed meaning: "Starting a tree on Dutch painters." became "Begin a new tree on Dutch painters." in both rounds, "Going up." became "Let's go up.", and "Done." was added before a results line. Both kinds failed, so both fall back: `verbatim` is the default, and the setting lets the user choose own words by ear. As written was also heard sooner: 460 ms to the first sound at the median against 583 ms for replies. One consequence: a user who speaks Chinese hears the pipeline's English replies as they are written ("Looking for more on old maps."), where own words would have said them in Chinese. Both voices asked for, marin and cedar, are offered.

**Not done.** The Quest itself (its network, AudioTrack, the room, real voices) and the Android build of these changes. Answering an `ask` with a spoken reply, which would let a picked question think until Momo speaks. A results line keeps a first-person "I found nothing new" as the pipeline writes it.

## 59. Live voice: Momo holds the conversation, and walks the user through what lands

**Decision.** This replaces 58's "ears and mouth only". The realtime model is Momo and answers each turn itself, in its own words, as a curious, warm, knowledgeable friend in one or two sentences (`instructions` in `src/node/live.ts`). It chooses one of four ways: from what it knows; `web_answer`, `gpt-5.4-mini` with OpenAI's web search at low reasoning, its links taken out (`src/node/web-answer.ts`); `look_up_mindstorm`, BM25 over what the user has, under 1 ms; or `find_new`, a Scout run on the open card, or a new tree when nothing is open. The Conductor's other moves are tools too, calling `Pipeline.perform` with the intent the Conductor would have made (`src/core/voice-tools.ts`): `start_tree`, `more_like_this`, `keep`, `undo`, `go_to` (it only opens a card, never starts a layer), `organize`, `hand_off` and `save_note`. A call runs as soon as the model makes it, while its lead-in still plays, and an act returns at once. The model speaks again after a call only for an answer (`web_answer`, `look_up_mindstorm`) or a call that could not be done. Typed questions, picked rows and Telegram still go through the Conductor.

As the cards of a Scout run this device asked for land, by voice or by a picked question, the model is told each in a system note of only what the card states (kind, title, maker, date, source, why it was picked, its summary): the first card at once, later ones gathered and told together at most every 6 s, and a wrap-up when the run ends, which says which to look at first and offers one next step. A line the pipeline says for this device's work is told as a note too; a run's own closing line is left to the wrap-up. No note is given while the user is heard or Momo answers. The headset's `/live` names its `/ws` connection (`hello.connection`), so what Momo starts is marked `yours` there, and only this device's work is walked through. Where the user is (the open card, its tree, the suggestions round it) is told in a note when it changes, never by rewriting the instructions, so the conversation's cached tokens stay cached.

**Hearing the end of the turn.** Semantic turn detection, eager, answers the turn itself (`create_response: true`). The turn is over for the device when Momo's answer begins, not when the detection first takes a pause for the end: if the user goes on before the answer begins, the early answer is cancelled and the turn goes on, its words written down whole. 1.8 s of quiet after the last word, by the headset recorder's own rule for a word, ends a turn the detection has not (`pauseMs`, `MIND_PALACE_LIVE_PAUSE`). The name while Momo speaks cancels the response and cuts Momo's words in the conversation (`conversation.item.truncate`) where the device had played them to.

**The model.** `gpt-realtime-2.1`, the full model, by the rule set for this choice: the full model unless mini matches it on choosing the way, answer quality and time to first sound. Mini chose the way as often as needed and was first heard as soon, but two blind readers preferred the full model's answers (35 to 3 with 2 ties, and 24 to 6 with 10 ties, over the 40 requests of one run each), and mini said things about cards that their notes do not state. The readers caught mini answering a question about De Stijl and the Bauhaus with Vermeer, saying ESCAPADE launched this month when it launched in November 2025, and naming unkept suggestions as saved cards.

**Measured.** `scripts/live-bench.ts` on 40 spoken requests (`scripts/live-requests.ts`: 10 questions Momo knows, 8 for the web, 6 about saved cards, 6 for new content, 6 commands, 2 small talk, 2 unclear), each said by `gpt-4o-mini-tts` into a file, never played, with a room's faint noise under it, streamed at the pace it was said into a service on a copy of the user's data with the stand-in roles. Two runs a model, B and C, the models side by side; `scripts/live-summary.ts` reads them.

| | `gpt-realtime-2.1` | `gpt-realtime-2.1-mini` |
|---|---|---|
| The right way, of 40 | 40 and 40 | 38 and 39: timeless questions sent to the web (Barry Lyndon's candles twice, the Red Blue Chair) |
| End of speech to Momo's first sound | median 2.29 and 2.22 s (1.11 to 3.64) | median 2.21 and 2.19 s (1.01 to 2.94) |
| A question Momo knows, first sound | median 2.28 and 2.25 s | median 2.27 and 2.32 s |
| A web question: lead-in, then the answer | lead-in 1.90 and 1.86 s; answer 6.70 and 6.42 s, none within 5 s | lead-in 2.13 and 2.10 s; answer 5.96 and 6.10 s, none within 5 s |
| The web search itself | median 3.05 and 2.84 s | median 2.93 and 2.86 s |
| A card landed to Momo's first word about it (the service's side) | median 0.53 and 0.62 s | median 0.38 and 0.40 s |
| Lines about cards stating something their note does not | 0 of 28 | 7 of 28 ("It shows a structured interior with a classic photographic look" of a card whose note said only "gelatin silver print") |
| Words in the answer to a turn | median 42 and 40 | median 54 and 58 |
| Two blind readers' choice of the better answer, run B | 35 and 24 of 40 | 3 and 6 of 40 (ties 2 and 10) |
| A turn's cost (the realtime model, writing the turn down, web answers) | $0.036 | $0.016 |

The lines about cards were judged by `gpt-5.4`, shown the user's request and every note.

In sample conversations on the full model (`scripts/live-samples.ts`, cards landing at 4 to 20 s as a run's do), Momo was first heard on the first card 0.6 to 1.4 s after it landed, in 4 of 4, and told later cards as "three more" and "one more". In the Mac preview, muted, with `-wakeClip` and the headset's own clock, the turn was over 0.93 s after the last word and Momo first heard 1.61 s after it on a question it knows; on a web question and a request for cards the turn waited for the 1.8 s pause, and Momo was first heard 2.43 s after the last word.

**Found by measuring.**
- The turn detection is most of the wait. Over clean digital silence it ended the turn 1.11 s after the last word at the median, but waited 2.3 to 2.7 s after 13 of 40 requests, short commands among them ("Keep that one.", "Undo that."). With a room's faint noise it waited past 1.8 s in 21 to 23 of 40. The full model's own part, from the end of the turn to its first sound, was 0.39 to 1.55 s, 0.66 s at the median (98 responses).
- Requests said with a thinking pause of 1.4 to 2.3 s ("I'd like to see… something about old maps."): server turn detection at 500 or 700 ms cut all five; semantic detection kept three; ending the turn after 1.2 s of quiet, the recorder's rule, cut all five, though it brought the first sound to 1.66 s at the median; 1.8 s with the turn going on when the user does kept four. A cut request loses the user's words, since the device stops sending at `over`, so 1.8 s is the default.
- Where the 2.2 s goes, on the full model (runs B and C, 40 requests each): from the end of speech to the answer beginning, 1.74 and 1.54 s at the median, the turn detection's; the 1.8 s rule ended 21 and 19 of the 40. From the answer beginning to its first sound, 0.70 and 0.65 s, the model's. The relay on the Mac adds milliseconds. Turn detection is already at its most eager. Thinking at effort `none` (accepted by the model) and ending turns after 1.5 s of quiet, on 12 of the requests: first sound 1.95 s at the median (1.32 to 2.29) against 2.47 and 2.21 s for the same 12 in B and C, the model's part 0.62 s against 0.69 s, the way right 12 of 12; but 2 of the 5 requests with a thinking pause stayed whole, against 4 of 5 at 1.8 s. The defaults stay at `minimal` and 1.8 s; `MIND_PALACE_LIVE_EFFORT=none` and `MIND_PALACE_LIVE_PAUSE=1500` (or 1200) trade them for speed.
- The blind readers flagged answers naming cards that may not exist ("a card on his pigments", "a cutaway of the light box"), unkept suggestions called saved cards, the cards of other trees listed as the generative UI tree's, web dates the search did not give, and "to the top of the tree" for "go up". `look_up_mindstorm` now marks each card saved or not and lists a tree named in the query as the tree; Momo is told to name only cards a tool returned or a note told it of, to tell only what a web answer says, and that "up" is one level; the web answer dates each event and keeps to the period asked about. Those seven requests, run twice on the full model after: no card named that no tool returned, suggestions called suggestions, the generative UI tree listed as itself, "going up one level". The hours and the date the readers doubted were the web answer's own; in one of the two runs the search model again dated ESCAPADE's 2025 launch to this month, and Momo said it as given.
- Web answers think at low effort. With none, the search model said ESCAPADE launched this month (it launched on 13 November 2025) in one of four answers to "What did NASA launch this month?", and once missed the Thyssen-Bornemisza's Vermeer show. The eight web requests on the full model at low effort: the search answered in 3.74 s at the median (2.36 to 5.13) against 3.05 and 2.84 s with none, and Momo's first words of the answer came at 7.70 s (5.95 to 8.42) against 6.70 and 6.42 s. Checked against the sources, the Booker winner, the Mauritshuis's Monday hours, the Thyssen show's dates, the Van Gogh Museum's prices, de Kooning's closing date and the next NASA launch were right; WORN's closing date was 27 March 2027, which the Rijksmuseum gives as 21 March, as one answer with none had it too. A wrong date is worse than a second more, and Momo's lead-in covers the wait; `MIND_PALACE_WEB_EFFORT=none` answers sooner.
- Four real Scout runs on the merged fast lane found that every Scout step names its card, so Momo took each step for a new run and said nothing had landed before the cards came. A run's own step now carries `whole` in its activity, and its parts are left out. A newer run on a card whose run is under way ("bread pictures", then "only rye") goes on as the same run, since the pipeline drops the older run's later cards and says nothing at its end; the run ends with the last of its runs' steps. The verifier found this through the real server. Four more real runs after it, with the Scout's written shapes merged: the first card landed 5.1 to 9.3 s after the end of speech and Momo was first heard on it 0.54 to 0.60 s after it landed; later cards came as "two more" and "three more", a wrap-up offered one next step, and a picture made after the run was told as one more. A list card was told with its entries, now that a written card's notes say what it shows. The judge found 1 of 18 lines adding to its note, a gloss that a paper gives a reading "a sharper, more unsettling edge".
- Asked to be unsure of nothing, mini still sent settled facts to the web, until its instructions said to trust what it knows and keep the web for what changes; it then routed all ten known questions itself in one run, and three of twenty in the two final runs went to the web.
- The web answer takes 2.8 to 3.1 s at the median when Momo asks it, against 2.5 s measured on short questions, and the full model makes its call 0.63 to 1.32 s after its lead-in begins (16 calls). So the answer comes about 6.4 s after the end of speech; the plan's 5 s holds only for a quick turn and a quick search.
- Without being told, Momo said a handoff was "sent to your coding agent". Notes from the agents now say to claim nothing they do not say. In the samples Momo said "The note says…" until told never to mention the notes.
- Momo says its lead-in before it calls `find_new`, so the Scout starts 1.5 to 2 s after the turn is over (four runs in the preview and the samples).
- The turn detection took the pause after "Hey Momo," for the end of a turn and heard the user go on; the early answer was cancelled and the turn kept whole, "Hey Momo, wait, what's a camera obscura?" answered as one.

**Not done.** The Quest itself: its network, AudioTrack, the room and real voices. A wrap-up the user speaks over before it is heard is not said again. A follow-up after Momo asks something still needs "hey Momo", since nothing is heard without the name. Long talks past the realtime session's 32,000 tokens or 60 minutes are not handled. Momo's answers run longer than the one or two sentences asked for, about 40 words at the median.

**Alternatives.** Mini, at less than half the cost, when its card talk is good enough: `MIND_PALACE_LIVE_MODEL=gpt-realtime-2.1-mini`. A faster turn at the cost of thinking pauses: `MIND_PALACE_LIVE_PAUSE=1200`. Speaking every card, or only the wrap-up: the plan's other two choices, not built.

## 60. Live voice: a web answer waits mostly on the search model, and nothing tried cuts it measurably

**Decision.** Momo's web answers stay as 59 left them: a lead-in, then `web_answer` at low effort, then the answer. Of everything tried, only a shorter lead-in moved its part, and that part is too small to show in the answer. `scripts/live-bench.ts` now records when each response began, how long the search model took and how many searches it made (or that it failed), and when its answer was handed to Momo; `scripts/live-summary.ts` prints a web answer part by part.

**Why.** The user wants a question that needs the web answered quickly, and the plan's target is a lead-in within 1.5 s and the answer within 5 s. The answer's first words came 7.7 s after the end of speech at the median (59).

**Where the time goes.** The eight web requests of `scripts/live-requests.ts`, said into files and never played, on `gpt-realtime-2.1`, two rounds alternating per request with the candidate below. Today's code, 16 turns:

| Part | Median (range) | What sets it |
|---|---|---|
| End of speech to the turn being over | 1.65 s (0.68 to 2.00) | the turn detection, or the 1.8 s pause rule (59) |
| Then to the lead-in's first sound | 0.72 s (0.55 to 0.89) | the realtime model |
| Then to the `web_answer` call | 0.96 s (0.57 to 1.42) | the model writes the lead-in's audio before the call's arguments, so this grows with the lead-in (11 words at the median) |
| The search model | 4.10 s (2.06 to 7.25) | OpenAI's web search and the model's thinking around it |
| Its answer handed over to the answer's first sound | 0.68 s (0.55 to 0.91) | the realtime model |
| End of speech to the answer's first sound | 8.06 s (5.77 to 10.32); run medians 8.06 and 8.34 s | |

The search itself, streamed from the Responses API (16 calls of the same questions): 0.39 s to the response beginning, 0.49 s of thinking before the first search, 1.90 s searching, 0.46 s of thinking after, 0.45 s writing the answer. Six of the 16 bench answers made two searches, which is most of the spread. One of 32 searches ran past the 10 s limit and failed; Momo said so and asked again, and that answer came at 13.45 s. A call starts the search as soon as its arguments are complete (`response.function_call_arguments.done`); the response ends 6 to 26 ms later, so nothing waits on it.

The parts after the turn is over and outside the search add up to about 2.4 s, so the 5 s target needs the search model to take about 1 s, against 3.4 to 4.1 s at the median in every run here.

**Tried, one at a time.**

| Candidate | How measured | Result |
|---|---|---|
| A lead-in of two to four words ("Let me look", "One sec, checking") | bench, 16 turns a side, alternating per request | lead-in 6 words against 11; lead-in to call 0.63 s against 0.96 s, 0.29 s sooner in a pair, 14 of 16; the call 0.23 s sooner, 12 of 16; the lead-in heard no sooner (+0.02 s, 8 of 16); the answer 7.72 s against 8.06 s, but +0.07 s in a pair, 7 of 16, because the search model moved by -2.41 to +2.97 s between the two runs of one request |
| Calling `web_answer` before the lead-in | typed questions on the realtime model, 4 per variant | told to call first, it still spoke first in 3 of 4; the one that called first ended its response at the call with nothing said, and a lead-in asked for then was first heard 1.46 s after the response began, against 0.59 to 0.86 s; a call before the audio in the same response never happened |
| Web search with `search_context_size: low` | search model alone, 8 pairs | 4.23 s against 3.53 s at the median; three searches in two answers |
| `tool_choice: required`, `text.verbosity: low` | search model alone, 8 each | 3.21 s and 3.55 s against 3.38 s: within the spread |
| `max_tool_calls: 1` | search model alone, 16 pairs | 3.68 s against 3.47 s; -0.23 s in a pair, 10 of 16, range -3.17 to +2.40 s; two searches were still counted in 6 of 16 |
| Warming the connection before the call | 6 cold calls, 6 after a warm-up request | 478 ms to the response's headers cold against 527 ms warm: the 0.4 s is OpenAI's before the stream begins |

Not built: streaming the search's answer into Momo's response, since writing the answer takes 0.45 s at the median and handing Momo its first sentence early saves at most about half of that; asking two searches at once and taking the first, since the quicker answer is the one that searched less, and those were the incomplete ones (the Vermeer question answered "nothing announced" while a Vermeer show was on).

The shorter lead-in is not kept. It is real at its part, 0.23 to 0.29 s, about 3% of the wait, and no answer came measurably sooner in 16 pairs. Its lead-ins are no more varied: 6 of 16 open with its example "One sec, checking" and 9 with "Let me check", as all 16 of today's do.

**Right answers.** The web answer is the same on both sides. Checked against the sources: the Booker winner and date (M. John Harrison, The End of Everything, 9 November 2026) in 4 of 4; the Mauritshuis on Mondays, 13:00 to 18:00, in 4 of 4; de Kooning at Work and Document Netherlands: New Energy until 17 January 2027 (the Rijksmuseum's pages); the Van Gogh Museum at €25, students €16, under 18 free; the Thyssen-Bornemisza's Vermeer show, 9 October 2026 to 10 January 2027, in the 2 answers that named it. Wrong: WORN's closing as 27 March 2027 in 1 of 4 (the Rijksmuseum gives 21 March, as in 59); "Sentinel-6B for November 16, 2026" in 1 of 4 NASA answers, a satellite that launched on 17 November 2025 (ESA), the year error 59 found with ESCAPADE. Incomplete: 2 of 4 Vermeer answers found no show on now. Not confirmed by any source found: the €26 price from 1 January 2027, CRS-25's 29 November date (one launch listing gives it as to be confirmed), the OpenAI news of 13 November, and the weather. In 30 of 32 answers Momo said no date its web answer did not give; the other 2 could not be checked, since the log keeps only 400 characters of a call's output.

**What would reach 5 s.** None of these is taken here, since each trades what the user chose: web answers at effort none (`MIND_PALACE_WEB_EFFORT=none`, about 0.7 to 1 s sooner by 59, with dates wrong more often), ending turns after 1.2 or 1.5 s of quiet (`MIND_PALACE_LIVE_PAUSE`, cutting thinking pauses), or a quicker search than OpenAI's.

**Measured with.** The bench with this commit's changes, run through a copy that swapped the lead-in's wording per turn, and three throwaway probes (the search model streamed, the realtime model's call order, a cold against a warm connection), kept outside the repository. About $3.30 of OpenAI calls: $1.60 for the bench, $1.38 for the search probes, $0.32 for the order probe.

## 62. Live voice: the run log keeps the pages each web answer cited and read

(61 is left to the live voice's other change on its own branch.)

**Decision.** The run log's line for each web answer ends with the pages the answer cited (its `url_citation` annotations) and every page its searches read (`include: ['web_search_call.action.sources']`), without the search's `utm_source` tag, or "nothing"; `scripts/live-bench.ts` records both with each answer (`src/node/web-answer.ts`). Nothing else changes: the search model's instructions are 59's, and Momo's instructions and what Momo is handed are as before.

**Why.** The user wants Momo's web answers right. The errors seen were 2025 launches given as this month's, CRS-25 called this month's launch, WORN's closing date, and the Thyssen-Bornemisza's Vermeer show left out, and nobody could say which pages an answer came from, since none were kept. Most answers cite nothing (17 of 29 in one check), so the pages read are the record. The logged pages have already explained two errors: the WORN date, which the Rijksmuseum's own pages give both ways (27 March 2027 on its What's on listing, 21 March on the exhibition page), and a year error, a 2025 launch read off NASA's launch archive as 16 November 2026. The year error did not come up on either side in the three runs below, so the logged pages are how its cause will be found when it does.

**Tried and not kept.** Each against 59's instructions, graded against the pages: the Booker on 9 November 2026; the Rijksmuseum's shows, open 9:00 to 17:00 daily; nothing launched by NASA this month and CRS-25 no earlier than 29 November 2026; the Mauritshuis on Mondays, 13:00 to 18:00; the Thyssen-Bornemisza and Mauritshuis exchange, on now, 9 October 2026 to 10 January 2027 in Madrid and 15 October 2026 to 17 January 2027 in The Hague.

- Handing Momo each claim's site, "(source: rijksmuseum.nl)", with Momo told to name it. Momo named them naturally ("according to the Booker Prize site", 4 of 4), but the user found it overkill and more words.
- Telling the search to give a number or date only from a page it cites. The search cites only some spans, so right facts would be dropped.
- Three rules for the search model together: (a) each date with its year, and a word or two on whether it has happened, is on now or is only scheduled; (b) the year checked against a period asked about, and anything outside it left out or named as outside; (c) for what is on at a named place or whether it is open, the venue's own site first. Against 59's instructions, the five requests below, three rounds alternating, and three more Vermeer answers: the Vermeer answer named the show on now in 1 of 6 against 4 of 6; 3 of 24 calls timed out against none of 15, and in a voice run both Vermeer calls timed out and Momo had no answer; the NASA and Vermeer answers made 2 or 3 searches against 1. Nothing else was right more often.
- Each rule alone, the five requests, three rounds with the order rotated, 60 answers:

| | 59's instructions | (a) year and status | (b) year against the period | (c) a named venue's site first |
|---|---|---|---|---|
| Right, of 15 | 13: NASA's "three small spacecraft launched on November 9, 2026" (they flew on 1 and 20 October); the Vermeer show on now missed once | 15 | 12: Madrid given The Hague's dates once; the Vermeer show on now missed twice | 13: the Vermeer show on now missed twice |
| Vermeer show on now named | 2 of 3 | 3 of 3 | 1 of 3 | 1 of 3 |
| Time-outs | 0 | 0 | 0 | 0 |
| Median time; paired against 59's | 3.99 s | 4.39 s; -0.09 s | 4.38 s; +0.22 s | 4.53 s; +0.06 s, Vermeer 2 to 4 searches, up to 9.8 s |
| Words, median and total of 15 | 41, 513 | 30, 492 | 27, 533 | 30, 460 |

(b) and (c) were right no more often and missed the Vermeer show on now. (a) was right in 15 against 13, so it was tried through Momo's voice, where the user's bar is Momo's words: kept only if Momo says no more than 10% more words across the answers, with no more time-outs and right at least as often.

- (a) through Momo's voice: `scripts/live-bench.ts` on `gpt-realtime-2.1`, the five requests, three runs a side alternating (with (a), without, and so on), the code otherwise the same on both sides. Momo's words are those of the turn's last response.

| | With (a) | Without |
|---|---|---|
| Momo's words over the 15 answers (median) | 568 (39) | 486 (25): (a) is 16.9% more |
| Per request: Booker, Rijksmuseum, NASA, Mauritshuis, Vermeer | 56, 159, 127, 75, 151 | 63, 159, 71, 68, 125 |
| The web answer's words over the 15 (median) | 586 (48) | 486 (24) |
| Right, of 15 | 13: the Vermeer show on now missed twice | 13: missed once, and once the Madrid show "planned to open on October 9", five weeks after it opened |
| Time-outs | 0 | 1, a Vermeer call, asked again and answered |
| End of speech to the answer heard, median | 8.74 s | 7.69 s |

(a) fails on words: the NASA answers took in ESCAPADE's flybys and its 2025 launch, and "it's still only planned", and the Vermeer answers ran longer. It is not kept.

**Not done.** A longer wait than 10 s for a web answer: not taken.

**Measured with.** Throwaway scripts outside the repository that called `ask` with each set of instructions, keeping each response's citations, pages read and searches, and `scripts/live-bench.ts`, run from a copy whose web answer added (a) or not, for the voice runs. About $5.35 of OpenAI calls, $1.60 of them for the voice comparison.
