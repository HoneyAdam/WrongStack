import { motion, useScroll, useSpring } from 'framer-motion';
import { lazy, Suspense, useEffect } from 'react';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { commandFromSlug, featureFromSlug, pageMeta, type SiteRoute } from '@/data/content';
import { useRouter } from '@/lib/router';

const HomePage = lazy(async () => ({ default: (await import('@/pages/HomePage')).HomePage }));
const FeaturesPage = lazy(async () => ({
  default: (await import('@/pages/FeaturesPage')).FeaturesPage,
}));
const HowItWorksPage = lazy(async () => ({
  default: (await import('@/pages/HowItWorksPage')).HowItWorksPage,
}));
const InterfacesPage = lazy(async () => ({
  default: (await import('@/pages/InterfacesPage')).InterfacesPage,
}));
const CommandsPage = lazy(async () => ({
  default: (await import('@/pages/CommandsPage')).CommandsPage,
}));
const SettingsPage = lazy(async () => ({
  default: (await import('@/pages/SettingsPage')).SettingsPage,
}));
const ArchitecturePage = lazy(async () => ({
  default: (await import('@/pages/ArchitecturePage')).ArchitecturePage,
}));
const EcosystemPage = lazy(async () => ({
  default: (await import('@/pages/EcosystemPage')).EcosystemPage,
}));
const SecurityPage = lazy(async () => ({
  default: (await import('@/pages/SecurityPage')).SecurityPage,
}));
const GettingStartedPage = lazy(async () => ({
  default: (await import('@/pages/GettingStartedPage')).GettingStartedPage,
}));
const WorkflowsPage = lazy(async () => ({
  default: (await import('@/pages/WorkflowsPage')).WorkflowsPage,
}));
const FleetPage = lazy(async () => ({ default: (await import('@/pages/FleetPage')).FleetPage }));
const ModesPage = lazy(async () => ({ default: (await import('@/pages/ModesPage')).ModesPage }));
const AgentRosterPage = lazy(async () => ({
  default: (await import('@/pages/AgentRosterPage')).AgentRosterPage,
}));
const MailboxPage = lazy(async () => ({
  default: (await import('@/pages/MailboxPage')).MailboxPage,
}));
const MemoryPage = lazy(async () => ({ default: (await import('@/pages/MemoryPage')).MemoryPage }));
const ProvidersPage = lazy(async () => ({
  default: (await import('@/pages/ProvidersPage')).ProvidersPage,
}));
const McpPage = lazy(async () => ({ default: (await import('@/pages/McpPage')).McpPage }));
const ToolsPage = lazy(async () => ({ default: (await import('@/pages/ToolsPage')).ToolsPage }));
const PluginsPage = lazy(async () => ({
  default: (await import('@/pages/PluginsPage')).PluginsPage,
}));
const TroubleshootingPage = lazy(async () => ({
  default: (await import('@/pages/TroubleshootingPage')).TroubleshootingPage,
}));
const CreatedByPage = lazy(async () => ({
  default: (await import('@/pages/CreatedByPage')).CreatedByPage,
}));
const CommandDetailPage = lazy(async () => ({
  default: (await import('@/pages/CommandDetailPage')).CommandDetailPage,
}));
const FeatureDetailPage = lazy(async () => ({
  default: (await import('@/pages/FeatureDetailPage')).FeatureDetailPage,
}));

const pages = {
  '/': HomePage,
  '/features': FeaturesPage,
  '/how-it-works': HowItWorksPage,
  '/interfaces': InterfacesPage,
  '/commands': CommandsPage,
  '/settings': SettingsPage,
  '/architecture': ArchitecturePage,
  '/ecosystem': EcosystemPage,
  '/security': SecurityPage,
  '/getting-started': GettingStartedPage,
  '/workflows': WorkflowsPage,
  '/fleet': FleetPage,
  '/modes': ModesPage,
  '/agent-roster': AgentRosterPage,
  '/mailbox': MailboxPage,
  '/memory': MemoryPage,
  '/providers': ProvidersPage,
  '/mcp': McpPage,
  '/tools': ToolsPage,
  '/plugins': PluginsPage,
  '/troubleshooting': TroubleshootingPage,
  '/created-by': CreatedByPage,
} satisfies Record<SiteRoute, typeof HomePage>;

