import { Elysia, t } from "elysia";
import { songRepo } from "./db";

function getClientIp(request: Request, server: any): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    server?.requestIP(request)?.address ??
    "unknown"
  );
}

// Body required when voting for the first time (song may not exist yet)
const VoteBody = t.Object({
  title:     t.String({ minLength: 1, description: "Título de la canción" }),
  artist:    t.String({ minLength: 1, description: "Artista" }),
  thumb_url: t.Optional(t.String({ description: "URL del thumbnail" })),
});

export const songsRouter = new Elysia({ prefix: "/songs", tags: ["Songs"] })

  // GET /songs
  .get("/", () => songRepo.list(), {
    detail: {
      summary: "Listar canciones",
      description: "Ordenadas por votos desc. El campo youtube_url se calcula a partir del ID.",
    },
  })

  // GET /songs/:videoId
  .get("/:videoId", ({ params, error }) => {
    const song = songRepo.getById(params.videoId);
    if (!song) return error(404, { message: "Canción no encontrada" });
    return song;
  }, {
    params: t.Object({ videoId: t.String() }),
    detail: { summary: "Obtener canción por video ID de YouTube" },
  })

  // POST /songs/:videoId/vote
  // First voter must include title + artist in body so the song can be created.
  // Subsequent voters hit the same endpoint — song already exists, only vote is recorded.
  .post("/:videoId/vote", ({ params, body, request, server, error }) => {
    const ip = getClientIp(request, server);
    const result = songRepo.vote({ id: params.videoId, ...body }, ip);

    if (!result.ok)
      return error(409, { message: "Ya votaste por esta canción desde tu IP" });

    return result.song;
  }, {
    params: t.Object({ videoId: t.String() }),
    body: VoteBody,
    detail: {
      summary: "Votar por una canción (upsert)",
      description:
        "Si la canción no existe la crea y registra el voto. " +
        "Si ya existe solo registra el voto. " +
        "Devuelve 409 si esta IP ya votó por esta canción.",
    },
  })

  // DELETE /songs/:videoId/vote — retirar voto
  .delete("/:videoId/vote", ({ params, request, server, error }) => {
    const ip = getClientIp(request, server);
    const result = songRepo.unvote(params.videoId, ip);

    if (!result.ok)
      return error(409, { message: "No tienes un voto registrado para esta canción" });

    return result.song;
  }, {
    params: t.Object({ videoId: t.String() }),
    detail: { summary: "Retirar voto" },
  })

  // DELETE /songs/:videoId
  .delete("/:videoId", ({ params, error }) => {
    const deleted = songRepo.delete(params.videoId);
    if (!deleted) return error(404, { message: "Canción no encontrada" });
    return { message: "Eliminada correctamente" };
  }, {
    params: t.Object({ videoId: t.String() }),
    detail: { summary: "Eliminar canción de la lista" },
  });
