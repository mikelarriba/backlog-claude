// ── Documentation panel: PDF export of proposed Confluence changes (#559) ────
// The PO wants to review the AI's proposed documentation changes (from
// POST /api/confluence/analyze) as a PDF before applying anything via
// POST /api/confluence/execute. This builder renders exactly the report the
// client already holds in memory — no Confluence/JIRA I/O, no state written —
// modeled directly on buildSavingsPdf() in aiSavingsService.ts (same
// PDFDocument({margin:50,size:'A4'}) + chunk-collection pattern).
import PDFDocument from 'pdfkit';
import type { ConfluenceSuggestion } from '../routes/confluence.js';

export interface ConfluenceSuggestionsPdfMeta {
  scope?: string;
}

export function buildConfluenceSuggestionsPdf(
  suggestions: ConfluenceSuggestion[],
  meta: ConfluenceSuggestionsPdfMeta = {}
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).font('Helvetica-Bold').text('Proposed Documentation Changes');
    doc.moveDown(0.3);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#555555')
      .text(`Generated ${new Date().toLocaleString()}`);
    if (meta.scope) {
      doc.text(`Scope: ${meta.scope}`);
    }
    doc.moveDown(1);

    doc
      .fillColor('#000000')
      .fontSize(12)
      .font('Helvetica-Bold')
      .text(`${suggestions.length} proposed change${suggestions.length === 1 ? '' : 's'}`);
    doc.moveDown(1);

    if (suggestions.length === 0) {
      doc.fontSize(10).font('Helvetica').text('No documentation changes were suggested.');
    }

    suggestions.forEach((s, i) => {
      if (i > 0) doc.moveDown(1);

      doc.fontSize(13).font('Helvetica-Bold').fillColor('#000000').text(s.pageTitle);
      if (s.hierarchyPath) {
        doc.fontSize(9).font('Helvetica').fillColor('#555555').text(s.hierarchyPath);
      }
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text(`Action: ${s.action}`);
      doc.moveDown(0.3);

      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Current content');
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#333333')
        .text(s.currentContent || '(none — page does not exist yet)');
      doc.moveDown(0.3);

      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Proposed content');
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#333333')
        .text(s.proposedContent || '(none — page will be removed)');

      doc.moveDown(0.5);
      doc.fontSize(9).font('Helvetica').fillColor('#CCCCCC').text('─'.repeat(80));
    });

    doc.end();
  });
}
