import path from 'path';
import MsgReaderModule from '@kenjiuno/msgreader';
// @ts-expect-error — pdfkit has no bundled types and no @types package
import PDFDocument from 'pdfkit';
import type { EmailSegment, ProcessedAttachment, ParsedMsg } from '../types.js';

// @ts-expect-error — @kenjiuno/msgreader exports default differently in CJS/ESM interop
const MsgReader = MsgReaderModule.default;

// ── HTML → segments ──────────────────────────────────────────────────────────
function htmlToSegments(html: string, inlineImages: Map<string, Buffer>): EmailSegment[] {
  const segments: EmailSegment[] = [];

  // Strip head/style/script blocks (avoid dumping CSS into text)
  let processed = html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');

  // Convert block-level elements to newlines before stripping tags
  processed = processed
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<td[^>]*>/gi, ' ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n');

  // Split on <img> tags so we can interleave real images
  const parts = processed.split(/(<img\b[^>]*\/?>)/gi);

  for (const part of parts) {
    if (/^<img\b/i.test(part)) {
      // 1. CID reference — look up in inlineImages map
      const cidMatch = part.match(/src=["']cid:([^"']+)["']/i);
      if (cidMatch) {
        const rawCid = cidMatch[1].trim();
        const imgBuf =
          inlineImages.get(rawCid) ||
          inlineImages.get(rawCid.replace(/^<|>$/g, '')) ||
          inlineImages.get(`<${rawCid}>`);
        if (imgBuf) {
          segments.push({ type: 'image', buffer: imgBuf });
          continue;
        }
      }

      // 2. Base64 data: URI — screenshots pasted inline in Outlook
      const dataMatch = part.match(/src=["']data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)["']/i);
      if (dataMatch) {
        try {
          segments.push({ type: 'image', buffer: Buffer.from(dataMatch[1], 'base64') });
        } catch {
          /* invalid base64 — skip */
        }
        continue;
      }
      // No matching buffer — omit the broken image reference entirely
    } else {
      const text = part
        .replace(/<[^>]+>/g, '') // strip remaining tags
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)))
        .replace(/\n{3,}/g, '\n\n') // collapse excessive blank lines
        .trim();
      if (text) segments.push({ type: 'text', value: text });
    }
  }

  return segments;
}

// ── Plain-text body → segments ────────────────────────────────────────────────
function plainTextToSegments(text: string, inlineImages: Map<string, Buffer>): EmailSegment[] {
  const segments: EmailSegment[] = [];
  if (!text) return segments;

  // Outlook plain-text bodies reference inline images as [cid:filename@domain]
  const parts = text.split(/\[cid:([^\]]+)\]/gi);

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // Text chunk
      const value = parts[i].replace(/\n{3,}/g, '\n\n').trim();
      if (value) segments.push({ type: 'text', value });
    } else {
      // CID reference — same lookup strategy as htmlToSegments
      const rawCid = parts[i].trim();
      const imgBuf =
        inlineImages.get(rawCid) ||
        inlineImages.get(rawCid.replace(/^<|>$/g, '')) ||
        inlineImages.get(`<${rawCid}>`);
      if (imgBuf) segments.push({ type: 'image', buffer: imgBuf });
    }
  }
  return segments;
}

// ── Translation ───────────────────────────────────────────────────────────────
export async function translateToEnglish(
  callClaude: (prompt: string) => Promise<string>,
  text: string
): Promise<string> {
  if (!text || !text.trim()) return text;
  const prompt = [
    'Detect the language of the following text.',
    'If it is NOT in English, translate it to English.',
    'If it is already in English, return it exactly as-is.',
    'Return ONLY the translated (or original) text. No explanations, no labels, no markdown fences.',
    '',
    'Text:',
    text,
  ].join('\n');
  return callClaude(prompt);
}

