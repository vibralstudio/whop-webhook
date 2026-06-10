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
    await page.setContent(html, { waitUntil: 'networkidle2', timeout: 60_000 });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

module.exports = { generatePDF };
