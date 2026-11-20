/* eslint-disable @typescript-eslint/no-require-imports */
// Rate limiting + security event log, both Postgres-backed (Neon) so no extra service is
// needed. Used by the auth routes, the credentials authorize(), the admin unlock, invites and
// the AI routes.
const { getPool, ensurePublicSchema } = require('@/server/postgres');

// ---------------------------------------------------------------------------------------
// Client identity
// ---------------------------------------------------------------------------------------

// Works with a WHATWG Headers object (NextRequest.headers) or the plain header object
// next-auth hands to authorize(). On Vercel the first x-forwarded-for hop is the client.
function readHeader(headers, name) {
    if (!headers) return '';
    if (typeof headers.get === 'function') return headers.get(name) || '';
    const value = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] || '' : String(value || '');
}

function getClientIp(headers) {
    const forwarded = readHeader(headers, 'x-forwarded-for');
    const first = forwarded.split(',')[0].trim();
    return first || readHeader(headers, 'x-real-ip').trim() || 'unknown';
}

function getUserAgent(headers) {
    return readHeader(headers, 'user-agent').slice(0, 300);
}

// ---------------------------------------------------------------------------------------
// Rate limiting — fixed window per key
// ---------------------------------------------------------------------------------------

// Counts one hit against `key` and reports whether it is still within `limit` for the
// current window. One atomic UPSERT: the window resets itself once it has elapsed (SET
// expressions see the row's OLD values, so both CASEs judge the same window).
async function consumeRateLimit(key, { limit, windowSeconds }) {
    await ensurePublicSchema();
    const { rows } = await getPool().query(
        `INSERT INTO rate_limits (key, count, window_start) VALUES ($1, 1, NOW())
         ON CONFLICT (key) DO UPDATE SET
             count = CASE WHEN rate_limits.window_start <= NOW() - make_interval(secs => $2::double precision)
                          THEN 1 ELSE rate_limits.count + 1 END,
             window_start = CASE WHEN rate_limits.window_start <= NOW() - make_interval(secs => $2::double precision)
                                 THEN NOW() ELSE rate_limits.window_start END
         RETURNING count,
                   GREATEST(0, CEIL(EXTRACT(EPOCH FROM (window_start + make_interval(secs => $2::double precision) - NOW()))))::int AS "retryAfter"`,
        [String(key), Number(windowSeconds)],
    );

    // Opportunistic cleanup so the table doesn't grow without bound.
    if (Math.random() < 0.02) {
        getPool()
            .query("DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '2 days'")
            .catch(() => {});
    }

    const count = Number(rows[0]?.count) || 0;
    return { allowed: count <= limit, count, retryAfterSeconds: Number(rows[0]?.retryAfter) || windowSeconds };
}

// Reads the current count for `key` without counting a hit (e.g. "is this login locked?").
async function peekRateLimit(key, { windowSeconds }) {
    await ensurePublicSchema();
    const { rows } = await getPool().query(
        `SELECT count,
                GREATEST(0, CEIL(EXTRACT(EPOCH FROM (window_start + make_interval(secs => $2::double precision) - NOW()))))::int AS "retryAfter"
           FROM rate_limits
          WHERE key = $1 AND window_start > NOW() - make_interval(secs => $2::double precision)`,
        [String(key), Number(windowSeconds)],
    );
    return { count: Number(rows[0]?.count) || 0, retryAfterSeconds: Number(rows[0]?.retryAfter) || 0 };
}

async function resetRateLimit(key) {
    await ensurePublicSchema();
    await getPool().query('DELETE FROM rate_limits WHERE key = $1', [String(key)]);
}

// Named budgets, so limits live in one place. windowSeconds / limit.
const LIMITS = {
    // Failed logins per (identifier, IP) and per identifier overall. Scoping the strict limit
    // to the pair means one attacker can't lock a victim out from everywhere; the looser
    // global limit still catches a distributed guess campaign against one account.
    loginPair: { limit: 5, windowSeconds: 15 * 60 },
    loginIdentifier: { limit: 20, windowSeconds: 15 * 60 },
    loginIp: { limit: 50, windowSeconds: 15 * 60 },
    mfa: { limit: 5, windowSeconds: 15 * 60 },
    signupIp: { limit: 5, windowSeconds: 60 * 60 },
    signupEmail: { limit: 3, windowSeconds: 60 * 60 },
    codeVerifyIp: { limit: 30, windowSeconds: 60 * 60 },
    recoveryIdentifier: { limit: 3, windowSeconds: 60 * 60 },
    recoveryIp: { limit: 10, windowSeconds: 60 * 60 },
    tokenIp: { limit: 20, windowSeconds: 15 * 60 },
    reauth: { limit: 5, windowSeconds: 15 * 60 },
    adminUnlock: { limit: 5, windowSeconds: 15 * 60 },
    invitesWorkspace: { limit: 20, windowSeconds: 24 * 60 * 60 },
    aiUser: { limit: 60, windowSeconds: 60 * 60 },
};

// Convenience: consume one named budget; returns { allowed, retryAfterSeconds }.
async function hit(name, scope) {
    const budget = LIMITS[name];
    if (!budget) throw new Error(`Unknown rate limit: ${name}`);
    return consumeRateLimit(`${name}:${scope}`, budget);
}

// ---------------------------------------------------------------------------------------
// Security event log
// ---------------------------------------------------------------------------------------

// Best-effort: a logging failure must never break the action being logged.
async function logSecurityEvent({ userId, identifier, event, headers, meta } = {}) {
    if (!event) return;
    try {
        await ensurePublicSchema();
        await getPool().query(
            `INSERT INTO security_events (user_id, identifier, event, ip, user_agent, meta)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                userId || null,
                identifier ? String(identifier).trim().toLowerCase().slice(0, 200) : null,
                String(event),
                headers ? getClientIp(headers) : null,
                headers ? getUserAgent(headers) : null,
                meta ? JSON.stringify(meta) : null,
            ],
        );
    } catch (error) {
        console.error('[security] failed to log event:', error && error.message);
    }
}

// The signed-in user's own recent activity (Account → Security).
async function listSecurityEventsForUser(userId, { limit = 20 } = {}) {
    await ensurePublicSchema();
    const cap = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const { rows } = await getPool().query(
        `SELECT id, event, ip, user_agent AS "userAgent", meta, created_at AS "createdAt"
           FROM security_events
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [userId, cap],
    );
    return rows;
}

// Platform-wide feed for the super-admin audit page.
async function listRecentSecurityEvents({ limit = 100 } = {}) {
    await ensurePublicSchema();
    const cap = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const { rows } = await getPool().query(
        `SELECT e.id, e.user_id AS "userId", e.identifier, e.event, e.ip, e.meta, e.created_at AS "createdAt",
                u.email AS "userEmail", u.name AS "userName"
           FROM security_events e
           LEFT JOIN users u ON u.id = e.user_id
          ORDER BY e.created_at DESC
          LIMIT $1`,
        [cap],
    );
    return rows;
}

module.exports = {
    getClientIp,
    getUserAgent,
    consumeRateLimit,
    peekRateLimit,
    resetRateLimit,
    hit,
    LIMITS,
    logSecurityEvent,
    listSecurityEventsForUser,
    listRecentSecurityEvents,
};
