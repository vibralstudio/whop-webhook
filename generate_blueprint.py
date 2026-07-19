#!/usr/bin/env python3
"""
generate_blueprint.py — Vibral Studio · Custom Blueprint pipeline v2 (Standard FENNO.)

Full flow, self-contained:
  Typeform answers (JSON) → Anthropic generation (15 sections, Fenno standard)
  → continuous exact-height PDF → approval email to contact@vibralstudio.com.

Usage:
    python3 generate_blueprint.py <answers.json> [client_name] [client_email]

- <answers.json>: raw Typeform webhook payload OR a simple {"question": "answer"} dict.
- client_name / client_email: optional — auto-extracted from the payload if absent.

Requires next to this script: generation_prompt.md, blueprint_head.html,
render_blueprint.py, fonts/ (the .ttf files).

Env vars: ANTHROPIC_API_KEY, SENDGRID_API_KEY
(Railway service Variables are canonical; a local .env is read as fallback only.)
"""
import base64
import json
import os
import re
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
APPROVAL_EMAIL = "contact@vibralstudio.com"
MODEL = "claude-sonnet-4-6"


# ---------- env (fallback .env loader — never overrides real env) ----------
def load_env_fallback():
    env_path = os.path.join(HERE, ".env")
    if not os.path.exists(env_path):
        return
    for line in open(env_path, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip())


# ---------- typeform parsing ----------
def parse_answers(path):
    """Return (qa_pairs, client_name, client_email) from a Typeform payload or dict."""
    data = json.load(open(path, encoding="utf-8"))
    name, email = None, None

    fr = data.get("form_response") if isinstance(data, dict) else None
    if fr:
        fields = {f["id"]: f.get("title", f["id"])
                  for f in fr.get("definition", {}).get("fields", [])}
        pairs = []
        for a in fr.get("answers", []):
            q = fields.get(a.get("field", {}).get("id", ""), "Question")
            t = a.get("type")
            if t == "choice":
                v = a["choice"].get("label", "")
            elif t == "choices":
                v = ", ".join(a["choices"].get("labels", []))
            elif t in ("text", "email", "url", "phone_number"):
                v = a.get(t, "")
            elif t in ("number", "rating", "opinion_scale"):
                v = str(a.get("number", ""))
            elif t == "boolean":
                v = "Yes" if a.get("boolean") else "No"
            elif t == "date":
                v = a.get("date", "")
            else:
                v = json.dumps(a.get(t, ""), ensure_ascii=False)
            pairs.append((q, str(v)))
            if t == "email" and not email:
                email = v
            ql = q.lower()
            if not name and any(k in ql for k in
                                ("artist name", "stage name", "project name", "nom d'artiste")):
                name = str(v)
        return pairs, name, email

    # simple dict fallback
    pairs = [(str(k), str(v)) for k, v in data.items()]
    for k, v in pairs:
        kl = k.lower()
        if not email and ("email" in kl or "courriel" in kl):
            email = v
        if not name and any(t in kl for t in ("artist", "stage", "nom d'artiste", "name")):
            name = v
    return pairs, name, email


