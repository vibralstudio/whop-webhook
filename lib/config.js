const REQUIRED_ENV = [
  'ANTHROPIC_API_KEY',
  'TYPEFORM_API_TOKEN',
  'SENDGRID_API_KEY',
];

// Placeholder strings that look like values but are not — a server configured
// with these would start cleanly then fail on the first real request
const PLACEHOLDERS = new Set([
  'your_anthropic_api_key_here',
  'your_sendgrid_api_key_here',
  'your_typeform_personal_access_token_here',
  'your_whop_webhook_secret_here',
]);

function validateConfig() {
  const errors = [];

  for (const key of REQUIRED_ENV) {
    const val = process.env[key];
    if (!val) {
      errors.push(`${key} is not set`);
    } else if (PLACEHOLDERS.has(val.trim())) {
      errors.push(`${key} still contains the placeholder value from .env.example`);
    }
  }

  if (errors.length) {
    throw new Error(`Configuration errors:\n  - ${errors.join('\n  - ')}`);
  }
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  whopWebhookSecret:  process.env.WHOP_WEBHOOK_SECRET   || '',
  anthropicApiKey:    (process.env.ANTHROPIC_API_KEY    || '').trim(),
  typeformApiToken:   (process.env.TYPEFORM_API_TOKEN   || '').trim(),
  sendgridApiKey:     (process.env.SENDGRID_API_KEY     || '').trim(),

  typeformFormId:   'EIeqF5OS',
  typeformBaseUrl:  'https://form.typeform.com/to/EIeqF5OS',
  fromEmail:        'contact@vibralstudio.com',
  claudeModel:      'claude-sonnet-4-6',

  validateConfig,
};
