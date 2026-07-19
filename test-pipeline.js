#!/usr/bin/env node
/**
 * Fetch the latest real Typeform response and run the full blueprint pipeline.
 * Usage:
 *   node test-pipeline.js                        # saves PDF locally, no email
 *   node test-pipeline.js --email you@test.com   # also sends the email
 */

// Load .env manually (no dotenv dependency)
const fs = require('fs');
const envPath = require('path').join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}

const path = require('path');
const config = require('./lib/config');
const { fetchTypeformResponse } = require('./lib/fetch-typeform-response');
const { generateBlueprint } = require('./lib/generate-blueprint');
const { renderTemplate } = require('./lib/render-template');
const { generatePDF } = require('./lib/generate-pdf');
const { sendBlueprintEmail } = require('./lib/send-blueprint-email');

const overrideEmail = (() => {
  const idx = process.argv.indexOf('--email');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

async function fetchLatestResponseToken() {
  const res = await fetch(
    `https://api.typeform.com/forms/${config.typeformFormId}/responses?page_size=1&sort=submitted_at%2Cdesc`,
    { headers: { Authorization: `Bearer ${config.typeformApiToken}` } },
  );
  if (!res.ok) throw new Error(`Typeform API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const item = data.items?.[0];
  if (!item) throw new Error('No responses found in this form yet.');
  return item.token;
}

async function main() {
  console.log('Fetching latest Typeform response...');
  const token = await fetchLatestResponseToken();
  console.log(`Token: ${token}`);

  console.log('Fetching answers...');
  const { email: formEmail, answers } = await fetchTypeformResponse(token);
  const email = overrideEmail || formEmail;
  console.log(`Email: ${email || '(none)'} | Answers: ${answers.length}`);

  console.log('\nGenerating blueprint JSON (Claude)...');
  const blueprintJson = await generateBlueprint(answers);
  console.log(`Artist: ${blueprintJson.artist_name} | Genre: ${blueprintJson.genre}`);

  console.log('Rendering HTML template...');
  const blueprintHtml = renderTemplate(blueprintJson);

  console.log('Generating PDF (Puppeteer)...');
  const pdfBuffer = await generatePDF(blueprintHtml);

  const outPath = path.join(__dirname, 'test-output.pdf');
  fs.writeFileSync(outPath, pdfBuffer);
  console.log(`\nPDF saved → ${outPath} (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);

  if (email) {
    console.log(`Sending email to ${email}...`);
    await sendBlueprintEmail(email, pdfBuffer);
    console.log('Email sent.');
  } else {
    console.log('No email address — skipping send. Use --email addr to send.');
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
