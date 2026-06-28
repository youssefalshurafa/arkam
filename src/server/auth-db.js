/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { getPool, ensurePublicSchema, withTransaction } = require('@/server/postgres');

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
    const displayName = String(name || '').trim();

    if (!displayName) {
        throw new Error('Name is required.');
    }

    if (!normalizedEmail) {
        throw new Error('Email is required.');
    }

    if (!password || String(password).length < 8) {
        throw new Error('Password must be at least 8 characters.');
    }

    const existing = await fetchOne('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing) {
        throw new Error('Email is already registered.');
    }

    const userId = generateId();
    const hash = bcrypt.hashSync(String(password), 10);

    await withTransaction(async (client) => {
        await runQuery(
            'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
            [userId, normalizedEmail, displayName, hash],
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

    const existing = await fetchOne('SELECT id, email, name, image FROM users WHERE email = $1', [normalizedEmail]);

    if (existing) {
        await runQuery('UPDATE users SET name = $1, image = $2 WHERE id = $3', [String(name || existing.name || 'User').trim(), image || null, existing.id]);
        await ensureUserHasWorkspace(existing.id, `${existing.name || 'My'} Workspace`);
        return fetchOne('SELECT id, email, name, image FROM users WHERE id = $1', [existing.id]);
    }

    const userId = generateId();
    const displayName = String(name || normalizedEmail.split('@')[0] || 'User').trim();

    await withTransaction(async (client) => {
        await runQuery(
            'INSERT INTO users (id, email, name, image) VALUES ($1, $2, $3, $4)',
            [userId, normalizedEmail, displayName, image || null],
            client,
        );
        await createWorkspaceForUserWithExecutor(client, userId, `${displayName} Workspace`);
    });

    return fetchOne('SELECT id, email, name, image FROM users WHERE id = $1', [userId]);
}

async function verifyCredentials({ email, password }) {
    await ensurePublicSchema();

    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !password) {
        return null;
    }

    const user = await fetchOne(
        'SELECT id, email, name, image, status, password_hash AS "passwordHash" FROM users WHERE email = $1',
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

async function createWorkspace(ownerUserId, name) {
    const workspaceName = String(name || '').trim();
    if (!workspaceName) {
        throw new Error('Workspace name is required.');
    }

    return createWorkspaceForUser(ownerUserId, workspaceName);
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
        throw new Error('Email is required.');
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
        return { status: 'added', email: normalizedEmail };
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

async function createEmailVerificationToken({ email, name, phone, company, country }) {
    await ensurePublicSchema();

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const displayName = String(name || '').trim();

    // Delete any prior unused tokens for this email
    await runQuery('DELETE FROM email_verification_tokens WHERE email = $1', [normalizedEmail]);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await runQuery(
        `INSERT INTO email_verification_tokens (id, email, name, phone, company, country, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
            generateId(),
            normalizedEmail,
            displayName,
            String(phone || '').trim(),
            String(company || '').trim(),
            String(country || '').trim(),
            tokenHash,
            expiresAt,
        ],
    );

    return { rawToken, expiresAt };
}

async function getEmailVerificationToken(rawToken) {
    await ensurePublicSchema();

    const tokenHash = crypto.createHash('sha256').update(String(rawToken)).digest('hex');
    return fetchOne(
        `SELECT id, email, name FROM email_verification_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
         LIMIT 1`,
        [tokenHash],
    );
}

async function consumeEmailVerificationAndCreateUser({ rawToken, password }) {
    await ensurePublicSchema();

    const tokenHash = crypto.createHash('sha256').update(String(rawToken)).digest('hex');

    return withTransaction(async (client) => {
        const record = await fetchOne(
            `SELECT id, email, name FROM email_verification_tokens
             WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
             LIMIT 1`,
            [tokenHash],
            client,
        );

        if (!record) {
            throw new Error('Verification link is invalid or has expired.');
        }

        const rawPassword = String(password || '');
        if (rawPassword.length < 8) {
            throw new Error('Password must be at least 8 characters.');
        }

        const existing = await fetchOne('SELECT id FROM users WHERE email = $1', [record.email], client);
        if (existing) {
            throw new Error('An account with this email already exists.');
        }

        const userId = generateId();
        const passwordHash = bcrypt.hashSync(rawPassword, 10);

        await runQuery(
            'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
            [userId, record.email, record.name, passwordHash],
            client,
        );
        await createWorkspaceForUserWithExecutor(client, userId, `${record.name} Workspace`);

        // Mark token as used
        await runQuery(
            'UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1',
            [record.id],
            client,
        );

        return fetchOne('SELECT id, email, name, image FROM users WHERE id = $1', [userId], client);
    });
}

// Like consumeEmailVerificationAndCreateUser, but creates the user as 'pending'
// (login blocked until approved) and records the payment/approval request,
// including the uploaded screenshot bytes. All in one transaction.
async function consumeEmailVerificationAndCreatePendingUser({
    rawToken,
    password,
    plan,
    amount,
    network,
    durationDays,
    txReference,
    proofMime,
    proofBuffer,
}) {
    await ensurePublicSchema();

    const tokenHash = crypto.createHash('sha256').update(String(rawToken)).digest('hex');

    return withTransaction(async (client) => {
        const record = await fetchOne(
            `SELECT id, email, name, phone, company, country FROM email_verification_tokens
             WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
             LIMIT 1`,
            [tokenHash],
            client,
        );

        if (!record) {
            throw new Error('Verification link is invalid or has expired.');
        }

        const rawPassword = String(password || '');
        if (rawPassword.length < 8) {
            throw new Error('Password must be at least 8 characters.');
        }

        const existing = await fetchOne('SELECT id FROM users WHERE email = $1', [record.email], client);
        if (existing) {
            throw new Error('An account with this email already exists.');
        }

        const userId = generateId();
        const passwordHash = bcrypt.hashSync(rawPassword, 10);

        await runQuery(
            `INSERT INTO users (id, email, name, password_hash, status, phone, company, country)
             VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)`,
            [userId, record.email, record.name, passwordHash, record.phone || '', record.company || '', record.country || ''],
            client,
        );
        await createWorkspaceForUserWithExecutor(client, userId, `${record.name} Workspace`);

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
            client,
        );

        await runQuery(
            'UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1',
            [record.id],
            client,
        );

        return fetchOne('SELECT id, email, name FROM users WHERE id = $1', [userId], client);
    });
}

// Lists access requests joined with the requester's user info. Never selects the
// (potentially large) proof_data blob — that's fetched separately on demand.
async function listAccessRequests({ status } = {}) {
    await ensurePublicSchema();

    const params = [];
    let where = '';
    if (status) {
        params.push(status);
        where = 'WHERE ar.status = $1';
    }

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

        // Use the explicit duration if provided, else the duration of the user's
        // most recent paid request, else fall back to 30 days.
        let days = Number(durationDays) > 0 ? Number(durationDays) : 0;
        if (!days) {
            const lastRequest = await fetchOne(
                'SELECT duration_days AS "durationDays" FROM access_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
                [userId],
                client,
            );
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

        return { email: user.email || '', name: user.name || '', endsAt: endsAt.toISOString() };
    });
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
    createWorkspace,
    addWorkspaceMemberByEmail,
    inviteWorkspaceMember,
    updateWorkspaceMemberRole,
    removeWorkspaceMember,
    listWorkspaceMembers,
    requestPasswordReset,
    validatePasswordResetToken,
    resetPasswordWithToken,
    listAllUsers,
    deleteUser,
    createEmailVerificationToken,
    getEmailVerificationToken,
    consumeEmailVerificationAndCreateUser,
    consumeEmailVerificationAndCreatePendingUser,
    listAccessRequests,
    getAccessRequestProof,
    reviewAccessRequest,
    renewSubscription,
    changePassword,
    getUserAccountInfo,
    createRenewalRequest,
    getUserByEmail,
};