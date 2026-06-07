import { Database } from "bun:sqlite";

const db = new Database("db/songvote.sqlite", { create: true });

db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA foreign_keys = ON;");

db.run(`
  CREATE TABLE IF NOT EXISTS songs (
    id          TEXT PRIMARY KEY,  -- YouTube video ID
    title       TEXT NOT NULL,
    artist      TEXT NOT NULL,
    thumb_url   TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS votes (
    song_id    TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    ip         TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (song_id, ip)
  )
`);

// ── Types ──────────────────────────────────────────────────────────────────

export type Song = {
  id: string;
  title: string;
  artist: string;
  youtube_url: string; // computed in queries
  thumb_url: string | null;
  votes: number;
  created_at: string;
};

export type VoteResult =
  | { ok: true; song: Song }
  | { ok: false; reason: "already_voted" };

// ── Helpers ────────────────────────────────────────────────────────────────

const ytUrl = (id: string) => `https://music.youtube.com/watch?v=${id}`;

// Base SELECT — computes youtube_url and vote count on the fly
const SELECT_SONG = `
  SELECT
    s.id,
    s.title,
    s.artist,
    ('https://music.youtube.com/watch?v=' || s.id) AS youtube_url,
    s.thumb_url,
    s.created_at,
    (SELECT COUNT(*) FROM votes v WHERE v.song_id = s.id) AS votes
  FROM songs s
`;

// ── Prepared statements ────────────────────────────────────────────────────

const stmts = {
  list: db.query<Song, []>(
    `${SELECT_SONG} ORDER BY votes DESC, s.created_at ASC`
  ),

  getById: db.query<Song, [string]>(
    `${SELECT_SONG} WHERE s.id = ?`
  ),

  // Won't fail if the song already exists (another user voting same song)
  upsertSong: db.prepare(`
    INSERT OR IGNORE INTO songs (id, title, artist, thumb_url)
    VALUES ($id, $title, $artist, $thumb_url)
  `),

  // Won't fail if the vote already exists — we check changes() after
  insertVote: db.prepare(`
    INSERT OR IGNORE INTO votes (song_id, ip) VALUES (?, ?)
  `),

  deleteVote: db.prepare(`
    DELETE FROM votes WHERE song_id = ? AND ip = ?
  `),

  changes: db.query<{ n: number }, []>("SELECT changes() AS n"),

  delete: db.query<{ id: string }, [string]>(
    `DELETE FROM songs WHERE id = ? RETURNING id`
  ),
};

// ── Transactions ───────────────────────────────────────────────────────────

// Atomic: upsert song + insert vote in one transaction
const txVote = db.transaction(
  (song: { id: string; title: string; artist: string; thumb_url?: string }, ip: string): VoteResult => {
    stmts.upsertSong.run({
      $id: song.id,
      $title: song.title,
      $artist: song.artist,
      $thumb_url: song.thumb_url ?? null,
    });

    stmts.insertVote.run(song.id, ip);
    const { n } = stmts.changes.get()!;

    if (n === 0) return { ok: false, reason: "already_voted" };

    return { ok: true, song: stmts.getById.get(song.id)! };
  }
);

// ── Repository ─────────────────────────────────────────────────────────────

export const songRepo = {
  list: (): Song[] => stmts.list.all(),

  getById: (id: string): Song | null => stmts.getById.get(id) ?? null,

  // Vote (and register the song if it doesn't exist yet)
  vote: (
    song: { id: string; title: string; artist: string; thumb_url?: string },
    ip: string
  ): VoteResult => txVote(song, ip),

  // Withdraw vote — song stays in the list
  unvote: (songId: string, ip: string): VoteResult => {
    const song = stmts.getById.get(songId);
    if (!song) return { ok: false, reason: "already_voted" }; // reused as "nothing to unvote"

    stmts.deleteVote.run(songId, ip);
    const { n } = stmts.changes.get()!;
    if (n === 0) return { ok: false, reason: "already_voted" };

    return { ok: true, song: stmts.getById.get(songId)! };
  },

  delete: (id: string): boolean => stmts.delete.get(id) !== null,
};
