/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { getPool, ensurePublicSchema, withTransaction } = require('@/server/postgres');

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

async function createCredentialsUser({ name, email, password, workspaceName }) {
    await ensurePublicSchema();

    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail) {
        throw new Error('Username or email is required.');
    }

    if (!password || String(password).length < 8) {
        throw new Error('Password must be at least 8 characters.');
    }

    if (!/[a-zA-Z]/.test(String(password)) || !/[0-9]/.test(String(password))) {
        throw new Error('Password must contain both letters and numbers.');
    }

    // Full name is optional — fall back to the identifier (the part before any @)
    // so the user still has a sensible display name and default workspace name.
    const displayName = String(name || '').trim() || normalizedEmail.split('@')[0] || normalizedEmail;

    const existing = await fetchOne('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing) {
        throw new Error('Email is already registered.');
    }

    const userId = generateId();
    const hash = bcrypt.hashSync(String(password), 10);
    const trialStartedAt = new Date();
    const trialEndsAt = new Date(trialStartedAt.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

    await withTransaction(async (client) => {
        await runQuery(
            `INSERT INTO users (id, email, name, password_hash, subscription_started_at, subscription_ends_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, normalizedEmail, displayName, hash, trialStartedAt.toISOString(), trialEndsAt.toISOString()],
            client,
        );
        await createWorkspaceForUserWithExecutor(client, userId, String(workspaceName || `${displayName} Workspace`).trim());
    });

    return fetchOne('SELECT id, email, name, image FROM users WHERE id = $1', [userId]);
}

async function upsertOAuthUser({ email, name, image }) {
    await ensurePublicSchema();

    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) {
        throw new Error('Google account email is missing.');
    }

    const existing = await fetchOne(
        'SELECT id, email, name, image, status, subscription_ends_at AS "subscriptionEndsAt" FROM users WHERE email = $1',
        [normalizedEmail],
    );

    if (existing) {
        await runQuery('UPDATE users SET name = $1, image = $2 WHERE id = $3', [String(name || existing.name || 'User').trim(), image || null, existing.id]);
        await ensureUserHasWorkspace(existing.id, `${existing.name || 'My'} Workspace`);
        return {
            id: existing.id,
            email: existing.email,
            name: existing.name,
            image: existing.image,
            status: existing.status || 'approved',
            subscriptionEndsAt: existing.subscriptionEndsAt,
        };
    }

    const userId = generateId();
    const displayName = String(name || normalizedEmail.split('@')[0] || 'User').trim();
    // Brand-new Google sign-ups get the same free trial window as a direct signup.
    const trialStartedAt = new Date();
    const trialEndsAt = new Date(trialStartedAt.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

    await withTransaction(async (client) => {
        await runQuery(
            `INSERT INTO users (id, email, name, image, subscription_started_at, subscription_ends_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, normalizedEmail, displayName, image || null, trialStartedAt.toISOString(), trialEndsAt.toISOString()],
            client,
        );
        await createWorkspaceForUserWithExecutor(client, userId, `${displayName} Workspace`);
    });

    return {
        id: userId,
        email: normalizedEmail,
        name: displayName,
        image: image || null,
        status: 'approved',
        subscriptionEndsAt: trialEndsAt.toISOString(),
    };
}

async function verifyCredentials({ email, password }) {
    await ensurePublicSchema();

    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !password) {
        return null;
    }

    const user = await fetchOne(
        'SELECT id, email, name, image, status, subscription_ends_at AS "subscriptionEndsAt", password_hash AS "passwordHash" FROM users WHERE email = $1',
        [normalizedEmail],
    );

    if (!user?.passwordHash) {
        return null;
    }

    if (!bcrypt.compareSync(String(password), user.passwordHash)) {
        return null;
    }

    return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        status: user.status || 'approved',
        subscriptionEndsAt: user.subscriptionEndsAt,
    };
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

