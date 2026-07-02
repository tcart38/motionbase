# ── Stage 1: build frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install
COPY frontend/ ./
RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Install ffmpeg, Python, and yt-dlp
RUN apk add --no-cache ffmpeg python3 py3-pip && \
    pip3 install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app

# Install backend deps
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install --omit=dev

# Copy backend source
COPY backend/src ./src

# Copy built frontend into backend's public dir
COPY --from=frontend-builder /app/frontend/dist ./public

ENV NODE_ENV=production \
    PORT=3001 \
    MEDIA_DIR=/media \
    DATA_DIR=/data

EXPOSE 3001

# Ensure data directory exists at runtime (volumes may not pre-create it)
CMD ["sh", "-c", "pip3 install -U --no-cache-dir --break-system-packages yt-dlp --quiet 2>/dev/null; mkdir -p $DATA_DIR/thumbnails && node src/index.js"]
