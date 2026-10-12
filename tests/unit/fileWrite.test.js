import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  writeFileAtomic,
  withFileLock,
  withFileLocks,
  updateDoc,
} from '../../src/utils/fileWrite.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'filewrite-'));

test('writeFileAtomic writes content and leaves no temp files', async () => {
  const dir = tmp();
  const f = path.join(dir, 'a.md');
  await writeFileAtomic(f, 'hello');
  assert.equal(fs.readFileSync(f, 'utf-8'), 'hello');
  assert.deepEqual(fs.readdirSync(dir), ['a.md']);
});

test('failed write leaves original intact and cleans up', async () => {
  const dir = tmp();
  const f = path.join(dir, 'a.md');
  fs.writeFileSync(f, 'original');
  // Target is a directory => rename fails
  const d = path.join(dir, 'sub');
  fs.mkdirSync(d);
  await assert.rejects(writeFileAtomic(d, 'x'));
  assert.equal(fs.readFileSync(f, 'utf-8'), 'original');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['a.md', 'sub']);
});

test('concurrent updateDoc calls never lose an update', async () => {
  const dir = tmp();
  const f = path.join(dir, 'n.md');
  fs.writeFileSync(f, '0');
  await Promise.all(
    Array.from({ length: 25 }, () =>
      updateDoc(f, async (c) => {
        await new Promise((r) => setTimeout(r, 1));
        return String(Number(c) + 1);
      })
    )
  );
  assert.equal(fs.readFileSync(f, 'utf-8'), '25');
});

test('lock queue continues after a rejected task', async () => {
  const f = path.join(tmp(), 'x');
  await assert.rejects(withFileLock(f, async () => Promise.reject(new Error('boom'))));
  assert.equal(await withFileLock(f, async () => 'ok'), 'ok');
});

test('withFileLocks takes locks in sorted order (no deadlock on opposite orders)', async () => {
  const dir = tmp();
  const a = path.join(dir, 'a');
  const b = path.join(dir, 'b');
  const order = [];
  await Promise.all([
    withFileLocks([a, b], async () => order.push('ab')),
    withFileLocks([b, a], async () => order.push('ba')),
  ]);
  assert.equal(order.length, 2);
});
