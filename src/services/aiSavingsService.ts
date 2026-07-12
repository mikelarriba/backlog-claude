// ── AI Time Saved: JSON log store + PDF/PPTX report builders ─────────────────
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import PptxGenJSCtor from 'pptxgenjs';

// @ts-expect-error — pptxgenjs's default export is double-wrapped under tsx's CJS/ESM interop
const PptxGenJS = (PptxGenJSCtor.default ?? PptxGenJSCtor) as typeof PptxGenJSCtor;

export type AiSavingsActionType =
  | 'story_push'
  | 'spike_push'
  | 'bug_create'
  | 'doc_ai_run'
  | 'doc_confluence_modify';

export interface AiSavingsEntry {
  id: string;
  timestamp: string;
  action_type: AiSavingsActionType;
  item_count: number;
  jira_keys: string[];
  time_saved_minutes: number;
  notes: string;
}

// Minutes saved per item for each action type. `doc_ai_run` is a flat
// per-run benchmark regardless of how many issues were analyzed.
export const BENCHMARK_MINUTES: Record<AiSavingsActionType, number> = {
  story_push: 15,
  spike_push: 15,
  bug_create: 10,
  doc_ai_run: 30,
  doc_confluence_modify: 20,
};

export const ACTION_LABELS: Record<AiSavingsActionType, string> = {
  story_push: 'Stories pushed to JIRA',
  spike_push: 'Spikes pushed to JIRA',
  bug_create: 'Bugs created',
  doc_ai_run: 'Documentation AI analysis',
  doc_confluence_modify: 'Confluence pages modified',
};

const ACTION_TYPES = Object.keys(BENCHMARK_MINUTES) as AiSavingsActionType[];

export function isValidActionType(value: string): value is AiSavingsActionType {
  return (ACTION_TYPES as string[]).includes(value);
}

export function computeTimeSavedMinutes(
  actionType: AiSavingsActionType,
  itemCount: number
): number {
  if (actionType === 'doc_ai_run') return BENCHMARK_MINUTES.doc_ai_run;
  return BENCHMARK_MINUTES[actionType] * itemCount;
}

export interface AiSavingsLogInput {
  action_type: string;
  item_count: number;
  jira_keys?: string[];
  notes?: string;
}

export function createAiSavingsService(rootDir: string) {
  const DATA_DIR = path.join(rootDir, 'data');
  const FILE_PATH = path.join(DATA_DIR, 'ai-savings.json');

  async function readEntries(): Promise<AiSavingsEntry[]> {
    try {
      if (!fs.existsSync(FILE_PATH)) return [];
      const raw = await fs.promises.readFile(FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function writeEntries(entries: AiSavingsEntry[]): Promise<void> {
    if (!fs.existsSync(DATA_DIR)) await fs.promises.mkdir(DATA_DIR, { recursive: true });
    await fs.promises.writeFile(FILE_PATH, JSON.stringify(entries, null, 2));
  }

  async function appendEntry(input: AiSavingsLogInput): Promise<AiSavingsEntry> {
    if (!isValidActionType(input.action_type)) {
      throw new Error(`Invalid action_type: ${input.action_type}`);
    }
    const itemCount = Math.max(1, Math.trunc(input.item_count) || 1);
    const entry: AiSavingsEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      action_type: input.action_type,
      item_count: itemCount,
      jira_keys: input.jira_keys ?? [],
      time_saved_minutes: computeTimeSavedMinutes(input.action_type, itemCount),
      notes: input.notes ?? '',
    };
    const entries = await readEntries();
    entries.push(entry);
    await writeEntries(entries);
    return entry;
  }

  async function getAll(): Promise<{ entries: AiSavingsEntry[]; totalMinutes: number }> {
    const entries = await readEntries();
    const totalMinutes = entries.reduce((sum, e) => sum + (e.time_saved_minutes || 0), 0);
    return { entries, totalMinutes };
  }

  return { appendEntry, getAll, readEntries };
}

// ── Report builders ────────────────────────────────────────────────────────

function groupByCategory(
  entries: AiSavingsEntry[]
): Map<AiSavingsActionType, { count: number; minutes: number }> {
  const byCategory = new Map<AiSavingsActionType, { count: number; minutes: number }>();
  for (const e of entries) {
    const cur = byCategory.get(e.action_type) || { count: 0, minutes: 0 };
    cur.count += e.item_count;
    cur.minutes += e.time_saved_minutes;
    byCategory.set(e.action_type, cur);
  }
  return byCategory;
}

export function buildSavingsPdf(entries: AiSavingsEntry[], totalMinutes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).font('Helvetica-Bold').text('AI Time Saved Report');
    doc.moveDown(0.3);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#555555')
      .text(`Generated ${new Date().toLocaleString()}`);
    doc.moveDown(1);

    const totalHours = (totalMinutes / 60).toFixed(1);
    doc
      .fillColor('#000000')
      .fontSize(14)
      .font('Helvetica-Bold')
      .text(`Total time saved: ${totalHours} hours (${totalMinutes} minutes)`);
    doc.moveDown(1);

    doc.fontSize(12).font('Helvetica-Bold').text('Breakdown by category');
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica');
    const byCategory = groupByCategory(entries);
    if (byCategory.size === 0) {
      doc.text('No actions logged yet.');
    }
    for (const [type, stat] of byCategory) {
      doc.text(`${ACTION_LABELS[type]}: ${stat.count} item(s), ${stat.minutes} min`);
    }
    doc.moveDown(1);

    doc.fontSize(12).font('Helvetica-Bold').text('Log entries');
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica');
    if (entries.length === 0) {
      doc.text('No actions logged yet.');
    }
    for (const e of [...entries].reverse()) {
      const date = new Date(e.timestamp).toLocaleString();
      const keys = e.jira_keys?.length ? ` [${e.jira_keys.join(', ')}]` : '';
      doc.text(
        `${date} — ${ACTION_LABELS[e.action_type]} × ${e.item_count} — ${e.time_saved_minutes} min${keys}`
      );
    }

    doc.end();
  });
}

