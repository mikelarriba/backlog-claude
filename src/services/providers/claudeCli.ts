import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { AIProvider, ProviderCallOpts } from './types.js';

export function normalizeOutput(content: string): string {
  let c = content.trim();
  c = c.replace(/^```[\w]+\n(---[\s\S]*?---)\n```\n?/, '$1\n');
  c = c.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
  return c.trim();
}

function resolveCommandPath(
  rootDir: string,
  name: string
): { path: string; source: 'custom' | 'example' } | null {
  const customPath = path.join(rootDir, '.claude', 'commands', `${name}.md`);
  if (fs.existsSync(customPath)) return { path: customPath, source: 'custom' };
  const examplePath = path.join(rootDir, '.claude', 'commands.example', `${name}.md`);
  if (fs.existsSync(examplePath)) return { path: examplePath, source: 'example' };
  return null;
}

export function loadProductContext(rootDir: string): {
  content: string;
  source: 'custom' | 'example';
} {
  const customPath = path.join(rootDir, '.product-context.md');
  if (fs.existsSync(customPath))
    return { content: fs.readFileSync(customPath, 'utf-8'), source: 'custom' };
  const examplePath = path.join(rootDir, '.product-context.example.md');
  if (fs.existsSync(examplePath))
    return { content: fs.readFileSync(examplePath, 'utf-8'), source: 'example' };
  return { content: '', source: 'example' };
}

export function loadCommand(rootDir: string, name: string): string | null {
  const resolved = resolveCommandPath(rootDir, name);
  if (!resolved) return null;
  let content = fs
    .readFileSync(resolved.path, 'utf-8')
    .replace(/^---[\s\S]*?---\n?/, '')
    .trim();
  if (content.includes('{{PRODUCT_CONTEXT}}')) {
    const ctx = loadProductContext(rootDir);
    content = content.replace('{{PRODUCT_CONTEXT}}', ctx.content);
  }
  return content;
}

export function loadCommandRaw(
  rootDir: string,
  name: string
): { content: string; source: 'custom' | 'example' } | null {
  const resolved = resolveCommandPath(rootDir, name);
  if (!resolved) return null;
  return { content: fs.readFileSync(resolved.path, 'utf-8'), source: resolved.source };
}

function buildArgs(prompt: string, model: string): string[] {
  const args = ['-p', prompt];
  if (model) args.push('--model', model);
  return args;
}

export const claudeCliProvider: AIProvider = {
  name: 'claude-cli',

  call(prompt: string, { rootDir, model, timeoutMs }: ProviderCallOpts): Promise<string> {
    return new Promise((resolve, reject) => {
      let out = '';
      let err = '';
      const proc = spawn('claude', buildArgs(prompt, model), {
        cwd: rootDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => {
        proc.kill();
        reject(Object.assign(new Error('Claude subprocess timed out'), { isTimeout: true }));
      }, timeoutMs);
      proc.stdout!.on('data', (d: Buffer) => (out += d.toString()));
      proc.stderr!.on('data', (d: Buffer) => (err += d.toString()));
      proc.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(err.trim() || `claude exited ${code}`));
        resolve(normalizeOutput(out));
      });
    });
  },

  stream(
    prompt: string,
    { rootDir, model, timeoutMs }: ProviderCallOpts,
    onChunk: (chunk: string) => void
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let err = '';
      const proc = spawn('claude', buildArgs(prompt, model), {
        cwd: rootDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error('Claude subprocess timed out'));
      }, timeoutMs);
      proc.stdout!.on('data', (d: Buffer) => onChunk(d.toString()));
      proc.stderr!.on('data', (d: Buffer) => (err += d.toString()));
      proc.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(err.trim() || `claude exited ${code}`));
      });
    });
  },
};
