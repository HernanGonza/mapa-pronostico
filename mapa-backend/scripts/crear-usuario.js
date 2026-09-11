#!/usr/bin/env node
// No hay alta pública — el resto de los usuarios se crean desde la
// pantalla "Usuarios" del panel (solo la ve `admin`/`superadmin`). Este
// script es solo para el arranque en frío: el primer usuario no puede
// crearse desde el panel porque hace falta estar logueado para verlo.
// Por eso siempre da de alta con rol `superadmin` — quien tiene acceso a
// la terminal del server ya es de máxima confianza.
// Uso: node scripts/crear-usuario.js correo@ejemplo.com
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
  const password = await rl.question("Contraseña (mín. 8 caracteres, 1 mayúscula, 1 número, 1 carácter especial): ");
  rl.close();
  if (!auth.validarPassword(password)) {
    console.error("La contraseña no cumple los requisitos mínimos.");
    process.exit(1);
  }
  const usuario = await auth.crearUsuario({ email, password, rol: "superadmin", permitirActualizar: true });
  console.log(`Usuario listo: ${usuario.email} (rol: ${usuario.rol})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
