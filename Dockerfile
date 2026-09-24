# Jhino: one container, one volume at /data. Everything Jhino writes goes to /data;
# the image itself is never written to, so a redeploy loses nothing.
FROM node:22-bookworm-slim AS build
# Tools to compile native modules (better-sqlite3) when no prebuilt binary is downloaded.
# They stay in this stage only; the final image does not have them.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
# --include=dev: the build needs Vite and TypeScript even if NODE_ENV=production is set for the build.
RUN npm ci --include=dev
COPY . .
# Build, then drop devDependencies. The compiled better-sqlite3 stays in node_modules and is copied
# to the final stage, which uses the same base image (same Node version and system libraries).
# The image uses the system ffmpeg (below), so the bundled copy from npm is not shipped.
RUN npm run build && npm prune --omit=dev && rm -rf node_modules/ffmpeg-static

FROM node:22-bookworm-slim
# ffmpeg makes big uploaded videos smaller (COMPRESS_VIDEO_MB, 0 turns it off).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4310 \
    DATA_DIR=/data \
    BACKUP_DIR=/data/backups \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    JHINO_SKIP_ENV_FILE=1
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/runtime ./runtime
COPY --from=build /app/builder ./builder
# Runs as the unprivileged "node" user (uid 1000). A new Docker volume at /data takes this ownership;
# if a mounted folder is not writable by uid 1000, Jhino stops at start with a message saying so.
RUN mkdir -p /data/backups && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4310)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "dist/server/index.js"]
