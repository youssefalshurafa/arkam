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

// Every user-controlled value (names, workspace names, admin notes, identifiers) is escaped
// before it goes into an HTML body. They used to be interpolated raw, so an inviter's display
// name or workspace name could inject markup/links into a mail Arkam sends to a third party.
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// URLs go into href attributes; only http(s) links we built ourselves are ever passed, but
// refuse anything else rather than trusting every caller.
function safeUrl(url) {
    const value = String(url || '');
    return /^https?:\/\//i.test(value) ? escapeHtml(value) : '#';
}

// Shared send pipeline: Resend → SMTP → console fallback (dev only).
//
// The console fallback prints the plain-text body, which carries live reset/setup links and
// verification codes. That is useful locally but would leak credentials into production logs,
// so in production with no provider configured the mail is dropped with an error instead.
async function sendEmail({ to, subject, html, text, logLabel }) {
    const from = process.env.EMAIL_FROM || 'Arkam <noreply@arkam.app>';

    if (isResendConfigured()) {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const { error } = await resend.emails.send({ from, to, subject, html, text });
        if (error) {
            console.error('[Resend] Failed to send email:', error.name || error.message || 'unknown error');
            throw new Error(`Email send failed: ${error.message || JSON.stringify(error)}`);
        }
        return;
    }

    if (isSmtpConfigured()) {
        const transporter = getSmtpTransporter();
        await transporter.sendMail({ from, to, subject, text, html });
        return;
    }

    if (process.env.NODE_ENV === 'production') {
        console.error(`[mailer] No email provider configured — dropped "${logLabel || subject}" mail.`);
        throw new Error('Email is not configured.');
    }

    console.log(`\n--- ${logLabel || 'EMAIL'} (no email provider configured — dev only) ---`);
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text);
    console.log('---------------------------------------------------------\n');
}

// Branded wrapper (blue header card). `heading` is escaped here; `bodyHtml` is trusted markup
// built by the functions below, which escape their own interpolations.
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
              <p style="margin:0 0 16px;font-size:22px;font-weight:600;color:#111827;">${escapeHtml(heading)}</p>
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

const P = 'margin:0 0 16px;font-size:14px;color:#374151;';
const P_MUTED = 'margin:24px 0 0;font-size:12px;color:#9ca3af;';
const BUTTON = 'display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;';

function button(url, label) {
    return `<a href="${safeUrl(url)}" style="${BUTTON}">${escapeHtml(label)}</a>`;
}

function codeBlock(code) {
    return `<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;font-family:ui-monospace,Menlo,Consolas,monospace;">${escapeHtml(code)}</p>`;
}

// Sent to the super admin when a new user submits a payment/access request.
async function sendAccessRequestNotification({ to, requesterName, requesterEmail, plan, amount, reviewUrl }) {
    const subject = 'New access request — Arkam';
    const text = `New access request from ${requesterName} (${requesterEmail}).\nPlan: ${plan}\nAmount: ${amount}\n\nReview it here: ${reviewUrl}`;
    const html = buildBrandedHtml({
        heading: 'New access request',
        bodyHtml: `
            <p style="margin:0 0 8px;font-size:14px;color:#374151;"><strong>${escapeHtml(requesterName)}</strong> (${escapeHtml(requesterEmail)}) requested access and submitted a payment.</p>
            <p style="margin:0 0 4px;font-size:14px;color:#6b7280;">Plan: <strong style="color:#111827;">${escapeHtml(plan)}</strong></p>
            <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Amount: <strong style="color:#111827;">${escapeHtml(amount)}</strong></p>
            ${button(reviewUrl, 'Review request')}
            <p style="${P_MUTED}">Open the admin panel to view the payment screenshot and approve or reject.</p>
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
            <p style="margin:0 0 24px;font-size:14px;color:#374151;">Hi ${escapeHtml(name)}, your access request has been approved. You can now sign in and start using Arkam.</p>
            ${button(loginUrl, 'Sign in')}
        `,
    });
    await sendEmail({ to, subject, html, text, logLabel: 'ACCESS APPROVED' });
}

