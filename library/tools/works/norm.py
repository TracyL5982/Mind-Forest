# Five museums describe things five ways. This puts a work's maker, kind and
# place into one vocabulary, so that works from different museums can share
# a tag, and shortens what is shown on a card.
import re

MUSEUM = {"met": "The Met", "vam": "V&A", "aic": "Art Institute of Chicago",
          "cma": "Cleveland Museum of Art", "moma": "MoMA"}

# Makers the museums spell differently ("Hilaire Germain Edgar Degas", "Degas, Edgar").
KNOWN = {
    "degas": "Edgar Degas", "hokusai": "Katsushika Hokusai", "hiroshige": "Utagawa Hiroshige",
    "rembrandt": "Rembrandt", "dürer": "Albrecht Dürer", "durer": "Albrecht Dürer", "goya": "Francisco Goya",
    "whistler": "James McNeill Whistler", "toulouse-lautrec": "Henri de Toulouse-Lautrec",
    "muybridge": "Eadweard Muybridge", "piranesi": "Giovanni Battista Piranesi", "daumier": "Honoré Daumier",
    "utamaro": "Kitagawa Utamaro", "kuniyoshi": "Utagawa Kuniyoshi", "kunisada": "Utagawa Kunisada",
    "yoshitoshi": "Tsukioka Yoshitoshi", "picasso": "Pablo Picasso", "manet": "Édouard Manet",
    "monet": "Claude Monet", "cézanne": "Paul Cézanne", "cezanne": "Paul Cézanne", "van gogh": "Vincent van Gogh",
    "hogarth": "William Hogarth", "callot": "Jacques Callot", "rowlandson": "Thomas Rowlandson",
    "stieglitz": "Alfred Stieglitz", "atget": "Eugène Atget", "winslow homer": "Winslow Homer",
    "sargent": "John Singer Sargent", "cassatt": "Mary Cassatt", "redon": "Odilon Redon", "munch": "Edvard Munch",
    "paul klee": "Paul Klee", "kandinsky": "Vasily Kandinsky", "matisse": "Henri Matisse", "tiepolo": "Giovanni Battista Tiepolo",
    "rubens": "Peter Paul Rubens", "bruegel": "Pieter Bruegel", "william morris": "William Morris",
    "william blake": "William Blake", "j. m. w. turner": "J. M. W. Turner", "joseph mallord william turner": "J. M. W. Turner",
    "marey": "Étienne-Jules Marey", "edgerton": "Harold Edgerton", "gauguin": "Paul Gauguin", "magritte": "René Magritte",
    "tiffany": "Louis Comfort Tiffany", "watteau": "Antoine Watteau", "delacroix": "Eugène Delacroix",
    "gillray": "James Gillray", "cruikshank": "George Cruikshank", "beardsley": "Aubrey Beardsley",
    "walker evans": "Walker Evans", "man ray": "Man Ray", "max ernst": "Max Ernst", "beckmann": "Max Beckmann",
}
NOBODY = re.compile(r"^(artist |maker )?unknown|^anonymous|^ancient |^unidentified|^various|^not known|workshop of unknown|^islamic$|^(british|french|italian|german|dutch|chinese|japanese|american)( school)?$", re.I)


def maker(name):
    name = re.sub(r"\s+", " ", re.sub(r"\(.*?\)", "", name or "")).strip(" ,;")
    if not name or NOBODY.search(name):
        return ""
    low = name.lower()
    for key, full in KNOWN.items():
        if re.search(r"(^|[\s,])" + re.escape(key) + r"($|[\s,])", low):
            return full
    return name


