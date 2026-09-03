import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import RutaProtegida from "./components/RutaProtegida";
import LoginPage from "./pages/LoginPage";
import PanelPage from "./pages/PanelPage";
import AdminPage from "./pages/AdminPage";
import RiesgoIncendiosPage from "./pages/RiesgoIncendiosPage";
import AlertasIncendiosPage from "./pages/AlertasIncendiosPage";
import EmbedPage from "./pages/EmbedPage";

export default function App() {
  return (
    <BrowserRouter>
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

          {/* Esta es la ruta que va en el src del <iframe> del ministerio — pública, sin login */}
          <Route path="/embed" element={<EmbedPage />} />

          <Route path="*" element={<Navigate to="/panel" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
