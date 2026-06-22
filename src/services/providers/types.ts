export interface ProviderCallOpts {
  rootDir: string;
  model: string;
  timeoutMs: number;
}

export interface AIProvider {
  readonly name: string;
  call(prompt: string, opts: ProviderCallOpts): Promise<string>;
  stream(prompt: string, opts: ProviderCallOpts, onChunk: (chunk: string) => void): Promise<void>;
}
