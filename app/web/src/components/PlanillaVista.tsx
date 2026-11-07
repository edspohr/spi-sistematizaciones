import { useMemo, useState } from 'react'
import type { Planilla } from '../lib/tipos'

// Spanish labels for the planilla keys (extractor/invimagil_base/esquema.py). Unknown keys show as-is.
const ETIQUETAS: Record<string, string> = {
  general: 'Información general',
  responsibles: 'Responsables',
  technical: 'Responsable técnico',
  legal: 'Representante legal / apoderado',
  origin: 'Origen',
  importer: 'Importador',
  manufacturer: 'Fabricante',
  thirds: 'Fabricantes terceros',
  company: 'Empresa',
  product: 'Producto',
  presentations: 'Presentaciones',
  composition: 'Composición',
  ingredients: 'Ingredientes',
  useInformation: 'Información de uso',
  technicalCharacteristics: 'Características técnicas',
  organoleptic: 'Organolépticas',
  microbiological: 'Microbiológicas',
  physicochemical: 'Fisicoquímicas',
  shelfLife: 'Vida útil',
  mandatoryDocuments: 'Documentos obligatorios',
  additionalDocuments: 'Documentos complementarios',
  label: 'Etiqueta',
  name: 'Nombre',
  value: 'Valor',
  type: 'Tipo',
  address: 'Dirección',
  countryName: 'País',
  countryCode: 'Código de país',
  isForeign: '¿Extranjero?',
  order: 'Orden',
  netContent: 'Contenido neto',
  measureUnit: 'Unidad',
  primaryContainer: 'Envase primario',
  primaryMaterial: 'Material primario',
  secondaryContainer: 'Envase secundario',
  secondaryMaterial: 'Material secundario',
  observations: 'Observaciones',
  months: 'Meses',
  files: 'Archivos',
}
const OCULTAS = new Set(['_note', '_decision', '_checks'])

const etiqueta = (k: string) => ETIQUETAS[k] ?? k

const esCatalogo = (v: unknown): v is { slug: string | null; name: string | null } =>
  !!v && typeof v === 'object' && !Array.isArray(v) && 'slug' in v && 'name' in v && Object.keys(v).every((k) => ['slug', 'name', '_decision', '_note'].includes(k))

function Valor({ v }: { v: unknown }) {
  if (v === null || v === undefined || v === '') return <span className="vacio">sin dato</span>
  if (typeof v === 'boolean') return <>{v ? 'Sí' : 'No'}</>
  if (esCatalogo(v))
    return v.name ? (
      <>
        {v.name} {v.slug ? <code className="slug">{v.slug}</code> : <span className="vacio">sin código</span>}
      </>
    ) : (
      <span className="vacio">sin dato</span>
    )
  if (Array.isArray(v) && v.every((x) => typeof x !== 'object' || esCatalogo(x)))
    return (
      <>
        {v.length === 0 ? <span className="vacio">ninguno</span> : v.map((x, i) => <span key={i} className="chip-v">{esCatalogo(x) ? x.name : String(x)}</span>)}
      </>
    )
  return <>{String(v)}</>
}

function Notas({ o }: { o: Record<string, any> }) {
  return (
    <>
      {o._decision ? <div className="decision">⚠ {o._decision}</div> : null}
      {o._note ? <div className="fuente">Fuente: {o._note}</div> : null}
    </>
  )
}

function Nodo({ k, v, nivel }: { k: string; v: any; nivel: number }) {
  if (v && typeof v === 'object' && !Array.isArray(v) && !esCatalogo(v)) {
    const hijos = Object.entries(v).filter(([kk]) => !OCULTAS.has(kk))
    return (
      <section className={`nodo nivel-${Math.min(nivel, 3)} ${v._decision ? 'con-decision' : ''}`}>
        <h4>{etiqueta(k)}</h4>
        <Notas o={v} />
        <dl>
          {hijos.map(([kk, vv]) =>
            vv && typeof vv === 'object' && !esCatalogo(vv) && !(Array.isArray(vv) && vv.every((x) => typeof x !== 'object' || esCatalogo(x))) ? (
              <div key={kk} className="fila-anidada">
                <Nodo k={kk} v={vv} nivel={nivel + 1} />
              </div>
            ) : (
              <div key={kk} className={`fila ${vv && typeof vv === 'object' && (vv as any)._decision ? 'con-decision' : ''}`}>
                <dt>{etiqueta(kk)}</dt>
                <dd>
                  <Valor v={vv} />
                  {vv && typeof vv === 'object' && !Array.isArray(vv) ? <Notas o={vv} /> : null}
                </dd>
              </div>
            ),
          )}
        </dl>
      </section>
    )
  }
  if (Array.isArray(v)) {
    return (
      <section className="nodo lista">
        <h4>
          {etiqueta(k)} <span className="cuenta">{v.length}</span>
        </h4>
        {v.length === 0 ? <p className="vacio">ninguno</p> : null}
        {v.map((item, i) => (
          <Nodo key={i} k={`${etiqueta(k)} ${i + 1}`} v={item} nivel={nivel + 1} />
        ))}
      </section>
    )
  }
  return (
    <div className="fila">
      <dt>{etiqueta(k)}</dt>
      <dd>
        <Valor v={v} />
      </dd>
    </div>
  )
}

