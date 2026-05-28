import type { SlashCommand } from '@wrongstack/core';
import {
  AutoPhaseRunner,
  PhaseStore,
  type PhaseGraph,
  type PhaseProgress,
  type PhaseTemplate,
} from '@wrongstack/core';
import * as path from 'node:path';
import * as os from 'node:os';

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
  argsHint: '[start|pause|resume|stop|status|list|load|save] [args...]',

  async run(args, _ctx) {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const sub = parts[0] ?? 'status';
    const store = getStore();

    switch (sub) {
      case 'start': {
        const title = parts.slice(1).join(' ') || 'Untitled Project';

        const runLog: string[] = [];
        const log = (line: string) => runLog.push(line);

        log(`🚀 AutoPhase başlatılıyor: ${title}`);

        currentRunner = new AutoPhaseRunner({
          title,
          phases: DEFAULT_PHASES,
          executeTask: async (task, phaseId) => {
            log(`  [${phaseId}] Executing: ${task.title}`);
            // Gerçek uygulamada burada AI agent çalıştırılır
            await new Promise((r) => setTimeout(r, 500)); // Simülasyon
            log(`  [${phaseId}] ✅ Completed: ${task.title}`);
          },
          onPhaseComplete: (phase) => {
            log(`✅ Phase tamamlandı: ${phase.name} (${phase.actualDurationMs ? (phase.actualDurationMs / 60000).toFixed(1) : 0}m)`);
          },
          onPhaseFail: (phase, error) => {
            log(`❌ Phase başarısız: ${phase.name} — ${error.message}`);
          },
          onProgress: (progress) => {
            // Her 10%'de log at
            if (progress.percentComplete % 10 === 0) {
              log(formatProgress(progress));
            }
          },
          onComplete: (graph) => {
            log(`🎉 Tüm fazlar tamamlandı! ${graph.title}`);
          },
          onFail: (_graph, phase, error) => {
            log(`💥 AutoPhase durdu: ${phase.name} — ${error.message}`);
          },
          autonomous: true,
          maxConcurrentPhases: 1,
          maxConcurrentTasks: 2,
        });

        currentGraph = await currentRunner.start();

        // Kaydet
        await store.save(currentGraph);

        return {
          message: [
            `AutoPhase başlatıldı: **${title}**`,
            '',
            formatPhaseList(currentGraph),
            ...(runLog.length > 0 ? ['', '---', ...runLog] : []),
          ].join('\n'),
        };
      }

      case 'pause': {
        if (!currentRunner) {
          if (currentGraph) {
            return { message: `❌ **${currentGraph.title}** yüklü ama çalışmıyor. Duraklatmak için önce başlatın: \`/autophase start\`` };
          }
          return { message: '❌ Aktif AutoPhase yok. Önce `/autophase start` çalıştırın.' };
        }
        currentRunner.pause();
        return { message: '⏸️ AutoPhase duraklatıldı. Devam etmek için `/autophase resume`' };
      }

      case 'resume': {
        if (!currentRunner) {
          if (currentGraph) {
            return { message: `❌ **${currentGraph.title}** yüklü ama çalışmıyor. Devam ettirmek için önce başlatın: \`/autophase start\`` };
          }
          return { message: '❌ Aktif AutoPhase yok. Önce `/autophase start` çalıştırın.' };
        }
        currentRunner.resume();
        return { message: '▶️ AutoPhase devam ediyor.' };
      }

      case 'stop': {
        if (!currentRunner) {
          if (currentGraph) {
            return { message: `❌ **${currentGraph.title}** yüklü ama çalışmıyor. Durdurmak için önce başlatın: \`/autophase start\`` };
          }
          return { message: '❌ Aktif AutoPhase yok.' };
        }
        currentRunner.stop();
        currentRunner = null;
        currentGraph = null;
        return { message: '🛑 AutoPhase durduruldu.' };
      }

      case 'status': {
        if (!currentRunner) {
          if (!currentGraph) {
            // Hiçbir şey yüklü değil - kayıtlı graph'ları listele
            const graphs = await store.list();
            if (graphs.length === 0) {
              return { message: 'Aktif AutoPhase yok. Başlatmak için `/autophase start [title]`' };
            }
            const list = graphs.slice(0, 5).map((g) => `  • ${g.title} (${g.status})`).join('\n');
            return { message: `Kayıtlı AutoPhase projeleri:\n${list}` };
          }
          // Graph var ama runner yok - sadece graph durumunu göster (live metrikler yok)
          const phaseList = formatPhaseList(currentGraph);
          return {
            message: [
              `**${currentGraph.title}** (yüklü, çalışmıyor)`,
              '',
              '**Fazlar:**',
              phaseList,
              '',
              '💡 Devam etmek için `/autophase start` veya `/autophase load <id>` kullanın.',
            ].join('\n'),
          };
        }

        const graph = currentRunner.getGraph()!;
        const progress = currentRunner.getProgress();
        const phaseList = formatPhaseList(graph);

        return {
          message: [
            `**${graph.title}**`,
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
          return { message: 'Kayıtlı AutoPhase projesi yok.' };
        }
        const list = graphs.map((g) => {
          const statusEmoji = g.status === 'completed' ? '✅' : g.status === 'in_progress' ? '🔄' : '⏳';
          return `  ${statusEmoji} ${g.title} (güncelleme: ${new Date(g.updatedAt).toLocaleDateString('tr-TR')})`;
        }).join('\n');
        return { message: `**Kayıtlı Projeler:**\n${list}` };
      }

      case 'load': {
        const graphId = parts[1];
        if (!graphId) {
          return { message: '❌ Graph ID gerekli. Kullanım: `/autophase load <id>`' };
        }
        const graph = await store.load(graphId);
        if (!graph) {
          return { message: `❌ Graph bulunamadı: ${graphId}` };
        }
        currentGraph = graph;
        return {
          message: `**${graph.title}** yüklendi.\n\n${formatPhaseList(graph)}`,
        };
      }

      case 'save': {
        if (!currentGraph) {
          return { message: '❌ Kaydedilecek aktif graph yok.' };
        }
        await store.save(currentGraph);
        return { message: `✅ **${currentGraph.title}** kaydedildi.` };
      }

      default:
        return {
          message: [
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