// ── .msg parser ───────────────────────────────────────────────────────────────
export function parseMsgFile(buffer: Buffer): ParsedMsg {
  const reader = new MsgReader(buffer);
  const fileData = reader.getFileData();

  const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|tiff?|webp)$/i;

  // CID → Buffer for HTML cid: references (inline images)
  const inlineImages = new Map<string, Buffer>();
  // Non-CID image attachments appended at the end of the PDF
  const attachmentImages: Array<{ filename: string; buffer: Buffer }> = [];

  for (const att of fileData.attachments || []) {
    try {
      const { content } = reader.getAttachment(att);
      if (!content) continue;
      const buf = Buffer.from(content);

      if (att.pidContentId) {
        const cid = att.pidContentId.replace(/[<>]/g, '').trim();
        inlineImages.set(cid, buf);
      } else if (IMAGE_EXT.test(att.fileName || '')) {
        attachmentImages.push({ filename: att.fileName, buffer: buf });
      }
    } catch {
      /* skip unreadable attachments */
    }
  }

  return {
    subject: fileData.subject || '',
    senderName: fileData.senderName || '',
    senderEmail: fileData.senderSmtpAddress || fileData.senderEmail || '',
    sentDate: fileData.headers?.match(/Date:\s*(.+)/)?.[1]?.trim() || '',
    body: fileData.body || '',
    bodyHtml: fileData.bodyHtml || '',
    inlineImages,
    attachmentImages,
  };
}

// ── PDF renderer ──────────────────────────────────────────────────────────────
export function textToPdfBuffer(title: string, segments: EmailSegment[] | string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const margin = 50;
    const maxWidth = doc.page.width - margin * 2;

    // Title
    doc.fontSize(16).font('Helvetica-Bold').text(title, { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');

    const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image
    const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 20 MB total inline images
    let totalImageBytes = 0;

    const list: EmailSegment[] = Array.isArray(segments)
      ? segments
      : [{ type: 'text', value: String(segments) }];

    for (const seg of list) {
      if (seg.type === 'text') {
        const txt = seg.value?.trim();
        if (txt) {
          doc.text(txt, { align: 'left', lineGap: 4 });
          doc.moveDown(0.3);
        }
      } else if (seg.type === 'image') {
        const bytes = seg.buffer?.byteLength ?? 0;
        if (bytes > MAX_IMAGE_BYTES) {
          doc.text(`[Image omitted — exceeds ${MAX_IMAGE_BYTES / 1024 / 1024} MB limit]`, {
            align: 'left',
          });
          doc.moveDown(0.3);
        } else if (totalImageBytes + bytes > MAX_TOTAL_BYTES) {
          doc.text('[Image omitted — total image budget exceeded]', { align: 'left' });
          doc.moveDown(0.3);
        } else {
          try {
            doc.moveDown(0.5);
            doc.image(seg.buffer!, { fit: [maxWidth, 400], align: 'left' });
            doc.moveDown(0.5);
            totalImageBytes += bytes;
          } catch {
            // Unsupported image format — skip silently
          }
        }
      }
    }

    doc.end();
  });
}

// ── Main attachment processor ─────────────────────────────────────────────────
export async function processAttachment(
  file: { originalname: string; buffer: Buffer },
  callClaude: (prompt: string) => Promise<string>
): Promise<ProcessedAttachment> {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ext === '.msg') {
    const msgData = parseMsgFile(file.buffer);

    const headerLines = [
      msgData.subject ? `Subject: ${msgData.subject}` : '',
      msgData.senderName ? `From: ${msgData.senderName} <${msgData.senderEmail}>` : '',
      msgData.sentDate ? `Date: ${msgData.sentDate}` : '',
    ].filter(Boolean);

    const rawSegments =
      msgData.bodyHtml && msgData.bodyHtml.trim()
        ? htmlToSegments(msgData.bodyHtml, msgData.inlineImages)
        : plainTextToSegments(msgData.body, msgData.inlineImages);

    for (const seg of rawSegments) {
      if (seg.type === 'text') {
        seg.value = await translateToEnglish(callClaude, seg.value!);
      }
    }

    const segments: EmailSegment[] = rawSegments;

    // Prepend email header
    if (headerLines.length) {
      segments.unshift({ type: 'text', value: headerLines.join('\n') });
    }

    // Append non-CID image attachments (e.g. screenshots saved as files)
    for (const att of msgData.attachmentImages) {
      segments.push({ type: 'image', buffer: att.buffer });
    }

    const pdfBuffer = await textToPdfBuffer(msgData.subject || 'Email', segments);
    const pdfName = file.originalname.replace(/\.msg$/i, '.pdf');
    return { filename: pdfName, buffer: pdfBuffer };
  }

  // All other formats: pass through unchanged
  return { filename: file.originalname, buffer: file.buffer };
}
