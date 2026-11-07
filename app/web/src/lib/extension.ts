// Talks to the InvimÁgil Inyector extension through its bridge content script (extension/content/puente.js).
import { useEffect, useState } from 'react'
import { doc, serverTimestamp, setDoc, addDoc, collection } from 'firebase/firestore'
import { auth, db } from './firebase'
import { documentosParaExtension, planillaParaExtension } from './acciones'
import type { Planilla, Tramite } from './tipos'

type MsgExt =
  | { tag: 'spi-ext'; kind: 'presente'; version: string }
  | { tag: 'spi-ext'; kind: 'recibido'; tramiteId: string; ok: boolean }
  | { tag: 'spi-ext'; kind: 'salida'; items: SalidaItem[] }
  | { tag: 'spi-ext'; kind: 'error'; mensaje: string }

export interface SalidaItem {
  id: string
  tipo: 'verificacion' | 'captura' | 'recorrido'
  fin?: string
  detalle?: string
  pasos?: { paso: string; titulo: string; ok: number; mal: number; pend: number }[]
  errores?: string[]
  fecha: string
  tramiteId: string | null
  paso?: string
  titulo?: string
  requestId?: string
  version?: number
  simulado?: boolean
  ok?: number
  mal?: number
  pend?: number
  problemas?: { campo: string; estado: string; esperado: string; leido: string; detalle: string }[]
  captura?: unknown
}

let version: string | null = null
const oyentes = new Set<(v: string | null) => void>()
const pendientesEnvio = new Map<string, (ok: boolean) => void>()
const yaEscritos = new Set<string>()

const aExtension = (m: Record<string, unknown>) => window.postMessage({ tag: 'spi-app', ...m }, window.location.origin)

async function escribir(items: SalidaItem[]) {
  const listos: string[] = []
  for (const it of items) {
    if (yaEscritos.has(it.id)) {
      listos.push(it.id)
      continue
    }
    try {
      const por = auth.currentUser?.email ?? 'desconocido'
      if (it.tipo === 'verificacion' && it.tramiteId) {
        await setDoc(doc(db, 'tramites', it.tramiteId, 'inyecciones', it.id), { ...it, por, recibido: serverTimestamp() })
        await addDoc(collection(db, 'tramites', it.tramiteId, 'eventos'), {
          tipo: it.simulado ? 'inyeccion_simulada' : 'inyeccion',
          detalle: `${it.titulo ?? it.paso}: ${it.ok} ok · ${it.mal} con problema · ${it.pend} sin dato · solicitud ${it.requestId ?? '?'}`,
          por,
          fecha: serverTimestamp(),
        })
      } else if (it.tipo === 'recorrido' && it.tramiteId) {
        const pasos = (it.pasos ?? []).map((p) => `${p.titulo} ${p.ok}/${p.mal}/${p.pend}`).join(' · ')
        await addDoc(collection(db, 'tramites', it.tramiteId, 'eventos'), {
          tipo: 'recorrido_automatico',
          detalle: `fin: ${it.fin} · solicitud ${it.requestId ?? '?'} · ${pasos}${it.detalle ? ' · ' + it.detalle : ''}`.slice(0, 2000),
          por,
          fecha: serverTimestamp(),
        })
      } else if (it.tipo === 'captura') {
        await setDoc(doc(db, 'capturas', it.id), { ...it, captura: JSON.stringify(it.captura ?? null), por, recibido: serverTimestamp() })
      }
      yaEscritos.add(it.id)
      listos.push(it.id)
    } catch (e) {
      console.error('No se pudo guardar el resultado de la extensión', it.id, e) // stays queued in the extension
    }
  }
  if (listos.length) aExtension({ kind: 'ack', ids: listos })
}

let iniciado = false
export function iniciarPuente() {
  if (iniciado) return
  iniciado = true
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.origin !== window.location.origin) return
    const d = ev.data as MsgExt
    if (!d || d.tag !== 'spi-ext') return
    if (d.kind === 'presente') {
      version = d.version
      oyentes.forEach((f) => f(version))
    } else if (d.kind === 'recibido') {
      pendientesEnvio.get(d.tramiteId)?.(d.ok)
      pendientesEnvio.delete(d.tramiteId)
    } else if (d.kind === 'salida' && auth.currentUser) {
      void escribir(d.items)
    }
  })
  aExtension({ kind: 'hola' })
}

export function useExtension() {
  const [v, setV] = useState<string | null>(version)
  useEffect(() => {
    oyentes.add(setV)
    aExtension({ kind: 'hola' })
    return () => void oyentes.delete(setV)
  }, [])
  return v
}

export async function enviarAExtension(t: Tramite, p: Planilla): Promise<boolean> {
  const documentos = await documentosParaExtension(t)
  return new Promise((resolve, reject) => {
    if (!version) return reject(new Error('La extensión InvimÁgil Inyector no está instalada o activa en este navegador.'))
    const timer = setTimeout(() => {
      pendientesEnvio.delete(t.id)
      reject(new Error('La extensión no respondió. Recargue esta página e intente de nuevo.'))
    }, 5000)
    pendientesEnvio.set(t.id, (ok) => {
      clearTimeout(timer)
      resolve(ok)
    })
    aExtension({
      kind: 'enviar',
      payload: {
        tramiteId: t.id,
        producto: t.producto,
        carpeta: t.carpeta,
        cliente: t.clienteNombre ?? '',
        invimaId: t.invimaId ?? '',
        version: t.version,
        enviadoPor: auth.currentUser?.email ?? '',
        planilla: planillaParaExtension(t, p),
        documentos,
      },
    })
  })
}