function Composicion({ c }: { c: Record<string, any> }) {
  const ing: any[] = c?.ingredients ?? []
  const cant = (i: any) => (typeof i.quantity === 'number' ? i.quantity : parseFloat(String(i.quantity ?? '').replace(',', '.')) || 0)
  const suma = ing.filter((i) => i.itemType !== 'secondary').reduce((s, i) => s + cant(i), 0)
  const sumaSec = ing.filter((i) => i.itemType === 'secondary').reduce((s, i) => s + cant(i), 0)
  const conDecision = ing.filter((i) => i._decision).length
  return (
    <div>
      <p className="resumen-linea">
        {ing.length} ingredientes · suma de básicos <strong className={Math.abs(suma - 100) > 0.5 ? 'alerta' : ''}>{suma.toFixed(4)} %</strong>
        {sumaSec ? <span className="sub"> · secundarios (alérgenos) {sumaSec.toFixed(6)} %</span> : null}
        {conDecision ? <span className="alerta"> · {conDecision} con decisión pendiente</span> : null}
      </p>
      {c?._checks ? <Nodo k="Comprobaciones" v={c._checks} nivel={1} /> : null}
      <div className="tabla-scroll">
        <table className="tabla composicion">
          <thead>
            <tr>
              <th>#</th>
              <th>INCI</th>
              <th>CAS</th>
              <th>Tipo</th>
              <th>Función</th>
              <th>Listado</th>
              <th className="num">Cantidad</th>
              <th>Unidad</th>
              <th>Nano</th>
              <th>Fuente / decisión</th>
            </tr>
          </thead>
          <tbody>
            {ing.map((i, n) => (
              <tr key={n} className={i._decision ? 'con-decision' : ''}>
                <td>{i.order ?? n + 1}</td>
                <td>
                  <strong>{i.inci}</strong>
                </td>
                <td className="nowrap">{i.cas || <span className="vacio">—</span>}</td>
                <td>{i.itemType === 'basic' ? 'Básico' : i.itemType === 'secondary' ? 'Secundario' : i.itemType}</td>
                <td>{(i.functions ?? []).map((f: any) => f?.name).filter(Boolean).join(', ') || <span className="vacio">{i.functionSource || '—'}</span>}</td>
                <td>{i.referenceList?.name ?? <span className="vacio">—</span>}</td>
                <td className="num">{i.quantity}</td>
                <td>{i.unit?.name}</td>
                <td>{siNo(i.isNanomaterial)}</td>
                <td className="nota">
                  {i._decision ? <div className="decision">⚠ {i._decision}</div> : null}
                  {i._note ? <div className="fuente">{i._note}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>Mezclas (se crean antes, en Administración de Ingredientes → Mezclas)</h4>
      {(c?.blends ?? []).length ? (
        (c.blends as any[]).map((b, n) => (
          <div key={n} className={b._decision ? 'con-decision' : ''}>
            <p>
              <strong>{b.name}</strong> · en el COCC como {b.basicInci}
              {b.supplier ? ` · proveedor ${b.supplier}` : ''}
            </p>
            <ul>
              {(b.components ?? []).map((x: any, k: number) => (
                <li key={k}>
                  {x.inci}
                  {x.percentage != null && x.percentage !== '' ? ` · ${x.percentage} % en la mezcla` : ''}
                  {x.quantity != null && x.quantity !== '' ? ` · ${x.quantity} en el producto` : ''}
                </li>
              ))}
            </ul>
            {b._decision ? <div className="decision">⚠ {b._decision}</div> : null}
            {b._note ? <div className="fuente">{b._note}</div> : null}
          </div>
        ))
      ) : (
        <p className="vacio">Sin mezclas.</p>
      )}
    </div>
  )
}

const siNo = (v: unknown) => {
  const t = String(v ?? '').toLowerCase()
  return v === true || t === 'si' || t === 'sí' ? 'Sí' : v === false || t === 'no' ? 'No' : t === 'no_aplica' ? 'No aplica' : '—'
}

const PREGUNTAS: Record<string, string> = {
  q1: '¿Cumple la definición de producto cosmético?',
  q2: '¿Se atribuye prevención, tratamiento o diagnóstico?',
  q3: '¿Se ingiere, inhala, inyecta o implanta?',
  q4: '¿Todos los ingredientes están en listados de referencia?',
  q5: '¿Contiene ingredientes prohibidos?',
  q6: '¿Contiene ingredientes restringidos?',
  q7: '¿Los restringidos están dentro de los límites?',
  q8: '¿Las funciones están dentro del alcance cosmético?',
  q9: '¿Tiene proclamas no cosméticas?',
  q10: '¿Tiene proclamas con riesgo si no son veraces?',
  q11: '¿Se allegan estudios de soporte?',
  q12: '¿El nombre o la marca no son acordes?',
  q13: '¿Contiene ingredientes de cannabis?',
  q14: '¿Cumple la normativa de cannabis?',
  q15: '¿Es jabón o limpiador enjuagable?',
  q16: '¿Cumple la Res. 0689 / 1770?',
  q17: '¿Ampara grupos cosméticos?',
}

function Inicio({ v }: { v: Record<string, any> }) {
  const a = v?.answers ?? {}
  return (
    <div>
      <table className="tabla compacta">
        <tbody>
          {Object.entries(PREGUNTAS).map(([k, q]) => (
            <tr key={k} className={siNo(a[k]) === '—' ? 'con-decision' : ''}>
              <td>{k}</td>
              <td>{q}</td>
              <td>
                <strong>{siNo(a[k])}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {v?._decision ? <div className="decision">⚠ {v._decision}</div> : null}
      {v?._note ? <div className="fuente">{v._note}</div> : null}
    </div>
  )
}

function Archivos({ p }: { p: Planilla }) {
  const arch: any[] = p.archivos ?? []
  return (
    <div className="tabla-scroll">
      <table className="tabla">
        <thead>
          <tr>
            <th>Archivo</th>
            <th>Clasificación</th>
            <th>Legible</th>
            <th>Resumen</th>
          </tr>
        </thead>
        <tbody>
          {arch.map((a, i) => (
            <tr key={i} className={a.legible === false ? 'con-decision' : ''}>
              <td>{a.archivo}</td>
              <td>{a.clasificacion}</td>
              <td>{a.legible === false ? 'No' : 'Sí'}</td>
              <td className="nota">{a.resumen}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const PESTANAS: { id: string; nombre: string; clave?: string }[] = [
  { id: 'initialValidation', nombre: 'Inicio', clave: 'initialValidation' },
  { id: 'general', nombre: 'Información general', clave: 'general' },
  { id: 'composition', nombre: 'Composición', clave: 'composition' },
  { id: 'useInformation', nombre: 'Información de uso', clave: 'useInformation' },
  { id: 'technicalCharacteristics', nombre: 'Características técnicas', clave: 'technicalCharacteristics' },
  { id: 'mandatoryDocuments', nombre: 'Documentos obligatorios', clave: 'mandatoryDocuments' },
  { id: 'additionalDocuments', nombre: 'Documentos complementarios', clave: 'additionalDocuments' },
  { id: 'archivos', nombre: 'Archivos leídos' },
  { id: 'json', nombre: 'JSON' },
]

function cuentaDecisiones(v: any): number {
  if (!v || typeof v !== 'object') return 0
  if (Array.isArray(v)) return v.reduce((s, x) => s + cuentaDecisiones(x), 0)
  return (v._decision ? 1 : 0) + Object.entries(v).reduce((s, [k, x]) => s + (k === '_decision' ? 0 : cuentaDecisiones(x)), 0)
}

export default function PlanillaVista({ planilla }: { planilla: Planilla }) {
  const [pest, setPest] = useState('general')
  const cuentas = useMemo(() => Object.fromEntries(PESTANAS.map((p) => [p.id, p.clave ? cuentaDecisiones(planilla[p.clave]) : 0])), [planilla])
  const actual = PESTANAS.find((p) => p.id === pest)!
  return (
    <div className="planilla">
      <nav className="pestanas" role="tablist">
        {PESTANAS.map((p) => (
          <button key={p.id} role="tab" aria-selected={pest === p.id} className={pest === p.id ? 'activa' : ''} onClick={() => setPest(p.id)}>
            {p.nombre}
            {cuentas[p.id] ? <span className="badge-dec" title="Campos con decisión pendiente">{cuentas[p.id]}</span> : null}
          </button>
        ))}
      </nav>
      <div className="contenido-pestana">
        {pest === 'initialValidation' ? (
          <Inicio v={planilla.initialValidation ?? {}} />
        ) : pest === 'composition' ? (
          <Composicion c={planilla.composition ?? {}} />
        ) : pest === 'archivos' ? (
          <Archivos p={planilla} />
        ) : pest === 'json' ? (
          <pre className="json">{JSON.stringify(planilla, null, 2)}</pre>
        ) : planilla[actual.clave!] ? (
          <Nodo k={actual.nombre} v={planilla[actual.clave!]} nivel={0} />
        ) : (
          <p className="vacio">La planilla no trae esta sección.</p>
        )}
      </div>
    </div>
  )
}
