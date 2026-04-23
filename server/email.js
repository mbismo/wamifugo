'use strict';
const nodemailer = require('nodemailer');

// ── TRANSPORTER ───────────────────────────────────────────────────────────────
// Uses Gmail with an App Password (not your main Gmail password).
// Set up at: https://myaccount.google.com/apppasswords
// Environment variables needed:
//   EMAIL_USER = your.email@gmail.com
//   EMAIL_PASS = 16-character app password (no spaces)

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

// ── SEND RESET CODE ───────────────────────────────────────────────────────────
async function sendResetCode({ toEmail, toName, code, siteUrl }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('⚠ EMAIL_USER / EMAIL_PASS not set — skipping email send');
    // In development, just log the code
    console.log(`[DEV] Reset code for ${toEmail}: ${code}`);
    return true;
  }

  const transporter = createTransporter();
  const siteName = 'Wa-Mifugo Feeds';
  const url = siteUrl || 'https://wamifugo.onrender.com';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8f5ee;">
  <div style="max-width:480px;margin:32px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.1);">
    <div style="background:#3D2B1F;padding:28px 32px;">
      <div style="font-size:32px;margin-bottom:6px;">🌾</div>
      <div style="font-size:22px;font-weight:700;color:white;font-family:Georgia,serif;">${siteName}</div>
      <div style="font-size:11px;color:#C9922A;letter-spacing:2px;text-transform:uppercase;margin-top:4px;">Password Reset</div>
    </div>
    <div style="padding:32px;">
      <p style="color:#5C3D2E;font-size:15px;margin:0 0 8px;">Hello ${toName || 'there'},</p>
      <p style="color:#7A6A55;font-size:14px;line-height:1.6;margin:0 0 24px;">
        Your password reset code is below. It expires in <strong>15 minutes</strong>.
      </p>
      <div style="background:#F2EAD8;border-radius:12px;padding:24px;text-align:center;margin:0 0 24px;">
        <div style="font-family:'Courier New',monospace;font-size:42px;font-weight:700;letter-spacing:14px;color:#3D2B1F;">
          ${code}
        </div>
      </div>
      <p style="color:#7A6A55;font-size:13px;line-height:1.6;margin:0 0 8px;">
        If you did not request this, ignore this email — your password remains unchanged.
      </p>
    </div>
    <div style="background:#F8F5EE;padding:16px 32px;border-top:1px solid #E8E0D4;">
      <a href="${url}" style="color:#C9922A;font-size:12px;text-decoration:none;">${url}</a>
    </div>
  </div>
</body>
</html>`;

  await transporter.sendMail({
    from: `"${siteName}" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: `${siteName} — Your Password Reset Code`,
    html,
  });

  return true;
}

module.exports = { sendResetCode };
