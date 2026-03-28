# /// script
# requires-python = ">=3.11"
# dependencies = ["markdown", "pyfiglet", "requests", "pyyaml"]
# ///

import re
import sys
from datetime import date
from pathlib import Path
import markdown
import yaml
import requests
import pyfiglet


EXPORT_URL = "https://docs.google.com/document/d/{doc_id}/export?format=md"

HTML_TEMPLATE = """\
<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Adil Soubki Official Website</title>
  </head>
  <body style="max-width: 1080px; margin: 0 auto; padding: 0 8px">
    <tt style="text-align: center">
      <b>
      <pre style="font-size: {font_size}">{ascii_art}</pre>
      </b>
    </tt>
    <tt>
      {description}
    </tt>
    <br>
    <br>
{content}
    <br>
    <div style="border-top: 1px solid"></div>
    <footer style="text-align: center; margin: 1.2em">
      <tt><a href="../index.html">Home</a></tt>
    </footer>
  </body>
</html>
"""

def parse_inline(text: str) -> str:
    """Convert markdown inline markup to HTML, stripping the wrapping <p> tag."""
    text = re.sub(r'~~(.+?)~~', r'<del style="text-decoration-thickness: 1.5px">\1</del>', text)
    return markdown.markdown(text).removeprefix('<p>').removesuffix('</p>')


def fetch_markdown(doc_id: str) -> str:
    url = EXPORT_URL.format(doc_id=doc_id)
    print(f"  Fetching {url}")
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.text


LIST_STYLE = 'margin: 0; list-style: none; padding-left: 3em; text-indent: -3em; line-height: 1.5;'
SUB_STYLE = 'margin: 0; list-style: none; padding-left: 2.5em; text-indent: -2.5em; line-height: 1.5;'


def parse_blocks(md: str) -> list[tuple]:
    """Parse markdown into ('list', [...]), ('text', str), and ('break', None) blocks."""
    blocks = []
    current_list = []
    for line in md.splitlines():
        if re.match(r'^[ \t]*[*\-][ \t]*$', line):
            continue  # skip empty bullets
        m = re.match(r'^( *)[*\-] (.+)$', line)  # bullet list item
        if m:
            level = 0 if len(m.group(1)) == 0 else 1
            current_list.append((level, m.group(2).strip()))
        else:
            if current_list:
                blocks.append(('list', current_list))
                current_list = []
            if line.strip():
                blocks.append(('text', line.strip()))
            elif blocks and blocks[-1][0] != 'break':
                blocks.append(('break', None))
    if current_list:
        blocks.append(('list', current_list))
    return blocks


def render_list_block(items: list[tuple[int, str]]) -> str:
    lines = []
    counter = 0
    i = 0
    while i < len(items):
        level, text = items[i]
        if level == 0:
            counter += 1
            html_item = parse_inline(text)
            sub_items = []
            j = i + 1
            while j < len(items) and items[j][0] > 0:
                sub_items.append(items[j][1])
                j += 1
            if sub_items:
                sub_lines = '\n'.join(
                    f'          <li>[{chr(ord("a") + k)}] {parse_inline(s)}</li>'
                    for k, s in enumerate(sub_items)
                )
                lines.append(
                    f'        <li>[{counter:02d}] {html_item}\n'
                    f'          <ul style="{SUB_STYLE}">\n'
                    f'{sub_lines}\n'
                    f'          </ul>\n'
                    f'        </li>'
                )
                i = j
            else:
                lines.append(f'        <li>[{counter:02d}] {html_item}</li>')
                i += 1
        else:
            # orphaned sub-item, render without counter
            lines.append(f'        <li>{parse_inline(text)}</li>')
            i += 1
    inner = '\n'.join(lines)
    return f'    <tt>\n      <ul style="{LIST_STYLE}">\n{inner}\n      </ul>\n    </tt>'


