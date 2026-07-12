import { claudeCliProvider } from './claudeCli.js';
import { githubModelsProvider } from './githubModels.js';
import { ollamaProvider, checkOllamaHealth, fetchOllamaModels } from './ollama.js';
import type { AIProvider } from './types.js';

export function createProvider(name: string): AIProvider {
  switch (name) {
    case 'github-models':
      return githubModelsProvider;
    case 'ollama':
      return ollamaProvider;
    default:
      return claudeCliProvider;
  }
}

// Reasoning-effort levels accepted by `claude --effort <level>`. Only the
// claude-cli provider supports this flag.
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export async function getAvailableProviders(): Promise<
  Array<{
    id: string;
    name: string;
    models: Array<{ id: string; name: string }>;
    effortLevels?: readonly string[];
  }>
> {
  const providers: Array<{
    id: string;
    name: string;
    models: Array<{ id: string; name: string }>;
    effortLevels?: readonly string[];
  }> = [
    {
      id: 'claude-cli',
      name: 'Claude (Anthropic)',
      models: [
        { id: '', name: 'Default (Sonnet 5)' },
        { id: 'claude-sonnet-5', name: 'Sonnet 5' },
        { id: 'claude-opus-4-8', name: 'Opus 4.8' },
        { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
        { id: 'claude-fable-5', name: 'Fable 5' },
      ],
      effortLevels: EFFORT_LEVELS,
    },
  ];

  if (process.env.GITHUB_MODELS_TOKEN) {
    providers.push({
      id: 'github-models',
      name: 'GitHub Models',
      models: [
        { id: 'openai/gpt-4o', name: 'GPT-4o' },
        { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
        { id: 'deepseek/DeepSeek-V3-0324', name: 'DeepSeek V3' },
        { id: 'deepseek/DeepSeek-R1', name: 'DeepSeek R1' },
        { id: 'meta/Llama-3.1-405B-Instruct', name: 'Llama 3.1 405B' },
        { id: 'Mistral-large-2411', name: 'Mistral Large' },
      ],
    });
  }

  if (await checkOllamaHealth()) {
    const ollamaModels = await fetchOllamaModels();
    providers.push({
      id: 'ollama',
      name: 'Ollama (local)',
      models: ollamaModels,
    });
  }

  return providers;
}
