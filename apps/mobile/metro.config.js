const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/**
 * Metro, taught about the monorepo.
 *
 * Metro assumes a project owns everything under its own root. Here the app imports
 * `@badminton/contracts` and `@badminton/analytics`, which live two directories up and
 * are installed as npm workspaces, so three things have to be said explicitly.
 */
const config = getDefaultConfig(projectRoot);

// Without this, editing a shared package does not trigger a reload — the change is picked
// up only on a cold restart, which is a genuinely confusing way to lose half an hour.
config.watchFolders = [workspaceRoot];

// npm hoists most dependencies to the workspace root, so the app's own `node_modules`
// alone is not enough to resolve React Native itself.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Node's walk-up resolution can find a second copy of React through a nested
// `node_modules`, and two Reacts in one bundle fail at runtime with an error that points
// nowhere near the cause. Restricting resolution to the paths above makes that impossible.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