// Sent when an owner/admin invites someone to a workspace. The link opens /invite/[token],
// where the recipient joins with an existing account or creates one.
async function sendWorkspaceInviteEmail({ to, inviterName, workspaceName, inviteUrl }) {
    const subject = `You're invited to Arkam`;
    const who = inviterName || 'A teammate';
    const ws = workspaceName ? ` "${workspaceName}"` : '';
    const text = `${who} invited you to join their Arkam workspace${ws}. Open the link below to accept:\n\n${inviteUrl}\n\nThis invite link expires in 7 days. If you weren't expecting it, you can ignore this email.`;
    const html = buildBrandedHtml({
        heading: "You're invited to Arkam",
        bodyHtml: `
            <p style="margin:0 0 24px;font-size:14px;color:#374151;">${escapeHtml(who)} invited you to join their Arkam workspace${workspaceName ? ` <strong>${escapeHtml(workspaceName)}</strong>` : ''}.</p>
            ${button(inviteUrl, 'Accept invitation')}
            <p style="${P_MUTED}">This invite link expires in 7 days. If you weren't expecting this, you can ignore this email.</p>
        `,
    });
    await sendEmail({ to, subject, html, text, logLabel: 'WORKSPACE INVITE' });
}

// Sent to the super admin when a user files a password reset request. Username-only accounts
// have no email of their own, so the admin must verify identity out-of-band before approving.
async function sendPasswordResetRequestNotification({ to, requesterName, requesterUsername, reviewUrl }) {
    const subject = 'New password reset request — Arkam';
    const text = `${requesterName || requesterUsername} (${requesterUsername}) requested a password reset.\n\nVerify their identity via the trusted contact on file, then review it here: ${reviewUrl}`;
    const html = buildBrandedHtml({
        heading: 'New password reset request',
        bodyHtml: `
            <p style="margin:0 0 8px;font-size:14px;color:#374151;"><strong>${escapeHtml(requesterName || requesterUsername)}</strong> (${escapeHtml(requesterUsername)}) requested a password reset.</p>
            <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Verify their identity by calling the trusted contact on file before approving.</p>
            ${button(reviewUrl, 'Review request')}
        `,
    });
    await sendEmail({ to, subject, html, text, logLabel: 'PASSWORD RESET REQUEST NOTIFICATION' });
}

// Sent to the user when the super admin rejects their request.
async function sendAccessRejectedEmail({ to, name, note }) {
    const subject = 'Update on your Arkam access request';
    const reason = note ? `\n\nReason: ${note}` : '';
    const text = `Hi ${name},\n\nUnfortunately your access request was not approved.${reason}\n\nIf you think this is a mistake, please reply to this email.`;
    const html = buildBrandedHtml({
        heading: 'Access request update',
        bodyHtml: `
            <p style="margin:0 0 ${note ? '8px' : '24px'};font-size:14px;color:#374151;">Hi ${escapeHtml(name)}, unfortunately your access request was not approved.</p>
            ${note ? `<p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Reason: <span style="color:#111827;">${escapeHtml(note)}</span></p>` : ''}
            <p style="margin:0;font-size:12px;color:#9ca3af;">If you think this is a mistake, please reply to this email.</p>
        `,
    });
    await sendEmail({ to, subject, html, text, logLabel: 'ACCESS REJECTED' });
}

async function sendPasswordResetEmail({ to, name, resetUrl }) {
    const subject = 'Reset your password — Arkam';
    const text = `Hi ${name},\n\nYou requested a password reset. Click the link below to set a new password:\n\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, you can safely ignore this email.`;
    const html = buildBrandedHtml({
        heading: 'Reset your password',
        bodyHtml: `
            <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Hi ${escapeHtml(name)}, click the button below to set a new password. This link expires in 1 hour.</p>
            ${button(resetUrl, 'Reset password')}
            <p style="${P_MUTED}">If you didn't request a password reset, you can safely ignore this email. Your password won't change.</p>
            <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />
            <p style="margin:0;font-size:11px;color:#9ca3af;">Or copy this URL:<br/><span style="color:#6b7280;word-break:break-all;">${escapeHtml(resetUrl)}</span></p>
        `,
    });
    await sendEmail({ to, subject, html, text, logLabel: 'PASSWORD RESET EMAIL' });
}

