import { Radar, Waves, Droplets, FileText, Layers, Table } from "lucide";

/**
 * Módulos del panel que se habilitan usuario por usuario (pantalla «Usuarios»). El superadmin los ve
 * todos; el resto, sólo los que tiene asignados. Espejo de mapa-backend/src/lib/modulos.js (los ids
 * tienen que coincidir). Para sumar uno: agregarlo acá y allá, y envolver su ruta en
 * <RutaProtegida modulo="id">; si tiene endpoints propios, protegerlos con requireModulo("id").
 */
export const MODULOS = [
  { id: "focos-de-calor", to: "/panel/alertas-incendios", icono: Radar, titulo: "Focos de calor", descripcion: "Anomalías térmicas detectadas por satélite (NASA FIRMS).", enDesarrollo: false },
  { id: "inundaciones", to: "/panel/inundaciones", icono: Waves, titulo: "Inundaciones", descripcion: "Altura de los arroyos internos de Misiones (Red Hidrológica Nacional) y puntos donde una crecida corta rutas." },
  { id: "cuencas", to: "/panel/cuencas", icono: Droplets, titulo: "Monitor de cuencas", descripcion: "Defluente de represas y altura de los ríos Paraná, Uruguay e Iguazú (SIG Misiones)." },
  { id: "tabla-precipitaciones", to: "/panel/precipitaciones", icono: Table, titulo: "Monitoreo de lluvias", descripcion: "Planilla de lluvia por día y estación (reemplaza al Excel), con totales, media y anomalía; de ahí salen la tabla y el mapa de la página y los informes (placa, PDF y Excel).", enDesarrollo: false },
  { id: "ensamble", to: "/panel/ensamble", icono: Layers, titulo: "Ensamble multimodelo", descripcion: "Qué dice cada modelo numérico (ECMWF, GFS, ICON, GEM, WRF-SMN y MONAN) para cada departamento a 10 días, y cuánto discrepan.", enDesarrollo: false },
];

/** Las pantallas ya terminadas llevan `enDesarrollo: false`: no figuran en «En desarrollo» ni llevan esa etiqueta. */
export const estadoDe = (m) => (m.enDesarrollo === false ? null : "En desarrollo");

/** ¿Este usuario (de useAuth) puede usar el módulo `id`? El superadmin, todos. */
// «informes-diarios» (retirado) valía para el informe de precipitaciones: quien lo tenía conserva el acceso a «tabla-precipitaciones».
const ALIAS = { "tabla-precipitaciones": "informes-diarios" };
export const puedeUsar = (usuario, id) => !!usuario && (usuario.rol === "superadmin" || (usuario.modulos || []).includes(id) || (!!ALIAS[id] && (usuario.modulos || []).includes(ALIAS[id])));

/** Los módulos que el usuario puede ver, en el orden del catálogo. */
export const modulosDe = (usuario) => MODULOS.filter((m) => puedeUsar(usuario, m.id));
