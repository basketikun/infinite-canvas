import { homedir } from 'os'
import { posix, win32 } from 'path'
import { DISTRIBUTION } from './distribution'

export interface ConfigPathOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  homeDir?: string
}

/**
 * Resolve Blockout's machine-local configuration directory.
 *
 * macOS and Linux keep the historical ~/.config/blockout location. The
 * Windows uses APPDATA. BLOCKOUT_CONFIG_DIR is primarily a deterministic
 * test/automation override, but is also useful for portable installations and
 * downstream distributions that need an isolated data root.
 */
export function resolveConfigDir(options: ConfigPathOptions = {}): string {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const home = options.homeDir ?? homedir()

  if (env.BLOCKOUT_CONFIG_DIR?.trim()) return env.BLOCKOUT_CONFIG_DIR.trim()
  if (platform === 'win32') {
    const appData = env.APPDATA?.trim() || win32.join(home, 'AppData', 'Roaming')
    const namespace = env.BLOCKOUT_CONFIG_NAMESPACE?.trim() || DISTRIBUTION.windowsConfigNamespace
    const segments = namespace.split(/[\\/]+/).filter((part) => part && part !== '.' && part !== '..')
    return win32.join(appData, ...(segments.length > 0 ? segments : ['blockout']))
  }
  return posix.join(home, '.config', 'blockout')
}

export function resolveConfigPath(name: string, options: ConfigPathOptions = {}): string {
  const pathJoin = (options.platform ?? process.platform) === 'win32' ? win32.join : posix.join
  return pathJoin(resolveConfigDir(options), name)
}
