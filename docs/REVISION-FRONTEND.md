# Revisión del frontend · Ecología Misiones

Fecha: 14 de septiembre de 2026. Revisión del código y del Brandbook 2024; sin inspección del sitio en navegador, a pedido del usuario.

## Dirección visual

El manual define Oak Sans (páginas 4, 6 y 12), el verde `#3E6C51` (página 6), y los rosas Lapacho `#C9346C` y `#F5A5BF` (página 8). La página 11 establece el área de seguridad de la marca; las páginas 14–17 describen usos, variantes y recursos gráficos.

La interfaz tiene una función operativa: editar información, revisar y publicar. Se prioriza lectura, jerarquía de acciones y consistencia. El verde identifica las acciones principales; el rosa queda como acento de marca y foco. Oak Sans sigue siendo la única familia del producto. Se reducen las sombras de las tarjetas y se evita sumar ornamentación al área de trabajo.

Paleta de base: verde institucional `#3E6C51`, rosa Lapacho `#C9346C`, rosa claro `#F5A5BF`, blanco `#FFFFFF`, fondo claro `#FAF4EB` y fondo oscuro `#17251E`. Los dos últimos son adaptaciones de interfaz, no valores declarados oficiales por el manual. Los tonos de texto y estados tienen variantes para ambos temas.

La distribución mantiene encabezado y acciones arriba, controles alineados a la izquierda y mapa/vista previa a la derecha. En móvil se apilan controles y mapa, sin encerrar el formulario en una segunda zona de desplazamiento corta.

```text
[Marca / Nombre del reporte]           [Volver al panel] [Tema]
[Editar y revisar          ] [Mapa manual | Placa para redes]
[Estado de publicación     ] [                              ]
[Datos                     ] [Mapa o imágenes y descargas   ]
[Revisar y publicar        ] [                              ]
[Generar placa             ] [                              ]
[Compartir mapa publicado  ] [                              ]
```

Se conserva Positron como cartografía clara, en ambos temas del panel. El tema no cambia los colores de riesgo, fenómenos ni imágenes exportadas: son información, no decoración.

## Cambios implementados

- Selector claro/oscuro en el encabezado compartido. Preferencia local persistente, inicialización antes de React, preferencia del sistema como valor inicial y sincronización entre pestañas.
- Variables de superficie, borde, texto, estados y acciones para ambos temas. Corregida la variable ausente de contraste de botones principales.
- Encabezados, controles de fecha/texto, estados, formularios, foco visible y diseño móvil consistentes.
- Inicio con explicación del flujo y módulos en desarrollo identificados. No se implementan los flujos pendientes de focos de incendios ni del SMN.
- Componente compartido de revisión: “Revisar publicación”, “Confirmar y publicar”, “Seguir editando”. Al abrir la revisión el foco pasa a su título.
- Componente compartido de estado: “Sin publicar”, “Cambios sin publicar”, “Publicado”.
- Meteorología utiliza el mismo componente de vista previa de Pronóstico y Riesgo, con una variante para feed/historias y recomendaciones. Descargas junto a las imágenes. Cambiar de vista conserva el mapa montado y excluye sus controles de la navegación por teclado cuando está oculto.
- Meteorología permite publicar por primera vez un mapa completamente verde. La acción de publicar se ubica antes de la sección opcional de placas y recomendaciones.
- Pronóstico considera un cambio de fecha como cambio pendiente y cierra la revisión cuando se edita esa fecha. No ofrece publicar una copia idéntica de lo publicado.
- Etiquetas accesibles para temperaturas y condiciones; errores y confirmaciones anunciables; enlace para saltar al contenido.
- Pantallas cargadas bajo demanda: el login ya no arrastra MapLibre y todos los editores en su descarga inicial. Estados visibles al cargar pantalla y sesión.

## Recuperación de contraseña sin correo: propuesta

Estado: diseño del flujo, pendiente de implementación. No se agregó un formulario que prometa una recuperación inexistente.

El registro guarda DNI y teléfono, pero no demuestra que quien los escribe sea titular de la cuenta. El teléfono almacenado tampoco tiene verificación de posesión. La autenticación del proyecto es propia (sesiones en Postgres), no el servicio Supabase Auth; su pantalla de recuperación no se puede conectar directamente a un método de Supabase Auth.

Propuesta recomendada para este panel interno:

