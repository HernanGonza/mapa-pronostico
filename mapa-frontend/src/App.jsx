import { BrowserRouter, Routes, Route } from "react-router-dom";
import AdminPage from "./pages/AdminPage";
import EmbedPage from "./pages/EmbedPage";
import TilesWorldPage from "./pages/TilesWorldPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TilesWorldPage />} />
        <Route path="/admin" element={<AdminPage />} />
        {/* Esta es la ruta que va en el src del <iframe> del ministerio */}
        <Route path="/embed" element={<EmbedPage />} />
        <Route path="/3d-tiles" element={<TilesWorldPage />} />
      </Routes>
    </BrowserRouter>
  );
}
