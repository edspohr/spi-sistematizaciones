import { useEffect, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db, USA_EMULADORES } from './lib/firebase'
import { iniciarPuente } from './lib/extension'
import type { Usuario } from './lib/tipos'
import Tablero from './pages/Tablero'
import TramiteVista from './pages/TramiteVista'
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

// Firebase Auth error codes shown to the analyst in Spanish.
const ERRORES: Record<string, string> = {
  'auth/invalid-credential': 'Correo o clave incorrectos.',
  'auth/wrong-password': 'Correo o clave incorrectos.',
  'auth/user-not-found': 'Correo o clave incorrectos.',
  'auth/invalid-email': 'El correo no es válido.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Use «Entrar» o «¿Olvidó su clave?».',
  'auth/weak-password': 'La clave debe tener al menos 8 caracteres.',
  'auth/too-many-requests': 'Demasiados intentos. Espere unos minutos.',
  'auth/popup-closed-by-user': 'Se cerró la ventana de Google antes de terminar.',
  'auth/account-exists-with-different-credential': 'Ese correo ya entra con otro método. Use el método con el que se registró.',
  'auth/network-request-failed': 'Sin conexión. Revise Internet.',
}
const mensaje = (e: any) => ERRORES[e?.code] ?? e?.message ?? String(e)

function Entrar() {
  const [modo, setModo] = useState<'entrar' | 'crear' | 'olvido'>('entrar')
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [clave2, setClave2] = useState('')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const correr = async (f: () => Promise<unknown>) => {
    setError('')
    setAviso('')
    setOcupado(true)
    try {
      await f()
    } catch (e) {
      setError(mensaje(e))
    } finally {
      setOcupado(false)
    }
  }
  const correo = email.trim().toLowerCase()

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    if (modo === 'entrar') return correr(() => signInWithEmailAndPassword(auth, correo, clave))
    if (modo === 'olvido')
      return correr(async () => {
        await sendPasswordResetEmail(auth, correo)
        setAviso(`Si ${correo} tiene cuenta, le llegará un correo para crear una clave nueva.`)
      })
    if (clave.length < 8) return setError('La clave debe tener al menos 8 caracteres.')
    if (clave !== clave2) return setError('Las claves no coinciden.')
    return correr(async () => {
      const c = await createUserWithEmailAndPassword(auth, correo, clave)
      await sendEmailVerification(c.user)
    })
  }

  return (
    <div className="entrar">
      <div className="tarjeta entrar-tarjeta">
        <h1>SPI Sistematización</h1>
        <p className="sub">Sistematización de NSO de cosméticos en InvimÁgil.</p>
        <button
          className="primario grande"
          disabled={ocupado}
          onClick={() => correr(() => signInWithPopup(auth, new GoogleAuthProvider()))}
        >
          Entrar con Google
        </button>
        <div className="separador-o">
          <span>o con correo y clave</span>
        </div>
        <form className="form-entrar" onSubmit={enviar}>
          <input type="email" autoComplete="email" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {modo !== 'olvido' ? (
            <input
              type="password"
              autoComplete={modo === 'crear' ? 'new-password' : 'current-password'}
              placeholder={modo === 'crear' ? 'Clave nueva (mínimo 8 caracteres)' : 'Clave'}
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              required
            />
          ) : null}
          {modo === 'crear' ? (
            <input type="password" autoComplete="new-password" placeholder="Repita la clave" value={clave2} onChange={(e) => setClave2(e.target.value)} required />
          ) : null}
          <button type="submit" disabled={ocupado}>
            {modo === 'entrar' ? 'Entrar' : modo === 'crear' ? 'Crear cuenta' : 'Enviar correo para nueva clave'}
          </button>
        </form>
        <div className="enlaces-entrar">
          {modo !== 'entrar' ? (
            <button className="link" onClick={() => setModo('entrar')}>
              Ya tengo cuenta
            </button>
          ) : (
            <>
              <button className="link" onClick={() => setModo('crear')}>
                Crear cuenta
              </button>
              <button className="link" onClick={() => setModo('olvido')}>
                ¿Olvidó su clave?
              </button>
            </>
          )}
        </div>
        {modo === 'crear' ? (
          <p className="sub">Use el correo que un administrador habilitó en la herramienta. Le llegará un correo para verificarlo.</p>
        ) : null}
        {USA_EMULADORES ? <p className="sub">Emulador local: cuentas de prueba en app/scripts/seed-emulador.mjs</p> : null}
        {aviso ? <div className="aviso-info">{aviso}</div> : null}
        {error ? <div className="aviso-error">{error}</div> : null}
      </div>
    </div>
  )
}

// Password accounts must confirm their email: the security rules and the functions require email_verified.
function VerificarCorreo({ user }: { user: User }) {
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  return (
    <div className="entrar">
      <div className="tarjeta entrar-tarjeta">
        <h1>Verifique su correo</h1>
        <p>
          Enviamos un enlace a <strong>{user.email}</strong>. Ábralo y luego pulse «Ya lo verifiqué». Revise también la carpeta de spam.
        </p>
        <div className="acciones centrado">
          <button
            className="primario"
            onClick={async () => {
              setError('')
              await user.reload()
              if (auth.currentUser?.emailVerified) {
                await auth.currentUser.getIdToken(true) // the new token carries email_verified=true for the rules
                location.reload()
              } else setError('Todavía no aparece verificado.')
            }}
          >
            Ya lo verifiqué
          </button>
          <button
            onClick={() =>
              sendEmailVerification(user)
                .then(() => setAviso('Correo reenviado.'))
                .catch((e) => setError(mensaje(e)))
            }
          >
            Reenviar correo
          </button>
          <button className="link" onClick={() => signOut(auth)}>
            Salir
          </button>
        </div>
        {aviso ? <div className="aviso-info">{aviso}</div> : null}
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
    if (perfil?.activo) iniciarPuente() // results from the extension are written with this session
  }, [perfil?.activo])
  useEffect(() => {
    if (!user?.email || !user.emailVerified) return setPerfil(user === null ? null : undefined)
    return onSnapshot(
      doc(db, 'usuarios', user.email.toLowerCase()),
      (s) => setPerfil(s.exists() ? ({ email: s.id, ...(s.data() as Omit<Usuario, 'email'>) } as Usuario) : null),
      () => setPerfil(null),
    )
  }, [user])

  if (user === undefined) return <div className="pagina">Cargando…</div>
  if (!user) return <Entrar />
  if (!user.emailVerified) return <VerificarCorreo user={user} />
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
      ) : ruta === '#/usuarios' ? (
        <Usuarios soyAdmin={perfil.rol === 'admin'} />
      ) : (
        <Tablero />
      )}
    </>
  )
}
