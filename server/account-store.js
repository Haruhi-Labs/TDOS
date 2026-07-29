import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import Database from "better-sqlite3";

export const COMPETITIVE_MODES = Object.freeze(["pvp", "pvp2v2", "stellar3v3"]);
export const INITIAL_ELO = 1000;
export const ELO_K_FACTOR = 32;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const USERNAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const scryptAsync = promisify(scrypt);

export class AccountStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AccountStoreError";
    this.code = code;
  }
}

function nowMs() {
  return Date.now();
}

function normalizeUsername(value) {
  const username = String(value || "").trim().normalize("NFC");
  if (username.length < 3 || username.length > 16) {
    throw new AccountStoreError("invalid_username", "Username must be 3 to 16 characters.");
  }
  if (!/^[\p{L}\p{N}_-]+$/u.test(username)) {
    throw new AccountStoreError("invalid_username", "Username contains unsupported characters.");
  }
  return username;
}

function usernameKey(username) {
  return username.toLocaleLowerCase("en-US");
}

function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 8 || password.length > 128) {
    throw new AccountStoreError("invalid_password", "Password must be 8 to 128 characters.");
  }
  return password;
}

async function hashPassword(password, salt = randomBytes(16)) {
  return { salt, hash: await scryptAsync(password, salt, 64) };
}

async function verifyPassword(password, salt, expectedHash) {
  const actualHash = await scryptAsync(password, salt, 64);
  return actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash);
}

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    signature: row.signature || "",
    avatarKey: row.avatar_key || null,
    loadout: row.loadout_json ? JSON.parse(row.loadout_json) : null,
    usernameChangedAt: row.username_changed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRating(row) {
  return {
    userId: row.user_id,
    elo: row.elo,
    wins: row.wins,
    losses: row.losses,
    games: row.games,
    updatedAt: row.updated_at,
  };
}

function ensureCompetitiveMode(mode) {
  if (!COMPETITIVE_MODES.includes(mode)) {
    throw new AccountStoreError("invalid_mode", "Only 1v1, 2v2, and 3v3 PvP modes are competitive.");
  }
  return mode;
}