def render_blocks(blocks: list[tuple]) -> str:
    parts = []
    prev_kind = None
    pending_double = False
    for kind, content in blocks:
        if kind == 'break':
            pending_double = True
            continue
        if parts:
            if prev_kind == 'list' and kind == 'text':
                parts.append('    <br>')
            elif pending_double or (prev_kind == 'list' and kind == 'list'):
                parts.append('    <br>\n    <br>')
            else:
                parts.append('    <br>')
        if kind == 'list':
            parts.append(render_list_block(content))
        else:
            parts.append(f'    <tt>\n      {parse_inline(content)}\n    </tt>')
        prev_kind = kind
        pending_double = False
    if prev_kind == 'text':
        parts.append('    <br>')
    return '\n'.join(parts)


def generate_ascii(title: str) -> str:
    # Render title first to measure width, then compute how many '_' chars
    # fill one line (each '_' in the big font is 7 chars wide).
    width = len(pyfiglet.figlet_format(title, font='big', width=100).splitlines()[0])
    n = round((width - 1) / 7)
    art = pyfiglet.figlet_format(title + '\n' + '_' * n, font='big', width=100)
    # Drop blank lines (the empty rows from '_'s tall cell above the separator).
    lines = [l for l in art.splitlines() if l.strip()]
    # Add a leading space to the title rows (not the separator).
    lines = [' ' + l for l in lines[:-2]] + lines[-2:] + ['']
    return '\n' + '\n'.join(lines) + '\n'


def sync_post(post: dict) -> None:
    doc_id = post['doc_id']
    title = post['title']
    description = post['description']
    output = post['output']
    link_text = post['link_text']

    print(f"Syncing: {title} -> {output}")
    md = fetch_markdown(doc_id)
    blocks = parse_blocks(md)
    n_items = sum(len(c) for k, c in blocks if k == 'list')
    n_blocks = sum(1 for k, _ in blocks if k != 'break')
    print(f"  Found {n_items} items in {n_blocks} block(s)")

    ascii_art = generate_ascii(title)
    art_width = max(len(line.rstrip()) for line in ascii_art.splitlines() if line.strip())
    # 150 ≈ viewport% / char_width_ratio (empirically calibrated)
    font_size = f'min(1em, {150 / art_width:.2f}vw)'
    content = render_blocks(blocks)

    html = HTML_TEMPLATE.format(
        ascii_art=ascii_art,
        font_size=font_size,
        description=parse_inline(description),
        content=content,
    )

    existing = Path(output).read_text(encoding='utf-8') if Path(output).exists() else None
    if html == existing:
        print("  No changes.")
        return

    Path(output).write_text(html, encoding='utf-8')
    print(f"  Written to {output}")

    today = date.today().strftime('%B %-d, %Y')
    href = './' + output
    index = Path('index.html').read_text(encoding='utf-8')
    updated, n = re.subn(
        rf'(<a href="{re.escape(href)}">[^<]+</a>)( \(updated [^)]+\))?',
        rf'\1 (updated {today})',
        index,
    )
    if n == 0:
        # Link doesn't exist yet — insert it before the closing </tt> of "Games, Puzzles & Posts".
        new_link = f'\n      <br>\n      <a href="{href}">{link_text}</a> (updated {today})'
        updated = re.sub(
            r'(Games, Puzzles & Posts.*?</tt>.*?)(\n\s*)(</tt>)',
            rf'\1{new_link}\2\3',
            index, count=1, flags=re.DOTALL,
        )
        if updated == index:
            raise RuntimeError(f"Could not find insertion point in index.html for {href}")
        print(f"  Added link to index.html.")
    Path('index.html').write_text(updated, encoding='utf-8')
    print(f"  Updated index.html: {today}")


def main() -> None:
    with open('sync.yaml', encoding='utf-8') as f:
        config = yaml.safe_load(f)

    posts = config.get('posts', [])
    if not posts:
        print("No posts defined in sync.yaml")
        sys.exit(0)

    for post in posts:
        sync_post(post)

    print("Done.")


if __name__ == '__main__':
    main()
