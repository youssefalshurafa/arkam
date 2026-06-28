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

// Shared send pipeline: Resend → SMTP → console fallback (dev). Used by the
// access-approval emails below.
async function sendEmail({ to, subject, html, text, logLabel }) {
    const from = process.env.EMAIL_FROM || 'Arkam <onboarding@resend.dev>';

    if (isResendConfigured()) {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const { error } = await resend.emails.send({ from, to, subject, html, text });
        if (error) {
            console.error('[Resend] Failed to send email:', error);
            throw new Error(`Email send failed: ${error.message || JSON.stringify(error)}`);
        }
        return;
    }

    if (isSmtpConfigured()) {
        const transporter = getSmtpTransporter();
        await transporter.sendMail({ from, to, subject, text, html });
        return;
    }

    console.log(`\n--- ${logLabel || 'EMAIL'} (no email provider configured) ---`);
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text);
    console.log('---------------------------------------------------------\n');
}

// Branded wrapper matching the verification/reset emails (blue header card).
function buildBrandedHtml({ heading, bodyHtml }) {
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
              <p style="margin:0 0 16px;font-size:22px;font-weight:600;color:#111827;">${heading}</p>
              ${bodyHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Sent to the super admin when a new user submits a payment/access request.
async function sendAccessRequestNotification({ to, requesterName, requesterEmail, plan, amount, reviewUrl }) {
    const subject = 'New access request — Arkam';
    const text = `New access request from ${requesterName} (${requesterEmail}).\nPlan: ${plan}\nAmount: ${amount}\n\nReview it here: ${reviewUrl}`;
    const html = buildBrandedHtml({
        heading: 'New access request',
        bodyHtml: `
            <p style="margin:0 0 8px;font-size:14px;color:#374151;"><strong>${requesterName}</strong> (${requesterEmail}) requested access and submitted a payment.</p>
            <p style="margin:0 0 4px;font-size:14px;color:#6b7280;">Plan: <strong style="color:#111827;">${plan}</strong></p>
            <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Amount: <strong style="color:#111827;">${amount}</strong></p>
            <a href="${reviewUrl}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;">Review request</a>
            <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">Open the admin panel to view the payment screenshot and approve or reject.</p>
        `,
    });
    await sendEmail({ to, subject, html, text, logLabel: 'ACCESS REQUEST NOTIFICATION' });
}

// Sent to the user when the super admin approves their request.
async function sendAccessApprovedEmail({ to, name, loginUrl }) {
    const subject = 'Your Arkam access is approved 🎉';
    const text = `Hi ${name},\n\nGood news — your access request has been approved. You can now sign in and start using Arkam:\n\n${loginUrl}`;
    const html = buildBrandedHtml({
        heading: 'Access approved',
        bodyHtml: `
            <p style="margin:0 0 24px;font-size:14px;color:#374151;">Hi ${name}, your access request has been approved. You can now sign in and start using Arkam.</p>
            <a href="${loginUrl}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;">Sign in</a>
        `,
    });
    await sendEmail({ to, subject, html, text, logLabel: 'ACCESS APPROVED' });
}

// Sent to a newly invited teammate with a link to set their password and join.
async function sendWorkspaceInviteEmail({ to, name, inviterName, workspaceName, inviteUrl }) {
    const subject = `You're invited to Arkam`;
    const who = inviterName ? `${inviterName}` : 'A teammate';
    const ws = workspaceName ? ` "${workspaceName}"` : '';
    const text = `Hi ${name || ''},\n\n${who} invited you to join their Arkam workspace${ws}. Click the link below to set your password and get started:\n\n${inviteUrl}\n\nThis invite link expires in 7 days.`;
    const html = buildBrandedHtml({
        heading: "You're invited to Arkam",
        bodyHtml: `
            <p style="margin:0 0 24px;font-size:14px;color:#374151;">${who} invited you to join their Arkam workspace${ws ? ` <strong>${ws.trim().replace(/^"|"$/g, '')}</strong>` : ''}. Set your password to get started.</p>
            <a href="${inviteUrl}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;">Set my password</a>
            <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">This invite link expires in 7 days. If you weren't expecting this, you can ignore this email.</p>
        `,
    });
    await sendEmail({ to, subject, html, text, logLabel: 'WORKSPACE INVITE' });
}

// Sent to the user when the super admin rejects their request.
async function sendAccessRejectedEmail({ to, name, note }) {
    const subject = 'Update on your Arkam access request';
    const reason = note ? `\n\nReason: ${note}` : '';
    const text = `Hi ${name},\n\nUnfortunately your access request was not approved.${reason}\n\nIf you think this is a mistake, please reply to this email.`;
    const html = buildBrandedHtml({
        heading: 'Access request update',
        bodyHtml: `
            <p style="margin:0 0 ${note ? '8px' : '24px'};font-size:14px;color:#374151;">Hi ${name}, unfortunately your access request was not approved.</p>
            ${note ? `<p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Reason: <span style="color:#111827;">${note}</span></p>` : ''}
            <p style="margin:0;font-size:12px;color:#9ca3af;">If you think this is a mistake, please reply to this email.</p>
        `,
    });
    await sendEmail({ to, subject, html, text, logLabel: 'ACCESS REJECTED' });
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

module.exports = {
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendAccessRequestNotification,
    sendAccessApprovedEmail,
    sendAccessRejectedEmail,
    sendWorkspaceInviteEmail,
};

async function sendPasswordResetEmail({ to, name, resetUrl }) {
    const from = process.env.EMAIL_FROM || 'Arkam <onboarding@resend.dev>';

    const subject = 'Reset your password — Arkam';
    const text = `Hi ${name},\n\nYou requested a password reset. Click the link below to set a new password:\n\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, you can safely ignore this email.`;
    const html = `
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
              <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Reset your password</p>
              <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Hi ${name}, click the button below to set a new password. This link expires in 1 hour.</p>
              <a href="${resetUrl}"
                 style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;">
                Reset password
              </a>
              <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">If you didn't request a password reset, you can safely ignore this email. Your password won't change.</p>
              <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />
              <p style="margin:0;font-size:11px;color:#d1d5db;">Or copy this URL:<br/><span style="color:#6b7280;word-break:break-all;">${resetUrl}</span></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    if (isResendConfigured()) {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const { error } = await resend.emails.send({ from, to, subject, html, text });
        if (error) {
            console.error('[Resend] Failed to send password reset email:', error);
            throw new Error(`Email send failed: ${error.message || JSON.stringify(error)}`);
        }
        return;
    }

    if (isSmtpConfigured()) {
        const transporter = getSmtpTransporter();
        await transporter.sendMail({ from, to, subject, text, html });
        return;
    }

    console.log('\n--- PASSWORD RESET EMAIL (no email provider configured) ---');
    console.log(`To: ${to}`);
    console.log(`Reset URL: ${resetUrl}`);
    console.log('-----------------------------------------------------------\n');
}
