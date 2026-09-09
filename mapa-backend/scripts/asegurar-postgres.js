const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { execFileSync } = require("node:child_process");

require("dotenv").config({ path: [".env.local", ".env"], quiet: true });

function disponible(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(2000);
    const terminar = (ok) => { socket.destroy(); resolve(ok); };
    socket.once("connect", () => terminar(true));
    socket.once("error", () => terminar(false));
    socket.once("timeout", () => terminar(false));
  });
}

async function main() {
  if (!process.env.DATABASE_URL || process.env.LOCAL_POSTGRES_AUTOSTART === "false") return;
  const url = new URL(process.env.DATABASE_URL);
  // Solo administramos el clúster local de desarrollo, nunca bases remotas.
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || (url.port || "5432") !== "5544") return;
  const host = url.hostname === "[::1]" ? "::1" : url.hostname;
  if (await disponible(host, 5544)) {
    console.log("[postgres] La base local ya está escuchando en 5544.");
    return;
  }
  const dataDir = process.env.LOCAL_POSTGRES_DATA_DIR || path.join(os.homedir(), ".local/share/mapa-pronostico/pgdata");
  const versionFile = path.join(dataDir, "PG_VERSION");
  if (!fs.existsSync(versionFile)) throw new Error(`No se encontró la base local en ${dataDir}. Configurá LOCAL_POSTGRES_DATA_DIR con la ubicación de la base existente.`);
  const version = fs.readFileSync(versionFile, "utf8").trim();
  if (!/^\d+(\.\d+)?$/.test(version)) throw new Error("PG_VERSION no es válido.");
  const pgCtl = process.env.LOCAL_POSTGRES_PG_CTL || `/usr/lib/postgresql/${version}/bin/pg_ctl`;
  console.log("[postgres] Iniciando la base local en 5544…");
  execFileSync(pgCtl, ["-D", dataDir, "-l", path.join(dataDir, "startup.log"), "-o", `-p 5544 -k "${dataDir.replace(/"/g, '\\"')}"`, "-w", "-t", "30", "start"], { stdio: "inherit", timeout: 35000 });
  if (!await disponible(host, 5544)) throw new Error("PostgreSQL arrancó pero no responde en el host configurado y puerto 5544.");
  console.log("[postgres] Base local lista.");
}

main().catch((error) => {
  console.error(`[postgres] No se pudo preparar la base: ${error.message}`);
  process.exitCode = 1;
});
