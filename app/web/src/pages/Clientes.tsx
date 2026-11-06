import { useEffect, useState } from 'react'
import { addDoc, collection, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Cliente } from '../lib/tipos'

const VACIO: Omit<Cliente, 'id'> = { nombre: '', titular_nso: '', representante_legal: '', responsable_tecnico: '' }

export default function Clientes() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [editando, setEditando] = useState<(Omit<Cliente, 'id'> & { id?: string }) | null>(null)
  const [error, setError] = useState('')
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'clientes'), orderBy('nombre')),
        (s) => setClientes(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Cliente, 'id'>) }))),
        (e) => setError(e.message),
      ),
    [],
  )
  const guardar = async () => {
    if (!editando?.nombre.trim()) return
    const { id, ...datos } = editando
    try {
      if (id) await updateDoc(doc(db, 'clientes', id), datos)
      else await addDoc(collection(db, 'clientes'), datos)
      setEditando(null)
    } catch (e: any) {
      setError(e.message)
    }
  }
  return (
    <div className="pagina">
      <header className="cabecera-pagina">
        <div>
          <h1>Clientes</h1>
          <p className="sub">Los datos del cliente reemplazan los criterios fijos de SPI al extraer sus productos.</p>
        </div>
        <button className="primario" onClick={() => setEditando({ ...VACIO })}>
          + Cliente
        </button>
      </header>
      {error ? <div className="aviso-error">{error}</div> : null}
      {editando ? (
        <section className="tarjeta">
          <h3>{editando.id ? 'Editar cliente' : 'Nuevo cliente'}</h3>
          <div className="grid-campos">
            {(
              [
                ['nombre', 'Nombre del cliente'],
                ['titular_nso', 'Titular de la NSO'],
                ['representante_legal', 'Representante legal / apoderado'],
                ['responsable_tecnico', 'Responsable técnico (químico farmacéutico)'],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="campo">
                <span>{l}</span>
                <input value={editando[k] ?? ''} onChange={(e) => setEditando({ ...editando, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          <div className="acciones">
            <button onClick={() => setEditando(null)}>Cancelar</button>
            <button className="primario" onClick={guardar} disabled={!editando.nombre.trim()}>
              Guardar
            </button>
          </div>
        </section>
      ) : null}
      <table className="tabla">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Titular NSO</th>
            <th>Representante legal</th>
            <th>Responsable técnico</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => (
            <tr key={c.id}>
              <td>{c.nombre}</td>
              <td>{c.titular_nso}</td>
              <td>{c.representante_legal}</td>
              <td>{c.responsable_tecnico}</td>
              <td>
                <button className="link" onClick={() => setEditando({ ...c })}>
                  editar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
