import type { Found, ModelClient, Page, Source } from '../core/ports.ts';
import { openaiSearch } from './search-openai.ts';

type Send = typeof fetch;
type Json = Record<string, any>;

export interface SourceOptions {
  send: Send;
  model: ModelClient;
  read: (url: string) => Promise<Page | null>;
  /** Keys by their name in the env file. A source whose key is missing is not offered. */
  keys?: Record<string, string | undefined>;
}

interface Adapter extends Source {
  search(query: string): Promise<Found[]>;
}

const AGENT_NAME = 'MindPalace/0.1 (local prototype)';
const PER_SEARCH = 6;
/** The Internet Archive's MP4 copies, the ones every browser and the headset play first. "MPEG4" may be an original in an older codec. */
const ARCHIVE_FORMATS = ['h.264', '512Kb MPEG4', 'h.264 IA', 'MPEG4'];
const WEB_PREFERENCE =
  'Prefer pages with substance: original reporting, studies, official and first-hand sources, case studies, and long pieces by people who know the subject. ' +
  'Leave out listicles, "best of" roundups, affiliate reviews, pages written to rank in search, shops, and encyclopedia entries.';

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');
const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);
const q = encodeURIComponent;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: ', ', ndash: '-', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' };

/** Markup from an API reduced to the words a person would read. */
export function plain(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/li|\/div)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&(\w+);/g, (m, name) => ENTITIES[name] ?? m)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function makeSources(opts: SourceOptions): { list(): Source[]; search(id: string, query: string): Promise<Found[]> } {
  const { send } = opts;

  async function ask<T = Json>(url: string): Promise<T> {
    const res = await send(url, { headers: { 'User-Agent': AGENT_NAME, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as T;
  }

  // ---- the open web, read and brought back as text

  const web: Adapter = {
    id: 'web',
    name: 'The web',
    goodFor: 'Anything current or specific: articles, essays, case studies, reports, how-tos, reviews, company and product pages. The page is read and the passage that matters is shown.',
    query: 'A web search of four to eight words that would find one strong page.',
    show: 1,
    async search(query) {
      const openaiKey = opts.keys?.OPENAI_API_KEY;
      const hits = openaiKey
        ? await openaiSearch(send, { apiKey: openaiKey, model: opts.keys?.MIND_PALACE_SEARCH_MODEL }, { query, max: 8, prefer: WEB_PREFERENCE })
        : await opts.model.search({ role: 'tool.web', query, max: 8, prefer: WEB_PREFERENCE });
      // Encyclopedia entries are left out: the user asked for sources with a point of view or first-hand detail.
      const usable = hits.filter((hit) => !/(^|\.)(wikipedia|wikimedia|fandom)\.org$|(^|\.)fandom\.com$/.test(hostOf(hit.url)));
      const pages = await Promise.all(
        // Many sites refuse to be read by a program, so every hit is tried and the first few that answer are kept.
        usable.filter((hit) => !/\.pdf($|\?)/i.test(hit.url)).slice(0, 8).map(async (hit): Promise<Found | null> => {
          const page = await opts.read(hit.url).catch(() => null);
          const title = [page?.title, hit.title].map((t) => str(t)).find((t) => t && !/^https?:\/\//i.test(t));
          if (!page || !title || page.text.length < 400) return null;
          return { title, by: page.site, date: '', text: page.text.slice(0, 5000), url: hit.url };
        }),
      );
      return pages.flatMap((p) => p ?? []).slice(0, 5);
    },
  };

  // ---- museums

  type Museum = (query: string, max: number) => Promise<Found[]>;
  /** `said` is what the catalogue says the work is, shown as its text. `medium` is only what it is made of. */
  const work = (title: string, by: string, date: string, said: string, medium: string, holder: string, url: string, image: string): Found =>
    ({ title, by, date, text: said, from: holder, url, image, kind: 'artwork', holder, ...(medium ? { medium } : {}) });

  const chicago: Museum = async (query, max) => {
    const json = await ask(`https://api.artic.edu/api/v1/artworks/search?q=${q(query)}&limit=${max}&fields=id,title,artist_title,date_display,medium_display,image_id`);
    return list(json.data).filter((w) => str(w.image_id)).map((w) =>
      work(str(w.title), str(w.artist_title), str(w.date_display), str(w.medium_display), str(w.medium_display), 'Art Institute of Chicago', `https://www.artic.edu/artworks/${w.id}`, `https://www.artic.edu/iiif/2/${str(w.image_id)}/full/843,/0/default.jpg`));
  };
  const met: Museum = async (query, max) => {
    const base = 'https://collectionapi.metmuseum.org/public/collection';
    const found = await ask(`${base}/v1.1/search?hasImages=true&q=${q(query)}&limit=${max * 2}`);
    // The search answers with ids only, and works still in copyright come back without a picture.
    const works = await Promise.all(list(found.objectIDs).slice(0, max * 2).map((id) => ask(`${base}/v1/objects/${id}`).catch(() => null)));
    return works.flatMap((w) => (w && str(w.primaryImageSmall)
      ? [work(str(w.title), str(w.artistDisplayName), str(w.objectDate), str(w.medium), str(w.medium), 'The Metropolitan Museum of Art', str(w.objectURL), str(w.primaryImageSmall))]
      : [])).slice(0, max);
  };
  const cleveland: Museum = async (query, max) => {
    const json = await ask(`https://openaccess-api.clevelandart.org/api/artworks/?q=${q(query)}&has_image=1&limit=${max}`);
    return list(json.data).filter((w) => str(w.images?.web?.url)).map((w) =>
      work(str(w.title), str(w.creators?.[0]?.description), str(w.creation_date), str(w.technique) || str(w.type), str(w.technique), 'Cleveland Museum of Art', str(w.url), str(w.images.web.url)));
  };
  // The V&A search says what kind of object a work is ("Teapot"), never what it is made of, so it gives no medium.
  const victoriaAndAlbert: Museum = async (query, max) => {
    const json = await ask(`https://api.vam.ac.uk/v2/objects/search?q=${q(query)}&images_exist=1&page_size=${max}`);
    return list(json.records).filter((w) => str(w._images?._iiif_image_base_url)).map((w) =>
      work(str(w._primaryTitle) || str(w.objectType), str(w._primaryMaker?.name), str(w._primaryDate), str(w.objectType), '', 'Victoria and Albert Museum', `https://collections.vam.ac.uk/item/${w.systemNumber}`, `${str(w._images._iiif_image_base_url)}full/!960,960/0/default.jpg`));
  };
  const MUSEUMS = [chicago, met, cleveland, victoriaAndAlbert];
  const PER_MUSEUM = 4;

  const museums: Adapter = {
    id: 'museums',
    name: 'Museum collections',
    goodFor: 'Paintings, prints, photographs, textiles, posters and design objects from four major museums, shown as their pictures.',
    query: 'Two to four plain catalogue words: an artist, a subject, or a kind of object with a place or period ("Hiroshige rain", "art deco poster").',
    show: 3,
    visual: true,
    async search(query) {
      const answers = await Promise.all(MUSEUMS.map((museum) => museum(query, PER_MUSEUM).catch(() => [] as Found[])));
      // Dealt out in turn, so no single collection fills the list.
      const dealt: Found[] = [];
      for (let round = 0; round < PER_MUSEUM; round++) for (const works of answers) if (works[round]) dealt.push(works[round]!);
      return dealt.slice(0, 12);
    },
  };

  // ---- research

  /** What OpenAlex calls a work, as the kind a card draws. A chapter, a dataset or anything else gets no kind. */
  const WORK_KINDS: Record<string, Found['kind']> = { article: 'paper', preprint: 'paper', review: 'paper', letter: 'paper', dissertation: 'paper', book: 'book', monograph: 'book' };
  const OPENALEX_AUTHORS = 100;

  const papers: Adapter = {
    id: 'papers',
    name: 'Research papers',
    goodFor: 'What research has found: studies, evidence, methods and surveys in any academic field, with the abstract. Not for practical advice, prices, places or current events.',
    query: 'Three to six words a paper on this would have in its title or abstract.',
    show: 2,
    async search(query) {
      const json = await ask(`https://api.openalex.org/works?search=${q(query)}&filter=cited_by_count:>10&per-page=8&select=id,doi,title,type,publication_year,authorships,is_authors_truncated,primary_location,abstract_inverted_index,cited_by_count`);
      return list(json.results).map((w): Found => {
        const words: string[] = [];
        for (const [word, places] of Object.entries((w.abstract_inverted_index ?? {}) as Record<string, number[]>)) for (const at of places) words[at] = word;
        const authors = list(w.authorships).map((a) => str(a.author?.display_name)).filter(Boolean);
        const cited = Number(w.cited_by_count) || 0;
        const venue = str(w.primary_location?.source?.display_name);
        const kind = WORK_KINDS[str(w.type)];
        // The search lists at most 100 authors. Eight live records with a cut list all came without `is_authors_truncated`, so the count decides.
        const authorsCut = w.is_authors_truncated === true || list(w.authorships).length >= OPENALEX_AUTHORS;
        return {
          ...(kind ? { kind } : {}),
          ...(authors.length > 0 ? { authors } : {}),
          ...(authorsCut ? { authorsCut } : {}),
          ...(venue ? { venue } : {}),
          title: plain(str(w.title)),
          by: authors.length > 2 ? `${authors[0]} et al.` : authors.join(' and '),
          date: str(w.publication_year),
          text: [words.filter(Boolean).join(' '), cited > 0 ? `Cited by ${cited} other works.` : ''].filter(Boolean).join('\n'),
          url: str(w.doi) || str(w.id),
        };
      }).filter((f) => f.text.length > 200);
    },
  };

  // ---- books

  /** Apple names several authors in one string, as "A, B & C". */
  const authorsOf = (names: string): string[] => names.split(/\s+&\s+|,\s+(?!(?:Jr|Sr|II|III|IV)\b)/).map((n) => n.trim()).filter(Boolean);

  const books: Adapter = {
    id: 'books',
    name: 'Books',
    goodFor: 'A book that treats the subject at length, with its cover and the publisher\'s description. Search by title or author when you know one.',
    query: 'A title, an author, or two to four subject words.',
    show: 2,
    async search(query) {
      const json = await ask(`https://itunes.apple.com/search?term=${q(query)}&media=ebook&limit=${PER_SEARCH}`);
      return list(json.results).map((b): Found => {
        const authors = authorsOf(str(b.artistName));
        return {
          kind: 'book', ...(authors.length > 0 ? { authors } : {}),
          title: str(b.trackName), by: str(b.artistName), date: str(b.releaseDate).slice(0, 4),
          text: [plain(str(b.description)).slice(0, 1500), list(b.genres).length > 0 ? `Shelved under: ${list(b.genres).filter((g) => g !== 'Books').slice(0, 5).join(', ')}.` : ''].filter(Boolean).join('\n'),
          url: str(b.trackViewUrl),
          ...(str(b.artworkUrl100) ? { image: str(b.artworkUrl100).replace('100x100bb', '600x600bb') } : {}),
        };
      }).filter((f) => f.text.length > 120);
    },
  };

  // ---- people who build things, talking

  const discussions: Adapter = {
    id: 'discussions',
    name: 'Hacker News',
    goodFor: 'What builders, founders and engineers say from experience about a tool, a company, a technique or an idea. Technology, software and startups only.',
    query: 'Two to four words naming the topic.',
    show: 1,
    async search(query) {
      const json = await ask(`https://hn.algolia.com/api/v1/search?query=${q(query)}&tags=story&hitsPerPage=5`);
      return (await Promise.all(list(json.hits).filter((s) => Number(s.num_comments) >= 5).slice(0, 4).map(async (story): Promise<Found | null> => {
        const thread = await ask(`https://hn.algolia.com/api/v1/items/${story.objectID}`).catch(() => null);
        const comments = list(thread?.children).map((c) => ({ by: str(c.author), text: plain(str(c.text)) })).filter((c) => c.text.length > 120).slice(0, 3);
        if (comments.length === 0) return null;
        return {
          title: str(story.title), by: `${story.points} points, ${story.num_comments} comments`, date: str(story.created_at).slice(0, 10),
          text: comments.map((c) => `${c.by} wrote: ${c.text.slice(0, 700)}`).join('\n\n'),
          url: `https://news.ycombinator.com/item?id=${story.objectID}`,
        };
      }))).flatMap((f) => f ?? []);
    },
  };

  const code: Adapter = {
    id: 'code',
    name: 'GitHub',
    goodFor: 'An open-source project that already does this or a part of it.',
    query: 'Two to four words a project on this would use to describe itself.',
    show: 2,
    async search(query) {
      const json = await ask(`https://api.github.com/search/repositories?q=${q(query)}&per_page=${PER_SEARCH}`);
      return list(json.items).filter((r) => str(r.description)).map((r): Found => ({
        title: str(r.full_name), by: str(r.owner?.login), date: `updated ${str(r.pushed_at).slice(0, 10)}`,
        text: [str(r.description), `${r.stargazers_count} stars.`, str(r.language) ? `Written in ${str(r.language)}.` : '', list(r.topics).length > 0 ? `Topics: ${list(r.topics).slice(0, 6).join(', ')}.` : ''].filter(Boolean).join(' '),
        url: str(r.html_url),
      }));
    },
  };

  const answers: Adapter = {
    id: 'answers',
    name: 'Stack Overflow',
    goodFor: 'A concrete programming problem that others have asked about and solved.',
    query: 'The problem in four to eight words, with the language or tool named.',
    show: 1,
    async search(query) {
      const json = await ask(`https://api.stackexchange.com/2.3/search/excerpts?order=desc&sort=relevance&q=${q(query)}&site=stackoverflow&pagesize=${PER_SEARCH}`);
      return list(json.items).map((a): Found => ({
        title: plain(str(a.title)), by: `${a.item_type}, score ${a.score}`, date: a.creation_date ? new Date(Number(a.creation_date) * 1000).toISOString().slice(0, 10) : '',
        text: plain(str(a.excerpt)), url: `https://stackoverflow.com/q/${a.question_id}`,
      })).filter((f) => f.text.length > 80);
    },
  };

  // ---- numbers

  async function csv(url: string): Promise<string[][]> {
    const res = await send(url, { headers: { 'User-Agent': AGENT_NAME }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.text()).split(/\r?\n/).filter(Boolean).map((line) => line.split(','));
  }

  const data: Adapter = {
    id: 'data',
    name: 'Our World in Data',
    goodFor: 'A world total over the years, drawn as a chart: population, economy, energy, health, education, technology use, emissions, food, work. World figures only: nothing about one country, city, company, month or season.',
    query: 'Two to four words naming what is measured ("internet users", "solar energy cost", "life expectancy").',
    show: 1,
    async search(query) {
      const json = await ask(`https://ourworldindata.org/api/search?q=${q(query)}&type=charts`);
      return (await Promise.all(list(json.results).filter((c) => /^https:\/\/ourworldindata\.org\/grapher\/[\w-]+$/.test(str(c.url))).slice(0, 5).map(async (c): Promise<Found | null> => {
        const rows = await csv(`${str(c.url)}.csv?csvType=filtered&country=~OWID_WRL&tab=chart`).catch(() => []);
        // Entity, Code, Year, then the first measured column.
        const points = rows.slice(1).filter((r) => r[1] === 'OWID_WRL' && r[3] !== '' && Number.isFinite(Number(r[3]))).map((r) => ({ year: r[2]!, value: Number(r[3]) }));
        if (points.length < 4) return null;
        const step = (points.length - 1) / (Math.min(8, points.length) - 1);
        const shown = Array.from({ length: Math.min(8, points.length) }, (_v, n) => points[Math.round(n * step)]!);
        const top = Math.max(...shown.map((p) => Math.abs(p.value)));
        const [scale, unit] = top >= 1e12 ? [1e12, 'trillions'] : top >= 1e9 ? [1e9, 'billions'] : top >= 1e6 ? [1e6, 'millions'] : [1, ''];
        const values = shown.map((p) => Number((p.value / scale).toPrecision(3)));
        const measured = str(rows[0]?.[3]);
        return {
          title: `${str(c.title)}, world`, by: 'Our World in Data', date: `${shown[0]!.year} to ${shown.at(-1)!.year}`,
          text: [str(c.subtitle), measured && measured !== str(c.title) ? `Measured: ${measured}.` : '', shown.map((p, n) => `${p.year}: ${values[n]}${unit ? ` ${unit}` : ''}`).join(', ')].filter(Boolean).join('\n'),
          url: str(c.url),
          chart: { labels: shown.map((p) => p.year), values, ...(unit ? { unit } : {}) },
        };
      }))).flatMap((f) => f ?? []);
    },
  };

  // ---- things to listen to, collect and cook

  const podcasts: Adapter = {
    id: 'podcasts',
    name: 'Podcasts',
    goodFor: 'An episode where people who know the subject talk it through. It plays inside the card. Good for broad subjects, poor for narrow or personal ones.',
    query: 'Two to four words naming the topic or a guest.',
    show: 1,
    async search(query) {
      const json = await ask(`https://itunes.apple.com/search?term=${q(query)}&media=podcast&entity=podcastEpisode&limit=${PER_SEARCH}`);
      return list(json.results).filter((e) => /^https:\/\//.test(str(e.episodeUrl))).map((e): Found => ({
        title: str(e.trackName), by: str(e.collectionName), date: str(e.releaseDate).slice(0, 10),
        text: plain(str(e.description) || str(e.shortDescription)).slice(0, 1200),
        url: str(e.trackViewUrl) || str(e.episodeUrl), media: str(e.episodeUrl),
        ...(Number(e.trackTimeMillis) > 0 ? { seconds: Math.round(Number(e.trackTimeMillis) / 1000) } : {}),
        ...(str(e.artworkUrl600) ? { image: str(e.artworkUrl600) } : {}),
      }));
    },
  };

  const boards: Adapter = {
    id: 'boards',
    name: 'Are.na',
    goodFor: 'Pictures and fragments that people have hand-collected around a theme: references for design, culture, architecture, ideas.',
    query: 'One to three words naming the theme.',
    show: 3,
    visual: true,
    async search(query) {
      // Channel names are short, so a search that finds none is tried again with its last word dropped.
      let channels: Json[] = [];
      for (let words = query.split(/\s+/); words.length > 0 && channels.length === 0; words = words.slice(0, -1)) {
        const json = await ask(`https://api.are.na/v2/search/channels?q=${q(words.join(' '))}&per=6`);
        channels = list(json.channels).filter((c) => Number(c.length) >= 8).slice(0, 3);
      }
      const blocks = await Promise.all(channels.map(async (channel) => {
        const inside = await ask(`https://api.are.na/v2/channels/${q(str(channel.slug))}/contents?per=8`).catch(() => null);
        return list(inside?.contents).flatMap((b): Found[] => {
          const image = str(b.image?.display?.url);
          const text = plain(str(b.content) || str(b.description));
          if (!image && text.length < 80) return [];
          return [{
            title: [str(b.title), str(b.generated_title)].find((t) => t && !/\.(jpe?g|png|gif|webp|pdf)$/i.test(t) && !/^[0-9a-f]{16,}/i.test(t)) || str(channel.title), by: str(b.user?.full_name), date: str(b.created_at).slice(0, 4),
            text: text.slice(0, 1200), from: `Are.na channel "${str(channel.title)}"`,
            url: str(b.source?.url) || `https://www.are.na/block/${b.id}`, ...(image ? { image } : {}),
          }];
        }).slice(0, 4);
      }));
      return blocks.flat();
    },
  };

  const recipes: Adapter = {
    id: 'recipes',
    name: 'Recipes',
    goodFor: 'A dish, with its picture, ingredients and method.',
    query: 'The name of one dish, one or two words ("risotto", "shakshuka").',
    show: 1,
    async search(query) {
      const json = await ask(`https://www.themealdb.com/api/json/v1/1/search.php?s=${q(query)}`);
      return list(json.meals).slice(0, PER_SEARCH).map((m): Found => {
        const ingredients = Array.from({ length: 20 }, (_v, n) => [str(m[`strMeasure${n + 1}`]), str(m[`strIngredient${n + 1}`])].filter(Boolean).join(' ')).filter((line, n) => str(m[`strIngredient${n + 1}`]) && line);
        const steps = str(m.strInstructions).split(/\r?\n+/).map((s) => s.replace(/^\s*(step\s*)?\d+[.):]?\s*/i, '').trim()).filter((s) => s.length > 8);
        return {
          title: str(m.strMeal), by: [str(m.strArea), str(m.strCategory)].filter(Boolean).join(', '), date: '',
          text: [`Ingredients: ${ingredients.join(', ')}.`, ...steps.map((s, n) => `${n + 1}. ${s}`)].join('\n'),
          url: str(m.strSource) || `https://www.themealdb.com/meal/${m.idMeal}`,
          ...(str(m.strMealThumb) ? { image: str(m.strMealThumb) } : {}),
          ...(steps.length >= 2 ? { steps } : {}),
        };
      });
    },
  };

  // ---- films that play as a file, for a client that cannot show a player from another site

  const archive: Adapter = {
    id: 'archive',
    name: 'Internet Archive',
    goodFor: 'Old films, newsreels, industrial and teaching films, lectures and home movies, played in the card. Strong on the twentieth century and on how things were made or done. Weak on anything recent.',
    query: 'Two or three plain words such a film would have in its title or subjects ("bread baking", "steam locomotive", "Hitchcock").',
    show: 1,
    async search(query) {
      // The catalogue requires every word, so a search that finds nothing is tried again with its last word dropped.
      let docs: Json[] = [];
      for (let words = query.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean); words.length > 0 && docs.length === 0; words = words.slice(0, -1)) {
        const terms = words.join(' ');
        const params = new URLSearchParams({ q: `(title:(${terms}) OR subject:(${terms})) AND mediatype:movies AND NOT collection:(tvnews OR deemphasize OR stream_only)`, rows: '6', output: 'json' });
        params.append('fl[]', 'identifier');
        params.append('sort[]', 'downloads desc');
        docs = list((await ask(`https://archive.org/advancedsearch.php?${params}`)).response?.docs);
      }
      const found = await Promise.all(docs.map(async (doc): Promise<Found | null> => {
        const id = str(doc.identifier);
        const item = await ask(`https://archive.org/metadata/${q(id)}`).catch(() => null);
        const file = list(item?.files)
          .filter((f) => /\.mp4$/i.test(str(f.name)) && ARCHIVE_FORMATS.includes(str(f.format)))
          .sort((a, b) => ARCHIVE_FORMATS.indexOf(str(a.format)) - ARCHIVE_FORMATS.indexOf(str(b.format)))[0];
        if (!item || !file) return null;
        const about = item.metadata ?? {};
        const one = (value: unknown) => str(Array.isArray(value) ? value[0] : value);
        return {
          title: plain(one(about.title)) || id, by: plain(one(about.creator)), date: (one(about.date) || one(about.year)).slice(0, 4),
          text: plain(one(about.description)).slice(0, 1500) || plain(one(about.title)),
          from: 'Internet Archive', url: `https://archive.org/details/${id}`,
          media: `https://archive.org/download/${q(id)}/${str(file.name).split('/').map(q).join('/')}`,
          image: `https://archive.org/services/img/${q(id)}`,
        };
      }));
      return found.flatMap((f) => f ?? []);
    },
  };

  // ---- sources that need a key. The key travels in the address, so a failure reports its status and nothing else.

  const tmdbKey = opts.keys?.TMDB_API_KEY;
  const films: Adapter = {
    id: 'films',
    name: 'Film and television',
    goodFor: 'A film or series that tells this kind of story, shows this world or treats this subject, with a still and its synopsis.',
    query: 'The exact title when you know one. Otherwise one subject word that such films share ("heist", "hotel", "lighthouse"). Never add the word film.',
    show: 2,
    async search(query) {
      const tmdb = (path: string) => ask(`https://api.themoviedb.org/3/${path}${path.includes('?') ? '&' : '?'}api_key=${q(tmdbKey ?? '')}&include_adult=false`);
      // A title search only matches titles, so the subject is also looked up as a keyword and the best-known films carrying it are added.
      const [titled, keywords] = await Promise.all([tmdb(`search/multi?query=${q(query)}`), tmdb(`search/keyword?query=${q(query)}`).catch(() => ({}) as Json)]);
      const ids = list(keywords.results).slice(0, 2).map((k) => k.id).join('|');
      const tagged = ids ? await tmdb(`discover/movie?with_keywords=${q(ids)}&sort_by=vote_count.desc`).catch(() => ({}) as Json) : {};
      const all = [...list(titled.results).slice(0, 3), ...list((tagged as Json).results).map((m) => ({ ...m, media_type: 'movie' })), ...list(titled.results).slice(3)];
      const seen = new Set<string>();
      return all.filter((m) => {
        const id = `${m.media_type}/${m.id}`;
        if (seen.has(id) || !(m.media_type === 'movie' || m.media_type === 'tv') || str(m.overview).length <= 60 || !(str(m.backdrop_path) || str(m.poster_path))) return false;
        seen.add(id);
        return true;
      }).slice(0, 8).map((m): Found => ({
        title: str(m.title) || str(m.name), by: m.media_type === 'tv' ? 'Television series' : 'Film', date: (str(m.release_date) || str(m.first_air_date)).slice(0, 4),
        text: str(m.overview), from: 'The Movie Database',
        url: `https://www.themoviedb.org/${m.media_type}/${m.id}`,
        image: `https://image.tmdb.org/t/p/w780${str(m.backdrop_path) || str(m.poster_path)}`,
      }));
    },
  };

  const europeanaKey = opts.keys?.EUROPEANA_API_KEY;
  const heritage: Adapter = {
    id: 'heritage',
    name: 'Europeana',
    goodFor: 'Historical photographs, maps, posters, drawings, manuscripts and everyday objects from European museums, libraries and archives. Good for how something looked or was done in the past.',
    query: 'Two or three plain words: a thing, a place, a trade, a period ("tram Lisbon", "herbarium", "shop interior 1920").',
    show: 3,
    visual: true,
    async search(query) {
      const json = await ask(`https://api.europeana.eu/record/v2/search.json?wskey=${q(europeanaKey ?? '')}&query=${q(query)}&rows=10&media=true&thumbnail=true&qf=TYPE:IMAGE&reusability=open&profile=standard`);
      const one = (value: unknown) => str(list(value)[0]);
      return list(json.items).filter((r) => one(r.edmIsShownBy) || one(r.edmPreview)).map((r): Found => ({
        title: plain(one(r.title)), by: /^https?:/.test(one(r.dcCreator)) ? '' : one(r.dcCreator), date: one(r.year),
        text: plain(one(r.dcDescription)).slice(0, 600), from: one(r.dataProvider) || 'Europeana', ...(one(r.dataProvider) ? { holder: one(r.dataProvider) } : {}),
        url: str(r.guid).split('?')[0]!, image: one(r.edmIsShownBy) || one(r.edmPreview),
      }));
    },
  };

  const guardianKey = opts.keys?.GUARDIAN_API_KEY;
  const news: Adapter = {
    id: 'news',
    name: 'The Guardian',
    goodFor: 'Reporting and analysis from a newspaper: current events, politics, business, cities, science, the environment, culture, long reads. The article is read and the passage that matters is shown.',
    query: 'Two to four words a headline on this would use.',
    show: 1,
    async search(query) {
      const json = await ask(`https://content.guardianapis.com/search?q=${q(query)}&order-by=relevance&page-size=${PER_SEARCH}&show-fields=headline,byline,bodyText&api-key=${q(guardianKey ?? '')}`);
      return list(json.response?.results).filter((a) => str(a.fields?.bodyText).length > 600).map((a): Found => ({
        title: plain(str(a.fields?.headline) || str(a.webTitle)), by: str(a.fields?.byline), date: str(a.webPublicationDate).slice(0, 10),
        text: str(a.fields.bodyText).slice(0, 5000), url: str(a.webUrl),
      }));
    },
  };

  const adapters: Adapter[] = [web, papers, books, data, discussions, code, answers, museums, boards, podcasts, recipes, archive, ...(guardianKey ? [news] : []), ...(tmdbKey ? [films] : []), ...(europeanaKey ? [heritage] : [])];
  const byId = new Map(adapters.map((a) => [a.id, a]));

  return {
    list: () => adapters.map(({ search: _search, ...info }) => info),
    async search(id, query) {
      const adapter = byId.get(id);
      if (!adapter || !query.trim()) return [];
      const found = await adapter.search(query.trim());
      return found.filter((f) => f.title && /^https?:\/\//.test(f.url));
    },
  };
}
