import { useEffect, useMemo, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { encolarExtraccion, enCola, suscribirCola } from '../lib/acciones'
import { ESTADOS, nombreEstado, type Estado, type Tramite } from '../lib/tipos'
import NuevoLote from './NuevoLote'

type Orden = 'recientes' | 'faciles' | 'producto'

export function BadgeEstado({ e }: { e: Estado }) {
  return <span className={`estado estado-${e}`}>{nombreEstado(e)}</span>
}

const fecha = (t?: { toDate(): Date }) =>
  t ? t.toDate().toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

export default function Tablero() {
  const [tramites, setTramites] = useState<Tramite[]>([])
  const [filtro, setFiltro] = useState<Estado | 'activos' | 'todos'>('activos')
  const [texto, setTexto] = useState('')
  const [orden, setOrden] = useState<Orden>('recientes')
  const [nuevo, setNuevo] = useState(false)
  const [cola, setCola] = useState<string[]>(enCola())
  const [error, setError] = useState('')

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'tramites'), orderBy('actualizado', 'desc'), limit(1000)),
        (s) => setTramites(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Tramite, 'id'>) }))),
        (e) => setError(e.message),
      ),
    [],
  )
  useEffect(() => suscribirCola(() => setCola(enCola())), [])

  const cuentas = useMemo(() => {
    const c: Record<string, number> = {}
    for (const t of tramites) c[t.estado] = (c[t.estado] ?? 0) + 1
    return c
  }, [tramites])

  const visibles = useMemo(() => {
    const q = texto.trim().toLowerCase()
    let l = tramites.filter((t) =>
      filtro === 'todos' ? true : filtro === 'activos' ? !['archivado', 'cumple'].includes(t.estado) : t.estado === filtro,
    )
    if (q) l = l.filter((t) => [t.producto, t.carpeta, t.clienteNombre, t.nso?.numero, t.lote].some((x) => x?.toLowerCase().includes(q)))
    if (orden === 'faciles') l = [...l].sort((a, b) => (a.resumen?.decisiones ?? 99) - (b.resumen?.decisiones ?? 99))
    if (orden === 'producto') l = [...l].sort((a, b) => (a.producto ?? '').localeCompare(b.producto ?? '', 'es'))
    return l
  }, [tramites, filtro, texto, orden])

  const porExtraer = tramites.filter((t) => t.estado === 'cargado' && !cola.includes(t.id))

  return (
    <div className="pagina">
      <header className="cabecera-pagina">
        <div>
          <h1>Trámites de sistematización</h1>
          <p className="sub">Una fila por producto. Ordene por «menos decisiones» para despachar primero los fáciles.</p>
        </div>
        <div className="acciones">
          {porExtraer.length ? (
            <button onClick={() => encolarExtraccion(porExtraer.map((t) => t.id))}>Extraer {porExtraer.length} pendientes</button>
          ) : null}
          <button className="primario" onClick={() => setNuevo(true)}>
            + Nuevo lote
          </button>
        </div>
      </header>

      {error ? <div className="aviso-error">{error}</div> : null}
      {cola.length ? <div className="aviso-info">{cola.length} trámite(s) en cola de extracción en este navegador. No cierre la pestaña hasta que empiecen.</div> : null}

      <div className="filtros">
        <button className={filtro === 'activos' ? 'chip activo' : 'chip'} onClick={() => setFiltro('activos')}>
          Activos
        </button>
        {ESTADOS.filter((e) => cuentas[e.id]).map((e) => (
          <button key={e.id} title={e.ayuda} className={filtro === e.id ? 'chip activo' : 'chip'} onClick={() => setFiltro(e.id)}>
            {e.nombre} <span className="cuenta">{cuentas[e.id]}</span>
          </button>
        ))}
        <button className={filtro === 'todos' ? 'chip activo' : 'chip'} onClick={() => setFiltro('todos')}>
          Todos <span className="cuenta">{tramites.length}</span>
        </button>
        <span className="separador" />
        <input className="buscar" placeholder="Buscar producto, cliente, NSO, lote…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)} aria-label="Orden">
          <option value="recientes">Más recientes</option>
          <option value="faciles">Menos decisiones primero</option>
          <option value="producto">Producto A–Z</option>
        </select>
      </div>

      {visibles.length === 0 ? (
        <div className="vacio-grande">
          {tramites.length === 0 ? (
            <>
              <p>Aún no hay trámites.</p>
              <button className="primario" onClick={() => setNuevo(true)}>
                Cargar el primer lote de carpetas
              </button>
            </>
          ) : (
            <p>Ningún trámite coincide con el filtro.</p>
          )}
        </div>
      ) : (
        <div className="tabla-scroll">
          <table className="tabla tablero">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cliente</th>
                <th>Estado</th>
                <th className="num">Ingred.</th>
                <th className="num">Decisiones</th>
                <th>NSO</th>
                <th>Responsable</th>
                <th>Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((t) => (
                <tr key={t.id} onClick={() => (location.hash = `#/t/${t.id}`)} className="clicable">
                  <td>
                    <a href={`#/t/${t.id}`}>{t.producto || t.carpeta}</a>
                    {t.producto !== t.carpeta ? <div className="sub">{t.carpeta}</div> : null}
                    {t.estado === 'extrayendo' && t.progreso ? <div className="sub progreso">{t.progreso}</div> : null}
                    {t.estado === 'error' && t.error ? <div className="sub alerta">{t.error.slice(0, 120)}</div> : null}
                    {cola.includes(t.id) ? <div className="sub">En cola…</div> : null}
                  </td>
                  <td>{t.clienteNombre ?? <span className="vacio">—</span>}</td>
                  <td>
                    <BadgeEstado e={t.estado} />
                  </td>
                  <td className="num">{t.resumen?.ingredientes ?? ''}</td>
                  <td className="num">{t.resumen ? <span className={t.resumen.decisiones ? 'alerta' : 'ok'}>{t.resumen.decisiones}</span> : ''}</td>
                  <td>{t.nso?.numero ?? <span className="vacio">—</span>}</td>
                  <td className="sub">{t.responsable?.split('@')[0]}</td>
                  <td className="sub">{fecha(t.actualizado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nuevo ? <NuevoLote onCerrar={() => setNuevo(false)} /> : null}
    </div>
  )
}
