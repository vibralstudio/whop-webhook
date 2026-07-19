#!/usr/bin/env python3
"""
render_blueprint.py — Vibral Studio
Assembles head + generated body, renders an exact-height continuous PDF
(one single page, black background, embedded fonts, zero trailing blank).

Usage:
    python3 render_blueprint.py <body.html> <output.pdf> [client_name]

- <body.html>: the HTML produced by the Anthropic API (starts at <body>)
- If the input file contains a full document (<html>...), it is used as-is.
- Fonts are read from ./fonts/ next to this script (commit them to the repo):
    ArchivoBlack-Regular.ttf, Inter_300Light.ttf, Inter_300Light_Italic.ttf,
    Inter_400Regular.ttf, Inter_400Regular_Italic.ttf, Inter_500Medium.ttf,
    Inter_500Medium_Italic.ttf, Inter_600SemiBold.ttf, Inter_600SemiBold_Italic.ttf,
    Inter_700Bold.ttf, Inter_700Bold_Italic.ttf, Inter_800ExtraBold.ttf,
    Inter_800ExtraBold_Italic.ttf
- blueprint_head.html must sit next to this script (contains the fixed CSS).
"""
import os
import re
import sys

from weasyprint import HTML, CSS
from weasyprint.text.fonts import FontConfiguration

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")
HEAD_PATH = os.path.join(HERE, "blueprint_head.html")
WIDTH = 900  # px — the .doc max-width; do not change without changing the CSS


def build_font_css() -> str:
    faces = [
        f"@font-face{{font-family:'Archivo Black';"
        f"src:url('file://{FONTS}/ArchivoBlack-Regular.ttf');}}"
    ]
    weights = {
        300: "300Light", 400: "400Regular", 500: "500Medium",
        600: "600SemiBold", 700: "700Bold", 800: "800ExtraBold",
    }
    for w, name in weights.items():
        faces.append(
            f"@font-face{{font-family:'Inter';"
            f"src:url('file://{FONTS}/Inter_{name}.ttf');font-weight:{w};}}"
        )
        italic = f"{FONTS}/Inter_{name}_Italic.ttf"
        if os.path.exists(italic):
            faces.append(
                f"@font-face{{font-family:'Inter';src:url('file://{italic}');"
                f"font-weight:{w};font-style:italic;}}"
            )
    return "".join(faces)


def assemble(body_path: str, client_name: str) -> str:
    raw = open(body_path, encoding="utf-8").read()
    if "<html" in raw[:200].lower():
        html = raw  # already a full document
    else:
        head = open(HEAD_PATH, encoding="utf-8").read()
        head = head.replace("{{CLIENT_NAME}}", client_name or "Client")
        # tolerate model output not starting exactly at <body>
        if "<body>" not in raw:
            raw = "<body>\n" + raw
        if "</html>" not in raw:
            raw = raw + "\n</html>"
        html = head + raw
    # strip external font links — we embed locally
    html = re.sub(r"<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>", "", html)
    html = re.sub(r'<link rel="preconnect"[^>]*>', "", html)
    return html


def measure_content_height(html: str, font_css: str, fc: FontConfiguration) -> int:
    probe = CSS(string=font_css + f"@page{{size:{WIDTH}px 60000px;margin:0}}",
                font_config=fc)
    doc = HTML(string=html).render(stylesheets=[probe], font_config=fc)
    best = [0.0]

    def walk(box):
        if getattr(box, "element_tag", None) == "section":
            y = getattr(box, "position_y", 0) or 0
            h = box.margin_height() if hasattr(box, "margin_height") else 0
            best[0] = max(best[0], y + h)
        for child in (getattr(box, "children", None) or []):
            walk(child)

    walk(doc.pages[0]._page_box)
    return int(best[0]) + 18  # tiny breathing room, no white page


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: render_blueprint.py <body.html> <output.pdf> [client_name]")
        sys.exit(1)
    body_path, out_path = sys.argv[1], sys.argv[2]
    client = sys.argv[3] if len(sys.argv) > 3 else "Client"

    fc = FontConfiguration()
    font_css = build_font_css()
    html = assemble(body_path, client)

    height = measure_content_height(html, font_css, fc)
    final = CSS(
        string=font_css
        + f"@page{{size:{WIDTH}px {height}px;margin:0}} .doc{{max-width:{WIDTH}px}}",
        font_config=fc,
    )
    HTML(string=html).write_pdf(out_path, stylesheets=[final], font_config=fc)
    print(f"OK — {out_path} ({WIDTH}x{height}px, single continuous page)")


if __name__ == "__main__":
    main()
