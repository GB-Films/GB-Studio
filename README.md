# GB Studio

La [página principal de GB Studio](https://gb-films.github.io/GB-Studio/) reúne los accesos a [Visto](https://gb-films.github.io/GB-Studio/?app=storyboards) para organizar tomas y [Mira](https://gb-films.github.io/GB-Studio/?app=reviews) para corregir fotos y videos. El recuadro de [Compi](https://gb-films.github.io/GB-Studio/downloads/Compi.zip) descarga la aplicación de escritorio para Windows. También presenta **PDR**, la futura herramienta de planes de rodaje, como «En proceso» sin acceso funcional. La cabecera permite volver al inicio o cambiar entre las herramientas habilitadas para la cuenta. Los enlaces nuevos de revisiones usan la dirección `GB-Studio`. Los enlaces anteriores con `/StoryApp/` requieren reemplazar esa parte de la dirección por `/GB-Studio/`; GitHub Pages no redirige la dirección antigua. Las rutas internas conservan `storyboards` y `reviews` para mantener los parámetros de los enlaces.

Para actualizar Compi, reemplazá `downloads/Compi.zip` por el ZIP de la versión nueva y publicá ese cambio. El enlace de descarga permanece igual. Después de descomprimirlo en Windows, abrí `Compi.exe`; en el primer uso puede necesitar internet para obtener FFmpeg.

## Mira

- Cada proyecto puede mostrar la portada predeterminada, una imagen cargada y reducida para sincronizarla con el equipo, o un color sólido. La portada se elige al crear o editar el proyecto.
- Para revisar un archivo ya guardado en Dropbox, compartí **ese archivo** y pegá su enlace en «Vincular desde Dropbox». Reviews conserva el enlace y reproduce el original; no lo sube ni crea otra copia. Dropbox recomienda `raw=1` para mostrar directamente el contenido de un enlace compartido, y la app lo aplica al reproducir.
- La vista directa sin conexión OAuth requiere un enlace accesible para cualquiera que lo tenga, sin contraseña ni restricción de equipo. Quien obtenga ese enlace podrá abrir el archivo en Dropbox. Si la política de la productora exige enlaces privados, hará falta una integración autenticada de Dropbox; esta modalidad por enlace no evita sus permisos ni garantiza que todos los formatos de video se reproduzcan en el navegador.
- En Reviews solo se pueden vincular archivos ya compartidos en Dropbox: no hay carga local ni arrastrar archivos desde el equipo. Cada archivo tiene sus propios comentarios. Los archivos locales creados en versiones anteriores siguen disponibles para no perder trabajo, pero ya no se pueden agregar nuevos.
- Reviews abre en un tablero de proyectos. Cada proyecto tiene título, cliente, agencia y director; al crearlo se abre una primera review de montaje y después podés crear otras independientes para VFX, cliente o cualquier etapa. Cada review mantiene separados sus archivos y comentarios. Los proyectos y reviews se pueden renombrar o eliminar, y los archivos se pueden quitar. Las eliminaciones usan confirmaciones diseñadas dentro de la app, no ventanas del navegador.
- Los archivos y comentarios de Reviews creados antes de esta organización se conservan automáticamente en el proyecto «Reviews anteriores», dentro de «Review original».
- Podés vincular un `.fbx` compartido en Dropbox para previsualizarlo en 3D cuando Dropbox permita leerlo desde el navegador; un enlace que bloquee CORS no podrá abrirse en el visor. Los FBX locales heredados siguen disponibles. Las texturas externas pueden requerir sus archivos aparte.
- Dentro de cada review podés crear secciones (por ejemplo, «Última versión») y arrastrar archivos entre ellas o reordenarlos. Quitar una sección mueve su contenido a «Sin clasificar», sin borrar archivos ni comentarios.
- En video, cada comentario queda asociado al segundo actual y aparece como marca en la línea de tiempo. Hacer clic en un comentario vuelve a ese momento.
- Dibujá sobre el cuadro antes de publicar un comentario. El trazo se guarda con ese comentario y se muestra al seleccionarlo; el archivo original no se modifica.
- «Dibujo temporal» permite marcar la imagen sin guardar esos trazos con el comentario. «Limpiar» los quita.
- Scroll hace zoom; `Z` + clic con mouse o lápiz acerca, y `Z` + arrastre vertical ajusta el zoom de forma continua. `H` vuelve a encuadrar. `F` alterna pantalla completa y `Q` oculta/muestra los controles.
- Los botones y atajos `I`/`O` marcan un rango de reproducción, sin recortar ni modificar el archivo original. La regla puede alternar entre tiempo y fotogramas. En modo fotogramas, hacer clic salta al punto elegido y arrastrar recorre el video de extremo a extremo; también podés escribir un número de frame o usar los botones ±1F para ajustar. La numeración usa el FPS seleccionado y permite comenzar en 1001. `←`/`→` avanzan o retroceden un fotograma estimado, `↑`/`↓` saltan entre tiempos de comentarios, `Inicio`/`Fin` van a los extremos del video. En videos de FPS variable o con límites del decodificador del navegador, el cuadro efectivamente mostrado puede no coincidir exactamente con el número calculado.
- «Captura PNG» descarga el cuadro visible con la anotación superpuesta cuando el navegador permite leer los píxeles del archivo. Enlaces externos de Dropbox normalmente no habilitan esa lectura por CORS: en ese caso la app muestra un aviso y no promete una captura inexistente. El ícono de descarga de la cabecera ofrece el original únicamente cuando el archivo ya es MP4; no convierte ni recorta otros formatos.
- Cada tarjeta de review tiene «Compartir». Publica en Firestore los enlaces de Dropbox, la organización y los comentarios de esa review; no copia los videos ni las fotos. El enlace abre directamente el visor, sin el dashboard ni navegación hacia otros proyectos. Quien tenga el enlace puede mirar sin iniciar sesión; para comentar o dibujar escribe su nombre de invitado. Las correcciones se sincronizan entre navegadores. El enlace funciona como una llave: quien lo reciba puede entrar a esa review, por lo que no debe publicarse en lugares abiertos. Al eliminar la review o el proyecto, el enlace se revoca y se eliminan los datos compartidos de esa review.
- Los enlaces antiguos `#review=...` siguen mostrando un único archivo de Dropbox, pero son de solo lectura y no comparten comentarios. Para recibir feedback usá el enlace nuevo de la tarjeta de review.
- Podés resolver, reabrir o eliminar comentarios, y eliminar un archivo con todos sus comentarios.
- Los proyectos de Reviews y sus enlaces de Dropbox se sincronizan para las cuentas del equipo autorizadas, se hayan compartido con clientes o no. Los comentarios de Reviews también se sincronizan. La cuenta administradora puede migrar los proyectos anteriores guardados solo en ese navegador; las demás cuentas ven la biblioteca compartida según sus permisos. Los storyboards de Visto también se sincronizan con las cuentas autorizadas, incluidas sus fotos; el primer acceso con permiso completo migra los proyectos que estaban guardados solo en ese navegador. Los archivos locales heredados de Mira no se pueden compartir hasta reemplazarlos por enlaces de Dropbox. Los videos y fotos vinculados en Mira **no** se copian a Firestore. Para video, usá un formato compatible con el navegador (por ejemplo, MP4/H.264 o WebM).

## Funciones

- Biblioteca lateral para cargar todas las fotos del proyecto.
- Artboards 16:9, 9:16 y 1:1.
- Arrastrar fotos desde la biblioteca al artboard, sin definir una cantidad por página.
- Distribución automática que compara filas según las proporciones reales de las fotos y el formato del canvas.
- Agregar, quitar y duplicar fotos recalcula la composición, con márgenes seguros y sin huecos reservados.
- Reordenar fotos arrastrándolas; se conserva la secuencia de lectura de izquierda a derecha y de arriba hacia abajo.
- Arrastrar una foto fuera del canvas la elimina directamente del storyboard.
- Alt + arrastrar una miniatura de la barra de páginas duplica esa página con sus fotos y datos.
- La opción `Completa` respeta siempre la orientación y proporción original de la foto.
- Encuadre `Recortar` opcional, con punto focal configurable.
- Agregar pendientes incorpora las fotos de la biblioteca aún no usadas, sin reemplazar las tomas editadas.
- Las páginas adicionales se crean cuando el usuario quiere separar la secuencia; no hay un cupo de fotos por hoja.
- La información debajo de la foto puede mostrarse con recuadro blanco y texto negro o con recuadro negro y texto blanco. La información superpuesta conserva su estilo negro translúcido.
- Páginas múltiples, guardado local e importación/exportación del proyecto.
- Alta de proyectos con título y cliente obligatorios, más agencia y director opcionales. La identidad de productora queda fija como GRAN BERTA FILMS y puede ocultarse en el artboard.
- Archivo de proyectos ordenable por última modificación, título o cliente.
- Versiones agrupadas dentro de cada proyecto para crear alternativas horizontales, verticales o cuadradas.
- Exportar la hoja como PNG/JPG o imprimir todas las páginas a PDF.

## Uso local

Abrí `index.html` en el navegador. No requiere instalación ni servidor.

## Verificación

`node --test tests/*.test.cjs` comprueba márgenes, proporciones, orden y ausencia de superposiciones en los tres formatos.

## Acceso con Google

La app está conectada al proyecto Firebase `GB Studio` (`gb-studio-260bc`) mediante `firebase-config.js`. La configuración web de Firebase contiene identificadores públicos; la seguridad de los datos compartidos depende de Authentication y de las reglas de Firestore en `firestore.rules`. El administrador inicial es `info@granbertafilms.com`. La tuerquita junto al perfil abre Configuración → Permisos: muestra las cuentas autorizadas y las solicitudes pendientes, y permite editar el acceso de cada persona. Visto ofrece **Acceso completo** (crear, editar y eliminar) y **Solo lectura** (abrir proyectos, versiones y páginas). Firestore impide que el rol de lectura modifique proyectos compartidos. Mira ofrece Cliente (solo reviews asignadas y posibilidad de comentar), Lectura (toda la biblioteca), Colaborador/a (edición), Ejecutiva / Gerencia (crear, editar y compartir) y permisos personalizados. La asignación de Cliente se guarda como una lista de reviews compartidas; su cuenta no puede consultar las colecciones privadas completas de proyectos y archivos. Los enlaces públicos de review siguen funcionando para cualquiera que tenga el enlace. Las cuentas autorizadas antes de estos permisos conservan su acceso completo hasta que la administradora edite sus opciones. Una copia local o exportada de Visto no puede revocarse de forma remota. Los videos y fotos vinculados en Mira siguen en Dropbox y requieren acceso al archivo original.

La base Firestore predeterminada está en `southamerica-east1` (São Paulo) y tiene protección de borrado. Las reglas se publican con `npx firebase-tools deploy --only firestore:rules --project gb-studio-260bc`. Google y Anonymous deben estar habilitados en Authentication; `gb-films.github.io` debe figurar entre los dominios autorizados. Para comprobarlo en una instalación nueva:

1. Abrí `Authentication` → `Sign-in method`.
2. Habilitá los proveedores `Google` y `Anonymous`, y elegí el correo de asistencia del proyecto.
3. En los dominios autorizados, verificá que figure `gb-films.github.io`.
4. Publicá `firestore.rules` antes de publicar la interfaz; nunca uses reglas de prueba abiertas.

Después, el botón `Iniciar sesión` abre el acceso con Google; al tocar el perfil se muestran la cuenta, el rol, las aplicaciones habilitadas y una acción independiente para cerrar sesión. Las reglas de Firestore controlan los datos compartidos de Reviews; ocultar botones no es la barrera de seguridad.
