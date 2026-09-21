import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

const ETIQUETAS = {
  labelIdle: 'Arrastrá el archivo acá o <span class="filepond--label-action">elegilo</span>',
  labelFileLoading: "Leyendo…", labelFileProcessingComplete: "Listo", labelTapToCancel: "tocá para cancelar",
  labelTapToRetry: "tocá para reintentar", labelTapToUndo: "tocá para deshacer", labelButtonRemoveItem: "Quitar",
  labelFileLoadError: "No se pudo leer el archivo", labelFileRemoveError: "No se pudo quitar",
  labelMaxFileSizeExceeded: "El archivo es demasiado grande", labelDecimalSeparator: ",", labelThousandsSeparator: ".",
};

/**
 * Zona para arrastrar o elegir archivos (FilePond, cargado recién cuando aparece
 * un campo de archivos). Entrega los archivos con la misma forma que un
 * <input type="file"> — `onChange({ target: { files, value } })` — así las
 * pantallas que ya validaban tipo/tamaño no cambian. El `ref` expone `.value`
 * (asignarle "" vacía la zona), igual que un input.
 *
 * `limpiarAlElegir`: para pantallas que ya muestran su propia vista previa de
 * lo elegido (imágenes): la zona se vacía sola y queda lista para más archivos.
 */
const CampoArchivos = forwardRef(function CampoArchivos({ label, ayuda, accept, multiple = false, disabled = false, onChange, limpiarAlElegir = false, className = "" }, ref) {
  const contenedor = useRef(null);
  const pond = useRef(null);
  const alCambiar = useRef(onChange);
  alCambiar.current = onChange;

  useImperativeHandle(ref, () => ({
    get value() { return ""; },
    set value(_) { pond.current?.removeFiles({ revert: false }); },
  }), []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [{ create }] = await Promise.all([import("filepond"), import("filepond/dist/filepond.min.css")]);
      if (!vivo || !contenedor.current) return;
      const input = document.createElement("input");
      input.type = "file";
      if (accept) input.accept = accept;
      contenedor.current.appendChild(input);
      let limpiando = false;
      pond.current = create(input, {
        ...ETIQUETAS, allowMultiple: multiple, credits: false, instantUpload: false, storeAsFile: true, allowReorder: false,
        onupdatefiles: (items) => {
          if (limpiando) return;
          // Vaciar la zona a mano (botón "Quitar") avisa a la pantalla; en modo limpiarAlElegir el vaciado es interno.
          if (!items.length && limpiarAlElegir) return;
          alCambiar.current?.({ target: { files: items.map((i) => i.file), value: "" } });
          if (limpiarAlElegir) { limpiando = true; pond.current?.removeFiles({ revert: false }); limpiando = false; }
        },
      });
      pond.current.disabled = disabled;
    })();
    return () => { vivo = false; pond.current?.destroy(); pond.current = null; if (contenedor.current) contenedor.current.replaceChildren(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiple, accept, limpiarAlElegir]);

  useEffect(() => { if (pond.current) pond.current.disabled = disabled; }, [disabled]);

  return <div className={`field campo-archivos ${className}`}>
    <span>{label}</span>
    <div ref={contenedor} />
    {ayuda && <small>{ayuda}</small>}
  </div>;
});
export default CampoArchivos;
