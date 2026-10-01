# Transmisión a YouTube: Xvfb (pantalla virtual) + Chromium (abre /tv) + ffmpeg (RTMP).
# Ver servidor.mjs y docs/transmision.md.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb chromium ffmpeg \
      fonts-liberation fonts-noto-color-emoji fonts-noto-core \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY servidor.mjs ./

# Sin root: Chromium y ffmpeg no lo necesitan. /data guarda si estaba transmitiendo.
RUN mkdir -p /data && chown node:node /data
USER node

ENV TRANSMISION_PUERTO=8090
CMD ["node", "servidor.mjs"]
