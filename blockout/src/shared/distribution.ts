declare const __BLOCKOUT_APP_ID__: string
declare const __BLOCKOUT_WINDOWS_CONFIG_NAMESPACE__: string
declare const __BLOCKOUT_MAINTAINER_CREDIT__: string

/** Build-time downstream hooks. Defaults are the upstream-generic identity. */
export const DISTRIBUTION = Object.freeze({
  appId: typeof __BLOCKOUT_APP_ID__ === 'string'
    ? __BLOCKOUT_APP_ID__
    : 'com.wassermanproductions.blockout',
  windowsConfigNamespace: typeof __BLOCKOUT_WINDOWS_CONFIG_NAMESPACE__ === 'string'
    ? __BLOCKOUT_WINDOWS_CONFIG_NAMESPACE__
    : 'blockout',
  maintainerCredit: typeof __BLOCKOUT_MAINTAINER_CREDIT__ === 'string'
    ? __BLOCKOUT_MAINTAINER_CREDIT__
    : ''
})
