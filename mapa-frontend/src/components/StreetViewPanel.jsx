import { useEffect, useRef, useState } from "react";

/**
 * Panel de vista a nivel calle de un municipio.
 *
 * Alternativas libres a Google Street View:
 *
 *  - Mapillary (Meta, crowdsourced, API gratis). Con `VITE_MAPILLARY_TOKEN`
 *    montamos el visor navegable mapillary-js (WebGL, se camina de foto en
 *    foto igual que Street View). El token de cliente es gratis en
 *    https://www.mapillary.com/dashboard/developers, es de solo lectura y
 *    se puede exponer en el front.
 *  - Panoramax (OpenStreetMap France, 100% abierto). Cobertura creciente,
 *    todavía baja en Misiones — queda como enlace externo.
 *  - Google Street View, último recurso (enlace externo, sin key).
 *
 * Sin `VITE_MAPILLARY_TOKEN`, o si no hay fotos cerca, el panel ofrece los
 * tres como botones que abren en pestaña nueva.
 *
 * Doc del visor: https://mapillary.github.io/mapillary-js/
 */
const MLY_TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN;

/** Recuadro de ~`m` metros alrededor de [lng, lat] para la búsqueda. */
function bbox([lng, lat], m) {
  const dLat = m / 111_320;
  const dLng = m / (111_320 * Math.cos((lat * Math.PI) / 180));
  return `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`;
}

/** Foto de Mapillary más cercana al punto (o null si no hay cobertura). */
async function fotoMasCercana(lngLat) {
  // Se agranda el radio progresivamente: centro del municipio → alrededores.
  for (const radio of [150, 400, 1200]) {
    const url =
      `https://graph.mapillary.com/images?access_token=${MLY_TOKEN}` +
      `&fields=id,geometry&limit=50&bbox=${bbox(lngLat, radio)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Mapillary ${res.status}`);
    const { data } = await res.json();
    if (data?.length) {
      const [lng, lat] = lngLat;
      let mejor = null;
      let min = Infinity;
      for (const img of data) {
        const [ilng, ilat] = img.geometry.coordinates;
        const d = (ilng - lng) ** 2 + (ilat - lat) ** 2;
        if (d < min) {
          min = d;
          mejor = img.id;
        }
      }
      return mejor;
    }
  }
  return null;
}

export default function StreetViewPanel({ nombre, lngLat, onClose }) {
  const [lng, lat] = lngLat;
  const viewerHostRef = useRef(null);
  const viewerRef = useRef(null);
  const [estado, setEstado] = useState(MLY_TOKEN ? "buscando" : "sin-token");

  useEffect(() => {
    if (!MLY_TOKEN) return;
    let vivo = true;
    setEstado("buscando");

    fotoMasCercana(lngLat)
      .then(async (imageId) => {
        if (!vivo) return;
        if (!imageId) {
          setEstado("sin-cobertura");
          return;
        }
        // Import diferido: mapillary-js pesa ~1 MB y solo hace falta acá.
        // Sin VITE_MAPILLARY_TOKEN este bloque es código muerto y ni el JS
        // ni el CSS entran al bundle.
        const [{ Viewer }] = await Promise.all([
          import("mapillary-js"),
          import("mapillary-js/dist/mapillary.css"),
        ]);
        if (!vivo || !viewerHostRef.current) return;
        viewerRef.current = new Viewer({
          accessToken: MLY_TOKEN,
          container: viewerHostRef.current,
          imageId,
          component: { cover: false, bearing: true, zoom: true },
        });
        setEstado("ok");
      })
      .catch((err) => {
        console.warn("[StreetView] Mapillary:", err.message);
        if (vivo) setEstado("error");
      });

    return () => {
      vivo = false;
      viewerRef.current?.remove();
      viewerRef.current = null;
    };
  }, [lng, lat]); // eslint-disable-line react-hooks/exhaustive-deps

  const links = {
    mapillary: `https://www.mapillary.com/app/?lat=${lat}&lng=${lng}&z=17&panos=true`,
    panoramax: `https://api.panoramax.xyz/#focus=map&map=17/${lat}/${lng}`,
    google: `https://www.google.com/maps/@${lat},${lng},3a,75y,210h,90t/data=!3m1!1e3`,
  };

  return (
    <div className="sv-panel" role="dialog" aria-label={`Vista de calle de ${nombre}`}>
      <div className="sv-panel__head">
        <div>
          <span className="sv-panel__eyebrow">Vista a nivel calle · Mapillary</span>
          <h3>{nombre}</h3>
        </div>
        <button className="sv-panel__close" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
      </div>

      <div className="sv-panel__view">
        <div
          ref={viewerHostRef}
          className="sv-panel__mly"
          hidden={estado !== "ok"}
        />

        {estado !== "ok" && (
          <div className="sv-panel__nokey">
            {estado === "buscando" && <p>Buscando imágenes de calle cercanas…</p>}
            {estado === "sin-cobertura" && (
              <p>
                Todavía no hay fotos de calle subidas cerca de <b>{nombre}</b>.
                Probá con estos servicios:
              </p>
            )}
            {estado === "error" && (
              <p>No se pudo cargar Mapillary. Abrí la vista de calle en:</p>
            )}
            {estado === "sin-token" && (
              <p>
                Para el visor embebido configurá <code>VITE_MAPILLARY_TOKEN</code>{" "}
                (token gratis de Mapillary). Mientras tanto, abrila en:
              </p>
            )}

            {estado !== "buscando" && (
              <div className="sv-panel__proveedores">
                <a className="btn btn--primary" href={links.mapillary} target="_blank" rel="noopener noreferrer">
                  Mapillary
                </a>
                <a className="btn" href={links.panoramax} target="_blank" rel="noopener noreferrer">
                  Panoramax
                </a>
                <a className="btn" href={links.google} target="_blank" rel="noopener noreferrer">
                  Google Street View
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
