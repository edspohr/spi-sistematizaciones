// Seeds the local emulators (demo project) with test accounts and users.
// Test-only credentials for the emulator; they do not exist anywhere else.
//   node app/scripts/seed-emulador.mjs
const PROJECT = 'demo-spi-invimagil'
const AUTH = 'http://127.0.0.1:9099'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }

const CUENTAS = [
  { email: 'admin@spi.test', password: 'prueba-admin-123', nombre: 'Admin de prueba', rol: 'admin' },
  { email: 'laura@spi.test', password: 'prueba-laura-123', nombre: 'Laura (prueba)', rol: 'analista' },
]

const valor = (v) =>
  typeof v === 'boolean' ? { booleanValue: v } : v === null ? { nullValue: null } : { stringValue: String(v) }
const campos = (o) => ({ fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, valor(v)])) })

async function pedir(url, opts) {
  const r = await fetch(url, opts)
  if (!r.ok && r.status !== 400) throw new Error(`${r.status} ${url}: ${await r.text()}`)
  return r
}

for (const c of CUENTAS) {
  const r = await pedir(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ email: c.email, password: c.password, displayName: c.nombre, emailVerified: true }),
  })
  console.log(r.ok ? `cuenta ${c.email}` : `cuenta ${c.email} ya existía`)
  await pedir(`${FS}/usuarios/${encodeURIComponent(c.email)}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify(campos({ nombre: c.nombre, rol: c.rol, activo: true })),
  })
}
console.log('usuarios de prueba listos')
