import fs from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
const baseRoutes = [
    'features',
    'how-it-works',
    'compare',
    'interfaces',
    'commands',
    'settings',
    'architecture',
    'ecosystem',
    'security',
    'getting-started',
    'workflows',
    'fleet',
    'modes',
    'agent-roster',
    'mailbox',
    'memory',
    'providers',
    'coding-plans',
    'mcp',
    'tools',
    'plugins',
    'troubleshooting',
    'created-by',
];
function sourceSection(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    if (start < 0)
        throw new Error(`Catalog guard could not find: ${startMarker}`);
    const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
    if (endMarker && end < 0)
        throw new Error(`Catalog guard could not find: ${endMarker}`);
    return source.slice(start, end);
}
function captures(source, pattern) {
    return [...source.matchAll(pattern)].map((match) => match[1]).filter(Boolean);
}
function assertSameCatalog(label, websiteValues, runtimeValues) {
    const website = [...new Set(websiteValues)].sort();
    const runtime = [...new Set(runtimeValues)].sort();
    const missing = runtime.filter((value) => !website.includes(value));
    const stale = website.filter((value) => !runtime.includes(value));
    if (missing.length === 0 && stale.length === 0)
        return;
    throw new Error([
        `${label} drifted from the runtime source.`,
        missing.length > 0 ? `Missing in website: ${missing.join(', ')}` : '',
        stale.length > 0 ? `No longer in runtime: ${stale.join(', ')}` : '',
    ]
        .filter(Boolean)
        .join('\n'));
}
/**
 * The website intentionally presents runtime catalogs in a richer, hand-edited
 * form. Exact ids are still code-owned: fail the build when core adds/removes a
 * mode or fleet role without updating the corresponding operator page.
 */