function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 32, mass: 0.22 });
  return (
    <motion.div
      style={{ scaleX }}
      className="fixed inset-x-0 top-0 z-[70] h-[2px] origin-left bg-brand"
      aria-hidden="true"
    />
  );
}

function NotFound() {
  const { navigate } = useRouter();
  return (
    <div className="grid min-h-[80vh] place-items-center px-4 pt-24">
      <div className="max-w-xl text-center">
        <span className="font-mono text-xs font-black uppercase tracking-[0.2em] text-brand">
          404 / route not found
        </span>
        <h1 className="mt-6 text-6xl font-black tracking-[-0.07em] text-fg sm:text-8xl">
          Wrong turn.
        </h1>
        <p className="mt-5 text-lg leading-8 text-muted">
          This page is not part of the current operator manual.
        </p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mt-8 rounded-full bg-fg px-6 py-3 text-sm font-bold text-bg"
        >
          Return home
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { path } = useRouter();
  const commandDetail = path.startsWith('/commands/')
    ? commandFromSlug(path.slice('/commands/'.length))
    : undefined;
  const featureDetail = path.startsWith('/features/')
    ? featureFromSlug(path.slice('/features/'.length))
    : undefined;
  const Page = commandDetail
    ? CommandDetailPage
    : featureDetail
      ? FeatureDetailPage
      : pages[path as SiteRoute];

  useEffect(() => {
    const dynamicCommand = path.startsWith('/commands/')
      ? commandFromSlug(path.slice('/commands/'.length))
      : undefined;
    const dynamicFeature = path.startsWith('/features/')
      ? featureFromSlug(path.slice('/features/'.length))
      : undefined;
    const meta = dynamicCommand
      ? {
          title: `${dynamicCommand.name} command — WrongStack`,
          description: dynamicCommand.summary,
        }
      : dynamicFeature
        ? {
            title: `${dynamicFeature.title} — WrongStack`,
            description: dynamicFeature.summary,
          }
        : (pageMeta[path as SiteRoute] ?? {
            title: 'WrongStack',
            description: 'WrongStack AI coding agent.',
          });
    document.title = meta.title;
    document
      .querySelector<HTMLMetaElement>('meta[name="description"]')
      ?.setAttribute('content', meta.description);
    document
      .querySelector<HTMLMetaElement>('meta[property="og:title"]')
      ?.setAttribute('content', meta.title);
    document
      .querySelector<HTMLMetaElement>('meta[property="og:description"]')
      ?.setAttribute('content', meta.description);
    document
      .querySelector<HTMLMetaElement>('meta[property="og:url"]')
      ?.setAttribute('content', `https://wrongstack.com${path}`);
    document
      .querySelector<HTMLMetaElement>('meta[name="twitter:title"]')
      ?.setAttribute('content', meta.title);
    document
      .querySelector<HTMLMetaElement>('meta[name="twitter:description"]')
      ?.setAttribute('content', meta.description);
    document
      .querySelector<HTMLLinkElement>('link[rel="canonical"]')
      ?.setAttribute('href', `https://wrongstack.com${path}`);
  }, [path]);

  return (
    <div className="min-h-screen bg-bg text-fg antialiased">
      <a
        href="#main"
        className="sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>
      <ScrollProgress />
      <Header />
      <main id="main">
        <Suspense
          fallback={
            <div className="grid min-h-[75vh] place-items-center pt-24">
              <span className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-brand">
                Loading manual…
              </span>
            </div>
          }
        >
          {Page ? <Page /> : <NotFound />}
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
