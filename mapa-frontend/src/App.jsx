import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import RutaProtegida from "./components/RutaProtegida";
const LandingPage = lazy(() => import("./pages/LandingPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const PanelPage = lazy(() => import("./pages/PanelPage"));
const GeneradorMapasPage = lazy(() => import("./pages/GeneradorMapasPage"));
const HistoricoPage = lazy(() => import("./pages/HistoricoPage"));
const GeneradorPronosticosPage = lazy(() => import("./pages/GeneradorPronosticosPage"));
const ConfiguracionPage = lazy(() => import("./pages/ConfiguracionPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const RiesgoIncendiosPage = lazy(() => import("./pages/RiesgoIncendiosPage"));
const AlertasIncendiosPage = lazy(() => import("./pages/AlertasIncendiosPage"));
const EmbedPage = lazy(() => import("./pages/EmbedPage"));
const EmbedAlertasPage = lazy(() => import("./pages/EmbedAlertasPage"));
const EmbedRiesgoPage = lazy(() => import("./pages/EmbedRiesgoPage"));
const AlertasMeteorologicasPage = lazy(() => import("./pages/AlertasMeteorologicasPage"));
const EmbedAlertasMeteorologicasPage = lazy(() => import("./pages/EmbedAlertasMeteorologicasPage"));
const AlertasAutomaticasPage = lazy(() => import("./pages/AlertasAutomaticasPage"));
const AvisosCortoPlazoPage = lazy(() => import("./pages/AvisosCortoPlazoPage"));
const InundacionesPage = lazy(() => import("./pages/InundacionesPage"));
const PronosticoExtendidoPage = lazy(() => import("./pages/PronosticoExtendidoPage"));
const EmbedPronosticoExtendidoPage = lazy(() => import("./pages/EmbedPronosticoExtendidoPage"));
const UsuariosPage = lazy(() => import("./pages/UsuariosPage"));

const RecuperarPasswordPage = lazy(() => import("./pages/RecuperarPasswordPage"));

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <Suspense fallback={<p className="page-loading" role="status">Cargando pantalla…</p>}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/recuperar-contrasena" element={<RecuperarPasswordPage />} />

          <Route
            path="/panel"
            element={
              <RutaProtegida>
                <PanelPage />
              </RutaProtegida>
            }
          />
          <Route path="/panel/mapas" element={<RutaProtegida><GeneradorMapasPage /></RutaProtegida>} />
          <Route path="/panel/historico" element={<RutaProtegida><HistoricoPage /></RutaProtegida>} />
          <Route path="/panel/generador-pronosticos" element={<RutaProtegida><GeneradorPronosticosPage /></RutaProtegida>} />
          <Route path="/panel/configuracion" element={<RutaProtegida><ConfiguracionPage /></RutaProtegida>} />
          <Route
            path="/panel/pronostico"
            element={
              <RutaProtegida>
                <AdminPage />
              </RutaProtegida>
            }
          />
          <Route
            path="/panel/riesgo-incendios"
            element={
              <RutaProtegida>
                <RiesgoIncendiosPage />
              </RutaProtegida>
            }
          />
          <Route
            path="/panel/alertas-incendios"
            element={
              <RutaProtegida>
                <AlertasIncendiosPage />
              </RutaProtegida>
            }
          />
          <Route path="/panel/alertas-meteorologicas" element={<RutaProtegida><AlertasMeteorologicasPage /></RutaProtegida>} />
          <Route path="/panel/alertas-automaticas" element={<RutaProtegida><AlertasAutomaticasPage /></RutaProtegida>} />
          <Route path="/panel/avisos-corto-plazo" element={<RutaProtegida><AvisosCortoPlazoPage /></RutaProtegida>} />
          <Route path="/panel/inundaciones" element={<RutaProtegida><InundacionesPage /></RutaProtegida>} />
          <Route path="/panel/pronostico-3-dias" element={<RutaProtegida><PronosticoExtendidoPage /></RutaProtegida>} />
          <Route path="/panel/usuarios" element={<RutaProtegida><UsuariosPage /></RutaProtegida>} />

          {/* Esta es la ruta que va en el src del <iframe> del ministerio — pública, sin login */}
          <Route path="/embed/alertas-incendios" element={<EmbedAlertasPage />} />
          <Route path="/embed" element={<EmbedPage />} />
          <Route path="/embed/riesgo-incendios" element={<EmbedRiesgoPage />} />
          <Route path="/embed/alertas-meteorologicas" element={<EmbedAlertasMeteorologicasPage />} />
          <Route path="/embed/pronostico-3-dias" element={<EmbedPronosticoExtendidoPage />} />

          <Route path="*" element={<Navigate to="/panel" replace />} />
        </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
