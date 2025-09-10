const nodemailer = require('nodemailer');

// Cache transporter between sends
let transporterPromise = null;
let usingEthereal = false;

async function getTransporter() {
  if (transporterPromise) return transporterPromise;

  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    SMTP_SECURE,
  } = process.env;

  if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
    // Real SMTP
    const secure = String(SMTP_SECURE || '').toLowerCase();
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT),
        secure: secure === 'true' || secure === '1',
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      })
    );
    usingEthereal = false;
    return transporterPromise;
  }

  // Dev fallback: Ethereal test account (emails are viewable via preview URL)
  transporterPromise = (async () => {
    const testAccount = await nodemailer.createTestAccount();
    usingEthereal = true;
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
  })();

  return transporterPromise;
}

function appUrl() {
  const raw = process.env.APP_URL || 'http://localhost:5173';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

async function sendPasswordResetEmail({ to, token }) {
  const transporter = await getTransporter();
  const resetLink = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const from = process.env.SMTP_FROM || 'USC Scheduler <no-reply@usc-scheduler.com>';

  const info = await transporter.sendMail({
    from,
    to,
    subject: 'Reset your USC Scheduler password',
    text: `We received a request to reset your password.\n\nClick the link below to choose a new password:\n${resetLink}\n\nIf you did not request this, you can ignore this email.`,
    html: `
      <p>We received a request to reset your password.</p>
      <p><a href="${resetLink}">Click here to reset your password</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
  });

  // For dev with Ethereal, provide a preview URL to help testing
  const previewUrl = (usingEthereal && nodemailer.getTestMessageUrl)
    ? nodemailer.getTestMessageUrl(info)
    : null;

  if (previewUrl) {
    console.log('Password reset email preview URL:', previewUrl);
  }

  return { messageId: info.messageId, previewUrl };
}

module.exports = { sendPasswordResetEmail };