1. “¿Olvidaste tu contraseña?” abre una pantalla con instrucciones para contactar al responsable y un acceso “Ya tengo un código”.
2. El superadministrador ubica la cuenta por DNI dentro de Usuarios. El DNI se normaliza; si hay registros duplicados debe resolverlos antes de emitir un código. No se ofrece una búsqueda pública de personas.
3. El responsable verifica la identidad por un procedimiento institucional: presencialmente o mediante un contacto previamente verificado. Conocer DNI, teléfono o dependencia no basta.
4. “Generar código de recuperación” crea un código aleatorio de un solo uso, asociado a esa cuenta y con vencimiento breve (propuesta: 15 minutos). Se muestra una sola vez y se entrega por el canal verificado. No se conoce ni se decide la contraseña nueva del usuario.
5. La persona ingresa el código, una contraseña nueva y su repetición. El servidor valida todo, consume el código de forma atómica y cierra las sesiones anteriores. Vuelve al login normal.

Requisitos de implementación: guardar solamente el hash del código, limitar intentos por IP y cuenta, invalidar códigos anteriores, autorizar la emisión solo a superadministradores, auditar quién lo emitió/consumió sin registrar el secreto, conservar datos y rol del usuario y no revelar públicamente si existe un DNI. Definir además cómo recuperar al único superadministrador si pierde acceso.

Alternativa automática: código por SMS o WhatsApp al número verificado. Requiere proveedor, credenciales, verificación de teléfono y tratamiento de cambios de número. No elimina la necesidad de un canal de entrega.

Esta propuesta sigue las recomendaciones de [OWASP para recuperación de contraseñas](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html): códigos aleatorios, uso único, vencimiento, limitación de intentos y revocación de sesiones.

Hallazgo para resolver antes de implementar recuperación: `mapa-backend/scripts/crear-usuario.js` no debe reutilizarse como recuperación de usuarios comunes. Llama al alta/actualización con rol superadmin y puede reemplazar los datos personales por valores vacíos. Hace falta una operación específica que cambie únicamente contraseña y sesiones.

## Revisión por pantalla y pendientes

| Pantalla | Resultado / siguiente mejora |
| --- | --- |
| Login | Tema, tipografía, campos y errores coherentes. Falta implementar el flujo de recuperación elegido. |
| Inicio | Introducción al flujo y tarjetas con descripciones consistentes. |
| Pronóstico | Estado y confirmación compartidos; fecha incluida en cambios pendientes. |
| Riesgo de incendios | Estado, revisión y vista previa compartidos. |
| Alertas meteorológicas | Vista previa compartida, descargas junto a imágenes, publicación separada de recomendaciones. |
| Usuarios | Tema, mensajes accesibles y campos móviles. Próxima ampliación: búsqueda e interfaz de recuperación asistida. |
| Alertas de incendios / SMN | Reciben tema del encabezado y estilos comunes. Flujos funcionales pendientes, según el alcance acordado. |
| Mapas públicos | Se conserva la cartografía y los colores publicados. |

Otros hallazgos de código:

- `mapa-frontend/src/components/BrandHeader.jsx`: el logotipo se reconstruye con texto HTML. El manual indica ajustes ópticos propios; para reproducción exacta hace falta sustituirlo por el archivo maestro horizontal y su variante blanca. No se debe presentar la reconstrucción actual como reproducción exacta del logotipo.
- `mapa-frontend/src/pages/AdminPage.jsx`: la previsualización asíncrona necesita descartar respuestas anteriores si se edita rápidamente, y la carga inicial todavía silencia algunos errores. Conviene abordarlo como mejora funcional separada.
- `mapa-frontend/src/pages/RiesgoIncendiosPage.jsx`: existe aviso al cerrar la pestaña con cambios; hay que extender una protección equivalente a navegación interna y a los demás editores.
- `mapa-frontend/src/components/SmnAlertas.jsx`: conserva estilos propios. Unificarlo cuando se defina su flujo definitivo.

La revisión de accesibilidad toma como referencia las [Web Interface Guidelines de Vercel](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). La comprobación de código no sustituye pruebas con teclado ni lector de pantalla.

## Validación

`npm run build --prefix mapa-frontend` y `git diff --check` completados. También se verificaron cinco casos de inicialización de tema y el renderizado estático de las vistas de mapa, recomendaciones y placa vacía (incluyendo exclusión de controles ocultos). Sin cambios en esquema, credenciales ni datos de producción. La compilación conserva un aviso por el tamaño del módulo cartográfico; ahora se carga cuando se abre una pantalla de mapas.

Revisión manual sugerida al usuario: alternar tema y recargar; entrar a los tres editores; editar y revisar; volver a editar; generar y descargar; cambiar entre mapa/placas; probar ancho de móvil. Para Meteorología comprobar también recomendaciones y primera publicación completamente verde. La publicación real requiere decidir qué reporte se desea hacer público.
