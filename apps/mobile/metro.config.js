/* global require, module, __dirname */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);

// Workspace packages use TypeScript's .js extension convention in imports
// (e.g. `import './foo.js'` where the actual file is `./foo.ts`).
// Metro resolves specifiers literally, so we strip the .js suffix
// and let Metro find .ts/.tsx files normally.
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Only rewrite relative imports ending in .js to try .ts/.tsx first.
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const stripped = moduleName.slice(0, -3);
    try {
      return (defaultResolve || context.resolveRequest)(context, stripped, platform);
    } catch {
      // Fall through to the original name if stripping didn't help.
    }
  }
  return (defaultResolve || context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
