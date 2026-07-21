import { Puzzle } from 'lucide-react';
import { useAppTranslation } from '@/i18n';
import { useLocalPrefs } from '@/stores/local-prefs';
import { PreferenceToggle } from './PreferenceToggle';

const PLUGINS: Array<[string, string]> = [
  ['wstack-chimera', 'settings:features.pluginChimera'],
  ['wstack-skills', 'settings:features.pluginSkills'],
  ['wstack-prompts', 'settings:features.pluginPrompts'],
  ['cost-tracker', 'settings:features.pluginCostTracker'],
  ['telegram', 'settings:features.pluginTelegram'],
  ['knowledge-graph', 'settings:features.pluginKnowledgeGraph'],
  ['error-lens', 'settings:features.pluginErrorLens'],
  ['todo-tracker', 'settings:features.pluginTodoTracker'],
  ['secret-scanner', 'settings:features.pluginSecretScanner'],
  ['lint-gate', 'settings:features.pluginLintGate'],
  ['diff-summary', 'settings:features.pluginDiffSummary'],
  ['dep-guard', 'settings:features.pluginDepGuard'],
  ['type-gate', 'settings:features.pluginTypeGate'],
  ['injection-shield', 'settings:features.pluginInjectionShield'],
  ['prompt-firewall', 'settings:features.pluginPromptFirewall'],
  ['token-budget', 'settings:features.pluginTokenBudget'],
  ['loop-breaker', 'settings:features.pluginLoopBreaker'],
] as const;

/** Renders the per-plugin enable/disable toggle list inside the Features tab. */
export function PluginToggleList() {
  const { t } = useAppTranslation();
  const localPrefs = useLocalPrefs();

  return (
    <div className="pt-2 border-t">
      <h3 className="text-sm font-semibold mb-3 mt-3 flex items-center gap-2">
        <Puzzle className="h-4 w-4 text-muted-foreground" />
        {t('settings:features.pluginsPerPluginHeading')}
      </h3>
      <p className="text-xs text-muted-foreground mb-2">
        {t('settings:features.pluginsPerPluginHint')}
      </p>
      {PLUGINS.map(([pluginName, labelKey]) => {
        const enabled = localPrefs.pluginsEnabled?.[pluginName] ?? true;
        return (
          <PreferenceToggle
            key={pluginName}
            label={t(labelKey)}
            value={enabled}
            onChange={() => {
              const next = { ...localPrefs.pluginsEnabled, [pluginName]: !enabled };
              localPrefs.set({ pluginsEnabled: next });
            }}
          />
        );
      })}
    </div>
  );
}
