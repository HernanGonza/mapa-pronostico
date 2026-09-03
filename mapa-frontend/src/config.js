// Configurable vía variable de entorno de Vite (.env / .env.production):
// VITE_API_URL=https://api.tudominio.gob.ar (back en otro origen), o vacío
// para pedir todo relativo al mismo origen (back detrás del mismo proxy,
// como en el docker-compose — ver Caddyfile).
const configurada = import.meta.env.VITE_API_URL;
// En desarrollo, el backend local escucha en 3000. Evitamos que el valor de
// producción de Render desvíe los requests cuando se ejecuta Vite localmente.
export const API_URL = import.meta.env.DEV
  ? (configurada && !/onrender\.com/i.test(configurada) ? configurada : "http://localhost:3000")
  : (configurada ?? "");