export async function buildSavingsPptx(
  entries: AiSavingsEntry[],
  totalMinutes: number
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  const ACCENT = '6366F1';
  const SURFACE_DARK = '1E1E2E';
  const totalHours = (totalMinutes / 60).toFixed(1);

  // Slide 1: Title + total
  const slide1 = pptx.addSlide();
  slide1.background = { color: SURFACE_DARK };
  slide1.addText('AI Time Saved Report', {
    x: 0.5,
    y: 1.5,
    w: 9,
    h: 1,
    fontSize: 32,
    bold: true,
    color: 'FFFFFF',
  });
  slide1.addText(`${totalHours} hours saved`, {
    x: 0.5,
    y: 2.6,
    w: 9,
    h: 0.8,
    fontSize: 20,
    color: ACCENT,
  });
  slide1.addText(`Generated ${new Date().toLocaleDateString()}`, {
    x: 0.5,
    y: 3.4,
    w: 9,
    h: 0.5,
    fontSize: 12,
    color: 'AAAAAA',
  });

  // Slide 2: chart of hours saved by category
  const byCategory = groupByCategory(entries);
  const slide2 = pptx.addSlide();
  slide2.addText('Time Saved by Category', {
    x: 0.5,
    y: 0.3,
    w: 9,
    h: 0.6,
    fontSize: 20,
    bold: true,
  });
  if (byCategory.size > 0) {
    const chartData = [
      {
        name: 'Hours saved',
        labels: [...byCategory.keys()].map((k) => ACTION_LABELS[k]),
        values: [...byCategory.values()].map((v) => Math.round((v.minutes / 60) * 10) / 10),
      },
    ];
    slide2.addChart(pptx.ChartType.bar, chartData, {
      x: 0.5,
      y: 1,
      w: 9,
      h: 4.5,
      chartColors: [ACCENT],
      showLegend: false,
      showValAxisTitle: true,
      valAxisTitle: 'Hours',
    });
  } else {
    slide2.addText('No data yet', { x: 0.5, y: 2, w: 9, h: 1, fontSize: 14 });
  }

  // Slide 3: full log table
  const slide3 = pptx.addSlide();
  slide3.addText('Log', { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 20, bold: true });
  const headerRow = ['Date', 'Action', 'Items', 'Minutes'].map((text) => ({
    text,
    options: { bold: true, fill: { color: ACCENT }, color: 'FFFFFF' },
  }));
  const dataRows = [...entries]
    .reverse()
    .slice(0, 50)
    .map((e) => [
      { text: new Date(e.timestamp).toLocaleDateString() },
      { text: ACTION_LABELS[e.action_type] },
      { text: String(e.item_count) },
      { text: String(e.time_saved_minutes) },
    ]);
  slide3.addTable([headerRow, ...dataRows], {
    x: 0.4,
    y: 1,
    w: 9.2,
    fontSize: 9,
    border: { color: 'CCCCCC', pt: 1 },
    autoPage: true,
  });

  const output = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(output as Uint8Array);
}
