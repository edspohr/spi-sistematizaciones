import { useEffect, useState } from 'react'
import { collection, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Usuario } from '../lib/tipos'

export default function Usuarios({ soyAdmin }: { soyAdmin: boolean }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [nuevo, setNuevo] = useState({ email: '', nombre: '', rol: 'analista' as Usuario['rol'] })
  const [error, setError] = useState('')
  useEffect(
    () =>
      onSnapshot(
        collection(db, 'usuarios'),
        (s) => setUsuarios(s.docs.map((d) => ({ email: d.id, ...(d.data() as Omit<Usuario, 'email'>) })).sort((a, b) => a.email.localeCompare(b.email))),
        (e) => setError(e.message),
      ),
    [],
  )
  const intentar = (f: () => Promise<unknown>) => f().catch((e) => setError(e.message))
  return (
    <div className="pagina">
      <header className="cabecera-pagina">
        <div>
          <h1>Usuarios</h1>
          <p className="sub">Solo entran los correos listados aquí y activos, con Google o con correo y clave verificados. Los administradores gestionan los usuarios.</p>
        </div>
      </header>
      {error ? <div className="aviso-error">{error}</div> : null}
      {soyAdmin ? (
        <section className="tarjeta">
          <h3>Dar acceso</h3>
          <div className="grid-campos">
            <label className="campo">
              <span>Correo</span>
              <input type="email" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value.trim().toLowerCase() })} />
            </label>
            <label className="campo">
              <span>Nombre</span>
              <input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
            </label>
            <label className="campo">
              <span>Rol</span>
              <select value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value as Usuario['rol'] })}>
                <option value="analista">Analista</option>
                <option value="admin">Administrador</option>
              </select>
            </label>
          </div>
          <button
            className="primario"
            disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nuevo.email)}
            onClick={() =>
              intentar(async () => {
                await setDoc(doc(db, 'usuarios', nuevo.email), { nombre: nuevo.nombre, rol: nuevo.rol, activo: true })
                setNuevo({ email: '', nombre: '', rol: 'analista' })
              })
            }
          >
            Agregar
          </button>
        </section>
      ) : null}
      <table className="tabla">
        <thead>
          <tr>
            <th>Correo</th>
            <th>Nombre</th>
            <th>Rol</th>
            <th>Activo</th>
          </tr>
        </thead>
        <tbody>
          {usuarios.map((u) => (
            <tr key={u.email}>
              <td>{u.email}</td>
              <td>{u.nombre}</td>
              <td>{u.rol === 'admin' ? 'Administrador' : 'Analista'}</td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Activo ${u.email}`}
                  checked={u.activo}
                  disabled={!soyAdmin}
                  onChange={(e) => intentar(() => updateDoc(doc(db, 'usuarios', u.email), { activo: e.target.checked }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
