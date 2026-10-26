#!/usr/bin/env python3
"""Build the self-contained HTML reading edition of agent-system-plan.md.

Run: python3 scripts/render-agent-plan.py
Build dependency: markdown-it-py (the generated document has no dependencies).
The Markdown file remains the canonical plan. This script preserves every source
section and adds an editorial overview, navigation, and accessible diagrams.
"""

from html import escape
from pathlib import Path
import re
import sys

try:
    from markdown_it import MarkdownIt
except ImportError:
    sys.exit("Install the build dependency with: python3 -m pip install markdown-it-py")

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "agent-system-plan.md"
TEMPLATE = ROOT / "docs" / "agent-system-plan.template.html"
OUTPUT = ROOT / "docs" / "agent-system-plan.html"

CHAPTERS = [
    ("overview", "The idea", "A coherent assistant, built on the palace you already have.", [1, 2]),
    ("experience", "The experience", "Capture, explore, think, review, and maintain—through space.", [3, 4, 13]),
    ("librarians", "Librarians & projects", "Persistent project understanding. Specialists when the work needs them.", [7]),
    ("memory", "Memory & evidence", "Preserve the experience. Keep current knowledge accurate and traceable.", [5, 8, 10]),
    ("personalization", "Learning the user", "Understand preferences in context, with room to change.", [6]),
    ("trust", "Trust & change", "Make actions inspectable, bounded, and reversible.", [9, 11, 12]),
    ("architecture", "The architecture", "A shared memory service connects the interface and the agents.", [14]),
    ("roadmap", "Build & evaluate", "Prove the smallest useful loop, then grow the system.", [15, 16]),
]

TITLES = {
    1: "Product direction",
    2: "The prototype today",
    3: "Five ways to work with the librarian",
    4: "Stable homes, changing relevance",
    5: "The shared knowledge model",
    6: "Personal context and playbooks",
    7: "Who does what",
    8: "Retrieval and honest coverage",
    9: "How an agent runs",
    10: "Capture, memory, and review",
    11: "Propagating changes",
    12: "Permissions and change sets",
    13: "Inside the spatial experience",
    14: "Implementation architecture",
    15: "The build sequence",
    16: "How we know it works",
}


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def diagrams():
    return '''<figure class="architecture-map" aria-labelledby="architecture-caption">
      <figcaption id="architecture-caption">Two paths through one shared system</figcaption>
      <div class="system-path">
        <p class="path-label">Read &amp; understand</p>
        <ol class="path-nodes">
          <li><span>01</span><strong>Your question</strong><small>Selected memories + scope</small></li>
          <li><span>02</span><strong>Palace librarian</strong><small>Coordinates relevant specialists</small></li>
          <li><span>03</span><strong>Shared memory</strong><small>Retrieve and inspect sources</small></li>
          <li><span>04</span><strong>Cited answer</strong><small>Sources and a spatial path</small></li>
        </ol>
      </div>
      <div class="system-path">
        <p class="path-label">Propose &amp; remember</p>
        <ol class="path-nodes">
          <li><span>01</span><strong>A proposed change</strong><small>Evidence + expected revisions</small></li>
          <li><span>02</span><strong>Check &amp; review</strong><small>Policy, sources, user review as needed</small></li>
          <li><span>03</span><strong>Commit once</strong><small>Versioned records + event outbox</small></li>
          <li><span>04</span><strong>Refresh dependents</strong><small>Indexes, project briefs, summaries</small></li>
        </ol>
      </div>
      <p class="figure-note">Project librarians, the user model, and review workflows all reference the same canonical sources.</p>
    </figure>'''


md = MarkdownIt("commonmark", {"html": False, "typographer": False}).enable("table")


def heading_open(tokens, index, options, env):
    token = tokens[index]
    original = int(token.tag[1:])
    # Chapter headings are h2, source sections h3, and their subsections h4.
    level = min(original + 1, 6)
    title = tokens[index + 1].content
    anchor = f'section-{env["section"]}-{slug(title)}'
    token.tag = f"h{level}"
    tokens[index + 2].tag = token.tag
    token.attrSet("id", anchor)
    env["anchors"].append((title, anchor))
    return md.renderer.renderToken(tokens, index, options, env)


