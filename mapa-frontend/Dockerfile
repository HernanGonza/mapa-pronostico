# --- build: vite build ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Vacío = pedir todo relativo al mismo origen (el Caddyfile de acá abajo
# proxea /api, /glyphs, /materiales al backend). Ver src/config.js.
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# --- runtime: Caddy sirve el SPA + hace de reverse proxy al backend ---
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
