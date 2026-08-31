const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "..", "data", "store", "pronostico-actual.json");

/**
 * Guarda el pronóstico "publicado" (lo que va a mostrar el iframe público).
 * Persistencia simple en disco: alcanza para este caso de uso (se
 * actualiza unas pocas veces al día). Si más adelante hace falta
 * historial/auditoría, esto es lo primero a migrar a una base real.
 */
function publicar(dataset) {
  const payload = {
    publicadoEn: new Date().toISOString(),
    filas: dataset,
  };
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

function obtenerActual() {
  if (!fs.existsSync(STORE_PATH)) return null;
  return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
}

module.exports = { publicar, obtenerActual };
