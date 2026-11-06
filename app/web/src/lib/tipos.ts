import type { Timestamp } from 'firebase/firestore'

export type Estado =
  | 'cargando'
  | 'cargado'
  | 'extrayendo'
  | 'en_revision'
  | 'aprobado'
  | 'inyectado'
  | 'enviado'
  | 'cumple'
  | 'no_cumple'
  | 'error'
  | 'archivado'

export const ESTADOS: { id: Estado; nombre: string; ayuda: string }[] = [
  { id: 'cargando', nombre: 'Cargando', ayuda: 'Subiendo los archivos de la carpeta' },
  { id: 'cargado', nombre: 'Cargado', ayuda: 'Archivos listos; falta extraer' },
  { id: 'extrayendo', nombre: 'Extrayendo', ayuda: 'Gemini está leyendo el dossier' },
  { id: 'en_revision', nombre: 'En revisión', ayuda: 'La analista revisa la planilla y resuelve decisiones' },
  { id: 'aprobado', nombre: 'Aprobado', ayuda: 'Planilla lista para llenar InvimÁgil' },
  { id: 'inyectado', nombre: 'Inyectado', ayuda: 'Formulario llenado en InvimÁgil, falta enviar' },
  { id: 'enviado', nombre: 'Enviado a INVIMA', ayuda: 'En cotejo por un funcionario de INVIMA' },
  { id: 'cumple', nombre: 'Cumple', ayuda: 'Finalización exitosa' },
  { id: 'no_cumple', nombre: 'No cumple', ayuda: 'Finalización no exitosa; hay que repetir' },
  { id: 'error', nombre: 'Error', ayuda: 'La extracción falló; ver detalle' },
  { id: 'archivado', nombre: 'Archivado', ayuda: 'Fuera del flujo' },
]

export const nombreEstado = (e: Estado) => ESTADOS.find((x) => x.id === e)?.nombre ?? e

export interface Usuario {
  email: string
  nombre?: string
  rol: 'admin' | 'analista'
  activo: boolean
}

export interface Cliente {
  id: string
  nombre: string
  titular_nso?: string
  representante_legal?: string
  responsable_tecnico?: string
}

export interface Resumen {
  producto: string
  ingredientes: number
  presentaciones: number
  decisiones: number
  avisos: string[]
}

export interface Tramite {
  id: string
  carpeta: string
  producto: string
  productoConfirmado?: boolean
  clienteId?: string
  clienteNombre?: string
  lote?: string
  estado: Estado
  creadoPor: string
  responsable?: string
  creado?: Timestamp
  actualizado?: Timestamp
  archivos?: { rel: string; mb: number }[]
  resumen?: Resumen
  uso?: Record<string, unknown>
  error?: string | null
  progreso?: string | null
  progresoDesde?: Timestamp
  version?: number
  nso?: { numero?: string; emision?: string; vencimiento?: string }
  invimaId?: string
  aprobacion?: { por: string; fecha: Timestamp; version: number } | null
  resultado?: { valor: 'cumple' | 'no_cumple'; observaciones: string; fecha: string; por: string } | null
  notas?: string
}

export interface Decision {
  id: string
  tema?: string
  donde?: string
  hallazgo?: string
  propuesta?: string
}

// The planilla is the extractor's JSON (see extractor/invimagil_base/esquema.py); kept loose on purpose.
export type Planilla = Record<string, any> & {
  _meta?: Record<string, any>
  decisiones?: Decision[]
  _decisiones_resueltas?: (Decision & { respuesta: string; fecha: string; por?: string })[]
}

export interface Evento {
  id: string
  tipo: string
  detalle?: string
  por: string
  fecha?: Timestamp
}