def fence(tokens, index, options, env):
    token = tokens[index]
    if token.info.strip() == "mermaid":
        return diagrams() + '''<details class="technical-detail">
          <summary>Full architecture notation</summary>
          <p class="detail-note">The complete Mermaid definition from the source plan.</p>
          <pre><code>''' + escape(token.content) + "</code></pre></details>\n"
    return '<pre><code>' + escape(token.content) + '</code></pre>\n'


md.renderer.rules["heading_open"] = heading_open
md.renderer.rules["fence"] = fence


def responsive_tables(rendered):
    def convert(match):
        table = match.group(0)
        headers = re.findall(r"<th>(.*?)</th>", table, re.S)
        plain_headers = [re.sub(r"<[^>]+>", "", h) for h in headers]

        def row(match_row):
            cells = re.findall(r"<td>(.*?)</td>", match_row.group(1), re.S)
            converted = []
            for i, cell in enumerate(cells):
                label = plain_headers[i] if i < len(plain_headers) else "Detail"
                converted.append(f'<td data-label="{escape(label, quote=True)}">{cell}</td>')
            return "<tr>" + "".join(converted) + "</tr>"

        table = re.sub(r"<tr>\s*((?:<td>.*?</td>\s*)+)</tr>", row, table, flags=re.S)
        return '<div class="table-wrap">' + table + '</div>'

    return re.sub(r"<table>.*?</table>", convert, rendered, flags=re.S)


def section_html(number, body):
    env = {"section": number, "anchors": []}
    rendered = responsive_tables(md.render(body, env))
    # Treat each implementation phase as a self-contained step in the sequence.
    if number == 15:
        parts = re.split(r'(?=<h4\b)', rendered)
        rendered = parts[0] + '<div class="roadmap-steps">' + "".join(
            f'<div class="roadmap-step"><span class="step-marker" aria-hidden="true">{i:02}</span><div>{part}</div></div>'
            for i, part in enumerate(parts[1:])
        ) + '</div>'
    return f'''<article class="plan-section" id="section-{number}">
      <h3 class="section-title">{escape(TITLES[number])}<a class="permalink" href="#section-{number}" aria-label="Link to {escape(TITLES[number], quote=True)}">#</a></h3>
      <div class="prose">{rendered}</div>
    </article>'''


def main():
    source = SOURCE.read_text()
    matches = list(re.finditer(r"^## (\d+)\. (.+)$", source, re.M))
    sections = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(source)
        sections[int(match[1])] = source[match.end():end].strip()
    expected = [n for _, _, _, numbers in CHAPTERS for n in numbers]
    if sorted(expected) != sorted(sections):
        sys.exit("Source sections changed; update the chapter mapping before rendering.")

    navigation = []
    mobile = []
    chapters = []
    for index, (anchor, title, description, numbers) in enumerate(CHAPTERS, 1):
        navigation.append(f'''<li><a class="chapter-link" href="#{anchor}" data-chapter="{anchor}"><span>{index:02}</span>{escape(title)}</a></li>''')
        mobile.append(f'<a href="#{anchor}"><span>{index:02}</span>{escape(title)}</a>')
        body = "".join(section_html(n, sections[n]) for n in numbers)
        chapters.append(f'''<section class="chapter" id="{anchor}" aria-labelledby="heading-{anchor}">
          <header class="chapter-heading"><span class="chapter-number">{index:02}</span><div><h2 id="heading-{anchor}">{escape(title)}</h2><p>{escape(description)}</p></div></header>
          {body}
        </section>''')

    reading_minutes = round(len(re.findall(r"\b\w+\b", source)) / 230)
    template = TEMPLATE.read_text()
    replacements = {
        "{{NAVIGATION}}": "\n".join(navigation),
        "{{MOBILE_NAVIGATION}}": "\n".join(mobile),
        "{{CHAPTERS}}": "\n".join(chapters),
        "{{READING_MINUTES}}": str(reading_minutes),
    }
    for key, value in replacements.items():
        template = template.replace(key, value)
    if re.search(r"\{\{[A-Z_]+\}\}", template):
        sys.exit("Unresolved template placeholder.")
    OUTPUT.write_text(template)
    print(f"Created {OUTPUT.relative_to(ROOT)} ({len(template.encode()):,} bytes; all {len(sections)} source sections).")


if __name__ == "__main__":
    main()
