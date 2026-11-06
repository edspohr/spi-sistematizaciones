import { useEffect, useState } from 'react'
import { GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db, USA_EMULADORES } from './lib/firebase'
import type { Usuario } from './lib/tipos'
import Tablero from './pages/Tablero'
import TramiteVista from './pages/TramiteVista'
import Clientes from './pages/Clientes'
import Usuarios from './pages/Usuarios'

function useRuta() {
  const [h, setH] = useState(location.hash || '#/')
  useEffect(() => {
    const f = () => setH(location.hash || '#/')
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  return h
}

function Entrar() {
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  return (
    <div className="entrar">
      <div className="tarjeta entrar-tarjeta">
        <h1>SPI Sistematización</h1>
        <p className="sub">Sistematización de NSO de cosméticos en InvimÁgil.</p>
        <button className="primario grande" onClick={() => signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => setError(e.message))}>
          Entrar con Google
        </button>
        {USA_EMULADORES ? (
          <form
            className="emulador"
            onSubmit={(e) => {
              e.preventDefault()
              signInWithEmailAndPassword(auth, email, clave).catch((er) => setError(er.message))
            }}
          >
            <p className="sub">Emulador local: cuentas de prueba de app/scripts/seed-emulador.mjs</p>
            <input placeholder="correo" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input placeholder="clave" type="password" value={clave} onChange={(e) => setClave(e.target.value)} />
            <button type="submit">Entrar (emulador)</button>
          </form>
        ) : null}
        {error ? <div className="aviso-error">{error}</div> : null}
      </div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [perfil, setPerfil] = useState<Usuario | null | undefined>(undefined)
  const ruta = useRuta()

  useEffect(() => onAuthStateChanged(auth, setUser), [])
  useEffect(() => {
    if (!user?.email) return setPerfil(user === null ? null : undefined)
    return onSnapshot(
      doc(db, 'usuarios', user.email),
      (s) => setPerfil(s.exists() ? ({ email: s.id, ...(s.data() as Omit<Usuario, 'email'>) } as Usuario) : null),
      () => setPerfil(null),
    )
  }, [user])

  if (user === undefined) return <div className="pagina">Cargando…</div>
  if (!user) return <Entrar />
  if (perfil === undefined) return <div className="pagina">Verificando acceso…</div>
  if (!perfil || !perfil.activo)
    return (
      <div className="entrar">
        <div className="tarjeta entrar-tarjeta">
          <h1>Sin acceso</h1>
          <p>
            La cuenta <strong>{user.email}</strong> no está habilitada. Pida a un administrador que la agregue en Usuarios.
          </p>
          <button onClick={() => signOut(auth)}>Salir</button>
        </div>
      </div>
    )

  const tramite = ruta.match(/^#\/t\/([^/]+)/)?.[1]
  return (
    <>
      <nav className="barra">
        <a href="#/" className="marca">
          SPI Sistematización
        </a>
        <a href="#/" className={ruta === '#/' ? 'activo' : ''}>
          Trámites
        </a>
        <a href="#/clientes" className={ruta === '#/clientes' ? 'activo' : ''}>
          Clientes
        </a>
        <a href="#/usuarios" className={ruta === '#/usuarios' ? 'activo' : ''}>
          Usuarios
        </a>
        <span className="espacio" />
        {USA_EMULADORES ? <span className="etiqueta-emu">EMULADOR</span> : null}
        <span className="sub">{perfil.nombre || user.email}</span>
        <button className="link" onClick={() => signOut(auth)}>
          Salir
        </button>
      </nav>
      {tramite ? (
        <TramiteVista id={tramite} />
      ) : ruta === '#/clientes' ? (
        <Clientes />
      ) : ruta === '#/usuarios' ? (
        <Usuarios soyAdmin={perfil.rol === 'admin'} />
      ) : (
        <Tablero />
      )}
    </>
  )
}
