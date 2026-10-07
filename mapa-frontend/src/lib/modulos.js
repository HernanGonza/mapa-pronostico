import { Radar, Bell, Waves, Droplets, FileText, CloudSun } from "lucide";

/**
 * Módulos del panel que se habilitan usuario por usuario (pantalla «Usuarios»). El superadmin los ve
 * todos; el resto, sólo los que tiene asignados. Espejo de mapa-backend/src/lib/modulos.js (los ids
 * tienen que coincidir). Para sumar uno: agregarlo acá y allá, y envolver su ruta en
 * <RutaProtegida modulo="id">; si tiene endpoints propios, protegerlos con requireModulo("id").
 */
export const MODULOS = [
  { id: "focos-de-calor", to: "/panel/alertas-incendios", icono: Radar, titulo: "Focos de calor", descripcion: "Anomalías térmicas detectadas por satélite (NASA FIRMS)." },
  { id: "alertas-automaticas", to: "/panel/alertas-automaticas", icono: Bell, titulo: "Alertas automáticas (SMN)", descripcion: "Avisos del SMN por período y zona, en revisión." },
  { id: "inundaciones", to: "/panel/inundaciones", icono: Waves, titulo: "Inundaciones", descripcion: "Placas de alerta por inundación." },
  { id: "cuencas", to: "/panel/cuencas", icono: Droplets, titulo: "Monitor de cuencas", descripcion: "Defluente de represas y altura de los ríos Paraná, Uruguay e Iguazú (SIG Misiones)." },
  { id: "informes-diarios", to: "/panel/informes-diarios", icono: FileText, titulo: "Informes diarios", descripcion: "Qué pasó un día (por ejemplo, una tormenta) según las estaciones oficiales del INTA y SiNaRaMe, con lo que emitió el SMN: informe con mapa, tabla y gráficos, en PDF." },
  { id: "generador-pronosticos", to: "/panel/generador-pronosticos", icono: CloudSun, titulo: "Generador de pronósticos", descripcion: "Recolección de datos de las distintas fuentes que se usan para armar el pronóstico." },
];

/** ¿Este usuario (de useAuth) puede usar el módulo `id`? El superadmin, todos. */
export const puedeUsar = (usuario, id) => !!usuario && (usuario.rol === "superadmin" || (usuario.modulos || []).includes(id));

/** Los módulos que el usuario puede ver, en el orden del catálogo. */
export const modulosDe = (usuario) => MODULOS.filter((m) => puedeUsar(usuario, m.id));
