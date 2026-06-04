const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
config.resolver.unstable_enablePackageExports = true
config.resolver.unstable_enableSymlinks = true

// Force a single copy of react/react-dom across the bundle. The monorepo also
// hosts React 19 (web/admin); without this alias, Metro can pull in two copies
// and React complains at runtime.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName === 'react-dom' || moduleName.startsWith('react/') || moduleName.startsWith('react-dom/')) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(projectRoot, 'index.ts') },
      moduleName,
      platform,
    )
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
