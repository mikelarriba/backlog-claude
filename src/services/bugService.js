import path from 'path';
import MsgReaderModule from '@kenjiuno/msgreader';
import PDFDocument from 'pdfkit';

const MsgReader = MsgReaderModule.default;

// ── HTML → segments ──────────────────────────────────────────────────────────
/**
 * Convert an HTML email body into an ordered array of text and image segments.
 * Images are extracted from the inlineImages map using their CID references.
 */
function htmlToSegments(html, inlineImages) {
  const segments = [];

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
      const cidMatch = part.match(/src=["']cid:([^"']+)["']/i);
      if (cidMatch) {
        const rawCid = cidMatch[1].trim();
        // Try with and without angle brackets — contentId format varies
        const imgBuf = inlineImages.get(rawCid)
          || inlineImages.get(rawCid.replace(/^<|>$/g, ''))
          || inlineImages.get(`<${rawCid}>`);
        if (imgBuf) {
          segments.push({ type: 'image', buffer: imgBuf, cid: rawCid });
          continue;
        }
      }
      // No matching buffer found — omit the broken CID reference entirely
    } else {
      const text = part
        .replace(/<[^>]+>/g, '')            // strip remaining tags
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/\n{3,}/g, '\n\n')         // collapse excessive blank lines
        .trim();
      if (text) segments.push({ type: 'text', value: text });
    }
  }

  return segments;
}

// ── Translation ───────────────────────────────────────────────────────────────
/**
 * Translate text to English using Claude. Returns the text unchanged if already English.
 */
export async function translateToEnglish(callClaude, text) {
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
/**
 * Parse a .msg (Outlook) file.
 * Returns subject, sender, date, plain body, HTML body, and a Map of inline images.
 */
export function parseMsgFile(buffer) {
  const reader = new MsgReader(buffer);
  const fileData = reader.getFileData();

  // Build contentId → Buffer map for inline image lookup
  const inlineImages = new Map();
  for (const att of (fileData.attachments || [])) {
    if (att.contentId && att.content) {
      const cid = att.contentId.replace(/[<>]/g, '').trim();
      inlineImages.set(cid, Buffer.from(att.content));
    }
  }

  return {
    subject:     fileData.subject || '',
    senderName:  fileData.senderName || '',
    senderEmail: fileData.senderSmtpAddress || fileData.senderEmail || '',
    sentDate:    fileData.headers?.match(/Date:\s*(.+)/)?.[1]?.trim() || '',
    body:        fileData.body || '',
    bodyHtml:    fileData.bodyHtml || '',
    inlineImages,
  };
}

// ── PDF renderer ──────────────────────────────────────────────────────────────
/**
 * Render an ordered list of text/image segments to a PDF buffer.
 * Accepts either an array of segments or a plain string (backwards compat).
 */
export function textToPdfBuffer(title, segments) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const margin   = 50;
    const maxWidth = doc.page.width - margin * 2;

    // Title
    doc.fontSize(16).font('Helvetica-Bold').text(title, { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');

    const list = Array.isArray(segments)
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
        try {
          doc.moveDown(0.5);
          doc.image(seg.buffer, { fit: [maxWidth, 400], align: 'left' });
          doc.moveDown(0.5);
        } catch {
          // Unsupported image format — skip silently
        }
      }
    }

    doc.end();
  });
}

// ── Main attachment processor ─────────────────────────────────────────────────
/**
 * Process a single uploaded attachment.
 * - .msg → parse HTML body, translate each text segment, embed inline images → PDF
 * - everything else → pass through unchanged
 */
export async function processAttachment(file, callClaude) {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ext === '.msg') {
    const msgData = parseMsgFile(file.buffer);

    const headerLines = [
      msgData.subject    ? `Subject: ${msgData.subject}`                            : '',
      msgData.senderName ? `From: ${msgData.senderName} <${msgData.senderEmail}>` : '',
      msgData.sentDate   ? `Date: ${msgData.sentDate}`                              : '',
    ].filter(Boolean);

    let segments = [];

    if (msgData.bodyHtml) {
      // Parse HTML → text + image segments; translate each text segment
      segments = htmlToSegments(msgData.bodyHtml, msgData.inlineImages);
      for (const seg of segments) {
        if (seg.type === 'text') {
          seg.value = await translateToEnglish(callClaude, seg.value);
        }
      }
    } else {
      // Fallback: translate plain text body
      const translated = await translateToEnglish(callClaude, msgData.body);
      segments = [{ type: 'text', value: translated }];
    }

    // Prepend email header
    if (headerLines.length) {
      segments.unshift({ type: 'text', value: headerLines.join('\n') });
    }

    const pdfBuffer = await textToPdfBuffer(msgData.subject || 'Email', segments);
    const pdfName   = file.originalname.replace(/\.msg$/i, '.pdf');
    return { filename: pdfName, buffer: pdfBuffer };
  }

  // All other formats: pass through unchanged
  return { filename: file.originalname, buffer: file.buffer };
}