// 6-digit code for signup / email verification / email change. `purpose` only changes copy.
async function sendVerificationCodeEmail({ to, name, code, purpose }) {
    const isChange = purpose === 'email_change';
    const subject = isChange ? 'Confirm your new email — Arkam' : 'Your Arkam verification code';
    const intro = isChange
        ? 'Use this code to confirm your new email address for Arkam:'
        : 'Use this code to verify your email address for Arkam:';
    const text = `Hi ${name || ''},\n\n${intro}\n\n${code}\n\nThe code expires in 10 minutes. If you didn't request it, you can ignore this email.`;
    const html = buildBrandedHtml({
        heading: isChange ? 'Confirm your new email' : 'Verify your email',
        bodyHtml: `
            <p style="${P}">${name ? `Hi ${escapeHtml(name)}, ` : ''}${escapeHtml(intro)}</p>
            ${codeBlock(code)}
            <p style="${P_MUTED}">The code expires in 10 minutes. If you didn't request it, you can ignore this email — nothing changes on your account.</p>
        `,
    });
    await sendEmail({ to, subject, html, text, logLabel: 'VERIFICATION CODE' });
}

// Sent instead of a code when someone tries to sign up with an address that already has an
// account. The signup screen behaves identically either way (no enumeration); only the real
// owner of the inbox learns the account exists.
async function sendAlreadyRegisteredEmail({ to, loginUrl, forgotUrl }) {
    const subject = 'Sign-up attempt on your Arkam account';
    const text = `Someone (hopefully you) tried to create a new Arkam account with this email address, but an account already exists.\n\nSign in: ${loginUrl}\nForgot your password? ${forgotUrl}\n\nIf this wasn't you, you can ignore this email — your account is unchanged.`;
    const html = buildBrandedHtml({
        heading: 'You already have an account',
        bodyHtml: `
            <p style="${P}">Someone (hopefully you) tried to create a new Arkam account with this email address, but an account already exists.</p>
            <p style="margin:0 0 24px;">${button(loginUrl, 'Sign in')}</p>
            <p style="${P}"><a href="${safeUrl(forgotUrl)}" style="color:#1d4ed8;">Forgot your password?</a></p>
            <p style="${P_MUTED}">If this wasn't you, you can ignore this email — your account is unchanged.</p>
        `,
    });
    await sendEmail({ to, subject, html, text, logLabel: 'ALREADY REGISTERED' });
}

// Generic security notice: password changed, email changed (sent to the OLD address),
// two-factor turned on/off, password removed by a Google link, etc.
async function sendSecurityNoticeEmail({ to, name, heading, message, actionUrl, actionLabel }) {
    const subject = `${heading} — Arkam`;
    const text = `Hi ${name || ''},\n\n${message}\n\n${actionUrl ? `${actionUrl}\n\n` : ''}If this wasn't you, reset your password right away and contact support.`;
    const html = buildBrandedHtml({
        heading,
        bodyHtml: `
            <p style="${P}">${name ? `Hi ${escapeHtml(name)}, ` : ''}${escapeHtml(message)}</p>
            ${actionUrl ? `<p style="margin:0 0 16px;">${button(actionUrl, actionLabel || 'Open Arkam')}</p>` : ''}
            <p style="${P_MUTED}">If this wasn't you, reset your password right away and contact support.</p>
        `,
    });
    await sendEmail({ to, subject, html, text, logLabel: 'SECURITY NOTICE' });
}

module.exports = {
    escapeHtml,
    sendPasswordResetEmail,
    sendAccessRequestNotification,
    sendPasswordResetRequestNotification,
    sendAccessApprovedEmail,
    sendAccessRejectedEmail,
    sendWorkspaceInviteEmail,
    sendVerificationCodeEmail,
    sendAlreadyRegisteredEmail,
    sendSecurityNoticeEmail,
};
