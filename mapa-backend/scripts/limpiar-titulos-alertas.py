# Saca UNA vez el título "ALERTA METEOROLÓGICA" impreso en los 4 fondos de Alerta Meteorológica
# (nubes/tormenta × feed/historias), para que el backend dibuje el título (el predeterminado o
# el que se elija) sin ningún recuadro encima. El pie (Emergencias + Fuente SMN + logos) queda.
# Uso: cd data/alertas/placas-2025 && python ../../../scripts/limpiar-titulos-alertas.py sin-titulo
# (necesita numpy + opencv-python-headless). Ya se corrió: los PNG están en placas-2025/sin-titulo/.
import cv2, numpy as np, sys, os
# (origen, destino, caja del título y0, y1, x0, x1) — medidas sobre los PNG originales
TRABAJOS = [
  ('fondo feed (2).png', 'nubes-feed.png', (150, 330, 165, 1360)),
  ('fondo feed.png', 'nubes-historias.png', (210, 420, 430, 1850)),
  ('fondo historias.png', 'tormenta-feed.png', (150, 330, 165, 1360)),
  ('fondo historias (2).png', 'tormenta-historias.png', (210, 420, 415, 1835)),
]
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for src, dst, (y0, y1, x0, x1) in TRABAJOS:
    img = cv2.imread(src)
    gris = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mask = np.zeros(gris.shape, np.uint8)
    # El título es blanco puro; el cielo en esa franja no pasa de ~60.
    mask[y0:y1, x0:x1] = (gris[y0:y1, x0:x1] > 90).astype(np.uint8) * 255
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
    res = cv2.inpaint(img, mask, 15, cv2.INPAINT_TELEA)
    suave = cv2.GaussianBlur(res, (0, 0), 6)
    m3 = (cv2.GaussianBlur(mask, (0, 0), 4) / 255.0)[..., None]
    ruido = np.random.default_rng(1).normal(0, 2.0, img.shape)
    res = np.clip(res * (1 - m3) + suave * m3 + ruido * m3, 0, 255).astype(np.uint8)
    cv2.imwrite(f'{out}/{dst}', res, [cv2.IMWRITE_PNG_COMPRESSION, 9])
