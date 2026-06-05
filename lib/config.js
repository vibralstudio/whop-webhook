const REQUIRED_ENV = [
  'ANTHROPIC_API_KEY',
  'TYPEFORM_API_TOKEN',
  'SENDGRID_API_KEY',
];

function validateConfig() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  whopWebhookSecret: process.env.WHOP_WEBHOOK_SECRET || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  typeformApiToken: process.env.TYPEFORM_API_TOKEN || '',
  sendgridApiKey: process.env.SENDGRID_API_KEY || '',

  typeformFormId: 'EIeqF5OS',
  typeformBaseUrl: 'https://form.typeform.com/to/EIeqF5OS',
  fromEmail: 'contact@vibralstudio.com',
  claudeModel: 'claude-sonnet-4-6',

  validateConfig,
};
