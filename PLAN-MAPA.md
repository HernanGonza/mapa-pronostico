# Plan — mapa "espectacular" para TV

Trabajo en local. El usuario hace push si le gusta.

## 1. Capas de clima (data: Open-Meteo, gratis, sin key)  ← núcleo
- [ ] backend `clima.js` + `/api/clima/grilla` — grilla ~12×12 sobre la región,
      **por hora** (24h): cloud_cover, precipitation, temperature_2m, viento (u/v).
      1 request, cache 30 min.
- [ ] frontend `lib/campoClima.js` — interpola la grilla + rampas de color,
      genera un PNG (data-URL) por campo/hora.
- [ ] BaseMap: `image` sources para nubes / lluvia / temperatura (raster layers,
      MapLibre reproyecta solo, anda en globo). Viento sigue en canvas.
- [ ] `LayerPanel.jsx` — toggles: Viento · Nubosidad · Lluvia · Temperatura.
      + slider de hora ("ahora" marcado). Leyenda se adapta.

## 2. Animación de entrada (estable + cinematográfica)
- [ ] Re-activar el intro globo → Misiones. Diferir las provincias (pesadas)
      hasta después del vuelo. Que sea suave.

## 3. Performance
- [ ] Simplificar `municipios.geojson` y `provincias.geojson` (Douglas-Peucker),
      objetivo < 400 KB c/u. Limpiar vértices duplicados.

## 4. Street view / inmersivo
- [ ] Doble click en municipio (o botón en la tarjeta) → descenso cinematográfico
      al centro del municipio → panel con Street View (Google Maps Embed API,
      key por env `VITE_GOOGLE_MAPS_KEY`). Sin key: botón "abrir en Google".
      Dejar preparado para 3D fotorrealista (Map Tiles API) más adelante.

## 5. Globo + pulido
- [ ] Recortar el canvas de viento al disco del globo (que no se salga).
- [ ] Contornos de municipios SIEMPRE visibles (ya están — refinar grosor).
- [ ] Tipografía, colores, sensación cinematográfica.

## 6. Exports
- [ ] PNG de redes: `generateMap.js` usa coords detectadas de los puntos rojos
      del `basemap.png` (los nombres/íconos estaban corridos).
- [ ] Captura de pantalla: `map.redraw()` antes de leer el canvas (solo salía
      la animación del viento).
