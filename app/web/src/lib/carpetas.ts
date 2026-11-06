// Reads dropped or picked folders and groups the files by top-level folder: one folder = one trámite.
// Filters mirror extractor/invimagil_base/documentos.py so the cloud reads exactly what the CLI read.

const IGNORED_DIRS = new Set(['_invimagil', '_referencia', '.git', '__MACOSX'])
const IGNORED_DIR_PREFIXES = ['no usar', 'no_usar', 'nousar', 'descart', 'obsolet', 'antig', 'old', 'borrador']
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
const IGNORED_PREFIXES = ['MAESTRO NSO', 'log-nso', 'planilla', 'informe-nso', 'RESUMEN-']

export interface ArchivoLocal {
  rel: string // path inside the product folder
  file: File
}

export interface CarpetaLocal {
  nombre: string
  archivos: ArchivoLocal[]
  ignorados: string[]
}

export function ignorar(rel: string): boolean {
  const partes = rel.split('/')
  const nombre = partes[partes.length - 1]
  for (const d of partes.slice(0, -1)) {
    const low = d.trim().toLowerCase()
    if (IGNORED_DIRS.has(d) || d.startsWith('.') || IGNORED_DIR_PREFIXES.some((p) => low.startsWith(p))) return true
  }
  return (
    IGNORED_FILES.has(nombre) ||
    nombre.startsWith('~$') ||
    nombre.startsWith('.') ||
    IGNORED_PREFIXES.some((p) => nombre.startsWith(p))
  )
}

function agrupar(entradas: { ruta: string; file: File }[]): CarpetaLocal[] {
  const porCarpeta = new Map<string, CarpetaLocal>()
  for (const { ruta, file } of entradas) {
    const [top, ...resto] = ruta.split('/')
    if (!resto.length) continue // loose files at the drop root are not a product folder
    const rel = resto.join('/')
    const c = porCarpeta.get(top) ?? { nombre: top, archivos: [], ignorados: [] }
    if (ignorar(rel)) c.ignorados.push(rel)
    else c.archivos.push({ rel, file })
    porCarpeta.set(top, c)
  }
  return [...porCarpeta.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

// <input type="file" webkitdirectory>: one folder per pick, paths in webkitRelativePath.
export function desdeInput(files: FileList): CarpetaLocal[] {
  return agrupar([...files].map((f) => ({ ruta: f.webkitRelativePath || f.name, file: f })))
}

// Drag and drop: several folders at once through the File and Directory Entries API.
export async function desdeArrastre(items: DataTransferItemList): Promise<CarpetaLocal[]> {
  const raices = [...items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e)
  const salida: { ruta: string; file: File }[] = []
  const leerTodo = (dir: FileSystemDirectoryEntry) =>
    new Promise<FileSystemEntry[]>((resolve, reject) => {
      const lector = dir.createReader()
      const todas: FileSystemEntry[] = []
      const lote = () =>
        lector.readEntries((es) => {
          if (!es.length) return resolve(todas)
          todas.push(...es)
          lote() // readEntries returns at most ~100 entries per call
        }, reject)
      lote()
    })
  const visitar = async (e: FileSystemEntry, ruta: string): Promise<void> => {
    if (e.isFile) {
      const file = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej))
      salida.push({ ruta, file })
    } else if (e.isDirectory) {
      for (const hijo of await leerTodo(e as FileSystemDirectoryEntry)) await visitar(hijo, `${ruta}/${hijo.name}`)
    }
  }
  for (const r of raices) await visitar(r, r.name)
  return agrupar(salida)
}

export const mb = (bytes: number) => Math.round((bytes / 1e6) * 100) / 100
