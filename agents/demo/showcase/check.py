#!/usr/bin/env python3
"""Checks one showcase tree: agents/demo/showcase/<name>/tree.json with its pictures in <name>/media.

  python3 agents/demo/showcase/check.py <name>            what is wrong, or "ok"
  python3 agents/demo/showcase/check.py <name> --sheet    also writes <name>/sheet.jpg: every card's picture, branch by branch

A showcase tree is a whole tree that stands in the demo's forest beside the walkthrough's. Its cards are written as the
walkthrough's are (ScriptCard in agents/src/demo/script.ts), each with the card it hangs from in "parent" ("root" for the
tree's first card). The service checks the same file again when it loads it.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
KINDS = {'picture', 'artwork', 'paper', 'note', 'link', 'facts', 'person', 'list'}
ORIGINS = {'ocean', 'external', 'generated'}
OPEN = ('public domain', 'cc0', 'cc by', 'cc-by')
PIN = re.compile(r'^https://www\.pinterest\.com/pin/[A-Za-z0-9_-]+/$')


def check(name):
    wrong = []
    folder = os.path.join(HERE, name)
    path = os.path.join(folder, 'tree.json')
    if not os.path.exists(path):
        return [f'no {path}'], None
    raw = open(path, encoding='utf-8').read()
    if 'pin.it' in raw:
        wrong.append('a pin.it short link is written in the file: only https://www.pinterest.com/pin/<id>/ addresses may be')
    try:
        tree = json.loads(raw)
    except ValueError as err:
        return [f'tree.json is not JSON: {err}'], None
    if tree.get('version') != 1:
        wrong.append('"version" must be 1')
    if tree.get('id') != name:
        wrong.append(f'"id" must be the folder\'s name, {name}')
    title, topic = tree.get('title', ''), tree.get('topic', '')
    if not 3 <= len(title) <= 26:
        wrong.append(f'"title" is the tree\'s name on its cover: 3 to 26 characters, not {len(title)}')
    if not 8 <= len(topic) <= 64:
        wrong.append(f'"topic" is the words of the first card: 8 to 64 characters, not {len(topic)}')
    cards = tree.get('cards', [])
    if not 36 <= len(cards) <= 52:
        wrong.append(f'{len(cards)} cards: a showcase tree has 36 to 52')
    ids, titles, hrefs, reasons = {}, {}, {}, {}
    for card in cards:
        cid = card.get('id', '')
        where = f'card {cid or "?"}'
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,39}', cid):
            wrong.append(f'{where}: an id is 2 to 40 of a-z, 0-9 and -')
        if cid in ids:
            wrong.append(f'{where}: two cards have this id')
        ids[cid] = card
        if card.get('kind') not in KINDS:
            wrong.append(f'{where}: kind is one of {sorted(KINDS)}')
        if card.get('origin') not in ORIGINS:
            wrong.append(f'{where}: origin is one of {sorted(ORIGINS)}')
        t = card.get('title', '')
        if not 2 <= len(t) <= 48:
            wrong.append(f'{where}: a title has 2 to 48 characters, not {len(t)}')
        if t.lower() in titles:
            wrong.append(f'{where}: the title "{t}" is also the title of {titles[t.lower()]} (a tree keeps one of two cards with one title)')
        titles[t.lower()] = cid
        text = card.get('text', '')
        if not 40 <= len(text) <= 230:
            wrong.append(f'{where}: "text" is one or two sentences, 40 to 230 characters, not {len(text)}')
        why = card.get('why', '').strip()
        if not why or len(why.split()) >= 8 or '…' in why or '...' in why or why.endswith('.'):
            wrong.append(f'{where}: "why" is the words on its thread, why it hangs from its card: under eight words, no "…", no full stop')
        said = (card.get('parent'), why.lower())
        if why and said in reasons:
            wrong.append(f'{where}: its "why" is also the "why" of {reasons[said]}, under the same card')
        reasons[said] = cid
        href = card.get('href')
        if href:
            if not href.startswith('https://'):
                wrong.append(f'{where}: href must begin https://')
            if href in hrefs:
                wrong.append(f'{where}: the address is also the address of {hrefs[href]}')
            hrefs[href] = cid
        kind, origin = card.get('kind'), card.get('origin')
        if kind in ('picture', 'artwork'):
            image = card.get('image')
            file = os.path.join(folder, 'media', image or '')
            if not image or not os.path.isfile(file):
                wrong.append(f'{where}: a {kind} needs "image", a file in {name}/media')
            else:
                if not image.lower().endswith(('.jpg', '.jpeg')):
                    wrong.append(f'{where}: pictures are JPEG files')
                if os.path.getsize(file) > 700_000:
                    wrong.append(f'{where}: {image} is {os.path.getsize(file) // 1000} KB; keep a picture under 700 KB')
                try:
                    from PIL import Image
                    with Image.open(file) as im:
                        w, h = im.size
                    if max(w, h) > 1400 or max(w, h) < 300:
                        wrong.append(f'{where}: {image} is {w} x {h}; its long side should be 300 to 1400 pixels')
                    if card.get('w') != w or card.get('h') != h:
                        wrong.append(f'{where}: "w" and "h" must be the picture\'s own size, {w} and {h}')
                except ImportError:
                    pass
                except Exception as err:
                    wrong.append(f'{where}: {image} cannot be read as a picture ({err})')
        if origin == 'ocean':
            if kind != 'picture':
                wrong.append(f'{where}: a thing of the user\'s own here is a pin, so its kind is picture')
            if not href or not PIN.match(href):
                wrong.append(f'{where}: a pin\'s href is its own page, https://www.pinterest.com/pin/<id>/')
            if not str(card.get('from', '')).startswith('Pinterest, your '):
                wrong.append(f'{where}: a pin\'s "from" reads: Pinterest, your <board\'s name> board')
        if origin == 'external':
            if not href:
                wrong.append(f'{where}: something found outside needs its page in href')
            if not (card.get('from') or card.get('holder')):
                wrong.append(f'{where}: something found outside names its source in "from" (a museum also in "holder")')
            if card.get('image'):
                licence = str(card.get('licence', '')).lower()
                if not licence.startswith(OPEN):
                    wrong.append(f'{where}: a picture from outside must be free to use, with "licence" saying so: Public domain, CC0, CC BY … or CC BY-SA …')
                if licence.startswith(('cc by', 'cc-by')) and not card.get('credit'):
                    wrong.append(f'{where}: a CC BY picture names its maker in "credit"')
        if kind == 'artwork' and not card.get('holder'):
            wrong.append(f'{where}: an artwork names the collection that holds it in "holder"')
        if kind == 'paper':
            if not card.get('authors'):
                wrong.append(f'{where}: a paper lists its "authors"')
            if not re.search(r'\d{4}', str(card.get('date', ''))):
                wrong.append(f'{where}: a paper has its year in "date"')
            if not str(href or '').startswith('https://doi.org/'):
                wrong.append(f'{where}: a paper\'s href is its DOI, https://doi.org/…')
            if not card.get('venue'):
                wrong.append(f'{where}: a paper names its journal or conference in "venue"')
        if origin == 'generated' and kind not in ('note', 'picture', 'list', 'facts'):
            wrong.append(f'{where}: what the agents made is a note, a list, facts, or a picture they drew')
    # The shape: every card hangs from the first card or from another card, three layers deep at most.
    kids = {}
    for card in cards:
        parent = card.get('parent')
        if parent != 'root' and parent not in ids:
            wrong.append(f'card {card.get("id")}: its "parent" is "root" or another card\'s id, not {parent!r}')
        kids.setdefault(parent, []).append(card.get('id'))

    def depth(cid, seen=()):
        if cid in seen:
            return 99
        parent = ids[cid].get('parent')
        return 1 if parent == 'root' or parent not in ids else 1 + depth(parent, seen + (cid,))

    for cid in ids:
        if depth(cid) > 5:
            wrong.append(f'card {cid}: it hangs more than five layers below the first card (or its parents go round in a ring)')
    # A tree, not a stick: it branches at several cards and on several layers, and some lines of thought run four layers deep.
    deep3 = [cid for cid in ids if 3 <= depth(cid) <= 5]
    deep4 = [cid for cid in ids if 4 <= depth(cid) <= 5]
    if len(deep3) < 8:
        wrong.append(f'only {len(deep3)} cards hang three layers or more below the first card: at least 8 should, on several branches')
    if len(deep4) < 2:
        wrong.append(f'only {len(deep4)} cards hang four layers below the first card: at least 2 should')
    forks = [parent for parent, under in kids.items() if parent != 'root' and len(under) >= 2]
    if len(forks) < 8:
        wrong.append(f'only {len(forks)} cards have two or more cards under them: at least 8 should, so the tree branches again and again')
    second = [cid for cid in kids.get('root', []) if kids.get(cid)]
    if len(second) < 4:
        wrong.append(f'only {len(second)} of the first layer\'s cards have cards under them: at least 4 should')
    lines = [cid for cid in ids if depth(cid) >= 2 and len(kids.get(ids[cid].get('parent'), [])) == 1 and len(kids.get(cid, [])) == 1]
    if len(lines) > 3:
        wrong.append(f'{len(lines)} cards sit in single file (one card under one card under one card): let those lines fork')
    if not 5 <= len(kids.get('root', [])) <= 9:
        wrong.append(f'{len(kids.get("root", []))} cards hang from the first card: 5 to 9 make a good first layer')
    for parent, under in kids.items():
        if len(under) > 12:
            wrong.append(f'{len(under)} cards hang from {parent}: 12 at most fit round a card')
    count = lambda test: sum(1 for c in cards if test(c))
    if count(lambda c: c.get('origin') == 'ocean') < 12:
        wrong.append('fewer than 12 pins: the tree should be made mostly of the boards\' own pictures')
    if count(lambda c: c.get('origin') == 'external') < 8:
        wrong.append('fewer than 8 things found outside')
    if count(lambda c: c.get('kind') == 'paper') < 1:
        wrong.append('no paper: one or two that are real and to the point')
    if count(lambda c: c.get('origin') == 'generated') > 3:
        wrong.append('more than 3 cards made by the agents')
    return wrong, tree


def sheet(name, tree):
    from PIL import Image, ImageDraw
    folder = os.path.join(HERE, name)
    cards = tree['cards']
    by_parent = {}
    for card in cards:
        by_parent.setdefault(card['parent'], []).append(card)
    order = []

    def walk(parent, level):
        for card in by_parent.get(parent, []):
            order.append((level, card))
            walk(card['id'], level + 1)

    walk('root', 0)
    cell, cols = 170, 10
    rows = (len(order) + cols - 1) // cols
    out = Image.new('RGB', (cols * cell, rows * (cell + 34)), (18, 18, 22))
    draw = ImageDraw.Draw(out)
    tint = [(240, 200, 120), (140, 200, 240), (200, 160, 240)]
    for n, (level, card) in enumerate(order):
        x, y = (n % cols) * cell, (n // cols) * (cell + 34)
        file = os.path.join(folder, 'media', card.get('image') or '')
        if card.get('image') and os.path.isfile(file):
            im = Image.open(file).convert('RGB')
            im.thumbnail((cell - 8, cell - 8))
            out.paste(im, (x + (cell - im.width) // 2, y + (cell - im.height) // 2))
        else:
            draw.rectangle((x + 6, y + 6, x + cell - 6, y + cell - 6), outline=(90, 90, 100))
            draw.text((x + 12, y + 14), card['kind'], fill=(170, 170, 180))
        draw.text((x + 4, y + cell), ('· ' * level) + card['title'][:24 - level], fill=tint[min(level, 2)])
        draw.text((x + 4, y + cell + 14), f"{card['origin']} / {card['kind']}", fill=(130, 130, 140))
    out.save(os.path.join(folder, 'sheet.jpg'), quality=84)
    print(f'{name}/sheet.jpg written: {len(order)} cards, the first layer in yellow, the second in blue, the third in violet')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    wrong, tree = check(sys.argv[1])
    for line in wrong:
        print('-', line)
    if tree is not None:
        cards = tree.get('cards', [])
        print(f"{sys.argv[1]}: {len(cards)} cards ({sum(1 for c in cards if c.get('origin') == 'ocean')} pins, {sum(1 for c in cards if c.get('origin') == 'external')} found outside, {sum(1 for c in cards if c.get('origin') == 'generated')} made), {'ok' if not wrong else str(len(wrong)) + ' things to put right'}")
        if '--sheet' in sys.argv and not any('cannot be read' in w or 'needs "image"' in w for w in wrong):
            sheet(sys.argv[1], tree)
    sys.exit(1 if wrong else 0)
