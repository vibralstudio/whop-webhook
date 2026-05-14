const sgMail = require("@sendgrid/mail");

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendBlueprintEmail(toEmail, pdfBuffer) {
  if (!process.env.SENDGRID_API_KEY) throw new Error("SENDGRID_API_KEY not set");
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  await sgMail.send({
    to: toEmail,
    from: "contact@vibralstudio.com",
    subject: "Your Personalized Viral Growth Blueprint is ready",
    text: [
      "Your Custom Growth Blueprint has been generated.",
      "",
      "Find it attached to this email as a PDF.",
      "",
      "Take your time reading through it — every recommendation was built specifically around your answers.",
      "",
      "If you have questions, reply to this email.",
      "",
      "Talk soon,",
      "Vibral Studio",
    ].join("\n"),
    html: `
      <p>Your Custom Growth Blueprint has been generated.</p>
      <p>Find it attached to this email as a PDF.</p>
      <p>Take your time reading through it — every recommendation was built specifically around your answers.</p>
      <p>If you have questions, reply to this email.</p>
      <p>Talk soon,<br>Vibral Studio</p>
    `,
    attachments: [
      {
        content: pdfBuffer.toString("base64"),
        filename: "Vibral-Growth-Blueprint.pdf",
        type: "application/pdf",
        disposition: "attachment",
      },
    ],
  });
}

module.exports = { sendBlueprintEmail };
