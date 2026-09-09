import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import RutaProtegida from "./components/RutaProtegida";
import LoginPage from "./pages/LoginPage";
import PanelPage from "./pages/PanelPage";
import AdminPage from "./pages/AdminPage";
import RiesgoIncendiosPage from "./pages/RiesgoIncendiosPage";
import AlertasIncendiosPage from "./pages/AlertasIncendiosPage";
import EmbedPage from "./pages/EmbedPage";
import EmbedAlertasPage from "./pages/EmbedAlertasPage";
import EmbedRiesgoPage from "./pages/EmbedRiesgoPage";
import AlertasMeteorologicasPage from "./pages/AlertasMeteorologicasPage";
import EmbedAlertasMeteorologicasPage from "./pages/EmbedAlertasMeteorologicasPage";

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/panel" replace />} />
          <Route path="/login" element={<LoginPage />} />

          <Route
            path="/panel"
            element={
              <RutaProtegida>
                <PanelPage />
              </RutaProtegida>
            }
          />
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

          {/* Esta es la ruta que va en el src del <iframe> del ministerio — pública, sin login */}
          <Route path="/embed/alertas-incendios" element={<EmbedAlertasPage />} />
          <Route path="/embed" element={<EmbedPage />} />
          <Route path="/embed/riesgo-incendios" element={<EmbedRiesgoPage />} />
          <Route path="/embed/alertas-meteorologicas" element={<EmbedAlertasMeteorologicasPage />} />

          <Route path="*" element={<Navigate to="/panel" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
