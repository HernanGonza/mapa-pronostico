// Estas 4 reglas tienen que ser las mismas que `REGLAS_PASSWORD` en
// mapa-backend/src/lib/auth.js (el back es quien manda, esto es nomás
// para el tilde en vivo mientras se escribe).
const REGLAS = [
  { id: "longitud", label: "Al menos 8 caracteres", test: (p) => p.length >= 8 },
  { id: "mayuscula", label: "Una letra mayúscula", test: (p) => /[A-Z]/.test(p) },
  { id: "numero", label: "Un número", test: (p) => /[0-9]/.test(p) },
  { id: "especial", label: "Un carácter especial", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function passwordValida(password) {
  const p = String(password || "");
  return REGLAS.every((r) => r.test(p));
}

/** Checklist en vivo: cada regla se pone en verde apenas se cumple. */
export default function PasswordChecklist({ password }) {
  const p = String(password || "");
  return (
    <ul className="password-checklist">
      {REGLAS.map((r) => {
        const ok = r.test(p);
        return (
          <li key={r.id} className={ok ? "is-ok" : ""}>
            <span className="password-checklist__marca">{ok ? "✓" : "○"}</span>
            {r.label}
          </li>
        );
      })}
    </ul>
  );
}
