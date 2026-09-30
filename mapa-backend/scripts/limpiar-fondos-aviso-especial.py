# Limpia UNA vez los fondos de rayos de Alerta Meteorológica (saca el título y la línea
# "Fuente Servicio Meteorológico Nacional") para usarlos como plantilla del Aviso Especial.
# Uso: cd data/alertas/placas-2025 && python limpiar-fondos-aviso-especial.py ../aviso-especial
# (necesita numpy + opencv-python-headless). Ya se corrió: los PNG limpios quedaron en data/alertas/aviso-especial/.
import cv2, numpy as np, sys
# (origen, destino, [(y0, y1, x0, x1, umbral de luminancia)]) — cajas medidas sobre los PNG originales
TRABAJOS = [
  ('fondo historias.png', 'feed.png', [(150, 325, 170, 1350, 62), (2385, 2436, 1085, 2035, 22)]),
  ('fondo historias (2).png', 'historias.png', [(215, 410, 420, 1830, 62), (3630, 3685, 655, 1595, 12)]),
]
out = sys.argv[1]
for src, dst, cajas in TRABAJOS:
    img = cv2.imread(src)
    gris = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mask = np.zeros(gris.shape, np.uint8)
    for y0, y1, x0, x1, umbral in cajas:
        mask[y0:y1, x0:x1] = (gris[y0:y1, x0:x1] > umbral).astype(np.uint8) * 255
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
    res = cv2.inpaint(img, mask, 15, cv2.INPAINT_TELEA)
    # un poco de desenfoque + grano sólo en lo rellenado, para que no se note el parche
    suave = cv2.GaussianBlur(res, (0, 0), 6)
    m3 = (cv2.GaussianBlur(mask, (0, 0), 4) / 255.0)[..., None]
    ruido = np.random.default_rng(1).normal(0, 2.0, img.shape)
    res = np.clip(res * (1 - m3) + suave * m3 + ruido * m3, 0, 255).astype(np.uint8)
    cv2.imwrite(f'{out}/{dst}', res, [cv2.IMWRITE_PNG_COMPRESSION, 9])
# En la historia la línea "Fuente" está sobre negro casi puro: se aplana con el color del borde
# para que no quede ni el fantasma del inpainting.
img = cv2.imread(f'{out}/historias.png')
y0, y1, x0, x1 = 3615, 3700, 620, 1630
borde = np.concatenate([img[y0-10:y0, x0:x1].reshape(-1, 3), img[y1:y1+10, x0:x1].reshape(-1, 3)])
img[y0:y1, x0:x1] = np.median(borde, axis=0).astype(np.uint8)
cv2.imwrite(f'{out}/historias.png', img, [cv2.IMWRITE_PNG_COMPRESSION, 9])
