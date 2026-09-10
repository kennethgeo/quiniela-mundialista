/* Condiciones del servicio, PÚBLICAS y sin sesión. Ver PrivacidadPage para
   el porqué del requisito de Google.

   El punto que NO se puede omitir es el del dinero: la app lleva la cuenta de
   un pozo pero no cobra, no paga y no retiene nada. Dejarlo ambiguo en una
   quiniela por plata sería justo lo que no hay que hacer. */
import DocumentoLegal, { Seccion } from '../components/legal/DocumentoLegal'

export default function TerminosPage() {
  return (
    <DocumentoLegal titulo="Condiciones del servicio" actualizado="10 de septiembre de 2026">
      <p>
        Tico Games es una aplicación gratuita para que grupos de amigos predigan
        resultados de fútbol y lleven la cuenta de sus aciertos.
      </p>

      <Seccion titulo="Sobre el dinero">
        <p>
          Algunos grupos juegan por plata entre ellos. <b>La aplicación no cobra,
          no paga, no retiene ni transfiere dinero</b>: solo muestra lo que el
          administrador de cada quiniela anota sobre el pozo y las cuotas.
          Cualquier acuerdo económico es entre los miembros del grupo, y los
          cobros y pagos ocurren fuera de la app.
        </p>
      </Seccion>

      <Seccion titulo="Las reglas las pone tu grupo">
        <p>
          Cada quiniela tiene un administrador que fija el puntaje, los
          comodines y el pozo. Algunos cambios exigen la votación del grupo.
          La app aplica esas reglas; no arbitra desacuerdos entre miembros.
        </p>
      </Seccion>

      <Seccion titulo="Los datos de los partidos">
        <p>
          Los marcadores, horarios y alineaciones vienen de fuentes externas y
          <b> pueden llegar tarde o con errores</b>. Hacemos lo posible por
          corregirlos, pero no garantizamos que sean exactos. El administrador
          puede corregir un resultado y recalcular los puntos.
        </p>
      </Seccion>

      <Seccion titulo="Tu cuenta">
        <p>
          Sos responsable de lo que se haga desde tu cuenta. No creés cuentas
          con el correo de otra persona. Podés dejar de usar la app cuando
          quieras y pedir que la borremos.
        </p>
      </Seccion>

      <Seccion titulo="Sin garantías">
        <p>
          La app se ofrece tal como está, sin costo y sin garantía de estar
          siempre disponible. No nos hacemos responsables de pérdidas
          derivadas de fallos, caídas o datos incorrectos.
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
