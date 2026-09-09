# Plantilla institucional ECOSOTAT

`misiones.png` es una copia sin modificar de `ECOSOTAT/misiones.png` entregada
con el proyecto. Conserva encabezado, escala semicircular, teléfono y franja de
logos. No se utiliza el reporte ya coloreado ni su fecha.

`generateRiesgoMap.js` porta la sustitución de colores del generador Java.
Las máscaras se identifican por los 17 grises (10, 20, …, 170) declarados en
`ECOSOTAT/src/configuracion.properties`, tomando el componente territorial mayor
para no recolorear letras ni logos. El mapeo a los IDs del GeoJSON es explícito.
Conserva los rótulos originales y añade la fecha elegida para el informe.

Las fuentes Oak Sans se copian de los recursos institucionales ya incluidos en
el frontend, para que el render funcione igual dentro de Docker.