KINDS = [
    ("Photograph", r"photograph|daguerreotype|albumen|gelatin silver|cyanotype|stereograph|lantern slide|tintype|ambrotype|negative|photogravure"),
    ("Poster", r"poster"),
    ("Collage", r"collage|photomontage|cut paper|papercut|decoupage|silhouette"),
    ("Toys and devices", r"\btoy|optical|magic lantern|puppet|marionette|\bdoll|game|playing card|chess|zoetrope|peep ?show|automaton|kite|praxinoscope"),
    ("Print", r"\bprints?\b|woodblock|lithograph|etching|engraving|woodcut|mezzotint|screenprint|aquatint|drypoint|linocut|broadside"),
    ("Books and manuscripts", r"manuscript|\bbooks?\b|folio|codex|album|calligraph|bookbinding|illuminat|periodical|typograph"),
    ("Drawing", r"drawing|watercolou?r|pastel|sketch|design for|costume design|set design|gouache|work on paper|\bdesigns?\b|chalk|charcoal"),
    ("Painting", r"painting|oil on|tempera|\bpanel\b|hanging scroll|handscroll|folding screen|\bscreens?\b|miniature|fresco|icon\b|acrylic"),
    ("Arms and armor", r"armou?r|sword|helmet|shield|dagger|firearm|\barms\b|tsuba|pistol"),
    ("Costume", r"costume|\bdress|kimono|\brobe|\bhats?\b|shoes?|gown|coat\b|jacket|\bsuit\b|ensemble|headdress|\bfan\b|accessor"),
    ("Textile", r"textile|tapestr|embroider|carpet|\brug\b|quilt|lace|woven|fabric|silk|ikat|brocade|velvet|sampler|wallpaper"),
    ("Musical instrument", r"instrument|violin|\blute|drum|harp|guitar|piano|flute|chordophone|aerophone|membranophone|idiophone"),
    ("Mask", r"\bmasks?\b"),
    ("Furniture", r"furniture|chair|\btable|cabinet|mirror|stool|desk|throne|\bbed\b|chest|woodwork|clock|lighting|lamp"),
    ("Jewelry", r"jewel|\bring\b|brooch|necklace|pendant|earring|bracelet|\bgems?\b|cameo"),
    ("Ceramic", r"ceramic|porcelain|\bvases?\b|pottery|earthenware|stoneware|terracotta|\btiles?\b|\bjar\b|\bbowl|\bdish|teapot|\bplate\b|vessel|faience|maiolica"),
    ("Glass", r"glass"),
    ("Sculpture", r"sculpture|statue|figure|figurine|relief|\bbust\b|netsuke|carving|ivor|okimono|stele|sarcophag|cast\b"),
    ("Metalwork", r"metalwork|silver|bronze|\bgold|brass|enamel|\biron\b|pewter|coin|medal"),
    ("Architecture", r"architect"),
    ("Moving image", r"video|\bfilm\b|installation|media|performance"),
    ("Design object", r"design|product|industrial|appliance|vehicle"),
]
KINDS = [(n, re.compile(r, re.I)) for n, r in KINDS]


def kind(w):
    """One word for what sort of thing it is, from how its museum files it."""
    first = f"{w.get('kind', '')} {w.get('what', '')}"
    for text in (first, f"{w.get('medium', '')} {w.get('title', '')}"):
        for name, pattern in KINDS:
            if pattern.search(text):
                return name
    return "Object"