async function addWorkspaceMemberByEmail({ workspaceId, email, role, addedByUserId }) {
    await ensurePublicSchema();

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedRole = String(role || 'member').trim().toLowerCase();

    if (!['admin', 'member', 'viewer'].includes(normalizedRole)) {
        throw new Error('Role must be one of: admin, member, viewer.');
    }

    const actorRole = await assertWorkspaceAccess(addedByUserId, workspaceId);
    if (!['owner', 'admin'].includes(actorRole)) {
        throw new Error('Only owners and admins can add workspace members.');
    }

    const targetUser = await fetchOne('SELECT id, email, name, image FROM users WHERE email = $1', [normalizedEmail]);
    if (!targetUser) {
        throw new Error('User not found. Ask them to sign up first.');
    }

    await runQuery(
        `
            INSERT INTO workspace_members (workspace_id, user_id, role)
            VALUES ($1, $2, $3)
            ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
        `,
        [workspaceId, targetUser.id, normalizedRole],
    );

    return {
        userId: targetUser.id,
        email: targetUser.email,
        role: normalizedRole,
    };
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
                wm.created_at AS "addedAt"
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

// Invites a teammate into a workspace. Existing users are added/role-updated
// immediately; brand-new people get an approved, password-less, workspace-less
// account plus a set-password token to email them. Teammates skip the payment flow.
async function inviteWorkspaceMember({ workspaceId, email, name, role, invitedByUserId }) {
    await ensurePublicSchema();

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const displayName = String(name || '').trim();
    const normalizedRole = String(role || 'member').trim().toLowerCase();

    if (!normalizedEmail) {
        throw new Error('Email or username is required.');
    }
    if (!['admin', 'member', 'viewer'].includes(normalizedRole)) {
        throw new Error('Role must be one of: admin, member, viewer.');
    }

    const actorRole = await assertWorkspaceAccess(invitedByUserId, workspaceId);
    if (!['owner', 'admin'].includes(actorRole)) {
        throw new Error('Only owners and admins can add workspace members.');
    }

    const existing = await fetchOne('SELECT id FROM users WHERE email = $1', [normalizedEmail]);

    if (existing) {
        await runQuery(
            `INSERT INTO workspace_members (workspace_id, user_id, role)
             VALUES ($1, $2, $3)
             ON CONFLICT (workspace_id, user_id)
             DO UPDATE SET role = EXCLUDED.role
             WHERE workspace_members.role <> 'owner'`,
            [workspaceId, existing.id, normalizedRole],
        );

        // Notify them they now have access. We never have their existing plaintext
        // password to send (it's stored as a bcrypt hash), so reuse the same
        // set-password token flow as a brand-new invite.
        const addedRawToken = crypto.randomBytes(32).toString('hex');
        const addedTokenHash = hashResetToken(addedRawToken);
        const addedExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await runQuery(
            'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
            [generateId(), existing.id, addedTokenHash, addedExpiresAt],
        );

        return { status: 'added', email: normalizedEmail, rawToken: addedRawToken };
    }

    const userId = generateId();
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7-day invite window

    await withTransaction(async (client) => {
        await runQuery(
            "INSERT INTO users (id, email, name, status) VALUES ($1, $2, $3, 'approved')",
            [userId, normalizedEmail, displayName || normalizedEmail],
            client,
        );
        await runQuery(
            'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
            [workspaceId, userId, normalizedRole],
            client,
        );
        await runQuery(
            'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
            [generateId(), userId, tokenHash, expiresAt],
            client,
        );
    });

    return { status: 'invited', email: normalizedEmail, rawToken };
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

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await withTransaction(async (client) => {
        await runQuery('DELETE FROM password_reset_tokens WHERE user_id = $1 OR expires_at <= NOW()', [user.id], client);
        await runQuery(
            'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
            [generateId(), user.id, tokenHash, expiresAt],
            client,
        );
    });

    return {
        ok: true,
        resetToken: rawToken,
        expiresAt,
    };
}

async function validatePasswordResetToken(token) {
    await ensurePublicSchema();

    const tokenHash = hashResetToken(token);
    const record = await fetchOne(
        `
            SELECT id
            FROM password_reset_tokens
            WHERE token_hash = $1
                AND used_at IS NULL
                AND expires_at > NOW()
            LIMIT 1
        `,
        [tokenHash],
    );

    return Boolean(record?.id);
}

async function resetPasswordWithToken({ token, password }) {
    await ensurePublicSchema();

    const rawPassword = String(password || '');
    if (rawPassword.length < 8) {
        throw new Error('Password must be at least 8 characters.');
    }

    const tokenHash = hashResetToken(token);
    const record = await fetchOne(
        `
            SELECT id, user_id AS "userId"
            FROM password_reset_tokens
            WHERE token_hash = $1
                AND used_at IS NULL
                AND expires_at > NOW()
            LIMIT 1
        `,
        [tokenHash],
    );

    if (!record?.id) {
        throw new Error('Reset link is invalid or has expired.');
    }

    const passwordHash = bcrypt.hashSync(rawPassword, 10);

    await withTransaction(async (client) => {
        await runQuery('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, record.userId], client);
        await runQuery('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [record.id], client);
        await runQuery('DELETE FROM password_reset_tokens WHERE user_id = $1 AND id != $2', [record.userId, record.id], client);
    });

    return { ok: true };
}

async function getUserByEmail(email) {
    await ensurePublicSchema();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    return fetchOne('SELECT id, email, name, image FROM users WHERE email = $1', [normalizedEmail]);
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
// hand the user a plain username instead of a real address. The account has no password yet;
// no email is sent — the user sets their own password later via setInitialPassword() (the
// sign-in page links to a "set your password" screen for first-time logins like this).
async function createUserBySuperAdmin({ name, email, durationDays }) {
    await ensurePublicSchema();

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const displayName = String(name || '').trim() || normalizedEmail;
    const days = Number(durationDays) > 0 ? Number(durationDays) : 30;

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

    await withTransaction(async (client) => {
        await runQuery(
            `INSERT INTO users (id, email, name, status, subscription_started_at, subscription_ends_at)
             VALUES ($1, $2, $3, 'approved', $4, $5)`,
            [userId, normalizedEmail, displayName, now.toISOString(), endsAt.toISOString()],
            client,
        );
        await createWorkspaceForUserWithExecutor(client, userId, `${displayName} Workspace`);
    });

    return {
        id: userId,
        email: normalizedEmail,
        name: displayName,
        subscriptionEndsAt: endsAt.toISOString(),
    };
}

// Lets a user created via createUserBySuperAdmin (no password_hash yet) set their own password
// for the first time, given just their email/username — no token/email involved. Matched on
// "password_hash IS NULL" so it can never be used to hijack an account that already has a
// password (that's what forgot-password/reset-password is for).
async function setInitialPassword({ email, password }) {
    await ensurePublicSchema();

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const rawPassword = String(password || '');

    if (!normalizedEmail) {
        throw new Error('Email or username is required.');
    }
    if (rawPassword.length < 8) {
        throw new Error('Password must be at least 8 characters.');
    }

    const user = await fetchOne('SELECT id FROM users WHERE email = $1 AND password_hash IS NULL', [normalizedEmail]);
    if (!user) {
        throw new Error('No pending account found for this email/username, or a password has already been set.');
    }

    const passwordHash = bcrypt.hashSync(rawPassword, 10);
    await runQuery('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, user.id]);

    return { ok: true };
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

// Changes a logged-in user's email. Requires the current password for
// credentials accounts. Rejects if the new email is already taken.
async function changeEmail({ userId, currentPassword, newEmail }) {
    await ensurePublicSchema();

    const normalizedEmail = String(newEmail || '').trim().toLowerCase();
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new Error('Please enter a valid email address.');
    }

    const user = await fetchOne('SELECT email, password_hash AS "passwordHash" FROM users WHERE id = $1', [userId]);
    if (!user) {
        throw new Error('User not found.');
    }

    if (normalizedEmail === user.email) {
        throw new Error('The new email is the same as your current email.');
    }

    if (user.passwordHash) {
        if (!bcrypt.compareSync(String(currentPassword || ''), user.passwordHash)) {
            throw new Error('Current password is incorrect.');
        }
    }

    const taken = await fetchOne('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (taken) {
        throw new Error('This email is already in use.');
    }

    await runQuery('UPDATE users SET email = $1 WHERE id = $2', [normalizedEmail, userId]);
    return { ok: true };
}

// Changes a logged-in user's password. Verifies the current password for
// credentials accounts; OAuth accounts (no password yet) may set one directly.
async function changePassword({ userId, currentPassword, newPassword }) {
    await ensurePublicSchema();

    const user = await fetchOne('SELECT password_hash AS "passwordHash" FROM users WHERE id = $1', [userId]);
    if (!user) {
        throw new Error('User not found.');
    }

    if (user.passwordHash) {
        if (!bcrypt.compareSync(String(currentPassword || ''), user.passwordHash)) {
            throw new Error('Current password is incorrect.');
        }
    }

    const next = String(newPassword || '');
    if (next.length < 8) {
        throw new Error('New password must be at least 8 characters.');
    }

    const passwordHash = bcrypt.hashSync(next, 10);
    await runQuery('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);

    return { ok: true };
}

// Account/subscription snapshot for the logged-in user's settings page.
async function getUserAccountInfo(userId) {
    await ensurePublicSchema();

    const user = await fetchOne(
        `SELECT email, name, status,
                subscription_started_at AS "subscriptionStartedAt",
                subscription_ends_at AS "subscriptionEndsAt"
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
            CASE WHEN u.password_hash IS NOT NULL THEN 'credentials' ELSE 'oauth' END AS "authProvider",
            u.created_at AS "createdAt",
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
            CASE WHEN u.password_hash IS NOT NULL THEN 'credentials' ELSE 'oauth' END AS "authProvider",
            u.created_at AS "createdAt",
            u.status,
            u.subscription_started_at AS "subscriptionStartedAt",
            u.subscription_ends_at AS "subscriptionEndsAt"
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

module.exports = {
    openAuthDb,
    createCredentialsUser,
    upsertOAuthUser,
    verifyCredentials,
    listUserWorkspaces,
    getDefaultWorkspaceIdByUserId,
    getWorkspaceRole,
    assertWorkspaceAccess,
    getWorkspaceBackupInfo,
    recordWorkspaceBackup,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    addWorkspaceMemberByEmail,
    inviteWorkspaceMember,
    updateWorkspaceMemberRole,
    removeWorkspaceMember,
    listWorkspaceMembers,
    requestPasswordReset,
    validatePasswordResetToken,
    resetPasswordWithToken,
    listAllUsers,
    getUserDetailForAdmin,
    deleteUser,
    createUserBySuperAdmin,
    setInitialPassword,
    listAccessRequests,
    getAccessRequestProof,
    reviewAccessRequest,
    renewSubscription,
    setSubscriptionDays,
    changeEmail,
    changePassword,
    getUserAccountInfo,
    createRenewalRequest,
    getUserByEmail,
};