function expectedScore(rating, opponentRating) {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

export function createAccountStore({
  databasePath = path.resolve("data", "users.sqlite"),
  sessionSecret,
  clock = nowMs,
} = {}) {
  if (!sessionSecret || String(sessionSecret).length < 16) {
    throw new Error("SESSION_SECRET must contain at least 16 characters.");
  }
  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }

  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);

  const selectUserById = db.prepare("SELECT * FROM users WHERE id = ?");
  const selectUserByKey = db.prepare("SELECT * FROM users WHERE username_key = ?");
  const selectRating = db.prepare("SELECT * FROM ratings WHERE user_id = ?");

  function ensureRating(userId, at = clock()) {
    db.prepare(
      `INSERT OR IGNORE INTO ratings (user_id, elo, wins, losses, games, updated_at)
       VALUES (?, ?, 0, 0, 0, ?)`,
    ).run(userId, INITIAL_ELO, at);
    return toRating(selectRating.get(userId));
  }

  function getUserById(userId) {
    return toUser(selectUserById.get(userId));
  }

  function getPublicUser(userId) {
    const user = getUserById(userId);
    if (!user) return null;
    const rating = ensureRating(userId);
    return {
      id: user.id,
      username: user.username,
      signature: user.signature,
      avatarKey: user.avatarKey,
      elo: rating.elo,
      wins: rating.wins,
      losses: rating.losses,
      games: rating.games,
    };
  }

  async function register({ username, password, loadout = null }) {
    const normalizedUsername = normalizeUsername(username);
    const safePassword = validatePassword(password);
    const { salt, hash } = await hashPassword(safePassword);
    const userId = randomUUID();
    const at = clock();
    try {
      db.prepare(
        `INSERT INTO users (
          id, username, username_key, password_salt, password_hash, signature,
          loadout_json, username_changed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
      ).run(
        userId,
        normalizedUsername,
        usernameKey(normalizedUsername),
        salt,
        hash,
        loadout === null ? null : JSON.stringify(loadout),
        null,
        at,
        at,
      );
    } catch (error) {
      if (String(error?.code || "").startsWith("SQLITE_CONSTRAINT")) {
        throw new AccountStoreError("username_taken", "That username is already taken.");
      }
      throw error;
    }
    ensureRating(userId, at);
    return getUserById(userId);
  }

  async function authenticate({ username, password }) {
    const normalizedUsername = String(username || "").trim().normalize("NFC");
    const row = selectUserByKey.get(usernameKey(normalizedUsername));
    if (!row || !await verifyPassword(String(password || ""), row.password_salt, row.password_hash)) return null;
    return toUser(row);
  }

  function sessionDigest(token) {
    return createHmac("sha256", String(sessionSecret)).update(token).digest("hex");
  }

  function createSession(userId, { ttlMs = SESSION_TTL_MS } = {}) {
    if (!getUserById(userId)) {
      throw new AccountStoreError("user_not_found", "Cannot create a session for an unknown user.");
    }
    const token = randomBytes(32).toString("base64url");
    const at = clock();
    db.prepare(
      `INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(sessionDigest(token), userId, at + ttlMs, at, at);
    return { token, expiresAt: at + ttlMs };
  }

  function getSessionUser(token, { touch = true } = {}) {
    if (!token) return null;
    const tokenHash = sessionDigest(String(token));
    const session = db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash);
    if (!session) return null;
    if (session.expires_at <= clock()) {
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
      return null;
    }
    if (touch) {
      db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(clock(), tokenHash);
    }
    return getUserById(session.user_id);
  }

  function revokeSession(token) {
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sessionDigest(String(token)));
  }

  function getRating(userId) {
    return ensureRating(userId);
  }

  function getLeaderboard(limit = 100) {
    const cappedLimit = Math.max(1, Math.min(Number(limit) || 100, 100));
    return db.prepare(
       `SELECT r.user_id, r.elo, r.wins, r.losses, r.games, r.updated_at,
               u.username, u.signature, u.avatar_key
        FROM ratings r JOIN users u ON u.id = r.user_id
        ORDER BY r.elo DESC, r.games DESC, u.created_at ASC LIMIT ?`,
    ).all(cappedLimit).map((row, index) => ({
      rank: index + 1,
      userId: row.user_id,
      username: row.username,
      signature: row.signature || "",
      avatarKey: row.avatar_key || null,
      elo: row.elo,
      wins: row.wins,
      losses: row.losses,
      games: row.games,
      updatedAt: row.updated_at,
    }));
  }

  function getRank(userId) {
    const user = getUserById(userId);
    if (!user) return null;
    const rating = ensureRating(userId);
    const row = db.prepare(
      `SELECT 1 + COUNT(*) AS rank
        FROM ratings r
        JOIN users u ON u.id = r.user_id
        WHERE (
          r.elo > ? OR
          (r.elo = ? AND r.games > ?) OR
          (r.elo = ? AND r.games = ? AND u.created_at < ?)
        )`,
    ).get(rating.elo, rating.elo, rating.games, rating.elo, rating.games, user.createdAt);
    return Number(row.rank);
  }

  const settleCompetitiveMatch = db.transaction(({ matchId, mode, winnerAllianceId, finishedAt = clock(), players }) => {
    ensureCompetitiveMode(mode);
    const normalizedMatchId = String(matchId || "").trim();
    if (!normalizedMatchId || (winnerAllianceId !== "A" && winnerAllianceId !== "B")) {
      throw new AccountStoreError("invalid_match", "A match ID and winning alliance are required.");
    }
    if (!Array.isArray(players) || players.length === 0) {
      throw new AccountStoreError("invalid_match", "Competitive matches need human participants.");
    }
    if (db.prepare("SELECT id FROM matches WHERE id = ?").get(normalizedMatchId)) {
      return { settled: false, reason: "already_settled" };
    }

    const seenUserIds = new Set();
    const byAlliance = { A: [], B: [] };
    for (const participant of players) {
      const userId = String(participant?.userId || "");
      const allianceId = participant?.allianceId;
      if (!userId || (allianceId !== "A" && allianceId !== "B") || seenUserIds.has(userId) || !getUserById(userId)) {
        throw new AccountStoreError("invalid_match", "Competitive participant data is invalid.");
      }
      seenUserIds.add(userId);
      byAlliance[allianceId].push(userId);
    }
    if (byAlliance.A.length === 0 || byAlliance.B.length === 0) return { settled: false, reason: "not_human_pvp" };

    const ratings = new Map();
    for (const userId of seenUserIds) ratings.set(userId, ensureRating(userId, finishedAt));
    const average = (ids) => ids.reduce((sum, id) => sum + ratings.get(id).elo, 0) / ids.length;
    const averageA = average(byAlliance.A);
    const averageB = average(byAlliance.B);
    const scoreA = winnerAllianceId === "A" ? 1 : 0;
    const deltaA = Math.round(ELO_K_FACTOR * (scoreA - expectedScore(averageA, averageB)));
    const deltaB = Math.round(ELO_K_FACTOR * ((1 - scoreA) - expectedScore(averageB, averageA)));

    db.prepare("INSERT INTO matches (id, mode, winner_alliance_id, finished_at, settled_at) VALUES (?, ?, ?, ?, ?)")
      .run(normalizedMatchId, mode, winnerAllianceId, finishedAt, clock());
    const updateRating = db.prepare(
      `UPDATE ratings SET elo = ?, wins = wins + ?, losses = losses + ?, games = games + 1, updated_at = ?
       WHERE user_id = ?`,
    );
    const insertMatchPlayer = db.prepare(
      `INSERT INTO match_players (match_id, user_id, alliance_id, elo_before, elo_after, elo_delta, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const changes = [];
    for (const allianceId of ["A", "B"]) {
      const won = allianceId === winnerAllianceId;
      const delta = allianceId === "A" ? deltaA : deltaB;
      for (const userId of byAlliance[allianceId]) {
        const before = ratings.get(userId).elo;
        const after = before + delta;
        updateRating.run(after, won ? 1 : 0, won ? 0 : 1, finishedAt, userId);
        insertMatchPlayer.run(normalizedMatchId, userId, allianceId, before, after, delta, won ? "win" : "loss");
        changes.push({ userId, allianceId, before, after, delta, outcome: won ? "win" : "loss" });
      }
    }
    return { settled: true, changes };
  });

  function updateProfile(userId, { username, signature, loadout } = {}) {
    const current = getUserById(userId);
    if (!current) throw new AccountStoreError("user_not_found", "User does not exist.");
    const at = clock();
    let nextUsername = current.username;
    let nextUsernameKey = usernameKey(current.username);
    let usernameChangedAt = current.usernameChangedAt;
    if (username !== undefined) {
      nextUsername = normalizeUsername(username);
      nextUsernameKey = usernameKey(nextUsername);
      if (nextUsernameKey !== usernameKey(current.username)) {
        if (usernameChangedAt && at - usernameChangedAt < USERNAME_COOLDOWN_MS) {
          throw new AccountStoreError("username_cooldown", "Username can only be changed once every 30 days.");
        }
        usernameChangedAt = at;
      }
    }
    const nextSignature = signature === undefined ? current.signature : String(signature || "").trim().slice(0, 160);
    const nextLoadout = loadout === undefined ? current.loadout : loadout;
    try {
      db.prepare(
        `UPDATE users SET username = ?, username_key = ?, signature = ?, loadout_json = ?, username_changed_at = ?, updated_at = ?
         WHERE id = ?`,
      ).run(nextUsername, nextUsernameKey, nextSignature, nextLoadout === null ? null : JSON.stringify(nextLoadout), usernameChangedAt, at, userId);
    } catch (error) {
      if (String(error?.code || "").startsWith("SQLITE_CONSTRAINT")) {
        throw new AccountStoreError("username_taken", "That username is already taken.");
      }
      throw error;
    }
    return getUserById(userId);
  }

  function setAvatarKey(userId, avatarKey) {
    if (!getUserById(userId)) throw new AccountStoreError("user_not_found", "User does not exist.");
    db.prepare("UPDATE users SET avatar_key = ?, updated_at = ? WHERE id = ?").run(avatarKey || null, clock(), userId);
    return getUserById(userId);
  }

  return {
    register,
    authenticate,
    createSession,
    getSessionUser,
    revokeSession,
    getUserById,
    getPublicUser,
    getRating,
    getLeaderboard,
    getRank,
    settleCompetitiveMatch,
    updateProfile,
    setAvatarKey,
    close: () => db.close(),
  };
}

function migrate(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const isApplied = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?");

  if (!isApplied.get(1)) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE,
          password_salt BLOB NOT NULL, password_hash BLOB NOT NULL, signature TEXT NOT NULL DEFAULT '',
          avatar_key TEXT, loadout_json TEXT, username_changed_at INTEGER,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
        CREATE TABLE IF NOT EXISTS ratings (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, mode TEXT NOT NULL, elo INTEGER NOT NULL,
          wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, games INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, mode)
        );
        CREATE INDEX IF NOT EXISTS ratings_leaderboard ON ratings(mode, elo DESC, games DESC);
        CREATE TABLE IF NOT EXISTS matches (
          id TEXT PRIMARY KEY, mode TEXT NOT NULL, winner_alliance_id TEXT NOT NULL,
          finished_at INTEGER NOT NULL, settled_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS match_players (
          match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, alliance_id TEXT NOT NULL,
          elo_before INTEGER NOT NULL, elo_after INTEGER NOT NULL, elo_delta INTEGER NOT NULL, outcome TEXT NOT NULL,
          PRIMARY KEY (match_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS match_players_user ON match_players(user_id, match_id);
      `);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)").run(Date.now());
    })();
  }

  if (!isApplied.get(2)) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE ratings_v2 (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          elo INTEGER NOT NULL, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,
          games INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
        );
        INSERT INTO ratings_v2 (user_id, elo, wins, losses, games, updated_at)
        SELECT id, ${INITIAL_ELO}, 0, 0, 0, updated_at FROM users;
        DROP TABLE ratings;
        ALTER TABLE ratings_v2 RENAME TO ratings;
        CREATE INDEX ratings_leaderboard ON ratings(elo DESC, games DESC);
      `);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)").run(Date.now());
    })();
  }
}
