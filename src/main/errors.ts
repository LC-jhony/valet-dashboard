// Traduce la salida cruda de un comando a un mensaje que se pueda leer y actuar.
// Es puro: recibe la firma del fallo y devuelve título, detalle y comandos.
import type { Pm } from './prereqs'

export interface ClassifiedError {
  title: string
  detail: string
  hint: string
  commands: string[]
}

export interface ErrorInput {
  cmd: string
  args?: string[]
  code?: number | null
  stderr?: string
  killed?: boolean
  message?: string
  pm?: Pm | null
}

const tail = (text: string, lines = 3): string => {
  const parts = text.trim().split('\n').filter(Boolean)
  return parts.slice(-lines).join('\n')
}

const updateCommand = (pm: Pm | null): string[] => {
  if (pm === 'apt') return ['sudo apt-get update']
  if (pm === 'dnf') return ['sudo dnf makecache --refresh']
  if (pm === 'pacman') return ['sudo pacman -Sy']
  return []
}

const installCommand = (pm: Pm | null, pkg: string): string[] => {
  if (pm === 'apt') return [`sudo apt-get install -y ${pkg}`]
  if (pm === 'dnf') return [`sudo dnf install -y ${pkg}`]
  if (pm === 'pacman') return [`sudo pacman -S --needed ${pkg}`]
  return []
}

/** Convierte el fallo de un comando en un diagnóstico con salida. */
export function classify(input: ErrorInput): ClassifiedError {
  const stderr = input.stderr ?? ''
  const out = `${stderr}\n${input.message ?? ''}`
  const command = [input.cmd, ...(input.args ?? [])].join(' ')
  const generic: ClassifiedError = {
    title: `Falló ${input.cmd}`,
    detail: tail(stderr) || input.message || `El comando terminó con código ${input.code ?? 'desconocido'}.`,
    hint: 'Revisa el registro de la instalación para ver la salida completa.',
    commands: []
  }

  if (input.killed) {
    return {
      title: 'El comando no terminó a tiempo',
      detail: `${command} superó el tiempo máximo y se detuvo.`,
      hint: 'Comprueba la conexión y vuelve a intentarlo. Si el gestor de paquetes sigue trabajando en segundo plano, espera a que termine antes de reintentar.',
      commands: input.pm === 'apt' ? ['ps aux | grep -E "apt|dpkg"'] : []
    }
  }

  if (/Could not get lock|dpkg frontend lock|Unable to acquire.*lock/i.test(out)) {
    return {
      title: 'Otro gestor de paquetes está en uso',
      detail: 'Hay otro proceso de apt, dpkg, dnf o pacman trabajando en este momento.',
      hint: 'Espera a que termine o cierra la otra herramienta. No borres el archivo de bloqueo a ciegas.',
      commands: input.pm === 'apt'
        ? ['ps aux | grep -E "apt|dpkg"', 'sudo systemctl status unattended-upgrades']
        : ['ps aux | grep -E "dnf|rpm|pacman"']
    }
  }

  if (/No space left on device|No hay espacio/i.test(out)) {
    return {
      title: 'Disco lleno',
      detail: 'No queda espacio para descargar o escribir los paquetes.',
      hint: 'Libera espacio y vuelve a pulsar Reparar instalación.',
      commands: ['df -h /', 'du -sh ~/.cache/* 2>/dev/null | sort -h | tail -10']
    }
  }

  if (/Temporary failure resolving|Could not resolve|Name or service not known|Network is unreachable/i.test(out)) {
    return {
      title: 'Sin red o DNS roto',
      detail: 'El gestor de paquetes no puede resolver el repositorio.',
      hint: 'Revisa la conexión antes de reintentar. El modo Hosts del panel no arregla la salida a Internet.',
      commands: ['ping -c 1 1.1.1.1', ...updateCommand(input.pm ?? null)]
    }
  }

  const locate = out.match(/Unable to locate package (\S+)/i)
  if (locate) {
    return {
      title: `El paquete ${locate[1]} no está disponible`,
      detail: 'Los índices están desactualizados o el paquete no existe en los repositorios configurados.',
      hint: 'Actualiza los índices y comprueba el nombre del paquete para tu distribución.',
      commands: [...updateCommand(input.pm ?? null), ...installCommand(input.pm ?? null, locate[1])]
    }
  }

  if (/Transaction check error|conflicting requests|file .* conflicts between attempted installs/i.test(out)) {
    return {
      title: 'Conflicto entre paquetes',
      detail: tail(stderr),
      hint: 'Resuelve el conflicto con el gestor de paquetes y vuelve a intentarlo.',
      commands: input.pm === 'dnf' ? ['sudo dnf check', 'sudo dnf repoquery --duplicates'] : []
    }
  }

  if (/target not found/i.test(out)) {
    return {
      title: 'Paquete no disponible en pacman',
      detail: tail(stderr),
      hint: 'Actualiza los índices o instala el nombre equivalente para Arch.',
      commands: ['sudo pacman -Sy']
    }
  }

  // Antes que 126/127: `sh` devuelve 127 también cuando el binario no existe.
  if (/No such file or directory|command not found/i.test(out)) {
    return {
      title: `No se encontró ${input.cmd}`,
      detail: tail(stderr),
      hint: 'Falta un binario que el instalador esperaba. Revisa la guía de requisitos.',
      commands: []
    }
  }

  if (input.code === 126 || input.code === 127) {
    return {
      title: 'Autenticación cancelada',
      detail: 'El diálogo de administrador se cerró sin escribir la contraseña.',
      hint: 'Vuelve a intentarlo y autentica cuando aparezca la ventana del sistema.',
      commands: []
    }
  }

  return generic
}
