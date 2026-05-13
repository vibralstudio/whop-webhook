const PDFDocument = require("pdfkit");
const path = require("path");

const BG = "#0a0a08";
const GOLD = "#C9A84C";
const WHITE = "#FFFFFF";
const GREY = "#A0A0A0";

const SYNE_BOLD = path.join(__dirname, "../assets/Syne-Bold.ttf");
const SYNE_REGULAR = path.join(__dirname, "../assets/Syne-Regular.ttf");

function generatePDF(blueprintText) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 60, bottom: 60, left: 60, right: 60 },
      bufferPages: true,
    });

    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    doc.registerFont("SyneBold", SYNE_BOLD);
    doc.registerFont("SyneRegular", SYNE_REGULAR);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const contentWidth = pageWidth - 120;
    const BOTTOM_MARGIN = pageHeight - 80;

    let y = 60;
    let pageHasContent = false;

    function fillBackground() {
      doc.rect(0, 0, pageWidth, pageHeight).fill(BG);
    }

    function addContentPage() {
      // Only add a new page if the current one has content
      if (!pageHasContent) return;
      doc.addPage();
      fillBackground();
      doc.rect(0, 0, pageWidth, 4).fill(GOLD);
      y = 60;
      pageHasContent = false;
    }

    function ensureSpace(needed) {
      if (y + needed > BOTTOM_MARGIN) addContentPage();
    }

    // ── Cover page ────────────────────────────────────────────────────────────
    fillBackground();
    doc.rect(0, 0, pageWidth, 4).fill(GOLD);
    doc.font("SyneBold").fontSize(10).fillColor(GOLD).text("VIBRAL STUDIO", 60, 50, { align: "left" });
    doc.font("SyneBold").fontSize(36).fillColor(GOLD).text("PERSONALIZED", 60, 180, { width: contentWidth });
    doc.font("SyneBold").fontSize(36).fillColor(WHITE).text("VIRAL GROWTH", 60, doc.y + 4, { width: contentWidth });
    doc.font("SyneBold").fontSize(36).fillColor(WHITE).text("BLUEPRINT", 60, doc.y + 4, { width: contentWidth });
    doc.moveDown(1.5);
    doc.moveTo(60, doc.y).lineTo(pageWidth - 60, doc.y).strokeColor(GOLD).lineWidth(0.5).stroke();
    doc.moveDown(0.8);
    doc.font("SyneRegular").fontSize(11).fillColor(GREY).text("Prepared exclusively by Vibral Studio", 60, doc.y, { width: contentWidth });
    doc.font("SyneRegular").fontSize(11).fillColor(GREY).text(
      new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      60, doc.y + 4, { width: contentWidth }
    );
    doc.font("SyneRegular").fontSize(9).fillColor(GOLD)
      .text("CONFIDENTIAL — FOR YOUR EYES ONLY", 60, pageHeight - 80, { width: contentWidth, align: "center" });
    doc.rect(0, pageHeight - 4, pageWidth, 4).fill(GOLD);

    // ── Content pages ─────────────────────────────────────────────────────────
    // Start first content page — mark it as having content so the cover isn't reused
    pageHasContent = true;
    addContentPage();

    const lines = blueprintText.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      // Blank line — add a small gap only if we're not at the top of a fresh page
      if (!trimmed) {
        if (pageHasContent) y = Math.min(y + 8, BOTTOM_MARGIN - 20);
        continue;
      }

      // H1 — # Title
      if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
        const text = trimmed.slice(2);
        ensureSpace(80);
        doc.font("SyneBold").fontSize(22).fillColor(GOLD).text(text, 60, y, { width: contentWidth });
        y = doc.y + 4;
        doc.moveTo(60, y).lineTo(pageWidth - 60, y).strokeColor(GOLD).lineWidth(0.5).stroke();
        y += 14;
        pageHasContent = true;
        continue;
      }

      // H2 — ## Section
      if (trimmed.startsWith("## ")) {
        const text = trimmed.slice(3);
        ensureSpace(60);
        y += 10;
        doc.font("SyneBold").fontSize(14).fillColor(GOLD).text(text.toUpperCase(), 60, y, { width: contentWidth });
        y = doc.y + 8;
        pageHasContent = true;
        continue;
      }

      // H3 — ### Sub-section
      if (trimmed.startsWith("### ")) {
        const text = trimmed.slice(4);
        ensureSpace(40);
        y += 6;
        doc.font("SyneBold").fontSize(11).fillColor(WHITE).text(text, 60, y, { width: contentWidth });
        y = doc.y + 6;
        pageHasContent = true;
        continue;
      }

      // Bullet points
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        const text = trimmed.slice(2);
        ensureSpace(30);
        doc.font("SyneRegular").fontSize(10).fillColor(GOLD).text("•", 60, y, { width: 16, continued: false });
        doc.font("SyneRegular").fontSize(10).fillColor(WHITE).text(text, 82, y, { width: contentWidth - 22 });
        y = doc.y + 4;
        pageHasContent = true;
        continue;
      }

      // Numbered list
      const numMatch = trimmed.match(/^(\d+)\.\s(.*)/);
      if (numMatch) {
        ensureSpace(30);
        doc.font("SyneBold").fontSize(10).fillColor(GOLD).text(`${numMatch[1]}.`, 60, y, { width: 22, continued: false });
        doc.font("SyneRegular").fontSize(10).fillColor(WHITE).text(numMatch[2], 82, y, { width: contentWidth - 22 });
        y = doc.y + 4;
        pageHasContent = true;
        continue;
      }

      // Bold text **...**
      const boldMatch = trimmed.match(/^\*\*(.+)\*\*$/);
      if (boldMatch) {
        ensureSpace(30);
        doc.font("SyneBold").fontSize(10).fillColor(WHITE).text(boldMatch[1], 60, y, { width: contentWidth });
        y = doc.y + 4;
        pageHasContent = true;
        continue;
      }

      // Regular body text
      ensureSpace(30);
      doc.font("SyneRegular").fontSize(10).fillColor(WHITE).text(trimmed, 60, y, { width: contentWidth });
      y = doc.y + 4;
      pageHasContent = true;
    }

    // ── Finalize: page numbers + gold bottom bar on all content pages ─────────
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 1; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.rect(0, pageHeight - 4, pageWidth, 4).fill(GOLD);
      doc.font("SyneRegular").fontSize(8).fillColor(GREY)
        .text(String(i + 1), 0, pageHeight - 24, { width: pageWidth, align: "center" });
    }

    doc.end();
  });
}

module.exports = { generatePDF };
