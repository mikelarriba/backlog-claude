// ── Crash-safe, serialized file writes ────────────────────────────────────────
// Markdown files in backlog/ are the app's database. These helpers make writes
// atomic (temp file + rename) and serialize read-modify-write cycles per file.
import fs from 'fs';
import path from 'path';

export const TMP_SUFFIX = '.tmp';

let tmpCounter = 0;

/** Write via a same-directory temp file then rename, so readers never see a truncated file. */
export async function writeFileAtomic(
  filepath: string,
  content: string | Buffer,
  encoding?: BufferEncoding
): Promise<void> {
  const resolved = path.resolve(filepath);
  const tmpPath = `${resolved}.${process.pid}.${++tmpCounter}${TMP_SUFFIX}`;
  try {
    await fs.promises.writeFile(tmpPath, content, encoding);
    await fs.promises.rename(tmpPath, resolved);
  } catch (err) {
    await fs.promises.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

const queues = new Map<string, Promise<unknown>>();

/** In-process promise queue keyed by resolved path. */
export function withFileLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(filepath);
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

/** Take several locks in a stable (sorted) order to avoid deadlock. */
export async function withFileLocks<T>(filepaths: string[], fn: () => Promise<T>): Promise<T> {
  const sorted = [...new Set(filepaths.map((p) => path.resolve(p)))].sort();
  const acquire = (i: number): Promise<T> =>
    i >= sorted.length ? fn() : withFileLock(sorted[i], () => acquire(i + 1));
  return acquire(0);
}

/** lock → read → mutate → atomic write. Mutator returns the new content. */
export function updateDoc(
  filepath: string,
  mutator: (content: string) => string | Promise<string>
): Promise<string> {
  return withFileLock(filepath, async () => {
    const current = await fs.promises.readFile(filepath, 'utf-8');
    const next = await mutator(current);
    await writeFileAtomic(filepath, next);
    return next;
  });
}
