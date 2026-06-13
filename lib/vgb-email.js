const sgMail  = require('@sendgrid/mail');
const config  = require('./config');
const { withRetry } = require('./retry');

const BASE_URL = process.env.BASE_URL || 'https://whop-webhook-production.up.railway.app';

async function sendVGBAccessEmail(email, token) {
  sgMail.setApiKey(config.sendgridApiKey);

  const accessUrl = `${BASE_URL}/vgb/${token}`;

  await withRetry(
    () => sgMail.send({
      to: email,
      from: config.fromEmail,
      subject: 'Your Viral Growth Blueprint is Ready',
      text: [
        'Your Viral Growth Blueprint is live.',
        '',
        `Access it here: ${accessUrl}`,
        '',
        'Bookmark this link — it\'s yours permanently.',
        'The document is updated every Monday with the latest strategies.',
        '',
        'Questions? Reply to this email.',
        '',
        'Vibral Studio',
      ].join('\n'),
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#0A0A08;color:#F0EDE6;padding:40px 32px;">
          <p style="font-size:11px;letter-spacing:0.2em;color:#C8A96E;text-transform:uppercase;margin-bottom:32px;">VIBRAL STUDIO</p>
          <h1 style="font-size:28px;font-weight:800;color:#F0EDE6;margin-bottom:8px;line-height:1.1;">Your Blueprint<br>is live.</h1>
          <p style="color:#888880;font-size:14px;margin-bottom:32px;line-height:1.7;">
            Updated every Monday with what's actually working right now.
          </p>
          <a href="${accessUrl}" style="display:inline-block;padding:16px 32px;background:#C8A96E;color:#0A0A08;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">
            Access My Blueprint →
          </a>
          <p style="color:#888880;font-size:12px;margin-top:24px;">Bookmark this link — it's yours permanently.</p>
          <p style="color:#555;font-size:11px;margin-top:32px;border-top:1px solid #2A2A28;padding-top:20px;">
            Questions? Reply to this email · contact@vibralstudio.com
          </p>
        </div>
      `,
    }),
    { attempts: 3, delayMs: 1000, label: 'VGB access email' },
  );
}

async function sendApprovalEmail(adminEmail, weekLabel, approveUrl) {
  sgMail.setApiKey(config.sendgridApiKey);

  await withRetry(
    () => sgMail.send({
      to: adminEmail,
      from: config.fromEmail,
      subject: `VGB Weekly Draft Ready — ${weekLabel}`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#0A0A08;color:#F0EDE6;padding:40px 32px;">
          <p style="font-size:11px;letter-spacing:0.2em;color:#C8A96E;text-transform:uppercase;margin-bottom:32px;">VIBRAL STUDIO · ADMIN</p>
          <h1 style="font-size:24px;font-weight:800;color:#F0EDE6;margin-bottom:16px;">Weekly VGB Draft Ready</h1>
          <p style="color:#888880;font-size:14px;margin-bottom:32px;line-height:1.7;">
            The weekly update for <strong style="color:#F0EDE6;">${weekLabel}</strong> is ready for your review.
            Click below to preview and publish it to all subscribers.
          </p>
          <a href="${approveUrl}" style="display:inline-block;padding:16px 32px;background:#C8A96E;color:#0A0A08;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;">
            Review & Publish →
          </a>
          <p style="color:#555;font-size:11px;margin-top:32px;border-top:1px solid #2A2A28;padding-top:20px;">
            This email was sent automatically every Monday.
          </p>
        </div>
      `,
    }),
    { attempts: 3, delayMs: 1000, label: 'VGB approval email' },
  );
}

module.exports = { sendVGBAccessEmail, sendApprovalEmail };
