# Arquitectura del motor meteorológico 3D

## Estado actual

La aplicación conserva `BaseMap` como dueño del mapa geográfico: MapLibre GL v5,
proyección `globe`, países, provincias, municipios, selección, capas de clima,
vuelo de águila y captura. React continúa controlando navegación, paneles y
estado; no hay rerender de React por frame.

Babylon se integra como una escena transparente (`BabylonWeatherFX`) encima del
globo durante el modo águila. Su render loop es independiente del de MapLibre y
se destruye al desmontar el componente. Usa `Engine` WebGL con alpha y la base
Babylon existente mantiene el intento WebGPU con fallback WebGL para la futura
migración de la escena geográfica.

## Flujo meteorológico

Los datos de Open-Meteo siguen entrando por los adaptadores existentes y se
normalizan mediante `weather/WeatherState.js`. `weather/WeatherDirector.js`
interpela presets y mediciones; Babylon consume su salida para precipitación,
viento, granizo y relámpagos, sin conocer el formato de la API.

## Celdas espaciales

`babylon/WeatherCell.js` define el contrato independiente del proveedor.
`WeatherCellManager` mantiene celdas reales o de debug, calcula distancia
geográfica y asigna LOD 0–3. No genera tormentas artificiales en producción; el
contrato queda preparado para un generador de radar/grilla.

## Próximas etapas

La evolución prevista es reemplazar progresivamente los efectos 2D restantes
por managers Babylon persistentes (nubes, atmósfera, iluminación, wetness,
heat-haze y LightningManager), y finalmente mover la geometría geográfica a una
escena Babylon compartida sólo cuando exista una fuente de terreno/globo que
preserve la cobertura mundial actual.
