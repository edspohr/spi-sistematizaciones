import { useEffect, useState } from 'react'
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { auth, db, fn } from '../lib/firebase'
import {
  cambiarEstado,
  descargar,
  encolarExtraccion,
  exportarExcel,
  guardarCampos,
  leerPlanilla,
  planillaParaExtension,
} from '../lib/acciones'
import type { Evento, Planilla, Tramite } from '../lib/tipos'
import PlanillaVista from '../components/PlanillaVista'
import { BadgeEstado } from './Tablero'

const fechaHora = (t?: { toDate(): Date }) => (t ? t.toDate().toLocaleString('es-CO') : '')

function Paso({ n, titulo, hecho, actual, children }: { n: number; titulo: string; hecho: boolean; actual: boolean; children?: React.ReactNode }) {
  return (
    <li className={`paso ${hecho ? 'hecho' : ''} ${actual ? 'actual' : ''}`}>
      <span className="num-paso">{hecho ? '✓' : n}</span>
      <div>
        <strong>{titulo}</strong>
        {children ? <div className="sub">{children}</div> : null}
      </div>
    </li>
  )
}

function DatosNso({ t }: { t: Tramite }) {
  const [nso, setNso] = useState(t.nso ?? {})
  const [invimaId, setInvimaId] = useState(t.invimaId ?? '')
  const [guardado, setGuardado] = useState(false)
  useEffect(() => {
    setNso(t.nso ?? {})
    setInvimaId(t.invimaId ?? '')
  }, [t.nso, t.invimaId])
  const cambio = JSON.stringify(nso) !== JSON.stringify(t.nso ?? {}) || invimaId !== (t.invimaId ?? '')
  return (
    <section className="tarjeta">
      <h3>NSO vigente a sistematizar</h3>
      <p className="sub">Van en la pantalla «Sistematización» de InvimÁgil. Debe coincidir con el último documento oficial.</p>
      <div className="grid-campos">
        <label className="campo">
          <span>Número de NSO</span>
          <input value={nso.numero ?? ''} onChange={(e) => setNso({ ...nso, numero: e.target.value.trim() })} placeholder="NSOC12345-23CO" />
        </label>
        <label className="campo">
          <span>Fecha de emisión / última renovación</span>
          <input type="date" value={nso.emision ?? ''} onChange={(e) => setNso({ ...nso, emision: e.target.value })} />
        </label>
        <label className="campo">
          <span>Fecha de vencimiento</span>
          <input type="date" value={nso.vencimiento ?? ''} onChange={(e) => setNso({ ...nso, vencimiento: e.target.value })} />
        </label>
        <label className="campo">
          <span>Id de la solicitud en InvimÁgil</span>
          <input value={invimaId} onChange={(e) => setInvimaId(e.target.value.trim())} placeholder="106983" />
        </label>
      </div>
      {nso.vencimiento && new Date(nso.vencimiento) < new Date() ? (
        <div className="aviso-error">La NSO está vencida: INVIMA no permite sistematizarla.</div>
      ) : null}
      <button
        disabled={!cambio}
        onClick={async () => {
          await guardarCampos(t, { nso, invimaId }, 'nso_editada')
          setGuardado(true)
          setTimeout(() => setGuardado(false), 2000)
        }}
      >
        {guardado ? 'Guardado ✓' : 'Guardar'}
      </button>
    </section>
  )
}

