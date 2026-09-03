#!/usr/bin/env node
// No hay alta pública — los usuarios del panel se crean a mano con este
// script. Uso: node scripts/crear-usuario.js correo@ejemplo.com
require("dotenv").config({ path: [".env.local", ".env"], quiet: true });
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const auth = require("../src/lib/auth");

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Uso: node scripts/crear-usuario.js correo@ejemplo.com");
    process.exit(1);
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  // Sin máscara — es un script de un solo uso corrido a mano por un admin,
  // no vale la complejidad de ocultar el input en la terminal.
  const password = await rl.question("Contraseña (mín. 8 caracteres): ");
  rl.close();
  if (!password || password.length < 8) {
    console.error("La contraseña tiene que tener al menos 8 caracteres.");
    process.exit(1);
  }
  const usuario = await auth.crearUsuario(email, password);
  console.log(`Usuario listo: ${usuario.email}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
