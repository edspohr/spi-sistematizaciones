import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentReference,
} from 'firebase/firestore'
import { getDownloadURL, ref as sref, uploadBytesResumable } from 'firebase/storage'
import { auth, db, fn, storage } from './firebase'
import { mb, type CarpetaLocal } from './carpetas'
import type { Estado, Planilla, Tramite } from './tipos'

const yo = () => auth.currentUser?.email ?? 'desconocido'

export async function evento(tramiteId: string, tipo: string, detalle = '') {
  await addDoc(collection(db, 'tramites', tramiteId, 'eventos'), { tipo, detalle, por: yo(), fecha: serverTimestamp() })
}

export async function cambiarEstado(t: Tramite, estado: Estado, extra: Record<string, unknown> = {}, detalle = '') {
  await updateDoc(doc(db, 'tramites', t.id), { estado, ...extra, actualizado: serverTimestamp() })
  await evento(t.id, `estado_${estado}`, detalle)
}

export async function guardarCampos(t: Tramite, campos: Record<string, unknown>, tipo = 'datos_editados') {
  await updateDoc(doc(db, 'tramites', t.id), { ...campos, actualizado: serverTimestamp() })
  await evento(t.id, tipo, Object.keys(campos).join(', '))
}

// One more file into the trámite's dossier (e.g. the NSO's last official document).
export async function agregarAlDossier(t: Tramite, file: File): Promise<string> {
  const rel = file.name
  await uploadBytesResumable(sref(storage, `tramites/${t.id}/dossier/${rel}`), file)
  const archivos = [...(t.archivos ?? []).filter((a) => a.rel !== rel), { rel, mb: mb(file.size) }]
  await updateDoc(doc(db, 'tramites', t.id), { archivos, actualizado: serverTimestamp() })
  await evento(t.id, 'archivo_agregado', rel)
  return rel
}

export async function prepararDocumentos(t: Tramite) {
  await fn.prepararDocumentos({ tramiteId: t.id })
}

// Download links for the prepared PDFs, so the extension can fetch them (token URLs).
export async function documentosParaExtension(t: Tramite) {
  const out = []
  for (const d of t.documentos ?? []) {
    if (!d.ruta) continue
    out.push({ clave: d.clave, titulo: d.titulo, nombre: d.nombre, mb: d.mb, mime: 'application/pdf', url: await getDownloadURL(sref(storage, d.ruta)) })
  }
  return out
}

// ---- Upload ------------------------------------------------------------------------------
export interface Avance {
  carpeta: string
  subidos: number
  total: number
  bytes: number
  bytesTotal: number
  tramiteId?: string
  error?: string
  listo?: boolean
}

export async function crearYSubir(
  carpeta: CarpetaLocal,
  cliente: string,
  lote: string,
  onAvance: (a: Avance) => void,
): Promise<string> {
  const ref: DocumentReference = doc(collection(db, 'tramites'))
  const bytesTotal = carpeta.archivos.reduce((s, a) => s + a.file.size, 0)
  const avance: Avance = { carpeta: carpeta.nombre, subidos: 0, total: carpeta.archivos.length, bytes: 0, bytesTotal, tramiteId: ref.id }
  onAvance({ ...avance })
  await setDoc(ref, {
    carpeta: carpeta.nombre,
    producto: carpeta.nombre,
    clienteNombre: cliente || null,
    lote,
    estado: 'cargando',
    creadoPor: yo(),
    responsable: yo(),
    creado: serverTimestamp(),
    actualizado: serverTimestamp(),
    archivos: [],
  })
  const previos = new Map<string, number>()
  for (const a of carpeta.archivos) {
    const tarea = uploadBytesResumable(sref(storage, `tramites/${ref.id}/dossier/${a.rel}`), a.file, {
      contentType: a.file.type || undefined,
      customMetadata: { rel: a.rel },
    })
    await new Promise<void>((resolve, reject) =>
      tarea.on(
        'state_changed',
        (s) => {
          avance.bytes += s.bytesTransferred - (previos.get(a.rel) ?? 0)
          previos.set(a.rel, s.bytesTransferred)
          onAvance({ ...avance })
        },
        reject,
        () => resolve(),
      ),
    )
    avance.subidos += 1
    onAvance({ ...avance })
  }
  await updateDoc(ref, {
    archivos: carpeta.archivos.map((a) => ({ rel: a.rel, mb: mb(a.file.size) })),
    estado: 'cargado',
    actualizado: serverTimestamp(),
  })
  await evento(ref.id, 'carpeta_cargada', `${carpeta.archivos.length} archivos · ${mb(bytesTotal)} MB · lote ${lote}`)
  onAvance({ ...avance, listo: true })
  return ref.id
}

// ---- Extraction queue (runs while the page is open; state lives in Firestore) --------------
const CONCURRENCIA = 2
const cola: string[] = []
let activos = 0
const oyentes = new Set<() => void>()
export const enCola = () => [...cola]
export const suscribirCola = (f: () => void) => (oyentes.add(f), () => void oyentes.delete(f))

export function encolarExtraccion(ids: string[]) {
  for (const id of ids) if (!cola.includes(id)) cola.push(id)
  oyentes.forEach((f) => f())
  bombear()
}

function bombear() {
  while (activos < CONCURRENCIA && cola.length) {
    const id = cola.shift()!
    activos += 1
    oyentes.forEach((f) => f())
    fn.extraer({ tramiteId: id })
      .catch((e) => console.error('extraer', id, e)) // the function already wrote estado=error and the message
      .finally(() => {
        activos -= 1
        oyentes.forEach((f) => f())
        bombear()
      })
  }
}

// ---- Planilla ------------------------------------------------------------------------------
export async function leerPlanilla(t: Tramite): Promise<Planilla | null> {
  if (!t.version) return null
  const s = await getDoc(doc(db, 'tramites', t.id, 'planillas', `v${t.version}`))
  return s.exists() ? (JSON.parse(s.get('json')) as Planilla) : null
}

// The browser add-on reads _invimagil/planilla.json; this adds the NSO vigente block it maps
// to the Sistematización screen (extension/mapa-formulario.json).
export function planillaParaExtension(t: Tramite, p: Planilla): Planilla {
  return {
    ...p,
    sistematizacion: {
      wantsToSystematize: true,
      hasOngoingProcedures: false,
      nsoNumber: t.nso?.numero ?? '',
      issueDate: t.nso?.emision ?? '',
      expirationDate: t.nso?.vencimiento ?? '',
    },
    _meta: { ...(p._meta ?? {}), tramiteId: t.id, invimaId: t.invimaId ?? '', version: t.version },
  }
}

export function descargar(nombre: string, contenido: Blob) {
  const url = URL.createObjectURL(contenido)
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export async function exportarExcel(t: Tramite) {
  const r = await fn.exportarExcel({ tramiteId: t.id })
  const url = await getDownloadURL(sref(storage, r.data.ruta))
  window.open(url, '_blank')
}
