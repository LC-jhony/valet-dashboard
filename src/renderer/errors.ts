/** Quita el prefijo en inglés que Electron añade a los errores de `ipcRenderer.invoke`. */
export function errorMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return text.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
