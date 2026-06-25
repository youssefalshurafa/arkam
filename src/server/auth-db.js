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
        'SELECT id, email, name, image, password_hash AS "passwordHash" FROM users WHERE email = $1',
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
    listWorkspaceMembers,
    requestPasswordReset,
    validatePasswordResetToken,
    resetPasswordWithToken,
    listAllUsers,
    deleteUser,
};