import { useEffect, useRef, useState } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { crearYSubir, encolarExtraccion, type Avance } from '../lib/acciones'
import { desdeArrastre, desdeInput, mb, type CarpetaLocal } from '../lib/carpetas'
import type { Cliente } from '../lib/tipos'

export default function NuevoLote({ onCerrar }: { onCerrar: () => void }) {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [clienteId, setClienteId] = useState('')
  const [carpetas, setCarpetas] = useState<CarpetaLocal[]>([])
  const [extraer, setExtraer] = useState(true)
  const [avances, setAvances] = useState<Record<string, Avance>>({})
  const [subiendo, setSubiendo] = useState(false)
  const [sobre, setSobre] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(
    () =>
      onSnapshot(query(collection(db, 'clientes'), orderBy('nombre')), (s) =>
        setClientes(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Cliente, 'id'>) }))),
      ),
    [],
  )
  useEffect(() => {
    if (input.current) input.current.setAttribute('webkitdirectory', '')
  }, [])

  const agregar = (nuevas: CarpetaLocal[]) =>
    setCarpetas((prev) => {
      const nombres = new Set(prev.map((c) => c.nombre))
      return [...prev, ...nuevas.filter((c) => !nombres.has(c.nombre))]
    })

  const soltar = async (e: React.DragEvent) => {
    e.preventDefault()
    setSobre(false)
    try {
      const nuevas = await desdeArrastre(e.dataTransfer.items)
      if (!nuevas.length) setError('Arrastre carpetas de producto, no archivos sueltos.')
      agregar(nuevas)
    } catch (err) {
      setError(String(err))
    }
  }

  const iniciar = async () => {
    setSubiendo(true)
    setError('')
    const cliente = clientes.find((c) => c.id === clienteId)
    const lote = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const ids: string[] = []
    for (const c of carpetas) {
      try {
        const id = await crearYSubir(c, { id: cliente?.id, nombre: cliente?.nombre }, lote, (a) =>
          setAvances((prev) => ({ ...prev, [c.nombre]: a })),
        )
        ids.push(id)
      } catch (err) {
        setAvances((prev) => ({ ...prev, [c.nombre]: { ...(prev[c.nombre] ?? { carpeta: c.nombre, subidos: 0, total: 0, bytes: 0, bytesTotal: 0 }), error: String(err) } }))
      }
    }
    if (extraer && ids.length) encolarExtraccion(ids)
    setSubiendo(false)
  }

  const terminado = carpetas.length > 0 && carpetas.every((c) => avances[c.nombre]?.listo || avances[c.nombre]?.error)
  const totalMb = carpetas.reduce((s, c) => s + c.archivos.reduce((x, a) => x + a.file.size, 0), 0)

  return (
    <div className="modal-fondo" onClick={() => !subiendo && onCerrar()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Nuevo lote">
        <h2>Nuevo lote de carpetas</h2>
        <p className="sub">Cada carpeta de producto se convierte en un trámite. Se ignoran las subcarpetas «NO USAR», «_invimagil» y los Excel maestros anteriores.</p>

        <label className="campo">
          <span>Cliente (titular)</span>
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} disabled={subiendo}>
            <option value="">— Sin cliente / usar criterios de SPI —</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>

        <div
          className={`zona-soltar ${sobre ? 'sobre' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setSobre(true)
          }}
          onDragLeave={() => setSobre(false)}
          onDrop={soltar}
        >
          <p>
            <strong>Arrastre aquí una o varias carpetas de producto</strong>
          </p>
          <p className="sub">o</p>
          <button type="button" onClick={() => input.current?.click()} disabled={subiendo}>
            Elegir una carpeta…
          </button>
          <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && agregar(desdeInput(e.target.files))} />
        </div>

        {carpetas.length ? (
          <table className="tabla compacta">
            <thead>
              <tr>
                <th>Carpeta</th>
                <th className="num">Archivos</th>
                <th className="num">MB</th>
                <th>Avance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {carpetas.map((c) => {
                const a = avances[c.nombre]
                return (
                  <tr key={c.nombre}>
                    <td>
                      {c.nombre}
                      {c.ignorados.length ? <div className="sub">{c.ignorados.length} ignorados</div> : null}
                    </td>
                    <td className="num">{c.archivos.length}</td>
                    <td className="num">{mb(c.archivos.reduce((s, x) => s + x.file.size, 0))}</td>
                    <td>
                      {a?.error ? (
                        <span className="alerta">Error: {a.error.slice(0, 80)}</span>
                      ) : a?.listo ? (
                        <span className="ok">Subida ✓</span>
                      ) : a ? (
                        <progress max={a.bytesTotal || 1} value={a.bytes} />
                      ) : (
                        <span className="sub">pendiente</span>
                      )}
                    </td>
                    <td>
                      {!subiendo && !a ? (
                        <button className="link" onClick={() => setCarpetas((p) => p.filter((x) => x.nombre !== c.nombre))}>
                          quitar
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : null}

        <label className="check">
          <input type="checkbox" checked={extraer} onChange={(e) => setExtraer(e.target.checked)} disabled={subiendo} />
          Extraer con Gemini al terminar de subir (de a 2 a la vez)
        </label>
        {error ? <div className="aviso-error">{error}</div> : null}

        <footer className="pie-modal">
          <span className="sub">
            {carpetas.length} carpeta(s) · {mb(totalMb)} MB
          </span>
          {terminado ? (
            <button className="primario" onClick={onCerrar}>
              Listo
            </button>
          ) : (
            <>
              <button onClick={onCerrar} disabled={subiendo}>
                Cancelar
              </button>
              <button className="primario" onClick={iniciar} disabled={subiendo || !carpetas.length}>
                {subiendo ? 'Subiendo…' : `Crear ${carpetas.length} trámite(s)`}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
