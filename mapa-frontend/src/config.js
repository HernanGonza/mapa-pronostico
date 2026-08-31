// Configurable vía variable de entorno de Vite (.env / .env.production):
// VITE_API_URL=https://api.tudominio.gob.ar
export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
