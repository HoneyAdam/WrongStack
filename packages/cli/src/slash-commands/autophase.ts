import type { SlashCommand } from '@wrongstack/core';
import {
  AutoPhaseRunner,
  PhaseGraphBuilder,
  PhaseOrchestrator,
  PhaseStore,
  type PhaseGraph,
  type PhaseNode,
  type PhaseProgress,
  type PhaseTemplate,
} from '@wrongstack/core';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Global runner instance (per-session)
let currentRunner: AutoPhaseRunner | null = null;
let currentGraph: PhaseGraph | null = null;

const DEFAULT_PHASES: PhaseTemplate[] = [
  {
    name: 'Discovery',
    description: 'Requirements gathering and analysis',
    priority: 'high',
    estimateHours: 2,
    parallelizable: false,
  },
  {
    name: 'Design',
    description: 'Architecture and design decisions',
    priority: 'critical',
    estimateHours: 4,
    parallelizable: false,
  },
  {
    name: 'Implementation',
    description: 'Core feature development',
    priority: 'critical',
    estimateHours: 12,
    parallelizable: false,
  },
  {
    name: 'Testing',
    description: 'Unit, integration, and e2e tests',
    priority: 'high',
    estimateHours: 6,
    parallelizable: true,
  },
  {
    name: 'Deployment',
    description: 'Deploy to production',
    priority: 'medium',
    estimateHours: 2,
    parallelizable: false,
  },
];

function getStore(): PhaseStore {
  const baseDir = path.join(os.homedir(), '.wrongstack', 'autophase');
  return new PhaseStore({ baseDir });
}

function formatProgress(p: PhaseProgress): string {
  const bars = '█'.repeat(Math.floor(p.percentComplete / 5)) + '░'.repeat(20 - Math.floor(p.percentComplete / 5));
  return [
    `\n  📊 Progress: ${bars} ${p.percentComplete}%`,
    `  📋 Phases: ${p.completed}/${p.totalPhases} done, ${p.running} running, ${p.pending} pending`,
    `  ✅ Tasks: ${p.completedTasks}/${p.totalTasks} completed`,
    `  ⏱️  Est: ${p.estimatedHours.toFixed(1)}h | Actual: ${p.actualHours.toFixed(1)}h`,
  ].join('\n');
}

function formatPhaseList(graph: PhaseGraph): string {
  const phases = Array.from(graph.phases.values());
  const statusEmoji: Record<string, string> = {
    pending: '⏳',
    ready: '🔜',
    running: '🔄',
    paused: '⏸️',
    completed: '✅',
    failed: '❌',
    skipped: '⏭️',
  };

  return phases
    .map((p, i) => {
      const emoji = statusEmoji[p.status] ?? '⚪';
      const progress = p.taskGraph.nodes.size > 0
        ? `${Array.from(p.taskGraph.nodes.values()).filter((t) => t.status === 'completed').length}/${p.taskGraph.nodes.size}`
        : '0/0';
      return `  ${i + 1}. ${emoji} ${p.name} (${p.status}) — ${progress} tasks`;
    })
    .join('\n');
}

/**
 * /autophase — Otonom faz tabanlı iş akışı komutları.
 */