function validateProductCatalog() {
    const repoRoot = path.resolve(__dirname, '..');
    const productSource = fs.readFileSync(path.resolve(__dirname, 'src/data/product-catalog.ts'), 'utf8');
    const modeSource = fs.readFileSync(path.join(repoRoot, 'packages/core/src/types/mode.ts'), 'utf8');
    const runtimeModeBlock = sourceSection(modeSource, 'export const DEFAULT_MODES', '\n];');
    const websiteModeBlock = sourceSection(productSource, 'export const modeCatalog', 'export type RosterBudget');
    assertSameCatalog('Session mode catalog', captures(websiteModeBlock, /\bid:\s*'([^']+)'/g), captures(runtimeModeBlock, /\bid:\s*'([^']+)'/g));
    const phaseDir = path.join(repoRoot, 'packages/core/src/coordination/agents');
    const runtimePhaseRoles = fs
        .readdirSync(phaseDir)
        .filter((file) => /^phase\d.*\.ts$/.test(file))
        .flatMap((file) => captures(fs.readFileSync(path.join(phaseDir, file), 'utf8'), /\brole:\s*'([^']+)'/g));
    const fleetSource = fs.readFileSync(path.join(repoRoot, 'packages/core/src/coordination/fleet.ts'), 'utf8');
    const builtInFleetBlock = sourceSection(fleetSource, '', '// ACP external agents');
    const runtimeBuiltInRoles = [
        ...runtimePhaseRoles,
        ...captures(builtInFleetBlock, /defineAgent\('([^']+)'/g),
    ];
    const websitePhaseBlock = sourceSection(productSource, 'export const rosterPhases', 'export const specialRosterAgents');
    const websiteSpecialBlock = sourceSection(productSource, 'export const specialRosterAgents', 'export const externalAcpAgents');
    assertSameCatalog('Built-in agent roster', [
        ...captures(websitePhaseBlock, /\brole:\s*'([^']+)'/g),
        ...captures(websiteSpecialBlock, /\brole:\s*'([^']+)'/g),
    ], runtimeBuiltInRoles);
    const runtimeAcpBlock = sourceSection(fleetSource, '// ACP external agents');
    const websiteAcpBlock = sourceSection(productSource, 'export const externalAcpAgents');
    assertSameCatalog('External ACP roster', captures(websiteAcpBlock, /\brole:\s*'([^']+)'/g), captures(runtimeAcpBlock, /defineAgent\('([^']+)'/g));
    const runtimeCatalogSource = fs.readFileSync(path.resolve(__dirname, 'src/data/runtime-catalog.ts'), 'utf8');
    const websiteToolBlock = sourceSection(runtimeCatalogSource, 'export const toolCatalog', 'export const pluginSources');
    const websiteToolNames = captures(websiteToolBlock, /(?:"name"|name):\s*['"]([^'"]+)['"]/g);
    const builtinToolsSource = fs.readFileSync(path.join(repoRoot, 'packages/tools/src/builtin.ts'), 'utf8');
    const builtinToolsBlock = sourceSection(builtinToolsSource, 'export const builtinTools', '\n];');
    const browserToolsSource = fs.readFileSync(path.join(repoRoot, 'packages/tools/src/browser/tools.ts'), 'utf8');
    const browserToolsBlock = sourceSection(browserToolsSource, 'export const browserTools', '\n];');
    const directBuiltinCount = captures(builtinToolsBlock, /^\s{2}(\w+Tool),$/gm).length;
    const browserBuiltinCount = captures(browserToolsBlock, /^\s{2}(browser\w+Tool),$/gm).length;
    const runtimeToolCount = directBuiltinCount + browserBuiltinCount;
    if (websiteToolNames.length !== runtimeToolCount) {
        throw new Error(`Built-in tool catalog drifted from the runtime source. Website: ${websiteToolNames.length}; runtime: ${runtimeToolCount}.`);
    }
    const websitePluginBlock = sourceSection(runtimeCatalogSource, 'export const pluginCatalog');
    const pluginManagementSource = fs.readFileSync(path.join(repoRoot, 'packages/cli/src/plugin-management.ts'), 'utf8');
    const runtimePluginBlock = sourceSection(pluginManagementSource, 'export const PLUGIN_AUDIT_ENTRIES', '\n];');
    assertSameCatalog('Managed plugin catalog', captures(websitePluginBlock, /(?:"name"|name):\s*['"]([^'"]+)['"]/g), captures(runtimePluginBlock, /\bname:\s*'([^']+)'/g));
}
function contentRoutes() {
    const source = fs.readFileSync(path.resolve(__dirname, 'src/data/content.ts'), 'utf8');
    const commandStart = source.indexOf('const commandRows');
    const commandEnd = source.indexOf('const categories', commandStart);
    const commandBlock = source.slice(commandStart, commandEnd);
    const commands = [...commandBlock.matchAll(/\[\s*'\/([^']+)'/g)].map(([, name]) => `commands/${name?.replace(/_/g, '-')}`);
    const features = [...source.matchAll(/slug: '([^']+)'/g)].map(([, slug]) => `features/${slug}`);
    const runtimeSource = fs.readFileSync(path.resolve(__dirname, 'src/data/runtime-catalog.ts'), 'utf8');
    const pluginBlock = sourceSection(runtimeSource, 'export const pluginCatalog', 'export type PluginCatalogEntry');
    const plugins = captures(pluginBlock, /\bname:\s*'([^']+)'/g).map((name) => `plugins/${name.replace(/^@/, '').replace(/\//g, '-')}`);
    const toolBlock = sourceSection(runtimeSource, 'export const toolCatalog', 'export const pluginSources');
    const tools = captures(toolBlock, /\bname:\s*'([^']+)'/g).map((name) => `tools/${name.replace(/_/g, '-')}`);
    const productSource = fs.readFileSync(path.resolve(__dirname, 'src/data/product-catalog.ts'), 'utf8');
    const modeBlock = sourceSection(productSource, 'export const modeCatalog', 'export type RosterBudget');
    const modes = captures(modeBlock, /\bid:\s*'([^']+)'/g).map((id) => `modes/${id}`);
    const agents = captures(productSource, /\brole:\s*'([^']+)'/g).map((role) => `agent-roster/${role}`);
    return [...new Set([...baseRoutes, ...commands, ...features, ...plugins, ...tools, ...modes, ...agents])];
}
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        {
            name: 'wrongstack-static-routes',
            buildStart() {
                validateProductCatalog();
            },
            closeBundle() {
                const outDir = path.resolve(__dirname, 'dist');
                const source = path.join(outDir, 'index.html');
                if (!fs.existsSync(source))
                    return;
                const routes = contentRoutes();
                for (const route of routes) {
                    const routeDir = path.join(outDir, route);
                    fs.mkdirSync(routeDir, { recursive: true });
                    fs.copyFileSync(source, path.join(routeDir, 'index.html'));
                }
                const urls = ['', ...routes]
                    .map((route) => `  <url><loc>https://wrongstack.com/${route}</loc><priority>${route ? '0.8' : '1.0'}</priority></url>`)
                    .join('\n');
                fs.writeFileSync(path.join(outDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, 'utf8');
            },
        },
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
