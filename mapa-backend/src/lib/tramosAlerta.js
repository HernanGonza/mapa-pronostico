/**
 * Vigencias individuales de una alerta meteorológica manual. El mapa que se publica trae un nivel por
 * departamento (`zonas`); los `tramos` dicen hasta cuándo vale cada nivel y a qué pasa después:
 *
 *   tramos = { "<id del departamento>": [{ categoria: "Naranja", hasta: ISO }, { categoria: "Amarillo", hasta: ISO }] }
 *
 * El nivel de un departamento en un instante es el del primer tramo cuyo `hasta` todavía no pasó; si ya
 * pasaron todos, vuelve a Verde. Un departamento sin tramos queda con su nivel base hasta que la alerta
 * se saca sola. Las consultas devuelven `zonas` ya resuelta a la hora actual (así el mapa público, /tv y
 * el color de los ACP no necesitan saber nada de esto) y `zonasBase` con lo que se publicó.
 */
const NIVELES = ['Verde', 'Amarillo', 'Naranja', 'Rojo'];
const MAX_TRAMOS = 4;

/** `zonas` ([{id, categoria}]) con el nivel que corresponde en `ahora`. */
function zonasEn(zonas = [], tramos = {}, ahora = Date.now()) {
  if (!tramos || !Object.keys(tramos).length) return zonas;
  return zonas.map((z) => {
    const lista = tramos[String(z.id)];
    if (!Array.isArray(lista) || !lista.length) return z;
    const vigente = lista.find((t) => Date.parse(t.hasta) > ahora);
    return { ...z, categoria: vigente ? vigente.categoria : 'Verde' };
  });
}

/**
 * Íconos (fenómenos) con el color que corresponde ahora: uno con dos colores (ej. naranja y amarillo) deja
 * de mostrar el color de un nivel cuando ningún departamento está ya en ese nivel. `zonasActuales`: las
 * zonas ya resueltas a la hora actual (zonasEn). Si no queda ninguno de sus colores, se dejan como están.
 */
function iconosEn(iconos = [], zonasActuales = []) {
  const presentes = new Set(zonasActuales.map((z) => z.categoria));
  return iconos.map((i) => {
    if (!i.categoria2) return i;
    const quedan = [i.categoria, i.categoria2].filter((c) => presentes.has(c));
    if (quedan.length === 2 || !quedan.length) return i;
    const { categoria2, ...resto } = i;
    return { ...resto, categoria: quedan[0] };
  });
}

/** Error de los tramos que manda el panel, o null. `ids`: ids de departamentos válidos; `vigenteHasta`: tope. */
function errorDeTramos(tramos, ids, vigenteHasta) {
  if (!tramos || typeof tramos !== 'object' || Array.isArray(tramos)) return 'Vigencias inválidas.';
  const tope = Date.parse(vigenteHasta);
  for (const [id, lista] of Object.entries(tramos)) {
    if (!ids.has(String(id))) return 'Departamento desconocido en las vigencias.';
    if (!Array.isArray(lista) || lista.length > MAX_TRAMOS) return `Cada departamento admite hasta ${MAX_TRAMOS} tramos.`;
    let anterior = 0;
    for (const t of lista) {
      const hasta = Date.parse(t?.hasta);
      if (!NIVELES.includes(t?.categoria)) return 'Nivel inválido en las vigencias.';
      if (Number.isNaN(hasta)) return 'Falta la hora de fin de algún tramo.';
      if (hasta <= anterior) return 'Los tramos de un departamento tienen que terminar cada uno después del anterior.';
      if (hasta > tope) return 'Un tramo termina después de que la alerta se saca sola; primero alargá la vigencia de la alerta.';
      anterior = hasta;
    }
  }
  return null;
}

/** Sólo los campos que se usan; los departamentos sin tramos se omiten. */
function normalizarTramos(tramos) {
  const out = {};
  for (const [id, lista] of Object.entries(tramos)) {
    if (!lista.length) continue;
    out[String(id)] = lista.map((t) => ({ categoria: t.categoria, hasta: new Date(t.hasta).toISOString() }));
  }
  return out;
}

module.exports = { zonasEn, iconosEn, errorDeTramos, normalizarTramos, MAX_TRAMOS };
