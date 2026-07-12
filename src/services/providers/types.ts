export interface ProviderCallOpts {
  rootDir: string;
  model: string;
  timeoutMs: number;
  // Reasoning-effort level (low/medium/high/xhigh/max). Only honored by the
  // claude-cli provider, which forwards it as `--effort <level>`.
  effort?: string;
}

export interface AIProvider {
  readonly name: string;
  call(prompt: string, opts: ProviderCallOpts): Promise<string>;
  stream(prompt: string, opts: ProviderCallOpts, onChunk: (chunk: string) => void): Promise<void>;
}