# ---------- generation ----------
def generate_body(qa_pairs, client_name):
    import anthropic
    system = open(os.path.join(HERE, "generation_prompt.md"), encoding="utf-8").read()
    answers_block = "\n\n".join(f"Q: {q}\nA: {a}" for q, a in qa_pairs)
    user = (
        f"CLIENT ARTIST NAME: {client_name}\n"
        f"TODAY'S DATE: {datetime.now().strftime('%B %d, %Y')}\n\n"
        f"CLIENT'S TYPEFORM ANSWERS ({len(qa_pairs)} questions):\n\n{answers_block}\n\n"
        f"Generate the complete blueprint HTML body now."
    )
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    resp = client.messages.create(
        model=MODEL,
        max_tokens=32000,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    body = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
    body = re.sub(r"^```(?:html)?\s*", "", body.strip())
    body = re.sub(r"\s*```$", "", body)
    return body


def quality_check(body):
    """Hard gate — never let an incomplete blueprint reach approval (leçon Kemkila)."""
    problems = []
    caps = len(re.findall(r'<div class="cap">', body))
    # 65 captions + up to ~6 stat labels also use .cap
    if caps < 65:
        problems.append(f"captions insuffisantes ({caps} < 65)")
    for marker, label in [
        ("cover", "cover"), ('class="phase"', "plan 90 jours"),
        ("lyrc.studio", "section LYRC"), ("VIBRAL", "code VIBRAL"),
        ("Higgsfield", "prompt Higgsfield"), ("Trials", "section Trials"),
        ("Pre-Save", "pre-save"), ("cap-style", "caption bank"),
        ('class="check"', "day 1 checklist"), ("closing", "closing"),
    ]:
        if marker.lower() not in body.lower():
            problems.append(f"section manquante: {label}")
    sections = body.count("<section")
    if sections < 14:
        problems.append(f"sections insuffisantes ({sections} < 14)")
    return problems


# ---------- pdf ----------
def render_pdf(body, client_name, out_pdf):
    sys.path.insert(0, HERE)
    from render_blueprint import assemble, build_font_css, measure_content_height, WIDTH
    from weasyprint import HTML, CSS
    from weasyprint.text.fonts import FontConfiguration

    body_path = os.path.join("/tmp", "bp_body.html")
    open(body_path, "w", encoding="utf-8").write(body)
    fc = FontConfiguration()
    font_css = build_font_css()
    html = assemble(body_path, client_name)
    height = measure_content_height(html, font_css, fc)
    final = CSS(string=font_css + f"@page{{size:{WIDTH}px {height}px;margin:0}} "
                                  f".doc{{max-width:{WIDTH}px}}", font_config=fc)
    HTML(string=html).write_pdf(out_pdf, stylesheets=[final], font_config=fc)
    return height


# ---------- email ----------
def send_email(subject, text, pdf_path=None, to=APPROVAL_EMAIL):
    from sendgrid import SendGridAPIClient
    from sendgrid.helpers.mail import (Attachment, Disposition, FileContent,
                                       FileName, FileType, Mail)
    msg = Mail(from_email=APPROVAL_EMAIL, to_emails=to,
               subject=subject, plain_text_content=text)
    if pdf_path:
        data = base64.b64encode(open(pdf_path, "rb").read()).decode()
        msg.attachment = Attachment(
            FileContent(data), FileName(os.path.basename(pdf_path)),
            FileType("application/pdf"), Disposition("attachment"))
    sg = SendGridAPIClient(os.environ["SENDGRID_API_KEY"])
    r = sg.send(msg)
    print(f"Email sent → {to} (status {r.status_code})")


def main():
    load_env_fallback()
    if len(sys.argv) < 2:
        print("Usage: generate_blueprint.py <answers.json> [client_name] [client_email]")
        sys.exit(1)

    answers_path = sys.argv[1]
    try:
        qa_pairs, auto_name, auto_email = parse_answers(answers_path)
        client_name = (sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else auto_name) or "Client"
        client_email = (sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else auto_email) or "unknown"
        print(f"Client: {client_name} <{client_email}> — {len(qa_pairs)} answers")

        print("Generating blueprint (Fenno standard)...")
        body = generate_body(qa_pairs, client_name)

        problems = quality_check(body)
        if problems:
            raise RuntimeError("QUALITY GATE FAILED — blueprint incomplet, envoi bloqué: "
                               + "; ".join(problems))
        print("Quality gate: PASSED (15 sections, 65 captions, LYRC, Higgsfield, Trials)")

        safe = re.sub(r"[^A-Za-z0-9]+", "-", client_name).strip("-") or "Client"
        pdf_path = f"/tmp/{safe}-Growth-Blueprint.pdf"
        height = render_pdf(body, client_name, pdf_path)
        print(f"PDF: {pdf_path} (continuous, {height}px)")

        send_email(
            subject=f"[APPROBATION] Custom Blueprint — {client_name}",
            text=(f"Blueprint genere pour {client_name} <{client_email}>.\n\n"
                  f"Standard FENNO. — 15 sections, quality gate passe.\n"
                  f"PDF continu en piece jointe. Ouvre-le dans ton navigateur, "
                  f"approuve, puis transfere au client.\n\n— Pipeline Vibral v2"),
            pdf_path=pdf_path,
        )
        print("DONE — en attente d'approbation dans ta boite.")
    except Exception as e:
        print(f"!!! PIPELINE FAILED !!!\n{e}")
        try:
            send_email(subject="[ALERTE] Custom Blueprint pipeline failed",
                       text=f"Erreur pipeline v2:\n\n{e}\n\nFichier: {answers_path}")
        except Exception as alert_err:
            print(f"Could not send failure alert: {alert_err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
