/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

let authDb;

function getAuthDbPath() {
    return path.join(process.cwd(), 'database', 'auth', 'accounts.sqlite');
}

function openAuthDb() {
    if (authDb) {
        return authDb;
    }

    const dbPath = getAuthDbPath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    authDb = new Database(dbPath);
    authDb.pragma('journal_mode = WAL');
    authDb.pragma('foreign_keys = ON');
    authDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
   id TEXT PRIMARY KEY,
   email TEXT NOT NULL UNIQUE,
   name TEXT NOT NULL,
   password_hash TEXT,
   image TEXT,
   created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workspaces (
   id TEXT PRIMARY KEY,
   name TEXT NOT NULL,
   owner_user_id TEXT NOT NULL,
   slug TEXT NOT NULL UNIQUE,
   created_at TEXT NOT NULL DEFAULT (datetime('now')),
   FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workspace_members (
   workspace_id TEXT NOT NULL,
   user_id TEXT NOT NULL,
   role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
   created_at TEXT NOT NULL DEFAULT (datetime('now')),
   UNIQUE(workspace_id, user_id),
   FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON workspace_members(workspace_id);
 `);

    return authDb;
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

function reserveWorkspaceSlug(db, preferredName) {
    const base = slugify(preferredName);
    let candidate = base;
    let suffix = 1;

    const find = db.prepare('SELECT 1 FROM workspaces WHERE slug = ? LIMIT 1');
    while (find.get(candidate)) {
        suffix += 1;
        candidate = `${base}-${suffix}`;
    }

    return candidate;
}

function createWorkspaceForUser(userId, workspaceName) {
    const db = openAuthDb();
    const workspaceId = generateId();
    const slug = reserveWorkspaceSlug(db, workspaceName);

    const tx = db.transaction(() => {
        db.prepare('INSERT INTO workspaces (id, name, owner_user_id, slug) VALUES (?, ?, ?, ?)').run(
            workspaceId,
            workspaceName,
            userId,
            slug,
        );
        db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)').run(
            workspaceId,
            userId,
            'owner',
        );
    });

    tx();

    return { id: workspaceId, name: workspaceName, slug };
}

function ensureUserHasWorkspace(userId, preferredName) {
    const db = openAuthDb();
    const membership = db
        .prepare('SELECT workspace_id AS workspaceId FROM workspace_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1')
        .get(userId);

    if (membership?.workspaceId) {
        return membership.workspaceId;
    }

    const ws = createWorkspaceForUser(userId, preferredName || 'My Workspace');
    return ws.id;
}

function createCredentialsUser({ name, email, password, workspaceName }) {
    const db = openAuthDb();
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

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (existing) {
        throw new Error('Email is already registered.');
    }

    const userId = generateId();
    const hash = bcrypt.hashSync(String(password), 10);

    const tx = db.transaction(() => {
        db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(userId, normalizedEmail, displayName, hash);
        createWorkspaceForUser(userId, String(workspaceName || `${displayName} Workspace`).trim());
    });

    tx();

    return db.prepare('SELECT id, email, name, image FROM users WHERE id = ?').get(userId);
}

function upsertOAuthUser({ email, name, image }) {
    const db = openAuthDb();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) {
        throw new Error('Google account email is missing.');
    }

    const existing = db.prepare('SELECT id, email, name, image FROM users WHERE email = ?').get(normalizedEmail);

    if (existing) {
        db.prepare('UPDATE users SET name = ?, image = ? WHERE id = ?').run(
            String(name || existing.name || 'User').trim(),
            image || null,
            existing.id,
        );
        ensureUserHasWorkspace(existing.id, `${existing.name || 'My'} Workspace`);
        return db.prepare('SELECT id, email, name, image FROM users WHERE id = ?').get(existing.id);
    }

    const userId = generateId();
    const displayName = String(name || normalizedEmail.split('@')[0] || 'User').trim();

    const tx = db.transaction(() => {
        db.prepare('INSERT INTO users (id, email, name, image) VALUES (?, ?, ?, ?)').run(userId, normalizedEmail, displayName, image || null);
        createWorkspaceForUser(userId, `${displayName} Workspace`);
    });

    tx();

    return db.prepare('SELECT id, email, name, image FROM users WHERE id = ?').get(userId);
}

function verifyCredentials({ email, password }) {
    const db = openAuthDb();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !password) {
        return null;
    }

    const user = db.prepare('SELECT id, email, name, image, password_hash as passwordHash FROM users WHERE email = ?').get(normalizedEmail);
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

function listUserWorkspaces(userId) {
    const db = openAuthDb();
    return db
        .prepare(`
   SELECT
    w.id,
    w.name,
    w.slug,
    wm.role,
    w.owner_user_id AS ownerUserId,
    w.created_at AS createdAt
   FROM workspace_members wm
   JOIN workspaces w ON w.id = wm.workspace_id
   WHERE wm.user_id = ?
   ORDER BY w.created_at ASC
  `)
        .all(userId);
}

function getDefaultWorkspaceIdByUserId(userId) {
    const db = openAuthDb();
    const row = db
        .prepare('SELECT workspace_id AS workspaceId FROM workspace_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1')
        .get(userId);
    return row?.workspaceId || null;
}

function getWorkspaceRole(userId, workspaceId) {
    const db = openAuthDb();
    const row = db
        .prepare('SELECT role FROM workspace_members WHERE user_id = ? AND workspace_id = ? LIMIT 1')
        .get(userId, workspaceId);
    return row?.role || null;
}

function assertWorkspaceAccess(userId, workspaceId) {
    const role = getWorkspaceRole(userId, workspaceId);
    if (!role) {
        throw new Error('You do not have access to this workspace.');
    }
    return role;
}

function createWorkspace(ownerUserId, name) {
    const workspaceName = String(name || '').trim();
    if (!workspaceName) {
        throw new Error('Workspace name is required.');
    }

    return createWorkspaceForUser(ownerUserId, workspaceName);
}

function addWorkspaceMemberByEmail({ workspaceId, email, role, addedByUserId }) {
    const db = openAuthDb();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedRole = String(role || 'member').trim().toLowerCase();

    if (!['admin', 'member', 'viewer'].includes(normalizedRole)) {
        throw new Error('Role must be one of: admin, member, viewer.');
    }

    const actorRole = assertWorkspaceAccess(addedByUserId, workspaceId);
    if (!['owner', 'admin'].includes(actorRole)) {
        throw new Error('Only owners and admins can add workspace members.');
    }

    const targetUser = db.prepare('SELECT id, email, name, image FROM users WHERE email = ?').get(normalizedEmail);
    if (!targetUser) {
        throw new Error('User not found. Ask them to sign up first.');
    }

    db.prepare('INSERT OR REPLACE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)').run(
        workspaceId,
        targetUser.id,
        normalizedRole,
    );

    return {
        userId: targetUser.id,
        email: targetUser.email,
        role: normalizedRole,
    };
}

function listWorkspaceMembers({ workspaceId, userId }) {
    const db = openAuthDb();
    assertWorkspaceAccess(userId, workspaceId);

    return db
        .prepare(`
   SELECT
    u.id,
    u.email,
    u.name,
    u.image,
    wm.role,
    wm.created_at AS addedAt
   FROM workspace_members wm
   JOIN users u ON u.id = wm.user_id
   WHERE wm.workspace_id = ?
   ORDER BY
    CASE wm.role
     WHEN 'owner' THEN 1
     WHEN 'admin' THEN 2
     WHEN 'member' THEN 3
     ELSE 4
    END,
    u.name COLLATE NOCASE ASC
  `)
        .all(workspaceId);
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
};
