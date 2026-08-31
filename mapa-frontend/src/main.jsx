import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "maplibre-gl/dist/maplibre-gl.css";
import "./theme.css";
import "./styles.css";

// Sin StrictMode: el doble montaje que hace en desarrollo rompe la
// inicialización de MapLibre GL (crea el mapa, lo destruye y lo vuelve a
// crear, y el segundo queda con el estilo a medio cargar).
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
