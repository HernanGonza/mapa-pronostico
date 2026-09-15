import RecoveryIssuer from "../components/RecoveryIssuer";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import BrandHeader from "../components/BrandHeader";
import PasswordChecklist, { passwordValida } from "../components/PasswordChecklist";
import { useAuth } from "../context/AuthContext";
import { crearUsuarioPanel, listarUsuariosPanel } from "../api";

const ETIQUETA_ROL = { superadmin: "Superadmin", admin: "Admin", usuario: "Usuario" };

/** Espejo de `puedeCrearRol` en el back: solo `superadmin` llega a esta
 * pantalla, y da de alta cualquier rol. El back vuelve a validar esto igual. */
function rolesAsignables(rolCreador) {
  return rolCreador === "superadmin" ? ["superadmin", "admin", "usuario"] : [];
}

function dniValido(dni) {
  return /^\d{7,8}$/.test(String(dni || "").trim());
}

const VACIO = {
  nombre: "",
  apellido: "",
  email: "",
  password: "",
  repetirPassword: "",
  telefono: "",
  dni: "",
  puesto: "",
  dependencia: "",
};

export default function UsuariosPage() {
  const { usuario } = useAuth();
  const asignables = rolesAsignables(usuario?.rol);
  const [form, setForm] = useState({ ...VACIO, rol: asignables[asignables.length - 1] || "usuario" });
  const [usuarios, setUsuarios] = useState(null);
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [recargar, setRecargar] = useState(0);
  const [busqueda, setBusqueda] = useState("");
  const [recuperar, setRecuperar] = useState(null);

  useEffect(() => {
    listarUsuariosPanel()
      .then(setUsuarios)
      .catch((err) => setError(err.message));
  }, [recargar]);

  // Solo `superadmin` tiene acceso a esta pantalla — el back también lo
  // frena (esto es solo para no mostrarla).
  if (usuario && usuario.rol !== "superadmin") return <Navigate to="/panel/configuracion" replace />;

  function campo(nombre) {
    return {
      name: nombre,
      value: form[nombre],
      onChange: (e) => setForm((f) => ({ ...f, [nombre]: e.target.value })),
    };
  }

  const passwordOk = passwordValida(form.password);
  const repiteOk = form.repetirPassword.length > 0 && form.password === form.repetirPassword;
  const dniOk = dniValido(form.dni);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setMensajeOk(null);
    if (!passwordOk) return setError("La contraseña no cumple los requisitos mínimos.");
    if (!repiteOk) return setError("Las contraseñas no coinciden.");
    if (!dniOk) return setError("El DNI tiene que tener 7 u 8 dígitos, sin puntos.");

    setCargando(true);
    try {
      const nuevo = await crearUsuarioPanel(form);
      setMensajeOk(`Usuario creado: ${nuevo.email}`);
      setForm({ ...VACIO, rol: asignables[asignables.length - 1] || "usuario" });
      setRecargar((n) => n + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  const termino = busqueda.trim().toLocaleLowerCase("es-AR");
  const digitos = termino.replace(/[^0-9]/g, "");
  const visibles = (usuarios || []).filter(u => !termino ||
    [u.nombre, u.apellido, u.email, u.dni, u.telefono].some(v => String(v || "").toLocaleLowerCase("es-AR").includes(termino)) ||
    (digitos && /^[\d\s.+()-]+$/.test(termino) && [u.dni, u.telefono].some(v => String(v || "").replace(/[^0-9]/g, "").includes(digitos))));

  return (
    <div className="panel-layout">
      <BrandHeader subtitulo="Usuarios">
        <Link to="/panel/configuracion" className="btn-link">
          ← Configuración
        </Link>
      </BrandHeader>

      <main id="contenido-principal" tabIndex={-1} className="usuarios-panel">
        <section className="usuarios-form-card">
          <h1>Crear usuario</h1>
          <p className="admin-panel__hint">
            No hay alta pública — el usuario queda listo para entrar apenas se
            crea, con este email y contraseña.
          </p>

          {error && <div className="alert alert--error" role="alert">{error}</div>}
          {mensajeOk && <div className="alert alert--ok" role="status">{mensajeOk}</div>}

          <form onSubmit={onSubmit}>
            <div className="usuarios-form-grid">
              <label className="field">
                <span>Nombre</span>
                <input type="text" required disabled={cargando} {...campo("nombre")} />
              </label>
              <label className="field">
                <span>Apellido</span>
                <input type="text" required disabled={cargando} {...campo("apellido")} />
              </label>
            </div>

            <label className="field">
              <span>Email</span>
              <input type="email" autoComplete="off" required disabled={cargando} {...campo("email")} />
            </label>

            <div className="usuarios-form-grid">
              <label className="field">
                <span>Teléfono</span>
                <input type="tel" autoComplete="tel" required disabled={cargando} {...campo("telefono")} />
              </label>
              <label className="field">
                <span>DNI</span>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  disabled={cargando}
                  className={form.dni && !dniOk ? "is-invalid" : ""}
                  {...campo("dni")}
                />
              </label>
            </div>

            <div className="usuarios-form-grid">
              <label className="field">
                <span>Puesto</span>
                <input type="text" disabled={cargando} {...campo("puesto")} />
              </label>
              <label className="field">
                <span>Dependencia</span>
                <input type="text" disabled={cargando} {...campo("dependencia")} />
              </label>
            </div>

            <label className="field">
              <span>Rol</span>
              <select required disabled={cargando} {...campo("rol")}>
                {asignables.map((r) => (
                  <option key={r} value={r}>
                    {ETIQUETA_ROL[r]}
                  </option>
                ))}
              </select>
            </label>

            <div className="usuarios-form-grid">
              <label className="field">
                <span>Contraseña</span>
                <input type="password" autoComplete="new-password" required disabled={cargando} {...campo("password")} />
              </label>
              <label className="field">
                <span>Repetir contraseña</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  disabled={cargando}
                  {...campo("repetirPassword")}
                />
              </label>
            </div>

            <PasswordChecklist password={form.password} />
            {form.repetirPassword && (
              <p className={`password-checklist__match ${repiteOk ? "is-ok" : ""}`}>
                <span className="password-checklist__marca">{repiteOk ? "✓" : "○"}</span>
                Las contraseñas coinciden
              </p>
            )}

            <button className="btn btn--primary" type="submit" disabled={cargando}>
              {cargando ? "Creando…" : "Crear usuario"}
            </button>
          </form>
        </section>

        <section className="usuarios-lista">
          <h2>Usuarios existentes</h2>
          <label className="field"><span>Buscar por nombre, correo, DNI o teléfono</span><input type="search" value={busqueda} onChange={e => setBusqueda(e.target.value)} /></label>
          {recuperar && <RecoveryIssuer key={recuperar.id} usuario={recuperar} onClose={() => setRecuperar(null)} />}
          {usuarios && !visibles.length && <p role="status">No hay usuarios que coincidan con la búsqueda.</p>}
          {!usuarios ? (
            <p className="admin-panel__hint">Cargando…</p>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Puesto</th>
                  <th>Dependencia</th>
                  <th>DNI / Teléfono</th>
                  <th>Acceso</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((u) => (
                  <tr key={u.id}>
                    <td>{[u.nombre, u.apellido].filter(Boolean).join(" ") || "—"}</td>
                    <td>{u.email}</td>
                    <td>{ETIQUETA_ROL[u.rol] || u.rol}</td>
                    <td>{u.puesto || "—"}</td>
                    <td>{u.dependencia || "—"}</td>
                    <td>{u.dni || "—"}<br />{u.telefono || "Sin teléfono"}</td>
                    <td><button className="btn" type="button" disabled={!!recuperar} onClick={() => setRecuperar(u)}>Recuperar acceso</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}
