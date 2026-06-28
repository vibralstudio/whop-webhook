const puppeteer = require('puppeteer');
const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--single-process',
  '--disable-gpu',
];
async function generatePDF(html) {
  const browser = await puppeteer.launch({
    headless: true,
    args: LAUNCH_ARGS,
  });
  try {
    const page = await browser.newPage();

    // Match the template's exact pixel dimensions instead of letting
    // Puppeteer's "format: A4" fight with the CSS .page width/min-height —
    // mismatched page sizing is what causes blank/cut pages.
    await page.setViewport({ width: 794, height: 1123 });
    await page.setContent(html, { waitUntil: 'networkidle2', timeout: 60_000 });

    // Let layout settle before measuring/printing
    await page.evaluateHandle('document.fonts.ready');

    const pdfBuffer = await page.pdf({
      width: '794px',
      height: '1123px',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      pageRanges: '',
      preferCSSPageSize: false,
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
module.exports = { generatePDF };