export const autophaseCommand: SlashCommand = {
  name: 'autophase',
  description: 'Otonom faz tabanlı iş akışı — projeyi fazlara böl ve otonom çalıştır',
  usage: '/autophase [start|pause|resume|stop|status|list|load|save] [args...]',

  async execute(args, ctx) {
    const sub = args[0] ?? 'status';
    const store = getStore();

    switch (sub) {
      case 'start': {
        const title = args.slice(1).join(' ') || 'Untitled Project';

        ctx.logger.info(`🚀 AutoPhase başlatılıyor: ${title}`);

        currentRunner = new AutoPhaseRunner({
          title,
          phases: DEFAULT_PHASES,
          executeTask: async (task, phaseId) => {
            ctx.logger.info(`  [${phaseId}] Executing: ${task.title}`);
            // Gerçek uygulamada burada AI agent çalıştırılır
            await new Promise((r) => setTimeout(r, 500)); // Simülasyon
            ctx.logger.info(`  [${phaseId}] ✅ Completed: ${task.title}`);
          },
          onPhaseComplete: (phase) => {
            ctx.logger.info(`\n✅ Phase tamamlandı: ${phase.name} (${phase.actualDurationMs ? (phase.actualDurationMs / 60000).toFixed(1) : 0}m)`);
          },
          onPhaseFail: (phase, error) => {
            ctx.logger.error(`\n❌ Phase başarısız: ${phase.name} — ${error.message}`);
          },
          onProgress: (progress) => {
            // Her 10%'de log at
            if (progress.percentComplete % 10 === 0) {
              ctx.logger.info(formatProgress(progress));
            }
          },
          onComplete: (graph) => {
            ctx.logger.info(`\n🎉 Tüm fazlar tamamlandı! ${graph.title}`);
          },
          onFail: (graph, phase, error) => {
            ctx.logger.error(`\n💥 AutoPhase durdu: ${phase.name} — ${error.message}`);
          },
          autonomous: true,
          maxConcurrentPhases: 1,
          maxConcurrentTasks: 2,
        });

        currentGraph = await currentRunner.start();

        // Kaydet
        await store.save(currentGraph);

        return {
          content: `AutoPhase başlatıldı: **${title}**\n\n${formatPhaseList(currentGraph)}`,
        };
      }

      case 'pause': {
        if (!currentRunner) {
          return { content: '❌ Aktif AutoPhase yok. Önce `/autophase start` çalıştırın.' };
        }
        currentRunner.pause();
        return { content: '⏸️ AutoPhase duraklatıldı. Devam etmek için `/autophase resume`' };
      }

      case 'resume': {
        if (!currentRunner) {
          return { content: '❌ Aktif AutoPhase yok. Önce `/autophase start` çalıştırın.' };
        }
        currentRunner.resume();
        return { content: '▶️ AutoPhase devam ediyor.' };
      }

      case 'stop': {
        if (!currentRunner) {
          return { content: '❌ Aktif AutoPhase yok.' };
        }
        currentRunner.stop();
        currentRunner = null;
        return { content: '🛑 AutoPhase durduruldu.' };
      }

      case 'status': {
        if (!currentRunner || !currentGraph) {
          // Kayıtlı graph'ları listele
          const graphs = await store.list();
          if (graphs.length === 0) {
            return { content: 'Aktif AutoPhase yok. Başlatmak için `/autophase start [title]`' };
          }
          const list = graphs.slice(0, 5).map((g) => `  • ${g.title} (${g.status})`).join('\n');
          return { content: `Kayıtlı AutoPhase projeleri:\n${list}` };
        }

        const progress = currentRunner.getProgress();
        const phaseList = formatPhaseList(currentGraph);

        return {
          content: [
            `**${currentGraph.title}**`,
            progress ? formatProgress(progress) : '',
            '',
            '**Fazlar:**',
            phaseList,
            '',
            currentRunner.isPaused() ? '⏸️ Duraklatıldı' : currentRunner.isRunning() ? '🔄 Çalışıyor' : '⏹️ Durdu',
          ].join('\n'),
        };
      }

      case 'list': {
        const graphs = await store.list();
        if (graphs.length === 0) {
          return { content: 'Kayıtlı AutoPhase projesi yok.' };
        }
        const list = graphs.map((g) => {
          const statusEmoji = g.status === 'completed' ? '✅' : g.status === 'in_progress' ? '🔄' : '⏳';
          return `  ${statusEmoji} ${g.title} (güncelleme: ${new Date(g.updatedAt).toLocaleDateString('tr-TR')})`;
        }).join('\n');
        return { content: `**Kayıtlı Projeler:**\n${list}` };
      }

      case 'load': {
        const graphId = args[1];
        if (!graphId) {
          return { content: '❌ Graph ID gerekli. Kullanım: `/autophase load <id>`' };
        }
        const graph = await store.load(graphId);
        if (!graph) {
          return { content: `❌ Graph bulunamadı: ${graphId}` };
        }
        currentGraph = graph;
        return {
          content: `**${graph.title}** yüklendi.\n\n${formatPhaseList(graph)}`,
        };
      }

      case 'save': {
        if (!currentGraph) {
          return { content: '❌ Kaydedilecek aktif graph yok.' };
        }
        await store.save(currentGraph);
        return { content: `✅ **${currentGraph.title}** kaydedildi.` };
      }

      default:
        return {
          content: [
            '**AutoPhase Komutları:**',
            '',
            '`/autophase start [title]` — Yeni proje başlat',
            '`/autophase pause` — Duraklat',
            '`/autophase resume` — Devam et',
            '`/autophase stop` — Durdur',
            '`/autophase status` — Durum göster',
            '`/autophase list` — Kayıtlı projeleri listele',
            '`/autophase load <id>` — Projeyi yükle',
            '`/autophase save` — Aktif projeyi kaydet',
          ].join('\n'),
        };
    }
  },
};
