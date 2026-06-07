import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import { songsRouter } from "./routes";
import { readFileSync } from "fs";
import { join } from "path";

const PORT = Number(process.env.PORT ?? 3000);
const IS_DEV = process.env.NODE_ENV !== "production";
const HTML_PATH = join(import.meta.dir, "../public/index.html");

// In production, read once at startup; in dev, read on every request so
// you can edit the HTML without restarting the server.
const staticHtml = IS_DEV ? null : readFileSync(HTML_PATH, "utf8");
const getHtml = () => staticHtml ?? readFileSync(HTML_PATH, "utf8");

const app = new Elysia()
  // CORS — needed if the frontend is ever served from a different origin.
  // With same-origin serving (Elysia serving the HTML) this is a no-op,
  // but it keeps the API usable from curl / Swagger / other clients.
  .use(cors({
    origin: true,           // reflect the request Origin
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: false,
  }))

  .use(swagger({
    path: "/docs",
    documentation: {
      info: {
        title: "SongVote API",
        version: "1.0.0",
        description: "API para sugerir canciones y votarlas",
      },
    },
  }))

  // ── Frontend ────────────────────────────────────────────────────────────
  .get("/", () =>
    new Response(getHtml(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  )

  // ── System ──────────────────────────────────────────────────────────────
  .get("/health", () => ({ status: "ok", ts: new Date().toISOString() }), {
    detail: { tags: ["System"], summary: "Health check" },
  })

  .use(songsRouter)

  .listen(PORT);

console.log(`🎵 SongVote → http://localhost:${PORT}`);
console.log(`📖 Swagger  → http://localhost:${PORT}/docs`);
console.log(`🛠  Modo     → ${IS_DEV ? "desarrollo" : "producción"}`);
