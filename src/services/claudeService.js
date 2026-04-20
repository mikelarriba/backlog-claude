import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export function loadCommand(rootDir, name) {
  const commandPath = path.join(rootDir, '.claude', 'commands', `${name}.md`);
  if (!fs.existsSync(commandPath)) return null;
  return fs.readFileSync(commandPath, 'utf-8').replace(/^---[\s\S]*?---\n?/, '').trim();
}

export function callClaude(rootDir, prompt) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const proc = spawn('claude', ['-p', prompt], { cwd: rootDir });
    proc.stdout.on('data', d => (out += d.toString()));
    proc.stderr.on('data', d => (err += d.toString()));
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(err.trim() || `claude exited ${code}`));
      const trimmed = out.trim().replace(/^```(?:markdown)?\n?/, '').replace(/\n?```$/, '');
      resolve(trimmed);
    });
  });
}

export function streamClaude(rootDir, prompt, onChunk) {
  return new Promise((resolve, reject) => {
    let err = '';
    const proc = spawn('claude', ['-p', prompt], { cwd: rootDir });
    proc.stdout.on('data', d => onChunk(d.toString()));
    proc.stderr.on('data', d => (err += d.toString()));
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(err.trim() || `claude exited ${code}`))));
  });
}
