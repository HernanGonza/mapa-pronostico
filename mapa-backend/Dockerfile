# --- build: instala dependencias (canvas puede necesitar compilar nativo) ---
FROM node:20-bookworm-slim AS build
WORKDIR /app

# canvas trae binario prebuildeado (N-API) para glibc/x64 la mayoría de las
# veces; estas libs son el fallback por si en la plataforma del host no hay
# prebuild y tiene que compilar desde código fuente.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential python3 pkg-config \
      libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# --- runtime: libs de canvas + Chromium para lib/smn/token.mjs y scrape.mjs ---
FROM node:20-bookworm-slim
WORKDIR /app

# `chromium` de Debian trae sus propias deps de sistema (apt las resuelve
# solo); puppeteer-core no baja ningún navegador, usa este binario vía
# PUPPETEER_EXECUTABLE_PATH (default /usr/bin/chromium, ver .env.example).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 \
      librsvg2-2 \
      chromium fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]
