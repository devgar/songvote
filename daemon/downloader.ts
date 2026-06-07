#!/usr/bin/env bun
/**
 * SongVote Downloader Daemon
 *
 * Polls the SongVote API, compares the song list against local files,
 * and downloads any missing tracks with yt-dlp.
 *
 * Usage:
 *   bun run daemon/downloader.ts
 *
 * Env vars:
 *   SONGVOTE_API   Base URL of the SongVote API   (default: http://localhost:3000)
 *   DOWNLOAD_DIR   Directory to save audio files  (default: ~/Music/SongVote)
 *   INTERVAL_SEC   Poll interval in seconds        (default: 300)
 *   YTDLP_BIN      Path to yt-dlp binary           (default: yt-dlp, uses PATH)
 */

import { existsSync, mkdirSync } from "fs";
import { readdir } from "fs/promises";
import { join, resolve } from "path";
import { spawn } from "child_process";

const API        = (process.env.SONGVOTE_API  ?? "http://localhost:3000").replace(/\/$/, "");
const YTDLP      = process.env.YTDLP_BIN      ?? "yt-dlp";
const INTERVAL   = Number(process.env.INTERVAL_SEC ?? 300) * 1000;
const DOWNLOAD_DIR = resolve(
  process.env.DOWNLOAD_DIR ?? join(process.env.HOME ?? "~", "Music", "SongVote")
);

// ── Types ──────────────────────────────────────────────────────────────────

type Song = {
  id: string;
  title: string;
  artist: string;
  youtube_url: string;
  votes: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    log(`Carpeta creada: ${dir}`);
  }
}

// Returns the set of YouTube video IDs already downloaded.
// yt-dlp names files as "<title> [<videoId>].<ext>", so we extract the ID from [brackets].
async function downloadedIds(dir: string): Promise<Set<string>> {
  const files = await readdir(dir).catch(() => [] as string[]);
  const ids = new Set<string>();
  for (const f of files) {
    const m = f.match(/\[([A-Za-z0-9_\-]{11})\]\.[^.]+$/);
    if (m) ids.add(m[1]);
  }
  return ids;
}

async function fetchSongs(): Promise<Song[]> {
  const res = await fetch(`${API}/songs`);
  if (!res.ok) throw new Error(`API respondió ${res.status}`);
  return res.json() as Promise<Song[]>;
}

function download(song: Song): Promise<void> {
  return new Promise((resolve, reject) => {
    log(`  ↓ Descargando: ${song.artist} — ${song.title} [${song.id}]`);

    const args = [
      // Best audio, prefer opus/m4a
      "-f", "bestaudio[ext=opus]/bestaudio[ext=m4a]/bestaudio",
      "--extract-audio",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      // Embed metadata and thumbnail
      "--embed-thumbnail",
      "--add-metadata",
      // Output template: "Artist - Title [videoId].mp3"
      "-o", join(DOWNLOAD_DIR, "%(uploader)s - %(title)s [%(id)s].%(ext)s"),
      // Don't re-download if already present (belt-and-suspenders)
      "--no-overwrites",
      `https://www.youtube.com/watch?v=${song.id}`,
    ];

    const proc = spawn(YTDLP, args, { stdio: ["ignore", "pipe", "pipe"] });

    proc.stdout.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line) process.stdout.write(`    ${line}\n`);
    });
    proc.stderr.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line) process.stderr.write(`    [err] ${line}\n`);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        log(`  ✓ Listo: ${song.title}`);
        resolve();
      } else {
        reject(new Error(`yt-dlp salió con código ${code}`));
      }
    });
    proc.on("error", reject);
  });
}

// ── Main loop ──────────────────────────────────────────────────────────────

async function tick() {
  log("Comprobando lista de canciones…");
  try {
    ensureDir(DOWNLOAD_DIR);

    const [songs, already] = await Promise.all([
      fetchSongs(),
      downloadedIds(DOWNLOAD_DIR),
    ]);

    const missing = songs.filter(s => !already.has(s.id));

    if (!missing.length) {
      log(`Sin novedades — ${songs.length} canciones, todas descargadas.`);
      return;
    }

    log(`${missing.length} canción(es) nueva(s) para descargar:`);
    for (const song of missing) {
      try {
        await download(song);
      } catch (err) {
        log(`  ✗ Error con "${song.title}": ${(err as Error).message}`);
        // Continúa con las demás aunque falle una
      }
    }
  } catch (err) {
    log(`ERROR en tick: ${(err as Error).message}`);
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────

log(`SongVote Downloader iniciado`);
log(`  API:          ${API}`);
log(`  Destino:      ${DOWNLOAD_DIR}`);
log(`  Intervalo:    ${INTERVAL / 1000}s`);
log(`  yt-dlp:       ${YTDLP}`);
log("");

// Run immediately, then on interval
tick();
setInterval(tick, INTERVAL);
