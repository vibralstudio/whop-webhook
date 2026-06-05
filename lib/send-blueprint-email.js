const sgMail = require('@sendgrid/mail');
const { withRetry } = require('./retry');
const config = require('./config');

async function sendBlueprintEmail(toEmail, pdfBuffer) {
  sgMail.setApiKey(config.sendgridApiKey);

  return withRetry(
    () =>
      sgMail.send({
        to: toEmail,
        from: config.fromEmail,
        subject: 'Your Personalized Viral Growth Blueprint is ready',
        text: [
          'Your Custom Growth Blueprint has been generated.',
          '',
          'Find it attached to this email as a PDF.',
          '',
          'Take your time reading through it — every recommendation was built specifically around your answers.',
          '',
          'If you have questions, reply to this email.',
          '',
          'Talk soon,',
          'Vibral Studio',
        ].join('\n'),
        html: `
          <p>Your Custom Growth Blueprint has been generated.</p>
          <p>Find it attached to this email as a PDF.</p>
          <p>Take your time reading through it — every recommendation was built specifically around your answers.</p>
          <p>If you have questions, reply to this email.</p>
          <p>Talk soon,<br>Vibral Studio</p>
        `,
        attachments: [
          {
            content: pdfBuffer.toString('base64'),
            filename: 'Vibral-Growth-Blueprint.pdf',
            type: 'application/pdf',
            disposition: 'attachment',
          },
        ],
      }),
    { attempts: 3, delayMs: 1000, label: 'SendGrid blueprint email' },
  );
}

module.exports = { sendBlueprintEmail };
