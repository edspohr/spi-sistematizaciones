import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions'
import { connectStorageEmulator, getStorage } from 'firebase/storage'

// Must match REGION in app/functions/main.py.
export const REGION = 'southamerica-east1'
export const USA_EMULADORES = import.meta.env.VITE_USE_EMULATORS === 'true'

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
})

export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app, REGION)

if (USA_EMULADORES) {
  const host = '127.0.0.1'
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, host, 8080)
  connectStorageEmulator(storage, host, 9199)
  connectFunctionsEmulator(functions, host, 5001)
}

const LARGO = { timeout: 30 * 60 * 1000 }

export const fn = {
  extraer: httpsCallable<{ tramiteId: string }, { version: number }>(functions, 'extraer_tramite', LARGO),
  aplicarDecisiones: httpsCallable<
    { tramiteId: string; respuestas: { id: string; respuesta: string }[] },
    { version: number; sinCerrar: string[]; pendientes: number }
  >(functions, 'aplicar_decisiones', LARGO),
  exportarExcel: httpsCallable<{ tramiteId: string }, { ruta: string; nombre: string }>(functions, 'exportar_excel', { timeout: 5 * 60 * 1000 }),
}
