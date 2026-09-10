/* Política de privacidad, PÚBLICA y sin sesión.

   Existe porque Google la exige para pasar la pantalla de consentimiento de
   OAuth a producción: sin una URL de política válida, el botón «Publicar app»
   queda deshabilitado (comprobado, 10 sep 2026 — el tooltip pide «una URL de
   página principal y una URL de política de privacidad válidas»).

   Tiene que poder abrirse SIN iniciar sesión: la revisan personas que no
   tienen cuenta, y quien está decidiendo si entra con Google todavía no entró.

   Lo que dice es lo que la app hace de verdad. Una política genérica copiada
   de una plantilla sería mentir sobre datos ajenos, que acá son las
   predicciones y la plata del grupo. */
import DocumentoLegal, { Seccion } from '../components/legal/DocumentoLegal'

export default function PrivacidadPage() {
  return (
    <DocumentoLegal titulo="Política de privacidad" actualizado="10 de septiembre de 2026">
      <p>
        Tico Games es una aplicación privada para que grupos de amigos predigan
        resultados de fútbol. Esta página explica qué datos guarda y qué hace
        con ellos.
      </p>

      <Seccion titulo="Qué datos guardamos">
        <ul>
          <li><b>Tu correo electrónico</b>, para identificarte y para que puedas recuperar el acceso.</li>
          <li><b>Tu nombre visible y tu foto de perfil</b>, si la ponés. La foto es opcional.</li>
          <li><b>Tus predicciones, tus puntos y las quinielas a las que pertenecés.</b></li>
          <li><b>Tu suscripción a notificaciones</b>, solo si las activás. Se puede desactivar desde tu perfil.</li>
          <li>Registros técnicos de acceso (fecha, tipo de dispositivo), para poder diagnosticar fallos.</li>
        </ul>
        <p>
          No pedimos ni guardamos datos de tarjetas, direcciones ni números de
          teléfono. La aplicación <b>no procesa pagos</b>.
        </p>
      </Seccion>

      <Seccion titulo="Si entrás con Google">
        <p>
          Google nos comparte únicamente <b>tu correo, tu nombre y tu foto de
          perfil</b>. Nada más: ni tus contactos, ni tu calendario, ni tu
          actividad en otros servicios. Usamos ese correo para reconocer tu
          cuenta; si ya tenías una con ese mismo correo, entrás a esa misma y
          conservás tus quinielas y tus puntos.
        </p>
      </Seccion>

      <Seccion titulo="Quién más los ve">
        <ul>
          <li><b>El resto de tu quiniela</b> ve tu nombre, tu foto, tus predicciones (una vez que el partido cierra) y tus puntos. De eso se trata el juego.</li>
          <li><b>Nadie fuera de tus quinielas</b> ve tus predicciones.</li>
          <li>Usamos <b>Supabase</b> (base de datos y cuentas) y <b>Vercel</b> (alojamiento) para hacer funcionar la app. Los datos de los partidos vienen de ESPN, que no recibe ningún dato tuyo.</li>
        </ul>
        <p>
          <b>No vendemos tus datos, no hacemos publicidad y no los compartimos
          con nadie más.</b>
        </p>
      </Seccion>

      <Seccion titulo="Qué podés hacer">
        <p>
          Podés cambiar tu nombre y tu foto desde tu perfil, desactivar las
          notificaciones cuando quieras, y pedir que borremos tu cuenta y todo
          lo asociado a ella escribiendo al correo de abajo. Si borrás tu
          cuenta, tus predicciones dejan de estar asociadas a vos.
        </p>
      </Seccion>

      <Seccion titulo="Contacto">
        <p>
          Escribinos a <a href="mailto:kgcalderon1997@gmail.com">kgcalderon1997@gmail.com</a>.
        </p>
      </Seccion>
    </DocumentoLegal>
  )
}