PLACES = [
    ("Japan", r"japan|\bedo\b|kyoto|tokyo|osaka|yokohama"),
    ("China", r"china|chinese|jingdezhen|beijing|canton"),
    ("Korea", r"korea"),
    ("India", r"india|mughal|rajasthan|deccan|tamil|bengal|punjab|kashmir|pakistan|nepal|tibet|sri lanka|himalaya"),
    ("Southeast Asia", r"thai|cambodia|khmer|indonesia|\bjava|\bbali|vietnam|burma|myanmar|philippin|malay"),
    ("Iran", r"\biran|persia"),
    ("Turkey", r"turkey|turkish|ottoman|iznik|istanbul|anatolia"),
    ("Western Asia", r"syria|iraq|mesopotam|uzbek|samarkand|assyria|sumer|babylon|levant|arabia|afghan|yemen|jordan"),
    ("Egypt", r"egypt"),
    ("Greece and Rome", r"gree(k|ce)|athens|attic|corinth|\broman\b|etrus|etruria|pompeii|cypr|byzant|hellenist|vulci|locri"),
    ("Italy", r"ital|\brome\b|venice|venetian|florence|florentine|siena|naples|milan|bologna|sicil|tuscan|umbria|murano"),
    ("France", r"fran(ce|çais)|french|paris|sèvres|lyon|limoges|versailles"),
    ("Britain", r"brit|engl|london|scot|wales|welsh|irish|ireland|staffordshire|\buk\b|birmingham|manchester|united kingdom|stoke|liverpool|oxford|york\b(?!,? ?(city|ny))|edinburgh|glasgow"),
    ("Low Countries", r"nether|dutch|holland|amsterdam|delft|flemish|fland|belgi|antwerp|brussels|haarlem|utrecht"),
    ("Germany and Austria", r"german|berlin|meissen|nuremberg|augsburg|munich|dresden|bavaria|austria|vienna|saxony|cologne|bohemia|czech|prague|swiss|switzerland|zurich|basel"),
    ("Spain and Portugal", r"spain|spanish|madrid|catal|portug|lisbon|seville|toledo|valencia"),
    ("Scandinavia", r"swed|stockholm|denmark|danish|norw|finland|finnish|iceland|copenhagen"),
    ("Russia and Eastern Europe", r"russia|soviet|moscow|petersburg|poland|polish|hungar|ukrain|roman(ia|ian)|serbia|bulgar|lithuan|latvia|georgia(n)?\b(?!,)"),
    ("United States", r"americ|united states|new york|\busa\b|chicago|boston|philadelphia|california|u\.s\.|ohio|massachusetts|connecticut|new jersey|pennsylvania|virginia|texas|new england|canad"),
    ("Mexico and Central America", r"mexic|maya|aztec|guatemala|teotihuac|costa rica|panama|olmec|honduras|mesoamer|cuba|caribbean|haiti"),
    ("South America", r"peru|\binca|moche|nasca|nazca|andes|colombia|ecuador|bolivia|brazil|argentin|chile|venezuel|chim[uú]|wari|paracas|urugu"),
    ("Africa", r"nigeria|benin|\bmali\b|ghana|congo|côte|ivory coast|cameroon|yoruba|africa|ethiopia|kenya|burkina|gabon|sierra leone|senegal|sudan|angola|zimbabwe|tanzania|madagascar|morocc|tunis|alger|liberia"),
    ("Oceania", r"australia|new zealand|maori|papua|polynes|hawai|fiji|melanes|new guinea|solomon"),
]
PLACES = [(n, re.compile(r, re.I)) for n, r in PLACES]


def place(w):
    """The part of the world it was made in, or None when the museum doesn't say."""
    text = w.get("place") or ""
    for name, pattern in PLACES:
        if pattern.search(text):
            return name
    return None


def place_words(w):
    """Where it is from, as shown on its card: the museum's own first few words."""
    text = re.split(r"[;(]", w.get("place") or "")[0].strip(" ,")
    parts = [p.strip() for p in text.split(",") if p.strip()]
    text = ", ".join(parts[:2]) if parts and len(", ".join(parts[:2])) <= 30 else (parts[0] if parts else "")
    return text if len(text) <= 34 else text[:32].rsplit(" ", 1)[0] + "…"


def title(text):
    """A museum's title as a card shows it: without the series or book it comes from, which runs long."""
    t = re.sub(r"\s+", " ", text).strip()
    cut = re.split(r",? (?:from|in|plate \d+ (?:from|of)) (?:the )?(?:series|album|portfolio|book|set|suite|volume)\b", t, maxsplit=1, flags=re.I)[0]
    cut = cut.strip(" ,;:")
    return cut if len(cut) >= 6 else t


def short(title, limit=30):
    """A few words of a title, for a small card."""
    t = re.sub(r"\s+", " ", re.sub(r"[\[\]\"“”]", "", title)).strip(" ,;:.'‘’")
    for mark in (":", " (", ";", ", from ", " from the ", " – ", " — "):
        head = t.split(mark)[0].strip()
        if 8 <= len(head) < len(t):
            t = head
            break
    if len(t) <= limit:
        return t
    return t[:limit].rsplit(" ", 1)[0].rstrip(" ,;:-") + "…"


def medium(text, limit=52):
    """What it is made of, as shown on its card."""
    t = re.sub(r"\s+", " ", text or "").strip(" .;,")
    t = re.split(r"[;(]", t)[0].strip(" ,")
    t = t[:1].upper() + t[1:] if t else t
    return t if len(t) <= limit else t[:limit].rsplit(" ", 1)[0].rstrip(" ,") + "…"


def date(text):
    return re.sub(r"\s+", " ", (text or "").replace("\n", " ")).strip(" ,")
