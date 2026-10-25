import { createContext, useContext, type ReactNode } from 'react'
import type { IconThemeId } from './theme'

export const ICON_THEMES = [
  { id: 'dawn', name: 'Dawn' },
  { id: 'deep', name: 'Deep' },
  { id: 'dim', name: 'Dim' },
  { id: 'you', name: 'You' }
] as const

export type IconName =
  | 'folder_home_open' | 'folder_link_open' | 'folder_secure_open' | 'folder_download_open'
  | 'folder_connection_open' | 'folder_server_open' | 'folder_validation_open' | 'folder_error_open'
  | 'folder_warning_open' | 'folder_update_open' | 'folder_console_open' | 'folder_packages_open'
  | 'folder_redis_open' | 'folder_config_open'
  | 'php' | 'laravel' | 'nginx' | 'database' | 'http' | 'settings' | 'file'

/** Solo se empaquetan los iconos que usa la interfaz, en sus variantes clara y oscura. */
const icons = import.meta.glob<string>(
  './file-icons/{dawn,dawn-light,deep,deep-light,dim,dim-light,you,you-light}/{folder_home_open,folder_link_open,folder_secure_open,folder_download_open,folder_connection_open,folder_server_open,folder_validation_open,folder_error_open,folder_warning_open,folder_update_open,folder_console_open,folder_packages_open,folder_redis_open,folder_config_open,php,laravel,nginx,database,http,settings,file}.svg',
  { eager: true, query: '?url', import: 'default' }
)

export function iconUrl(theme: IconThemeId, mode: 'light' | 'dark', name: IconName): string {
  const dir = mode === 'light' ? `${theme}-light` : theme
  return icons[`./file-icons/${dir}/${name}.svg`]
    ?? icons[`./file-icons/${theme}/${name}.svg`]
    ?? icons[`./file-icons/${dir}/file.svg`]
    ?? icons[`./file-icons/${theme}/file.svg`]
    ?? ''
}

const IconCtx = createContext<{ theme: IconThemeId; mode: 'light' | 'dark' }>({ theme: 'dawn', mode: 'dark' })

export function IconProvider({ theme, mode, children }: {
  theme: IconThemeId; mode: 'light' | 'dark'; children: ReactNode
}) {
  return <IconCtx.Provider value={{ theme, mode }}>{children}</IconCtx.Provider>
}

export function Icon({ name, size = 18, className = '', alt }: {
  name: IconName; size?: number; className?: string; alt?: string
}) {
  const { theme, mode } = useContext(IconCtx)
  const src = iconUrl(theme, mode, name)
  if (!src) return null
  return (
    <img className={`icon ${className}`.trim()} src={src} width={size} height={size}
      alt={alt ?? ''} aria-hidden={alt ? undefined : true} draggable={false} title={alt} />
  )
}
