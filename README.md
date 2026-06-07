# 🎵 SongVote

Lista de canciones compartida con votación por IP. **Bun + Elysia + SQLite**.

## Estructura

```
songvote/
├── src/
│   ├── index.ts    # Entry point — servidor, CORS, frontend estático
│   ├── routes.ts   # Rutas /songs
│   └── db.ts       # SQLite + repositorio + transacciones
├── public/
│   └── index.html  # Frontend (vanilla JS, IBM Plex Mono + Bebas Neue)
├── daemon/
│   └── downloader.ts  # Script de descarga con yt-dlp
├── db/                # songvote.sqlite (se crea al iniciar)
├── Dockerfile
└── package.json
```

---

## Desarrollo local

```bash
bun install
bun dev          # hot reload en http://localhost:3000
```

---

## Deploy con Docker (VPS)

### Build

```bash
docker build -t songvote .
```

### Ejecutar

```bash
# La BD persiste en un volumen para sobrevivir reinicios
docker run -d \
  --name songvote \
  --restart unless-stopped \
  -p 3000:3000 \
  -v songvote_db:/app/db \
  songvote
```

### Con docker-compose

```yaml
services:
  songvote:
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - songvote_db:/app/db

volumes:
  songvote_db:
```

### Nginx reverse proxy (recomendado)

```nginx
server {
    listen 80;
    server_name tudominio.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $host;
    }
}
```

> **Importante:** El header `X-Real-IP` / `X-Forwarded-For` es el que usa la app para identificar votos por IP.
> Sin el proxy pass correcto todos los votos vendrán de la IP del proxy.

---

## Daemon de descarga (macOS)

El daemon `daemon/downloader.ts` corre en tu máquina local, consulta la API cada N segundos y descarga con `yt-dlp` las canciones que falten.

### Variables de entorno

| Variable       | Por defecto                        | Descripción                     |
|----------------|------------------------------------|---------------------------------|
| `SONGVOTE_API` | `http://localhost:3000`            | URL base de la API              |
| `DOWNLOAD_DIR` | `~/Music/SongVote`                 | Carpeta de destino              |
| `INTERVAL_SEC` | `300`                              | Segundos entre comprobaciones   |
| `YTDLP_BIN`    | `/Users/ed/.nix-profile/bin/yt-dlp` | Ruta al binario yt-dlp          |

### Ejecutar manualmente

```bash
bun run daemon/downloader.ts

# O con variables personalizadas:
SONGVOTE_API=https://tudominio.com INTERVAL_SEC=60 bun run daemon/downloader.ts
```


---

## API

| Método | Ruta                    | Descripción                                    |
|--------|-------------------------|------------------------------------------------|
| GET    | /                       | Frontend HTML                                  |
| GET    | /health                 | Health check                                   |
| GET    | /docs                   | Swagger UI                                     |
| GET    | /songs                  | Listar canciones (orden por votos desc)        |
| GET    | /songs/:videoId         | Obtener canción por video ID                   |
| POST   | /songs/:videoId/vote    | Votar — upsert canción + registra voto         |
| DELETE | /songs/:videoId/vote    | Retirar voto                                   |
| DELETE | /songs/:videoId         | Eliminar canción                               |

---

## YouTube API Key

La búsqueda en la app necesita una [YouTube Data API v3 key](https://console.cloud.google.com/):

1. Google Cloud Console → nuevo proyecto
2. Habilitar **YouTube Data API v3**
3. Crear **API Key** en Credentials
4. Introducirla en la app (se guarda en `localStorage`)

---

## Esquema SQLite

```sql
songs (id TEXT PK, title, artist, thumb_url, created_at)
votes (song_id TEXT → songs.id CASCADE, ip TEXT, created_at)
      PRIMARY KEY (song_id, ip)
```
