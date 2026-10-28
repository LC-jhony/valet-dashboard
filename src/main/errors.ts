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
    title: `${input.cmd} failed`,
    detail: tail(stderr) || input.message || `The command exited with code ${input.code ?? 'unknown'}.`,
    hint: 'Check the installation log to see the full output.',
    commands: []
  }

  if (input.killed) {
    return {
      title: 'The command did not finish in time',
      detail: `${command} exceeded the time limit and was stopped.`,
      hint: 'Check the connection and try again. If the package manager is still working in the background, wait for it to finish before retrying.',
      commands: input.pm === 'apt' ? ['ps aux | grep -E "apt|dpkg"'] : []
    }
  }

  if (/Could not get lock|dpkg frontend lock|Unable to acquire.*lock/i.test(out)) {
    return {
      title: 'Another package manager is in use',
      detail: 'Another apt, dpkg, dnf or pacman process is working right now.',
      hint: 'Wait for it to finish or close the other tool. Do not delete the lock file blindly.',
      commands: input.pm === 'apt'
        ? ['ps aux | grep -E "apt|dpkg"', 'sudo systemctl status unattended-upgrades']
        : ['ps aux | grep -E "dnf|rpm|pacman"']
    }
  }

  if (/No space left on device|No hay espacio/i.test(out)) {
    return {
      title: 'Disk full',
      detail: 'There is no space left to download or write the packages.',
      hint: 'Free up space and press Repair installation again.',
      commands: ['df -h /', 'du -sh ~/.cache/* 2>/dev/null | sort -h | tail -10']
    }
  }

  if (/Temporary failure resolving|Could not resolve|Name or service not known|Network is unreachable/i.test(out)) {
    return {
      title: 'No network or broken DNS',
      detail: 'The package manager cannot resolve the repository.',
      hint: 'Check the connection before retrying. The panel\'s Hosts mode does not fix internet access.',
      commands: ['ping -c 1 1.1.1.1', ...updateCommand(input.pm ?? null)]
    }
  }

  const locate = out.match(/Unable to locate package (\S+)/i)
  if (locate) {
    return {
      title: `Package ${locate[1]} is not available`,
      detail: 'The indexes are out of date or the package does not exist in the configured repositories.',
      hint: 'Update the indexes and check the package name for your distribution.',
      commands: [...updateCommand(input.pm ?? null), ...installCommand(input.pm ?? null, locate[1])]
    }
  }

  if (/Transaction check error|conflicting requests|file .* conflicts between attempted installs/i.test(out)) {
    return {
      title: 'Package conflict',
      detail: tail(stderr),
      hint: 'Resolve the conflict with the package manager and try again.',
      commands: input.pm === 'dnf' ? ['sudo dnf check', 'sudo dnf repoquery --duplicates'] : []
    }
  }

  if (/target not found/i.test(out)) {
    return {
      title: 'Package not available in pacman',
      detail: tail(stderr),
      hint: 'Update the indexes or install the equivalent name for Arch.',
      commands: ['sudo pacman -Sy']
    }
  }

  // Antes que 126/127: `sh` devuelve 127 también cuando el binario no existe.
  if (/No such file or directory|command not found/i.test(out)) {
    return {
      title: `${input.cmd} was not found`,
      detail: tail(stderr),
      hint: 'A binary the installer expected is missing. Check the prerequisites guide.',
      commands: []
    }
  }

  if (input.code === 126 || input.code === 127) {
    return {
      title: 'Authentication cancelled',
      detail: 'The administrator dialog was closed without typing the password.',
      hint: 'Try again and authenticate when the system window appears.',
      commands: []
    }
  }

  return generic
}
