const nodemailer = require('nodemailer');

let transporter = null;

async function getTransporter() {
  if (transporter) return transporter;

  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    SMTP_SECURE
  } = process.env;

  if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: String(SMTP_SECURE || '').toLowerCase() === 'true' || Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    return transporter;
  }

  // Development fallback: Ethereal test account
  const testAccount = await nodemailer.createTestAccount();
  transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: { user: testAccount.user, pass: testAccount.pass }
  });
  return transporter;
}

async function sendPasswordResetEmail(to, resetLink) {
  const transporter = await getTransporter();

  const appName = process.env.APP_NAME || 'USC Scheduler';
  const from = process.env.MAIL_FROM || `${appName} <no-reply@usc-scheduler.com>`;

  const info = await transporter.sendMail({
    from,
    to,
    subject: `${appName} – Reset your password`,
    text: `We received a request to reset your password. Click the link below to set a new password. If you did not request this, you can ignore this email.\n\n${resetLink}\n\nThis link expires in 15 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; max-width: 600px;">
        <h2 style="margin-bottom: 16px;">Reset your password</h2>
        <p>We received a request to reset your password. Click the button below to set a new password.</p>
        <p>If you did not request this, you can safely ignore this email.</p>
        <p style="margin: 24px 0;">
          <a href="${resetLink}"
             style="background:#990000;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;display:inline-block;">
             Reset Password
          </a>
        </p>
        <p>Or copy and paste this link into your browser:</p>
        <p><a href="${resetLink}">${resetLink}</a></p>
        <p style="color:#666; font-size: 12px;">This link expires in 15 minutes.</p>
      </div>
    `
  });

  // Log preview URL for dev (Ethereal)
  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) {
    console.log('Password reset email preview URL:', preview);
  }

  return info;
}

module.exports = { sendPasswordResetEmail };
