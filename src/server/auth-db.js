/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('node:crypto');
const { getPool, ensurePublicSchema, withTransaction } = require('@/server/postgres');
const { validatePassword, hashPassword, verifyPassword, needsRehash, burnPasswordCheck } = require('@/server/passwords');

// Keep in sync with TRIAL_DURATION_DAYS in src/config/plan.ts.
const TRIAL_DURATION_DAYS = 14;

async function runQuery(text, params = [], executor = getPool()) {
    return executor.query(text, params);
}

async function fetchOne(text, params = [], executor = getPool()) {
    const result = await runQuery(text, params, executor);
    return result.rows[0] || null;
}

async function openAuthDb() {
    await ensurePublicSchema();
    return getPool();
}

function generateId() {
    return crypto.randomUUID();
}

function slugify(name) {
    const base = String(name || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'workspace';

    return base;
}

async function reserveWorkspaceSlug(executor, preferredName) {
    const base = slugify(preferredName);
    let candidate = base;
    let suffix = 1;

    while (await fetchOne('SELECT 1 FROM workspaces WHERE slug = $1 LIMIT 1', [candidate], executor)) {
        suffix += 1;
        candidate = `${base}-${suffix}`;
    }

    return candidate;
}

async function createWorkspaceForUserWithExecutor(executor, userId, workspaceName) {
    const workspaceId = generateId();
    const slug = await reserveWorkspaceSlug(executor, workspaceName);

    await runQuery(
        'INSERT INTO workspaces (id, name, owner_user_id, slug) VALUES ($1, $2, $3, $4)',
        [workspaceId, workspaceName, userId, slug],
        executor,
    );
    await runQuery(
        'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
        [workspaceId, userId, 'owner'],
        executor,
    );

    return { id: workspaceId, name: workspaceName, slug };
}

async function createWorkspaceForUser(userId, workspaceName) {
    await ensurePublicSchema();
    return withTransaction((client) => createWorkspaceForUserWithExecutor(client, userId, workspaceName));
}

async function ensureUserHasWorkspace(userId, preferredName) {
    await ensurePublicSchema();

    const membership = await fetchOne(
        'SELECT workspace_id AS "workspaceId" FROM workspace_members WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
        [userId],
    );

    if (membership?.workspaceId) {
        return membership.workspaceId;
    }

    const workspace = await createWorkspaceForUser(userId, preferredName || 'My Workspace');
    return workspace.id;
}

// Self-service signup lives in src/server/email-verification.js: the account is only created
// once the emailed code is confirmed (startSignup -> completeSignup).

const USER_AUTH_COLUMNS = `
    id, email, name, image, status,
    subscription_ends_at AS "subscriptionEndsAt",
    session_version AS "sessionVersion",
    password_hash AS "passwordHash",
    email_verified_at AS "emailVerifiedAt",
    google_sub AS "googleSub",
    mfa_enabled_at AS "mfaEnabledAt"`;

function toAuthUser(row) {
    return {
        id: row.id,
        email: row.email,
        name: row.name,
        image: row.image || null,
        status: row.status || 'approved',
        subscriptionEndsAt: row.subscriptionEndsAt || null,
        sessionVersion: Number(row.sessionVersion) || 0,
        mfaEnabled: Boolean(row.mfaEnabledAt),
    };
}

// Resolves (or creates) the Arkam account for a Google sign-in. Replaces the old
// upsertOAuthUser, which matched purely on email and so handed a Google login to whoever had
// pre-registered that address with a password.
//
// Decision table:
//   1. Google says the email isn't verified          -> refuse (GOOGLE_EMAIL_UNVERIFIED).
//   2. An account already carries this google_sub    -> that account.
//   3. An account has this email:
//      a. it is linked to a DIFFERENT Google account -> refuse (GOOGLE_ACCOUNT_CONFLICT).
//      b. it has a password but its email was never verified -> Google just proved who owns
//         the address, the password holder hasn't. Link it, mark verified, and CLEAR the
//         password + bump session_version so a squatter is evicted (the real owner can set a
//         new password via the emailed reset link). The caller notifies the owner by email.
//      c. otherwise (verified email, or a passwordless legacy Google row) -> link it.
//   4. No match -> new account (verified email, trial window, own workspace).
async function resolveGoogleUser({ sub, email, emailVerified, name, image }) {
    await ensurePublicSchema();

    const googleSub = String(sub || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!googleSub || !normalizedEmail) {
        throw new Error('Google account email is missing.');
    }
    if (emailVerified !== true) {
        return { error: 'GOOGLE_EMAIL_UNVERIFIED' };
    }

    const displayName = String(name || normalizedEmail.split('@')[0] || 'User').trim();

    const bySub = await fetchOne(`SELECT ${USER_AUTH_COLUMNS} FROM users WHERE google_sub = $1`, [googleSub]);
    if (bySub) {
        await runQuery('UPDATE users SET image = COALESCE($1, image) WHERE id = $2', [image || null, bySub.id]);
        await ensureUserHasWorkspace(bySub.id, `${bySub.name || 'My'} Workspace`);
        return { user: toAuthUser(bySub) };
    }

    const byEmail = await fetchOne(`SELECT ${USER_AUTH_COLUMNS} FROM users WHERE email = $1`, [normalizedEmail]);
    if (byEmail) {
        if (byEmail.googleSub && byEmail.googleSub !== googleSub) {
            return { error: 'GOOGLE_ACCOUNT_CONFLICT' };
        }

        const evictPassword = Boolean(byEmail.passwordHash) && !byEmail.emailVerifiedAt;
        const updated = await fetchOne(
            `UPDATE users
                SET google_sub = $1,
                    email_verified_at = COALESCE(email_verified_at, NOW()),
                    image = COALESCE($2, image),
                    password_hash = CASE WHEN $3::boolean THEN NULL ELSE password_hash END,
                    session_version = CASE WHEN $3::boolean THEN session_version + 1 ELSE session_version END
              WHERE id = $4
          RETURNING ${USER_AUTH_COLUMNS}`,
            [googleSub, image || null, evictPassword, byEmail.id],
        );
        await ensureUserHasWorkspace(byEmail.id, `${byEmail.name || 'My'} Workspace`);
        return { user: toAuthUser(updated), passwordEvicted: evictPassword };
    }

    const userId = generateId();
    // Brand-new Google sign-ups get the same free trial window as a direct signup.
    const trialStartedAt = new Date();
    const trialEndsAt = new Date(trialStartedAt.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

    await withTransaction(async (client) => {
        await runQuery(
            `INSERT INTO users (id, email, name, image, google_sub, email_verified_at, subscription_started_at, subscription_ends_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)`,
            [userId, normalizedEmail, displayName, image || null, googleSub, trialStartedAt.toISOString(), trialEndsAt.toISOString()],
            client,
        );
        await createWorkspaceForUserWithExecutor(client, userId, `${displayName} Workspace`);
    });

    return {
        user: {
            id: userId,
            email: normalizedEmail,
            name: displayName,
            image: image || null,
            status: 'approved',
            subscriptionEndsAt: trialEndsAt.toISOString(),
            sessionVersion: 0,
            mfaEnabled: false,
        },
        isNewUser: true,
    };
}

// Only for server-side re-authentication checks; never returned to a client.
async function getPasswordHash(userId) {
    await ensurePublicSchema();
    const row = await fetchOne('SELECT password_hash AS "passwordHash" FROM users WHERE id = $1', [String(userId || '')]);
    return row?.passwordHash || null;
}

async function getAuthUserById(userId) {
    await ensurePublicSchema();
    const row = await fetchOne(`SELECT ${USER_AUTH_COLUMNS} FROM users WHERE id = $1`, [String(userId || '')]);
    return row ? toAuthUser(row) : null;
}

// The jwt callback's lookup after a Google sign-in (resolveGoogleUser already ran in the
// signIn callback and stamped google_sub, so this is a single indexed read).
async function getUserByGoogleSub(sub) {
    await ensurePublicSchema();
    const row = await fetchOne(`SELECT ${USER_AUTH_COLUMNS} FROM users WHERE google_sub = $1`, [String(sub || '')]);
    return row ? toAuthUser(row) : null;
}

// Everything the jwt callback needs to (a) refresh the DB-derived claims and (b) decide
// whether the session is still valid, in ONE round-trip. Returns null when the user row is
// gone (deleted account), which the caller treats as a revoked session.
async function getSessionClaims(userId) {
    await ensurePublicSchema();
    return fetchOne(
        `SELECT u.email,
                u.name,
                u.status,
                u.subscription_ends_at AS "subscriptionEndsAt",
                u.session_version AS "sessionVersion",
                u.ai_enabled AS "aiEnabled",
                (SELECT wm.workspace_id FROM workspace_members wm
                  WHERE wm.user_id = u.id ORDER BY wm.created_at ASC LIMIT 1) AS "defaultWorkspaceId"
           FROM users u
          WHERE u.id = $1`,
        [userId],
    );
}

// Revokes every outstanding session for the user (see users.session_version). Returns the
// new version so the caller's own device can re-mint its token with it.
async function bumpSessionVersion(userId, executor) {
    const row = await fetchOne(
        'UPDATE users SET session_version = session_version + 1 WHERE id = $1 RETURNING session_version AS "sessionVersion"',
        [userId],
        executor,
    );
    return Number(row?.sessionVersion) || 0;
}

async function recordSuccessfulLogin(userId) {
    try {
        await runQuery('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
    } catch {}
}

async function verifyCredentials({ email, password }) {
    await ensurePublicSchema();

    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !password) {
        return null;
    }

    const user = await fetchOne(`SELECT ${USER_AUTH_COLUMNS} FROM users WHERE email = $1`, [normalizedEmail]);

    if (!user?.passwordHash) {
        // Same bcrypt cost as a real check, so "no such account" isn't measurably faster.
        await burnPasswordCheck(password);
        return null;
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
        return null;
    }

    if (needsRehash(user.passwordHash)) {
        try {
            const upgraded = await hashPassword(password);
            await runQuery('UPDATE users SET password_hash = $1 WHERE id = $2 AND password_hash = $3', [upgraded, user.id, user.passwordHash]);
        } catch {}
    }

    return toAuthUser(user);
}

async function listUserWorkspaces(userId) {
    await ensurePublicSchema();

    const result = await runQuery(
        `
            SELECT
                w.id,
                w.name,
                w.slug,
                wm.role,
                w.owner_user_id AS "ownerUserId",
                w.created_at AS "createdAt"
            FROM workspace_members wm
            JOIN workspaces w ON w.id = wm.workspace_id
            WHERE wm.user_id = $1
            ORDER BY w.created_at ASC
        `,
        [userId],
    );

    return result.rows;
}

async function getDefaultWorkspaceIdByUserId(userId) {
    await ensurePublicSchema();

    const row = await fetchOne(
        'SELECT workspace_id AS "workspaceId" FROM workspace_members WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
        [userId],
    );

    return row?.workspaceId || null;
}

// Read on (most) session refreshes via the jwt callback (auth-options.ts), same as
// getDefaultWorkspaceIdByUserId above — so an admin's change here reaches an already-signed-in
// user without forcing a re-login, just not perfectly instantly.
// Resolves a batch of user ids to display names, for attributing audit-trail entries.
// Batched (= ANY) rather than one query per row, since a transaction's history can hold many
// entries from a handful of distinct users.
//
// Returns a plain id -> { name, email } object. Ids with no matching row are simply absent:
// a user's login can be deleted while their audit records live on (audit columns are
// deliberately not foreign keys, see the workspace schema DDL), and the caller must render
// those as unknown rather than inventing a name.
async function getUserDisplayNamesByIds(userIds) {
    const ids = [...new Set((userIds || []).filter((id) => typeof id === 'string' && id.length > 0))];
    if (ids.length === 0) {
        return {};
    }

    await ensurePublicSchema();

    const result = await runQuery('SELECT id, name, email FROM users WHERE id = ANY($1::text[])', [ids]);

    const byId = {};
    for (const row of result.rows) {
        byId[row.id] = { name: row.name, email: row.email };
    }
    return byId;
}

async function getUserAiEnabled(userId) {
    await ensurePublicSchema();

    const row = await fetchOne('SELECT ai_enabled AS "aiEnabled" FROM users WHERE id = $1', [userId]);

    return row?.aiEnabled === true;
}

// Super-admin-only: grants/revokes a user's access to the in-app AI features.
async function updateUserAiEnabled({ userId, aiEnabled }) {
    await ensurePublicSchema();

    const user = await fetchOne('SELECT id FROM users WHERE id = $1', [userId]);
    if (!user) {
        throw new Error('User not found.');
    }

    await runQuery('UPDATE users SET ai_enabled = $1 WHERE id = $2', [aiEnabled === true, userId]);
    return { ok: true, aiEnabled: aiEnabled === true };
}

async function getWorkspaceRole(userId, workspaceId) {
    await ensurePublicSchema();

    const row = await fetchOne('SELECT role FROM workspace_members WHERE user_id = $1 AND workspace_id = $2 LIMIT 1', [userId, workspaceId]);
    return row?.role || null;
}

async function assertWorkspaceAccess(userId, workspaceId) {
    const role = await getWorkspaceRole(userId, workspaceId);
    if (!role) {
        throw new Error('You do not have access to this workspace.');
    }

    return role;
}

// Read the last-backup marker for a workspace (shared across all devices).
async function getWorkspaceBackupInfo(workspaceId) {
    await ensurePublicSchema();

    const row = await fetchOne('SELECT last_backup_at, last_backup_device FROM workspaces WHERE id = $1 LIMIT 1', [workspaceId]);
    return {
        lastBackupAt: row?.last_backup_at ? new Date(row.last_backup_at).toISOString() : null,
        lastBackupDevice: row?.last_backup_device || null,
    };
}

// Stamp the workspace with the current time and the device the backup came from.
async function recordWorkspaceBackup(workspaceId, device) {
    await ensurePublicSchema();

    const now = new Date().toISOString();
    const deviceLabel = String(device || '').trim().slice(0, 120) || null;
    await runQuery('UPDATE workspaces SET last_backup_at = $1, last_backup_device = $2 WHERE id = $3', [now, deviceLabel, workspaceId]);
    return { lastBackupAt: now, lastBackupDevice: deviceLabel };
}

async function createWorkspace(ownerUserId, name) {
    const workspaceName = String(name || '').trim();
    if (!workspaceName) {
        throw new Error('Workspace name is required.');
    }

    return createWorkspaceForUser(ownerUserId, workspaceName);
}

async function renameWorkspace({ workspaceId, name, actorUserId }) {
    await ensurePublicSchema();

    const workspaceName = String(name || '').trim();
    if (!workspaceName) {
        throw new Error('Workspace name is required.');
    }

    const role = await assertWorkspaceAccess(actorUserId, workspaceId);
    if (role !== 'owner') {
        throw new Error('Only the workspace owner can rename it.');
    }

    await runQuery('UPDATE workspaces SET name = $1 WHERE id = $2', [workspaceName, workspaceId]);
    return { id: workspaceId, name: workspaceName };
}

async function deleteWorkspace({ workspaceId, actorUserId }) {
    await ensurePublicSchema();

    const role = await assertWorkspaceAccess(actorUserId, workspaceId);
    if (role !== 'owner') {
        throw new Error('Only the workspace owner can delete it.');
    }

    const membershipCount = await fetchOne('SELECT COUNT(*)::int AS count FROM workspace_members WHERE user_id = $1', [actorUserId]);
    if ((membershipCount?.count || 0) <= 1) {
        throw new Error('You cannot delete your only workspace.');
    }

    await runQuery('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
    return { id: workspaceId };
}

async function listWorkspaceMembers({ workspaceId, userId }) {
    await ensurePublicSchema();
    await assertWorkspaceAccess(userId, workspaceId);

    const result = await runQuery(
        `
            SELECT
                u.id,
                u.email,
                u.name,
                u.image,
                wm.role,
                wm.created_at AS "addedAt",
                (u.password_hash IS NULL AND u.google_sub IS NULL AND u.image IS NULL) AS "setupPending"
            FROM workspace_members wm
            JOIN users u ON u.id = wm.user_id
            WHERE wm.workspace_id = $1
            ORDER BY
                CASE wm.role
                    WHEN 'owner' THEN 1
                    WHEN 'admin' THEN 2
                    WHEN 'member' THEN 3
                    ELSE 4
                END,
                LOWER(u.name) ASC
        `,
        [workspaceId],
    );

    return result.rows;
}

// --- Workspace invitations ---------------------------------------------------------------
//
// Joining a workspace now always goes through a single-use invitation link the owner/admin
// shares (copied, and also emailed when the invitee is an email address). The old flow
// created approved, never-expiring, passwordless accounts for arbitrary identifiers, silently
// added EXISTING users without their consent, minted password-reset tokens for their logins,
// and told the inviter whether the identifier existed. None of that survives:
//   * no users row is created on anyone's behalf;
//   * the response is identical whatever the identifier is;
//   * the invitee accepts explicitly — signed in as an existing account, or by creating one.

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_ROLES = ['admin', 'member', 'viewer'];

async function assertCanManageMembers(actorUserId, workspaceId) {
    const actorRole = await assertWorkspaceAccess(actorUserId, workspaceId);
    if (!['owner', 'admin'].includes(actorRole)) {
        throw new Error('Only owners and admins can invite members.');
    }
    return actorRole;
}

async function createWorkspaceInvitation({ workspaceId, invitedByUserId, identifier, name, role }) {
    await ensurePublicSchema();
    await assertCanManageMembers(invitedByUserId, workspaceId);

    const normalizedRole = String(role || 'member').trim().toLowerCase();
    if (!INVITE_ROLES.includes(normalizedRole)) {
        throw new Error('Role must be one of: admin, member, viewer.');
    }
    const normalizedIdentifier = String(identifier || '').trim().toLowerCase().slice(0, 254) || null;
    const displayName = String(name || '').trim().slice(0, 120) || null;

    const rawToken = crypto.randomBytes(32).toString('hex');
    const id = generateId();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString();
    await runQuery(
        `INSERT INTO workspace_invitations (id, workspace_id, token_hash, role, invited_identifier, invited_name, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, workspaceId, hashResetToken(rawToken), normalizedRole, normalizedIdentifier, displayName, invitedByUserId, expiresAt],
    );

    const workspace = await fetchOne('SELECT name FROM workspaces WHERE id = $1', [workspaceId]);
    const inviter = await fetchOne('SELECT name FROM users WHERE id = $1', [invitedByUserId]);
    return {
        id,
        rawToken,
        expiresAt,
        role: normalizedRole,
        identifier: normalizedIdentifier,
        workspaceName: workspace?.name || '',
        inviterName: inviter?.name || '',
        emailable: Boolean(normalizedIdentifier && EMAILABLE_IDENTIFIER_RE.test(normalizedIdentifier)),
    };
}

async function listWorkspaceInvitations({ workspaceId, userId }) {
    await ensurePublicSchema();
    await assertCanManageMembers(userId, workspaceId);
    const result = await runQuery(
        `SELECT i.id, i.role, i.invited_identifier AS "identifier", i.invited_name AS "name",
                i.created_at AS "createdAt", i.expires_at AS "expiresAt", u.name AS "invitedByName"
           FROM workspace_invitations i
           LEFT JOIN users u ON u.id = i.invited_by
          WHERE i.workspace_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > NOW()
          ORDER BY i.created_at DESC`,
        [workspaceId],
    );
    return result.rows;
}

async function revokeWorkspaceInvitation({ workspaceId, invitationId, actorUserId }) {
    await ensurePublicSchema();
    await assertCanManageMembers(actorUserId, workspaceId);
    await runQuery(
        'UPDATE workspace_invitations SET revoked_at = NOW() WHERE id = $1 AND workspace_id = $2 AND accepted_at IS NULL',
        [invitationId, workspaceId],
    );
    return { ok: true };
}

// Public read for the /invite/[token] page. Only what the invitee needs to decide.
async function getInvitationByToken(rawToken) {
    await ensurePublicSchema();
    const row = await fetchOne(
        `SELECT i.id, i.workspace_id AS "workspaceId", i.role, i.invited_identifier AS "identifier",
                i.accepted_at AS "acceptedAt", i.revoked_at AS "revokedAt", (i.expires_at <= NOW()) AS expired,
                w.name AS "workspaceName", u.name AS "inviterName"
           FROM workspace_invitations i
           JOIN workspaces w ON w.id = i.workspace_id
           LEFT JOIN users u ON u.id = i.invited_by
          WHERE i.token_hash = $1`,
        [hashResetToken(rawToken)],
    );
    if (!row) return { status: 'invalid' };
    const status = row.revokedAt ? 'revoked' : row.acceptedAt ? 'used' : row.expired ? 'expired' : 'valid';
    return {
        status,
        workspaceId: status === 'valid' ? row.workspaceId : undefined,
        workspaceName: row.workspaceName,
        inviterName: row.inviterName || '',
        role: row.role,
        identifier: row.identifier || null,
        emailable: Boolean(row.identifier && EMAILABLE_IDENTIFIER_RE.test(row.identifier)),
    };
}

// Atomically claims an invitation inside `client`'s transaction; throws if it is not usable.
async function claimInvitation(client, rawToken, userId) {
    const claimed = await fetchOne(
        `UPDATE workspace_invitations
            SET accepted_at = NOW(), accepted_by = $2
          WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
      RETURNING id, workspace_id AS "workspaceId", role`,
        [hashResetToken(rawToken), userId],
        client,
    );
    if (!claimed) {
        throw new Error('This invitation link is invalid, expired, or has already been used.');
    }
    return claimed;
}

// Signed-in user accepts an invitation. Existing members keep their current role (an invite
// is never a way to change someone's role, least of all the owner's).
async function acceptWorkspaceInvitation({ rawToken, userId }) {
    await ensurePublicSchema();
    return withTransaction(async (client) => {
        const invitation = await claimInvitation(client, rawToken, userId);
        await runQuery(
            `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)
             ON CONFLICT (workspace_id, user_id) DO NOTHING`,
            [invitation.workspaceId, userId, invitation.role],
            client,
        );
        return { workspaceId: invitation.workspaceId, role: invitation.role };
    });
}

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

// Invite-only account creation with a plain USERNAME (no email): for teammates who have no
// inbox. The owner's single-use invitation link is the authorization; there is no address to
// verify. Such accounts have no own workspace and no subscription of their own — their access
// follows the inviting workspace owner's subscription (see getWorkspaceAccess).
async function createAccountFromInvitation({ rawToken, username, name, password, phone }) {
    await ensurePublicSchema();
    const normalizedUsername = String(username || '').trim().toLowerCase();
    if (!USERNAME_RE.test(normalizedUsername)) {
        throw new Error('Usernames are 3–32 characters: letters, numbers, dot, dash or underscore.');
    }
    validatePassword(password, { identifier: normalizedUsername });
    const passwordHash = await hashPassword(password);
    const displayName = String(name || '').trim().slice(0, 120) || normalizedUsername;
    const phoneDigits = String(phone || '').replace(/\D/g, '');

    return withTransaction(async (client) => {
        const taken = await fetchOne('SELECT id FROM users WHERE email = $1', [normalizedUsername], client);
        if (taken) {
            throw new Error('This username is already taken.');
        }
        const userId = generateId();
        const invitation = await claimInvitation(client, rawToken, userId);
        await runQuery(
            `INSERT INTO users (id, email, name, password_hash, status, phone) VALUES ($1, $2, $3, $4, 'approved', $5)`,
            [userId, normalizedUsername, displayName, passwordHash, phoneDigits ? `+${phoneDigits}` : ''],
            client,
        );
        await runQuery('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)', [invitation.workspaceId, userId, invitation.role], client);
        return { userId, username: normalizedUsername, workspaceId: invitation.workspaceId };
    });
}

// Legacy teammates created by the old invite flow may still have no password. An owner/admin
// can hand them a one-time setup link — but only for accounts that are exclusively this
// workspace's teammate (no password, no Google login, no other memberships, no own
// workspace), so this can never be pointed at someone else's real account.
async function createMemberSetupLink({ workspaceId, targetUserId, actorUserId }) {
    await ensurePublicSchema();
    await assertCanManageMembers(actorUserId, workspaceId);
    const target = await fetchOne(
        `SELECT u.id,
                (u.password_hash IS NULL AND u.google_sub IS NULL AND u.image IS NULL) AS "setupPending",
                (SELECT COUNT(*)::int FROM workspace_members m WHERE m.user_id = u.id) AS memberships,
                (SELECT COUNT(*)::int FROM workspaces w WHERE w.owner_user_id = u.id) AS owned,
                EXISTS (SELECT 1 FROM workspace_members m WHERE m.user_id = u.id AND m.workspace_id = $2) AS "isMember"
           FROM users u WHERE u.id = $1`,
        [targetUserId, workspaceId],
    );
    if (!target?.isMember || !target.setupPending || target.memberships !== 1 || target.owned !== 0) {
        throw new Error('A setup link can only be created for a teammate who has not set a password yet.');
    }
    const { rawToken } = await mintPasswordToken(targetUserId, { purpose: 'setup' });
    return { setupToken: rawToken };
}

// Workspace access check used by the data APIs: membership role AND whether the workspace
// owner's subscription is live. Teammates have no subscription of their own, so without the
// second half an expired trial could be kept alive forever by inviting a second login.
async function getWorkspaceAccess(userId, workspaceId) {
    await ensurePublicSchema();
    const row = await fetchOne(
        `SELECT wm.role,
                o.id AS "ownerId",
                o.name AS "ownerName",
                o.status AS "ownerStatus",
                o.subscription_ends_at AS "ownerEndsAt"
           FROM workspace_members wm
           JOIN workspaces w ON w.id = wm.workspace_id
           JOIN users o ON o.id = w.owner_user_id
          WHERE wm.user_id = $1 AND wm.workspace_id = $2
          LIMIT 1`,
        [userId, workspaceId],
    );
    if (!row) return null;
    const ownerExpired = Boolean(row.ownerEndsAt) && new Date(row.ownerEndsAt).getTime() < Date.now();
    const ownerBlocked = row.ownerStatus === 'rejected' || row.ownerStatus === 'pending';
    return {
        role: row.role,
        ownerId: row.ownerId,
        ownerName: row.ownerName || '',
        ownerActive: !ownerExpired && !ownerBlocked,
    };
}

async function updateWorkspaceMemberRole({ workspaceId, targetUserId, role, actorUserId }) {
    await ensurePublicSchema();

    const normalizedRole = String(role || '').trim().toLowerCase();
    if (!['admin', 'member', 'viewer'].includes(normalizedRole)) {
        throw new Error('Role must be one of: admin, member, viewer.');
    }

    const actorRole = await assertWorkspaceAccess(actorUserId, workspaceId);
    if (!['owner', 'admin'].includes(actorRole)) {
        throw new Error('Only owners and admins can change member roles.');
    }
    if (targetUserId === actorUserId) {
        throw new Error('You cannot change your own role.');
    }

    const target = await fetchOne('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, targetUserId]);
    if (!target) {
        throw new Error('Member not found.');
    }
    if (target.role === 'owner') {
        throw new Error('The workspace owner cannot be changed.');
    }

    await runQuery('UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND user_id = $3', [normalizedRole, workspaceId, targetUserId]);
    return { ok: true };
}

async function removeWorkspaceMember({ workspaceId, targetUserId, actorUserId }) {
    await ensurePublicSchema();

    const actorRole = await assertWorkspaceAccess(actorUserId, workspaceId);
    if (!['owner', 'admin'].includes(actorRole)) {
        throw new Error('Only owners and admins can remove members.');
    }
    if (targetUserId === actorUserId) {
        throw new Error('You cannot remove yourself from the workspace.');
    }

    const target = await fetchOne('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, targetUserId]);
    if (!target) {
        throw new Error('Member not found.');
    }
    if (target.role === 'owner') {
        throw new Error('The workspace owner cannot be removed.');
    }

    await runQuery('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, targetUserId]);
    return { ok: true };
}

function hashResetToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

const TOKEN_PURPOSES = ['reset', 'setup'];
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // emailed reset link: 1 hour
const SETUP_TOKEN_TTL_MS = 72 * 60 * 60 * 1000; // admin/owner-shared setup link: 72 hours

function normalizeTokenPurpose(purpose) {
    return TOKEN_PURPOSES.includes(purpose) ? purpose : 'reset';
}

// Mints a single-use password token for `userId`, replacing any earlier unused token of the
// SAME purpose (an emailed reset no longer silently kills a pending setup link, or vice versa).
//   'reset' — sent to the account's own email; using it proves ownership of that address.
//   'setup' — handed over out-of-band by a super admin (new account, admin reset, approved
//             reset request); says nothing about the email.
async function mintPasswordToken(userId, { purpose = 'reset', ttlMs } = {}, executor) {
    const kind = normalizeTokenPurpose(purpose);
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + (ttlMs || (kind === 'setup' ? SETUP_TOKEN_TTL_MS : RESET_TOKEN_TTL_MS))).toISOString();

    const write = async (client) => {
        await runQuery(
            'DELETE FROM password_reset_tokens WHERE (user_id = $1 AND purpose = $2) OR expires_at <= NOW()',
            [userId, kind],
            client,
        );
        await runQuery(
            'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, purpose) VALUES ($1, $2, $3, $4, $5)',
            [generateId(), userId, tokenHash, expiresAt, kind],
            client,
        );
    };

    if (executor) {
        await write(executor);
    } else {
        await withTransaction(write);
    }

    return { rawToken, expiresAt };
}

async function createSetupToken(userId, { ttlMs } = {}) {
    await ensurePublicSchema();
    const user = await fetchOne('SELECT id FROM users WHERE id = $1', [userId]);
    if (!user) {
        throw new Error('User not found.');
    }
    const { rawToken, expiresAt } = await mintPasswordToken(userId, { purpose: 'setup', ttlMs });
    return { setupToken: rawToken, expiresAt };
}

async function requestPasswordReset(email) {
    await ensurePublicSchema();

    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail) {
        throw new Error('Email is required.');
    }

    const user = await fetchOne('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (!user?.id) {
        return { ok: true, resetToken: null, expiresAt: null };
    }

    const { rawToken, expiresAt } = await mintPasswordToken(user.id, { purpose: 'reset' });

    return {
        ok: true,
        resetToken: rawToken,
        expiresAt,
    };
}

async function validatePasswordResetToken(token, purpose = 'reset') {
    await ensurePublicSchema();

    const tokenHash = hashResetToken(token);
    const record = await fetchOne(
        `
            SELECT t.id, u.email
            FROM password_reset_tokens t
            JOIN users u ON u.id = t.user_id
            WHERE t.token_hash = $1
                AND t.purpose = $2
                AND t.used_at IS NULL
                AND t.expires_at > NOW()
            LIMIT 1
        `,
        [tokenHash, normalizeTokenPurpose(purpose)],
    );

    return record?.id ? { valid: true, identifier: record.email } : { valid: false, identifier: null };
}

// Consumes a reset/setup token and sets the password. The token is claimed with a single
// conditional UPDATE … RETURNING inside the transaction, so two concurrent requests with the
// same link can't both succeed (the old SELECT-then-UPDATE let both through).
//
// Every outstanding session is revoked (session_version bump): if someone else had the old
// password, resetting it must actually lock them out. An emailed 'reset' link also proves the
// user controls the address, so it marks the email verified.
async function resetPasswordWithToken({ token, password, purpose = 'reset' }) {
    await ensurePublicSchema();

    const kind = normalizeTokenPurpose(purpose);
    const tokenHash = hashResetToken(token);

    const target = await fetchOne(
        `SELECT u.email FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
          WHERE t.token_hash = $1 AND t.purpose = $2 AND t.used_at IS NULL AND t.expires_at > NOW()`,
        [tokenHash, kind],
    );
    if (!target) {
        throw new Error('This link is invalid or has expired.');
    }
    validatePassword(password, { identifier: target.email });
    const passwordHash = await hashPassword(password);

    return withTransaction(async (client) => {
        const claimed = await fetchOne(
            `UPDATE password_reset_tokens
                SET used_at = NOW()
              WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > NOW()
          RETURNING id, user_id AS "userId"`,
            [tokenHash, kind],
            client,
        );
        if (!claimed) {
            throw new Error('This link is invalid or has expired.');
        }

        const user = await fetchOne(
            `UPDATE users
                SET password_hash = $1,
                    session_version = session_version + 1,
                    email_verified_at = CASE WHEN $3::boolean THEN COALESCE(email_verified_at, NOW()) ELSE email_verified_at END
              WHERE id = $2
          RETURNING id, email, name`,
            [passwordHash, claimed.userId, kind === 'reset'],
            client,
        );
        await runQuery('DELETE FROM password_reset_tokens WHERE user_id = $1 AND id != $2', [claimed.userId, claimed.id], client);

        return { ok: true, userId: user.id, email: user.email, name: user.name };
    });
}

async function getUserByEmail(email) {
    await ensurePublicSchema();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    return fetchOne('SELECT id, email, name, image FROM users WHERE email = $1', [normalizedEmail]);
}

const EMAILABLE_IDENTIFIER_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Looks up an account by its login identifier for the forgot-password flow. The identifier can be
// an email OR a username — both live in the `email` column. Returns whether an account exists and
// whether it has a real, deliverable email address: username-only accounts don't, so they can't be
// reached by the email reset link and must use the support-approval /reset-request flow instead.
async function lookupResetTarget(identifier) {
    await ensurePublicSchema();

    const normalized = String(identifier || '').trim().toLowerCase();
    if (!normalized) {
        return { exists: false, emailable: false };
    }

    const user = await fetchOne('SELECT email FROM users WHERE email = $1', [normalized]);
    if (!user) {
        return { exists: false, emailable: false };
    }

    return { exists: true, emailable: EMAILABLE_IDENTIFIER_RE.test(user.email || '') };
}


// Lists access requests joined with the requester's user info. Never selects the
// (potentially large) proof_data blob — that's fetched separately on demand.
async function listAccessRequests({ status, userId } = {}) {
    await ensurePublicSchema();

    const conditions = [];
    const params = [];
    if (status) {
        params.push(status);
        conditions.push(`ar.status = $${params.length}`);
    }
    if (userId) {
        params.push(userId);
        conditions.push(`ar.user_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await runQuery(
        `SELECT
            ar.id,
            ar.user_id AS "userId",
            u.email,
            u.name,
            ar.plan,
            ar.amount,
            ar.network,
            ar.tx_reference AS "txReference",
            ar.proof_mime AS "proofMime",
            (ar.proof_data IS NOT NULL) AS "hasProof",
            ar.status,
            ar.note,
            ar.created_at AS "createdAt",
            ar.reviewed_at AS "reviewedAt",
            ar.reviewed_by AS "reviewedBy",
            u.status AS "userStatus",
            u.phone,
            u.company,
            u.country,
            u.subscription_started_at AS "subscriptionStartedAt",
            u.subscription_ends_at AS "subscriptionEndsAt"
         FROM access_requests ar
         JOIN users u ON u.id = ar.user_id
         ${where}
         ORDER BY ar.created_at DESC`,
        params,
    );

    return result.rows;
}

async function getAccessRequestProof(id) {
    await ensurePublicSchema();
    return fetchOne(
        'SELECT proof_mime AS "proofMime", proof_data AS "proofData" FROM access_requests WHERE id = $1',
        [id],
    );
}

// Approves or rejects a request: updates the request audit fields and flips the
// user's login gate accordingly. On approval the subscription window is set to
// [now, now + durationDays]. Returns the requester's email/name for emailing.
async function reviewAccessRequest({ id, action, reviewerUserId, note }) {
    await ensurePublicSchema();

    if (action !== 'approve' && action !== 'reject') {
        throw new Error('Action must be approve or reject.');
    }

    const requestStatus = action === 'approve' ? 'approved' : 'rejected';

    return withTransaction(async (client) => {
        const request = await fetchOne(
            'SELECT id, user_id AS "userId", duration_days AS "durationDays" FROM access_requests WHERE id = $1',
            [id],
            client,
        );

        if (!request) {
            throw new Error('Access request not found.');
        }

        await runQuery(
            `UPDATE access_requests
             SET status = $1, note = $2, reviewed_at = NOW(), reviewed_by = $3
             WHERE id = $4`,
            [requestStatus, String(note || ''), reviewerUserId || null, id],
            client,
        );

        if (action === 'approve') {
            const durationDays = Number(request.durationDays) > 0 ? Number(request.durationDays) : 30;
            // Extend from the later of "now" and the current end date so approving a
            // renewal appends time instead of resetting it; a brand-new user starts now.
            const current = await fetchOne(
                'SELECT subscription_started_at AS "startedAt", subscription_ends_at AS "endsAt" FROM users WHERE id = $1',
                [request.userId],
                client,
            );
            const now = Date.now();
            const currentEnd = current?.endsAt ? new Date(current.endsAt).getTime() : 0;
            const base = Math.max(now, currentEnd);
            const endsAt = new Date(base + durationDays * 24 * 60 * 60 * 1000);
            const startedAt = current?.startedAt ? new Date(current.startedAt).toISOString() : new Date().toISOString();
            await runQuery(
                'UPDATE users SET status = $1, subscription_started_at = $2, subscription_ends_at = $3 WHERE id = $4',
                ['approved', startedAt, endsAt.toISOString(), request.userId],
                client,
            );
        } else {
            await runQuery('UPDATE users SET status = $1 WHERE id = $2', ['rejected', request.userId], client);
        }

        const user = await fetchOne('SELECT email, name FROM users WHERE id = $1', [request.userId], client);
        return { email: user?.email || '', name: user?.name || '', status: requestStatus };
    });
}

// Extends a user's subscription by one period. If the current subscription is
// still active, the new period is appended to the existing end date; if it has
// already lapsed (or never started), it runs from now. Also re-activates the
// account (status='approved') in case it had been revoked/expired.
async function renewSubscription({ userId, durationDays }) {
    await ensurePublicSchema();

    return withTransaction(async (client) => {
        const user = await fetchOne(
            'SELECT email, name, subscription_started_at AS "subscriptionStartedAt", subscription_ends_at AS "subscriptionEndsAt" FROM users WHERE id = $1',
            [userId],
            client,
        );

        if (!user) {
            throw new Error('User not found.');
        }

        // The most recent request drives the fallback duration below, and is also
        // the row the admin panel's status badge/buttons are keyed on — so it must
        // be flipped back to 'approved' here too, or the UI keeps showing
        // "rejected"/Reactivate forever even though the user's login gate (users.status)
        // was already fixed.
        const lastRequest = await fetchOne(
            'SELECT id, duration_days AS "durationDays" FROM access_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
            [userId],
            client,
        );

        // Use the explicit duration if provided, else the duration of the user's
        // most recent paid request, else fall back to 30 days.
        let days = Number(durationDays) > 0 ? Number(durationDays) : 0;
        if (!days) {
            days = Number(lastRequest?.durationDays) > 0 ? Number(lastRequest.durationDays) : 30;
        }

        const now = Date.now();
        const currentEnd = user.subscriptionEndsAt ? new Date(user.subscriptionEndsAt).getTime() : 0;
        const base = Math.max(now, currentEnd);
        const endsAt = new Date(base + days * 24 * 60 * 60 * 1000);
        const startedAt = user.subscriptionStartedAt || new Date().toISOString();

        await runQuery(
            'UPDATE users SET status = $1, subscription_started_at = $2, subscription_ends_at = $3 WHERE id = $4',
            ['approved', startedAt, endsAt.toISOString(), userId],
            client,
        );

        if (lastRequest?.id) {
            await runQuery(
                "UPDATE access_requests SET status = 'approved', reviewed_at = NOW() WHERE id = $1",
                [lastRequest.id],
                client,
            );
        }

        return { email: user.email || '', name: user.name || '', endsAt: endsAt.toISOString() };
    });
}

// Super-admin action: creates a fully active account directly (no self-signup/payment
// approval needed) with an admin-set subscription window and its own workspace, mirroring
// what a normal signup gets. `email` doubles as a login username — it's stored and matched
// as-is (lowercased/trimmed), not validated as an actual email address, since the admin may
// hand the user a plain username instead of a real address. The account has no password yet
// and no email is sent: the admin gets back a one-time 72h setup link (/setup/[token]) to
// hand over out-of-band (e.g. WhatsApp). The link is the ONLY way to claim the account.
async function createUserBySuperAdmin({ name, email, durationDays, phone }) {
    await ensurePublicSchema();

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const displayName = String(name || '').trim() || normalizedEmail;
    const days = Number(durationDays) > 0 ? Number(durationDays) : 30;
    const trustedContact = String(phone || '').trim();

    if (!normalizedEmail) {
        throw new Error('Email or username is required.');
    }

    const existing = await fetchOne('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing) {
        throw new Error('This email or username is already registered.');
    }

    const userId = generateId();
    const now = new Date();
    const endsAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    let setupToken = null;
    await withTransaction(async (client) => {
        await runQuery(
            `INSERT INTO users (id, email, name, status, phone, subscription_started_at, subscription_ends_at)
             VALUES ($1, $2, $3, 'approved', $4, $5, $6)`,
            [userId, normalizedEmail, displayName, trustedContact, now.toISOString(), endsAt.toISOString()],
            client,
        );
        await createWorkspaceForUserWithExecutor(client, userId, `${displayName} Workspace`);
        ({ rawToken: setupToken } = await mintPasswordToken(userId, { purpose: 'setup' }, client));
    });

    return {
        id: userId,
        email: normalizedEmail,
        name: displayName,
        subscriptionEndsAt: endsAt.toISOString(),
        setupToken,
    };
}

// Super-admin password recovery for accounts that can't be reached by email (username-only
// users have no real address, so the /forgot-password email flow can't help them). Clears the
// password, revokes every session, and returns a fresh one-time setup link for the admin to
// hand over. While cleared, the account is unusable — there is no tokenless way to claim it
// (the old /set-password route let anyone who knew the username grab it in that window).
async function clearUserPassword({ userId }) {
    await ensurePublicSchema();

    const user = await fetchOne('SELECT id, email, name FROM users WHERE id = $1', [userId]);
    if (!user) {
        throw new Error('User not found.');
    }

    let setupToken = null;
    await withTransaction(async (client) => {
        await runQuery('UPDATE users SET password_hash = NULL, session_version = session_version + 1 WHERE id = $1', [userId], client);
        ({ rawToken: setupToken } = await mintPasswordToken(userId, { purpose: 'setup' }, client));
    });

    return { ok: true, email: user.email || '', name: user.name || '', setupToken };
}

// Sets/changes the trusted contact (phone/WhatsApp) a super admin uses to verify a user's
// identity out-of-band before approving a password reset request.
async function updateUserContact({ userId, phone }) {
    await ensurePublicSchema();

    const user = await fetchOne('SELECT id FROM users WHERE id = $1', [userId]);
    if (!user) {
        throw new Error('User not found.');
    }

    await runQuery('UPDATE users SET phone = $1 WHERE id = $2', [String(phone || '').trim(), userId]);
    return { ok: true };
}

// Files a pending password reset request for an already-resolved user row, deduping any request
// already on file. Shared by the identifier-based (logged-out) and userId-based (logged-in) entry
// points. A pending row changes nothing about the account — only an admin approval
// (reviewPasswordResetRequest) mints a reset link.
async function fileResetRequestForUser(user, note) {
    const existing = await fetchOne(
        `SELECT id FROM password_reset_requests WHERE user_id = $1 AND status = 'pending' LIMIT 1`,
        [user.id],
    );
    if (existing?.id) {
        return { ok: true, created: false, userId: user.id, name: user.name || '', username: user.email || '' };
    }

    await runQuery(
        `INSERT INTO password_reset_requests (id, user_id, note, status)
         VALUES ($1, $2, $3, 'pending')`,
        [generateId(), user.id, String(note || '').trim()],
    );

    return { ok: true, created: true, userId: user.id, name: user.name || '', username: user.email || '' };
}

// Files a user-initiated password reset request (for username-only accounts the email-based
// /forgot-password flow can't reach). Anti-enumeration: if no account matches the identifier we
// silently return `created: false` so the caller can show the same confirmation either way.
async function createPasswordResetRequest({ email, note }) {
    await ensurePublicSchema();

    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) {
        return { ok: true, created: false };
    }

    const user = await fetchOne('SELECT id, name, email FROM users WHERE email = $1', [normalizedEmail]);
    if (!user?.id) {
        return { ok: true, created: false };
    }

    return fileResetRequestForUser(user, note);
}

// Files a password reset request for the currently logged-in user (identified by session, so no
// username or current password is needed). Used by the in-app "forgot your current password"
// affordance. Reuses the same support-approval machinery as the logged-out path.
async function createPasswordResetRequestForUser({ userId, note }) {
    await ensurePublicSchema();

    const normalizedId = String(userId || '').trim();
    if (!normalizedId) {
        return { ok: true, created: false };
    }

    const user = await fetchOne('SELECT id, name, email FROM users WHERE id = $1', [normalizedId]);
    if (!user?.id) {
        return { ok: true, created: false };
    }

    return fileResetRequestForUser(user, note);
}

// Lists password reset requests joined with the requester's user info. `phone` is the trusted
// contact the admin calls to verify identity before approving.
async function listPasswordResetRequests({ status } = {}) {
    await ensurePublicSchema();

    const conditions = [];
    const params = [];
    if (status) {
        params.push(status);
        conditions.push(`pr.status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await runQuery(
        `SELECT
            pr.id,
            pr.user_id AS "userId",
            u.email,
            u.name,
            u.phone,
            pr.note,
            pr.status,
            pr.created_at AS "createdAt",
            pr.reviewed_at AS "reviewedAt"
         FROM password_reset_requests pr
         JOIN users u ON u.id = pr.user_id
         ${where}
         ORDER BY pr.created_at DESC`,
        params,
    );

    return result.rows;
}

// Approves or rejects a password reset request. On approval it mints a one-time, 1-hour reset
// token (via requestPasswordReset) and returns the raw token so the caller can build the
// /reset-password/{token} link — the admin then hands that link to the user through the trusted
// channel. Nothing about the account changes on reject.
async function reviewPasswordResetRequest({ id, action, reviewerUserId }) {
    await ensurePublicSchema();

    if (action !== 'approve' && action !== 'reject') {
        throw new Error('Action must be approve or reject.');
    }

    const request = await fetchOne(
        'SELECT id, user_id AS "userId", status FROM password_reset_requests WHERE id = $1',
        [id],
    );
    if (!request) {
        throw new Error('Password reset request not found.');
    }

    const user = await fetchOne('SELECT email, name FROM users WHERE id = $1', [request.userId]);
    if (!user) {
        throw new Error('User not found.');
    }

    const requestStatus = action === 'approve' ? 'approved' : 'rejected';
    await runQuery(
        `UPDATE password_reset_requests
         SET status = $1, reviewed_at = NOW(), reviewed_by = $2
         WHERE id = $3`,
        [requestStatus, reviewerUserId || null, id],
    );

    if (action === 'reject') {
        return { ok: true, email: user.email || '', name: user.name || '', resetToken: null };
    }

    // A 'setup' token, not a 'reset' one: the admin hands this link over out-of-band, so using
    // it proves nothing about the email address. 24h gives the admin time to reach the user.
    const { rawToken } = await mintPasswordToken(request.userId, { purpose: 'setup', ttlMs: 24 * 60 * 60 * 1000 });
    return { ok: true, email: user.email || '', name: user.name || '', resetToken: rawToken };
}

// Super-admin override: sets a user's subscription to expire in exactly `days` days from now
// (not appended to the existing end date, unlike renewSubscription). Also (re)activates the
// account, so this doubles as a manual reactivate for rejected/expired users.
async function setSubscriptionDays({ userId, days }) {
    await ensurePublicSchema();

    if (!Number.isFinite(days) || days < 0) {
        throw new Error('Days must be a non-negative number.');
    }

    return withTransaction(async (client) => {
        const user = await fetchOne(
            'SELECT email, name, subscription_started_at AS "subscriptionStartedAt" FROM users WHERE id = $1',
            [userId],
            client,
        );

        if (!user) {
            throw new Error('User not found.');
        }

        const endsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        const startedAt = user.subscriptionStartedAt || new Date().toISOString();

        await runQuery(
            'UPDATE users SET status = $1, subscription_started_at = $2, subscription_ends_at = $3 WHERE id = $4',
            ['approved', startedAt, endsAt.toISOString(), userId],
            client,
        );

        return { email: user.email || '', name: user.name || '', endsAt: endsAt.toISOString() };
    });
}

// Email changes live in src/server/email-verification.js (startEmailChange ->
// confirmAccountCode): the switch only happens after the NEW inbox confirms a code.

// Changes a logged-in user's password. Always requires the current password; an account
// without one (Google-only) must set it through the emailed reset link instead — otherwise
// any live session on such an account could set a password and take it over.
//
// Revokes every session (session_version bump). The caller's own device re-signs-in with the
// new password right after, so only OTHER devices are logged out.
async function changePassword({ userId, currentPassword, newPassword }) {
    await ensurePublicSchema();

    const user = await fetchOne('SELECT email, name, password_hash AS "passwordHash" FROM users WHERE id = $1', [userId]);
    if (!user) {
        throw new Error('User not found.');
    }

    if (!user.passwordHash) {
        throw new Error('This account signs in with Google. Use "Forgot password" on the sign-in page to add a password.');
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        throw new Error('Current password is incorrect.');
    }

    validatePassword(newPassword, { identifier: user.email });
    const passwordHash = await hashPassword(newPassword);
    await runQuery(
        'UPDATE users SET password_hash = $1, session_version = session_version + 1 WHERE id = $2',
        [passwordHash, userId],
    );

    return { ok: true, email: user.email, name: user.name };
}

// Account/subscription snapshot for the logged-in user's settings page.
async function getUserAccountInfo(userId) {
    await ensurePublicSchema();

    const user = await fetchOne(
        `SELECT email, name, status,
                subscription_started_at AS "subscriptionStartedAt",
                subscription_ends_at AS "subscriptionEndsAt",
                ai_enabled AS "aiEnabled",
                (email_verified_at IS NOT NULL) AS "emailVerified",
                (password_hash IS NOT NULL) AS "hasPassword",
                (google_sub IS NOT NULL) AS "googleLinked",
                (mfa_enabled_at IS NOT NULL) AS "mfaEnabled"
         FROM users WHERE id = $1`,
        [userId],
    );
    if (!user) {
        throw new Error('User not found.');
    }

    const pending = await fetchOne(
        "SELECT id, plan, amount, created_at AS \"createdAt\" FROM access_requests WHERE user_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
        [userId],
    );

    return {
        email: user.email,
        name: user.name,
        status: user.status,
        subscriptionStartedAt: user.subscriptionStartedAt,
        subscriptionEndsAt: user.subscriptionEndsAt,
        // Sign-in & security facts for Settings -> Account (no secrets).
        emailIsAddress: EMAILABLE_IDENTIFIER_RE.test(user.email || ''),
        emailVerified: user.emailVerified === true,
        hasPassword: user.hasPassword === true,
        googleLinked: user.googleLinked === true,
        mfaEnabled: user.mfaEnabled === true,
        pendingRenewal: pending || null,
    };
}

// Records a self-service renewal payment for an existing user: a new pending
// access request the super admin will approve (which extends the subscription).
// Does not change the user's current status/subscription until approved.
async function createRenewalRequest({ userId, plan, amount, network, durationDays, txReference, proofMime, proofBuffer }) {
    await ensurePublicSchema();

    const user = await fetchOne('SELECT id FROM users WHERE id = $1', [userId]);
    if (!user) {
        throw new Error('User not found.');
    }

    await runQuery(
        `INSERT INTO access_requests
            (id, user_id, plan, amount, network, duration_days, tx_reference, proof_mime, proof_data, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')`,
        [
            generateId(),
            userId,
            String(plan || ''),
            String(amount || ''),
            String(network || ''),
            Number(durationDays) > 0 ? Number(durationDays) : 30,
            String(txReference || ''),
            String(proofMime || ''),
            proofBuffer || null,
        ],
    );

    return { ok: true };
}

async function listAllUsers() {
    await ensurePublicSchema();

    const result = await runQuery(`
        SELECT
            u.id,
            u.email,
            u.name,
            u.image,
            CASE WHEN u.password_hash IS NOT NULL THEN 'credentials' WHEN u.google_sub IS NOT NULL OR u.image IS NOT NULL THEN 'oauth' ELSE 'none' END AS "authProvider",
            (u.password_hash IS NOT NULL) AS "hasPassword",
            (u.google_sub IS NOT NULL) AS "googleLinked",
            (u.email_verified_at IS NOT NULL) AS "emailVerified",
            (u.mfa_enabled_at IS NOT NULL) AS "mfaEnabled",
            u.created_at AS "createdAt",
            u.status,
            u.phone,
            u.subscription_started_at AS "subscriptionStartedAt",
            u.subscription_ends_at AS "subscriptionEndsAt",
            u.ai_enabled AS "aiEnabled",
            COUNT(DISTINCT wm.workspace_id)::int AS "workspaceCount",
            COALESCE(
                json_agg(
                    json_build_object(
                        'id', w.id,
                        'name', w.name,
                        'slug', w.slug,
                        'role', wm.role,
                        'isOwner', (w.owner_user_id = u.id)
                    )
                    ORDER BY w.created_at ASC
                ) FILTER (WHERE w.id IS NOT NULL),
                '[]'::json
            ) AS workspaces
        FROM users u
        LEFT JOIN workspace_members wm ON wm.user_id = u.id
        LEFT JOIN workspaces w ON w.id = wm.workspace_id
        GROUP BY u.id
        ORDER BY u.created_at DESC
    `);

    return result.rows;
}

// Single-user version of listAllUsers, plus subscription info — powers the super admin's
// per-user detail page (GET /api/admin/users/[userId]). Workspace usage stats (transaction/
// client counts) are fetched separately per workspace schema by the route, not here.
async function getUserDetailForAdmin(userId) {
    await ensurePublicSchema();

    const user = await fetchOne(
        `SELECT
            u.id,
            u.email,
            u.name,
            u.image,
            CASE WHEN u.password_hash IS NOT NULL THEN 'credentials' WHEN u.google_sub IS NOT NULL OR u.image IS NOT NULL THEN 'oauth' ELSE 'none' END AS "authProvider",
            (u.password_hash IS NOT NULL) AS "hasPassword",
            (u.google_sub IS NOT NULL) AS "googleLinked",
            (u.email_verified_at IS NOT NULL) AS "emailVerified",
            (u.mfa_enabled_at IS NOT NULL) AS "mfaEnabled",
            u.created_at AS "createdAt",
            u.status,
            u.phone,
            u.subscription_started_at AS "subscriptionStartedAt",
            u.subscription_ends_at AS "subscriptionEndsAt",
            u.ai_enabled AS "aiEnabled"
         FROM users u
         WHERE u.id = $1`,
        [userId],
    );
    if (!user) {
        return null;
    }

    const workspaces = await runQuery(
        `SELECT
            w.id,
            w.name,
            w.slug,
            wm.role,
            (w.owner_user_id = $1) AS "isOwner",
            w.created_at AS "createdAt"
         FROM workspace_members wm
         JOIN workspaces w ON w.id = wm.workspace_id
         WHERE wm.user_id = $1
         ORDER BY w.created_at ASC`,
        [userId],
    );

    return { ...user, workspaces: workspaces.rows };
}

const ACTIVITY_EVENT_TYPES = ['app_open', 'section_visit', 'login'];

// Records one behavioral telemetry event (login / app open / section visit). Best-effort:
// callers invoke this fire-and-forget and must not let a failure here break their flow.
async function recordActivityEvent({ userId, workspaceId, eventType, section } = {}) {
    if (!userId || !ACTIVITY_EVENT_TYPES.includes(eventType)) {
        return;
    }
    await ensurePublicSchema();
    await runQuery(
        `INSERT INTO user_activity_events (user_id, workspace_id, event_type, section)
         VALUES ($1, $2, $3, $4)`,
        [userId, workspaceId || null, eventType, section || null],
    );
}

// Aggregates a user's activity events for the super-admin detail page: login/app-open
// counts with last-seen timestamps, per-section visit counts, and overall last-active time.
async function getUserActivitySummary(userId) {
    await ensurePublicSchema();

    const totals = await fetchOne(
        `SELECT
            COUNT(*) FILTER (WHERE event_type = 'app_open')::int AS "appOpenCount",
            MAX(created_at) FILTER (WHERE event_type = 'app_open') AS "lastAppOpenAt",
            COUNT(*) FILTER (WHERE event_type = 'login')::int AS "loginCount",
            MAX(created_at) FILTER (WHERE event_type = 'login') AS "lastLoginAt",
            MAX(created_at) AS "lastActiveAt"
         FROM user_activity_events
         WHERE user_id = $1`,
        [userId],
    );

    // "Today" is the server's own calendar day (date_trunc, not per-viewer timezone) — it
    // resets naturally at midnight since it's a live filter over the raw event log, not a
    // stored counter. totalCount stays available alongside it for the all-time figure.
    const sectionVisits = await runQuery(
        `SELECT
            COALESCE(section, '') AS section,
            COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS "todayCount",
            COUNT(*)::int AS "totalCount",
            MAX(created_at) AS "lastVisitAt"
         FROM user_activity_events
         WHERE user_id = $1 AND event_type = 'section_visit'
         GROUP BY section
         ORDER BY "todayCount" DESC, "totalCount" DESC, "lastVisitAt" DESC`,
        [userId],
    );

    return {
        appOpenCount: totals?.appOpenCount ?? 0,
        lastAppOpenAt: totals?.lastAppOpenAt ?? null,
        loginCount: totals?.loginCount ?? 0,
        lastLoginAt: totals?.lastLoginAt ?? null,
        lastActiveAt: totals?.lastActiveAt ?? null,
        sectionVisits: sectionVisits.rows,
    };
}

async function deleteUser(userId) {
    await ensurePublicSchema();

    const owned = await runQuery(
        'SELECT id FROM workspaces WHERE owner_user_id = $1',
        [userId],
    );

    const user = await fetchOne('SELECT id FROM users WHERE id = $1', [userId]);
    if (!user) {
        throw new Error('User not found.');
    }

    await withTransaction(async (client) => {
        await runQuery('DELETE FROM users WHERE id = $1', [userId], client);
    });

    return { deletedWorkspaceIds: owned.rows.map((r) => r.id) };
}

// --- Marketing images (global, super-admin managed) -----------------------

// Upserts the screenshot for one homepage mockup slot.
async function saveMarketingAsset({ slot, mime, buffer }) {
    await ensurePublicSchema();
    if (!slot) {
        throw new Error('Slot is required.');
    }
    await runQuery(
        `INSERT INTO marketing_assets (slot, mime, data, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (slot) DO UPDATE
            SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = NOW()`,
        [String(slot), String(mime || ''), buffer || null],
    );
    return { ok: true };
}

// Returns { mime, data } for one slot, or null when no image is set.
async function getMarketingAsset(slot) {
    await ensurePublicSchema();
    return fetchOne(
        'SELECT mime, data FROM marketing_assets WHERE slot = $1 AND data IS NOT NULL',
        [String(slot)],
    );
}

// Lists which slots currently have an uploaded image (never selects the bytes).
// updatedAt is returned so the homepage can cache-bust the image URL.
async function listMarketingAssets() {
    await ensurePublicSchema();
    const result = await runQuery(
        'SELECT slot, updated_at AS "updatedAt" FROM marketing_assets WHERE data IS NOT NULL',
    );
    return result.rows;
}

// Removes the image for one slot, reverting the homepage to its CSS mockup.
async function deleteMarketingAsset(slot) {
    await ensurePublicSchema();
    await runQuery('DELETE FROM marketing_assets WHERE slot = $1', [String(slot)]);
    return { ok: true };
}

// --- Admin audit log -------------------------------------------------------

// Records one super-admin action. Best-effort: audit logging must never break the
// primary action, so failures are swallowed. When target_email/name aren't supplied
// but a targetUserId is, we snapshot them from the users table so the audit row stays
// meaningful even after the user is later deleted.
async function logAdminAction({ actorEmail, action, targetUserId, targetEmail, targetName, meta } = {}) {
    if (!action) return;
    try {
        await ensurePublicSchema();
        let email = targetEmail || null;
        let name = targetName || null;
        if (targetUserId && (!email || !name)) {
            const u = await fetchOne('SELECT email, name FROM users WHERE id = $1', [targetUserId]);
            if (u) {
                email = email || u.email || null;
                name = name || u.name || null;
            }
        }
        await runQuery(
            `INSERT INTO admin_audit (actor_email, action, target_user_id, target_email, target_name, meta)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [actorEmail || null, String(action), targetUserId || null, email, name, meta ? JSON.stringify(meta) : null],
        );
    } catch (error) {
        console.error('[admin audit] failed to log action:', error);
    }
}

// Returns a merged, newest-first feed of super-admin actions (from admin_audit) and
// recent user login events (from user_activity_events) — the two halves the audit
// screen shows. Login rows join to users for a display name; deleted users are dropped.
async function listAdminAudit({ limit = 100 } = {}) {
    await ensurePublicSchema();
    const cap = Math.min(Math.max(Number(limit) || 100, 1), 500);

    const admin = await runQuery(
        `SELECT 'admin' AS kind, id, actor_email AS "actorEmail", action,
                target_user_id AS "targetUserId", target_email AS "targetEmail",
                target_name AS "targetName", meta, created_at AS "createdAt"
         FROM admin_audit
         ORDER BY created_at DESC
         LIMIT $1`,
        [cap],
    );

    const logins = await runQuery(
        `SELECT 'login' AS kind, e.id, NULL AS "actorEmail", 'login' AS action,
                u.id AS "targetUserId", u.email AS "targetEmail", u.name AS "targetName",
                NULL::jsonb AS meta, e.created_at AS "createdAt"
         FROM user_activity_events e
         JOIN users u ON u.id = e.user_id
         WHERE e.event_type = 'login'
         ORDER BY e.created_at DESC
         LIMIT $1`,
        [cap],
    );

    // Security events (failed/locked logins, password/email/2FA changes, recovery requests,
    // admin unlocks…). Successful logins are already covered by the 'login' rows above.
    const securityRows = await runQuery(
        `SELECT 'security' AS kind, e.id, NULL AS "actorEmail", e.event AS action,
                e.user_id AS "targetUserId", COALESCE(u.email, e.identifier) AS "targetEmail",
                u.name AS "targetName",
                COALESCE(e.meta, '{}'::jsonb) || jsonb_build_object('ip', e.ip) AS meta,
                e.created_at AS "createdAt"
         FROM security_events e
         LEFT JOIN users u ON u.id = e.user_id
         WHERE e.event <> 'login_success'
         ORDER BY e.created_at DESC
         LIMIT $1`,
        [cap],
    );

    return [...admin.rows, ...logins.rows, ...securityRows.rows]
        .map((r) => ({ ...r, id: `${r.kind}-${r.id}` }))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, cap);
}

module.exports = {
    openAuthDb,
    logAdminAction,
    listAdminAudit,
    saveMarketingAsset,
    getMarketingAsset,
    listMarketingAssets,
    deleteMarketingAsset,
    createWorkspaceForUserWithExecutor,
    resolveGoogleUser,
    getUserByGoogleSub,
    getAuthUserById,
    getPasswordHash,
    getSessionClaims,
    bumpSessionVersion,
    recordSuccessfulLogin,
    verifyCredentials,
    listUserWorkspaces,
    getDefaultWorkspaceIdByUserId,
    getUserAiEnabled,
    getUserDisplayNamesByIds,
    updateUserAiEnabled,
    getWorkspaceRole,
    assertWorkspaceAccess,
    getWorkspaceBackupInfo,
    recordWorkspaceBackup,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    createWorkspaceInvitation,
    listWorkspaceInvitations,
    revokeWorkspaceInvitation,
    getInvitationByToken,
    acceptWorkspaceInvitation,
    createAccountFromInvitation,
    createMemberSetupLink,
    getWorkspaceAccess,
    updateWorkspaceMemberRole,
    removeWorkspaceMember,
    listWorkspaceMembers,
    requestPasswordReset,
    validatePasswordResetToken,
    resetPasswordWithToken,
    listAllUsers,
    getUserDetailForAdmin,
    recordActivityEvent,
    getUserActivitySummary,
    deleteUser,
    createUserBySuperAdmin,
    createSetupToken,
    clearUserPassword,
    updateUserContact,
    createPasswordResetRequest,
    createPasswordResetRequestForUser,
    listPasswordResetRequests,
    reviewPasswordResetRequest,
    listAccessRequests,
    getAccessRequestProof,
    reviewAccessRequest,
    renewSubscription,
    setSubscriptionDays,
    changePassword,
    getUserAccountInfo,
    createRenewalRequest,
    getUserByEmail,
    lookupResetTarget,
};