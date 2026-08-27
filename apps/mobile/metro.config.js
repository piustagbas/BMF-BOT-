const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = false;
// pnpm stores packages via symlinks — required for Metro to follow them
config.resolver.unstable_enableSymlinks = true;

const forceResolve = (name) => {
  try {
    return path.dirname(
      require.resolve(`${name}/package.json`, { paths: [projectRoot, workspaceRoot] }),
    );
  } catch {
    return undefined;
  }
};

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  'expo-linking': forceResolve('expo-linking'),
  'expo-web-browser': forceResolve('expo-web-browser'),
  'expo-apple-authentication': forceResolve('expo-apple-authentication'),
  'expo-clipboard': forceResolve('expo-clipboard'),
  'expo-status-bar': forceResolve('expo-status-bar'),
  '@react-native-async-storage/async-storage': forceResolve(
    '@react-native-async-storage/async-storage',
  ),
};

// Drop undefined entries
Object.keys(config.resolver.extraNodeModules).forEach((key) => {
  if (!config.resolver.extraNodeModules[key]) {
    delete config.resolver.extraNodeModules[key];
  }
});

module.exports = config;
