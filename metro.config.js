const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

// Expo often treats the pnpm workspace root as the Metro project root.
// Point resolution at the mobile app and force-resolve auth packages for pnpm.
const workspaceRoot = __dirname;
const projectRoot = path.resolve(workspaceRoot, 'apps/mobile');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = false;
config.resolver.unstable_enableSymlinks = true;

const forceResolve = (name) => {
  try {
    return path.dirname(
      require.resolve(`${name}/package.json`, {
        paths: [projectRoot, workspaceRoot],
      }),
    );
  } catch {
    return undefined;
  }
};

const extras = {
  'expo-linking': forceResolve('expo-linking'),
  'expo-web-browser': forceResolve('expo-web-browser'),
  'expo-apple-authentication': forceResolve('expo-apple-authentication'),
  'expo-status-bar': forceResolve('expo-status-bar'),
  '@react-native-async-storage/async-storage': forceResolve(
    '@react-native-async-storage/async-storage',
  ),
};

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
};

for (const [key, value] of Object.entries(extras)) {
  if (value) config.resolver.extraNodeModules[key] = value;
}

module.exports = config;
