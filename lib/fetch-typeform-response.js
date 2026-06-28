const { withRetry } = require('./retry');
const config = require('./config');

const API_BASE = 'https://api.typeform.com';

async function typeformFetch(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${config.typeformApiToken}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Typeform API ${res.status}: ${body}`);
  }

  return res.json();
}

// Returns { email, answers: [{ question, answer }] }
async function fetchTypeformResponse(responseToken) {
  return withRetry(
    async () => {
      const [formDef, responseData] = await Promise.all([
        typeformFetch(`/forms/${config.typeformFormId}`),
        typeformFetch(`/forms/${config.typeformFormId}/responses?included_response_ids=${responseToken}`),
      ]);

      const fieldTitles = Object.fromEntries(
        (formDef.fields ?? []).map((f) => [f.id, f.title]),
      );

      const item = responseData.items?.[0];
      if (!item) throw new Error(`No response found for token ${responseToken}`);

      let email = item.hidden?.email ?? null;

// Fallback: extract email from the referer URL query param (?email=...)
// This is how our system passes the email when the link is sent manually
if (!email && item.metadata?.referer) {
  try {
    const url = new URL(item.metadata.referer);
    email = url.searchParams.get('email');
  } catch {
    // ignore malformed referer
  }
}

      const answers = (item.answers ?? []).map((a) => {
        const question = fieldTitles[a.field?.id] ?? a.field?.id ?? 'Unknown';

        let answer = '(no answer)';
        switch (a.type) {
          case 'text':
          case 'long_text':
          case 'short_text':    answer = a.text; break;
          case 'choice':        answer = a.choice?.label ?? a.choice?.other ?? '(no choice)'; break;
          case 'choices':       answer = (a.choices?.labels ?? []).join(', '); break;
          case 'number':
          case 'rating':
          case 'opinion_scale': answer = String(a.number); break;
          case 'boolean':       answer = a.boolean ? 'Yes' : 'No'; break;
          case 'email':
            answer = a.email;
            if (!email) email = a.email;
            break;
          default:
            answer = JSON.stringify(a[a.type] ?? '(unknown)');
        }

        return { question, answer };
      });

      return { email, answers };
    },
    { attempts: 3, delayMs: 1000, label: 'Typeform API fetch' },
  );
}

module.exports = { fetchTypeformResponse };