function Decisiones({ t, planilla }: { t: Tramite; planilla: Planilla }) {
  const pendientes = planilla.decisiones ?? []
  const resueltas = planilla._decisiones_resueltas ?? []
  const [resp, setResp] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState('')
  const llenas = Object.entries(resp).filter(([, v]) => v.trim())
  return (
    <section className="tarjeta">
      <h3>
        Decisiones pendientes <span className="cuenta">{pendientes.length}</span>
      </h3>
      {pendientes.length === 0 ? <p className="ok">No hay decisiones pendientes.</p> : null}
      {pendientes.map((d) => (
        <div key={d.id} className="decision-item">
          <div className="decision-cab">
            <strong>{d.id}</strong> {d.tema} <span className="sub">· {d.donde}</span>
          </div>
          <p>{d.hallazgo}</p>
          {d.propuesta ? <p className="sub">Propuesta: {d.propuesta}</p> : null}
          <textarea
            rows={2}
            placeholder="Respuesta de la analista (qué valor queda y por qué)"
            value={resp[d.id] ?? ''}
            onChange={(e) => setResp({ ...resp, [d.id]: e.target.value })}
            disabled={enviando}
          />
        </div>
      ))}
      {pendientes.length ? (
        <button
          className="primario"
          disabled={!llenas.length || enviando}
          onClick={async () => {
            setEnviando(true)
            setMsg('')
            try {
              const r = await fn.aplicarDecisiones({ tramiteId: t.id, respuestas: llenas.map(([id, respuesta]) => ({ id, respuesta })) })
              setResp({})
              setMsg(
                `Aplicadas. Quedan ${r.data.pendientes} pendientes.` + (r.data.sinCerrar.length ? ` No se pudieron cerrar: ${r.data.sinCerrar.join(', ')}.` : ''),
              )
            } catch (e: any) {
              setMsg(`Error: ${e.message}`)
            } finally {
              setEnviando(false)
            }
          }}
        >
          {enviando ? 'Aplicando con Gemini…' : `Aplicar ${llenas.length} respuesta(s)`}
        </button>
      ) : null}
      {msg ? <p className={msg.startsWith('Error') ? 'alerta' : 'ok'}>{msg}</p> : null}
      {resueltas.length ? (
        <details>
          <summary>{resueltas.length} decisiones ya resueltas</summary>
          <ul className="resueltas">
            {resueltas.map((d, i) => (
              <li key={i}>
                <strong>{d.id}</strong> {d.tema}: {d.respuesta} <span className="sub">({d.fecha}{d.por ? ` · ${d.por}` : ''})</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

function Resultado({ t }: { t: Tramite }) {
  const [obs, setObs] = useState('')
  const registrar = (valor: 'cumple' | 'no_cumple') =>
    cambiarEstado(t, valor, { resultado: { valor, observaciones: obs, fecha: new Date().toISOString().slice(0, 10), por: auth.currentUser?.email } }, obs)
  return (
    <section className="tarjeta">
      <h3>Resultado del cotejo de INVIMA</h3>
      <textarea rows={3} placeholder="Observaciones del funcionario (obligatorias si no cumple)" value={obs} onChange={(e) => setObs(e.target.value)} />
      <div className="acciones">
        <button className="ok-btn" onClick={() => registrar('cumple')}>
          Finalización exitosa
        </button>
        <button className="peligro" disabled={!obs.trim()} onClick={() => registrar('no_cumple')}>
          Finalización no exitosa
        </button>
      </div>
    </section>
  )
}

function Bitacora({ id }: { id: string }) {
  const [eventos, setEventos] = useState<Evento[]>([])
  useEffect(
    () =>
      onSnapshot(query(collection(db, 'tramites', id, 'eventos'), orderBy('fecha', 'desc'), limit(100)), (s) =>
        setEventos(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Evento, 'id'>) }))),
      ),
    [id],
  )
  return (
    <section className="tarjeta">
      <h3>Bitácora</h3>
      <ul className="bitacora">
        {eventos.map((e) => (
          <li key={e.id}>
            <span className="sub">{fechaHora(e.fecha)}</span> <strong>{e.tipo.replace(/_/g, ' ')}</strong> <span className="sub">· {e.por}</span>
            {e.detalle ? <div className={`detalle ${e.tipo.startsWith('error') ? 'alerta' : ''}`}>{e.detalle.split('\n')[0]}</div> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function TramiteVista({ id }: { id: string }) {
  const [t, setT] = useState<Tramite | null | undefined>(undefined)
  const [planilla, setPlanilla] = useState<Planilla | null>(null)
  const [ocupado, setOcupado] = useState('')
  const [error, setError] = useState('')

  useEffect(
    () =>
      onSnapshot(
        doc(db, 'tramites', id),
        (s) => setT(s.exists() ? ({ id: s.id, ...(s.data() as Omit<Tramite, 'id'>) } as Tramite) : null),
        (e) => setError(e.message),
      ),
    [id],
  )
  useEffect(() => {
    if (!t?.version) return setPlanilla(null)
    leerPlanilla(t).then(setPlanilla).catch((e) => setError(e.message))
  }, [t?.id, t?.version]) // eslint-disable-line react-hooks/exhaustive-deps

  if (t === undefined) return <div className="pagina">Cargando…</div>
  if (t === null) return <div className="pagina">El trámite no existe. <a href="#/">Volver</a></div>

  const accion = async (nombre: string, f: () => Promise<unknown>) => {
    setOcupado(nombre)
    setError('')
    try {
      await f()
    } catch (e: any) {
      setError(e.message ?? String(e))
    } finally {
      setOcupado('')
    }
  }
  const dec = t.resumen?.decisiones ?? 0
  const faltaNso = !t.nso?.numero || !t.nso?.emision || !t.nso?.vencimiento
  const orden = ['cargando', 'cargado', 'extrayendo', 'en_revision', 'aprobado', 'inyectado', 'enviado', 'cumple']
  const idx = orden.indexOf(t.estado === 'no_cumple' ? 'enviado' : t.estado === 'error' ? 'cargado' : t.estado)

  return (
    <div className="pagina">
      <a href="#/" className="volver">
        ← Trámites
      </a>
      <header className="cabecera-pagina">
        <div>
          <h1>{t.producto || t.carpeta}</h1>
          <p className="sub">
            {t.clienteNombre ?? 'Sin cliente'} · carpeta «{t.carpeta}» · {t.archivos?.length ?? 0} archivos
            {t.version ? ` · planilla v${t.version}` : ''} · responsable {t.responsable}
          </p>
        </div>
        <BadgeEstado e={t.estado} />
      </header>

      {error ? <div className="aviso-error">{error}</div> : null}
      {t.estado === 'error' && t.error ? <div className="aviso-error">La última extracción falló: {t.error}</div> : null}
      {t.estado === 'extrayendo' ? (
        <div className="aviso-info">
          Extrayendo con Gemini… {t.progreso}
          {t.progresoDesde && Date.now() - t.progresoDesde.toMillis() > 35 * 60 * 1000 ? (
            <>
              {' '}
              Lleva más de 35 minutos: probablemente se interrumpió.{' '}
              <button onClick={() => encolarExtraccion([t.id])}>Reintentar</button>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="dos-columnas">
        <div className="col-principal">
          <section className="tarjeta">
            <h3>Flujo</h3>
            <ol className="pasos">
              <Paso n={1} titulo="Carpeta cargada" hecho={idx > 1} actual={idx <= 1}>
                {t.estado === 'cargado' || t.estado === 'error' ? (
                  <button className="primario" disabled={!!ocupado} onClick={() => encolarExtraccion([t.id])}>
                    Extraer con Gemini
                  </button>
                ) : null}
              </Paso>
              <Paso n={2} titulo="Revisión de la planilla" hecho={idx > 3} actual={idx === 3}>
                {t.estado === 'en_revision' ? (
                  <>
                    {dec ? `${dec} decisiones pendientes. ` : 'Sin decisiones pendientes. '}
                    {faltaNso ? 'Faltan los datos de la NSO vigente. ' : ''}
                    <button
                      className="primario"
                      disabled={!!ocupado}
                      onClick={() =>
                        (!dec && !faltaNso) || confirm('Hay decisiones pendientes o faltan datos de la NSO. ¿Aprobar de todos modos? Esos campos quedarán vacíos al inyectar.')
                          ? accion('aprobar', () =>
                              cambiarEstado(t, 'aprobado', { aprobacion: { por: auth.currentUser?.email, fecha: serverTimestamp(), version: t.version } }, `v${t.version}`),
                            )
                          : undefined
                      }
                    >
                      Aprobar planilla
                    </button>
                  </>
                ) : null}
              </Paso>
              <Paso n={3} titulo="Llenado en InvimÁgil" hecho={idx > 5} actual={idx === 4 || idx === 5}>
                {t.estado === 'aprobado' ? (
                  <>
                    Descargue la planilla para la extensión InvimÁgil Inyector, cree antes las mezclas en «Administración de Ingredientes».{' '}
                    <button onClick={() => accion('inyectado', () => cambiarEstado(t, 'inyectado'))}>Marcar como llenado</button>{' '}
                    <button className="link" onClick={() => accion('revision', () => cambiarEstado(t, 'en_revision', { aprobacion: null }))}>
                      volver a revisión
                    </button>
                  </>
                ) : t.estado === 'inyectado' ? (
                  <button onClick={() => accion('enviado', () => cambiarEstado(t, 'enviado'))}>Marcar como enviado a validación</button>
                ) : null}
              </Paso>
              <Paso n={4} titulo="Cotejo de INVIMA" hecho={t.estado === 'cumple'} actual={t.estado === 'enviado' || t.estado === 'no_cumple'}>
                {t.resultado ? `${t.resultado.valor === 'cumple' ? 'Cumple' : 'No cumple'} (${t.resultado.fecha})${t.resultado.observaciones ? ': ' + t.resultado.observaciones : ''}` : null}
              </Paso>
            </ol>
          </section>

          {t.estado === 'enviado' ? <Resultado t={t} /> : null}
          {planilla ? <Decisiones t={t} planilla={planilla} /> : null}
          {planilla ? (
            <section className="tarjeta">
              <div className="cabecera-tarjeta">
                <h3>Planilla v{t.version}</h3>
                <div className="acciones">
                  <button disabled={!!ocupado} onClick={() => accion('excel', () => exportarExcel(t))}>
                    {ocupado === 'excel' ? 'Generando…' : 'Excel maestro'}
                  </button>
                  <button
                    onClick={() =>
                      descargar('planilla.json', new Blob([JSON.stringify(planillaParaExtension(t, planilla), null, 1)], { type: 'application/json' }))
                    }
                  >
                    planilla.json para la extensión
                  </button>
                  {['en_revision', 'error'].includes(t.estado) ? (
                    <button
                      className="link"
                      onClick={() => confirm('Se crea una versión nueva leyendo de nuevo todo el dossier. Las respuestas ya aplicadas se pierden en la nueva versión. ¿Continuar?') && encolarExtraccion([t.id])}
                    >
                      re-extraer
                    </button>
                  ) : null}
                </div>
              </div>
              {t.resumen?.avisos?.length ? (
                <details className="avisos">
                  <summary>{t.resumen.avisos.length} avisos de validación contra el catálogo</summary>
                  <ul>
                    {t.resumen.avisos.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {planilla._meta?.hallazgos ? (
                <details className="avisos">
                  <summary>Hallazgos del extractor</summary>
                  <div className="pre">{Array.isArray(planilla._meta.hallazgos) ? planilla._meta.hallazgos.join('\n') : String(planilla._meta.hallazgos)}</div>
                </details>
              ) : null}
              <PlanillaVista planilla={planilla} />
            </section>
          ) : null}
        </div>
        <aside className="col-lateral">
          <DatosNso t={t} />
          <section className="tarjeta">
            <h3>Archivos del dossier</h3>
            <ul className="archivos">
              {(t.archivos ?? []).map((a) => (
                <li key={a.rel}>
                  {a.rel} <span className="sub">{a.mb} MB</span>
                </li>
              ))}
            </ul>
          </section>
          {t.uso && Object.keys(t.uso).length ? (
            <section className="tarjeta">
              <h3>Uso del modelo</h3>
              <dl className="mini">
                {Object.entries(t.uso).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{typeof v === 'number' ? v.toLocaleString('es-CO') : String(v)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
          <Bitacora id={t.id} />
          {t.estado !== 'archivado' ? (
            <button className="link" onClick={() => confirm('¿Archivar este trámite?') && accion('archivar', () => cambiarEstado(t, 'archivado'))}>
              Archivar trámite
            </button>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
