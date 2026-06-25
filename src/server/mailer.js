/* eslint-disable @typescript-eslint/no-require-imports */
const nodemailer = require('nodemailer');

function isResendConfigured() {
    return Boolean(process.env.RESEND_API_KEY);
}

function isSmtpConfigured() {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getSmtpTransporter() {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
}

async function sendVerificationEmail({ to, name, verificationUrl }) {
    const from = process.env.EMAIL_FROM || 'Arkam <onboarding@resend.dev>';

    if (isResendConfigured()) {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const { error } = await resend.emails.send({
            from,
            to,
            subject: 'Verify your email — Arkam',
            html: buildHtml({ name, verificationUrl }),
            text: buildText({ name, verificationUrl }),
        });
        if (error) {
            console.error('[Resend] Failed to send email:', error);
            throw new Error(`Email send failed: ${error.message || JSON.stringify(error)}`);
        }
        return;
    }

    if (isSmtpConfigured()) {
        const transporter = getSmtpTransporter();
        await transporter.sendMail({
            from,
            to,
            subject: 'Verify your email — Arkam',
            text: buildText({ name, verificationUrl }),
            html: buildHtml({ name, verificationUrl }),
        });
        return;
    }

    // Dev fallback: print to server console
    console.log('\n--- EMAIL VERIFICATION (no email provider configured) ---');
    console.log(`To: ${to}`);
    console.log(`Verify URL: ${verificationUrl}`);
    console.log('---------------------------------------------------------\n');
}

function buildText({ name, verificationUrl }) {
    return `Hi ${name},\n\nClick the link below to verify your email and finish creating your account:\n\n${verificationUrl}\n\nThis link expires in 24 hours.\n\nIf you didn't sign up for Arkam, you can safely ignore this email.`;
}

function buildHtml({ name, verificationUrl }) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
          <tr>
            <td style="background:#1d4ed8;padding:24px 32px;">
              <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:4px;">ARKAM</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Verify your email</p>
              <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Hi ${name}, thanks for signing up. Click the button below to verify your email address and complete your account setup.</p>
              <a href="${verificationUrl}"
                 style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;">
                Verify my email
              </a>
              <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">This link expires in 24 hours. If you didn't create an Arkam account, you can safely ignore this email.</p>
              <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />
              <p style="margin:0;font-size:11px;color:#d1d5db;">Or copy this URL:<br/><span style="color:#6b7280;word-break:break-all;">${verificationUrl}</span></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { sendVerificationEmail };
