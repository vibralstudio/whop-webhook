const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { withRetry } = require('./retry');
const config = require('./config');

// Loaded once at startup — crash early if missing
const vgbBase = fs.readFileSync(path.join(__dirname, '../assets/vgb-base.txt'), 'utf8');

// Cached system prompt block — static across all requests, eligible for Anthropic prompt caching
const SYSTEM = [
  {
    type: 'text',
    text: [
      'You are a senior music marketing strategist at Vibral Studio.',
      'You specialize in creating hyper-personalized viral growth blueprints for music artists.',
      'Your blueprints are specific, actionable, and grounded in the artist\'s unique situation.',
      'Never give generic advice. Every recommendation must directly reference the artist\'s answers.',
      'Write in a direct, confident, expert tone. Use clear section headers.',
      '',
      '=== VIBRAL GROWTH BLUEPRINT FRAMEWORK ===',
      vgbBase,
    ].join('\n'),
    cache_control: { type: 'ephemeral' },
  },
];

async function generateBlueprint(answers) {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const formattedAnswers = answers
    .map((a, i) => `Q${i + 1}: ${a.question}\nA: ${a.answer}`)
    .join('\n\n');

  return withRetry(
    () =>
      client.messages
        .create({
          model: config.claudeModel,
          max_tokens: 8192,
          system: SYSTEM,
          messages: [
            {
              role: 'user',
              content: [
                'Using the Vibral Growth Blueprint framework and the artist\'s questionnaire responses below,',
                'create a fully personalized growth blueprint for this specific artist.',
                '',
                '=== ARTIST QUESTIONNAIRE RESPONSES ===',
                formattedAnswers,
                '',
                '=== INSTRUCTIONS ===',
                'Generate a comprehensive personalized growth blueprint with these sections:',
                '',
                '# PERSONALIZED VIRAL GROWTH BLUEPRINT',
                '## Artist Overview & Positioning',
                'A sharp 2-3 sentence summary of who this artist is and their unique angle based on their answers.',
                '',
                '## Phase 1: Pre-Release Strategy',
                'Specific actions tailored to their music style, audience, and current situation. Reference their exact answers.',
                '',
                '## Phase 2: Content & Platform Strategy',
                'Exact content formats, hooks, and posting cadence for their specific genre and audience. Be specific about what they should post.',
                '',
                '## Phase 3: Growth Acceleration',
                'Collaboration opportunities, playlist strategies, and paid amplification tactics suited to their budget and goals.',
                '',
                '## Branding & Identity',
                'How to position themselves based on their answers. Specific visual, sonic, and messaging direction.',
                '',
                '## 30-Day Action Plan',
                'A week-by-week breakdown of exactly what to do first, based on their current stage.',
                '',
                '## Key Metrics to Track',
                'The 3-5 numbers they should obsess over given their goals.',
                '',
                'Be specific. Reference their actual answers throughout. This blueprint should feel like it was written exclusively for them.',
              ].join('\n'),
            },
          ],
        })
        .then((msg) => msg.content[0].text),
    { attempts: 3, delayMs: 2000, label: 'Claude blueprint generation' },
  );
}

module.exports = { generateBlueprint };
