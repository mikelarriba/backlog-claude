// Minimal type shim for pdfkit — no @types/pdfkit package exists.
declare module 'pdfkit' {
  interface PDFDocumentOptions {
    margin?: number;
    size?: string;
    [key: string]: unknown;
  }

  interface PDFTextOptions {
    align?: 'left' | 'center' | 'right' | 'justify';
    lineGap?: number;
    continued?: boolean;
    underline?: boolean;
    [key: string]: unknown;
  }

  interface PDFImageOptions {
    fit?: [number, number];
    align?: 'left' | 'center' | 'right';
    width?: number;
    height?: number;
    [key: string]: unknown;
  }

  interface PDFDocument extends NodeJS.EventEmitter {
    page: { width: number; height: number };
    fontSize(size: number): this;
    font(name: string): this;
    text(text: string, options?: PDFTextOptions): this;
    moveDown(lines?: number): this;
    image(src: Buffer | string, options?: PDFImageOptions): this;
    end(): void;
  }

  interface PDFDocumentConstructor {
    new (options?: PDFDocumentOptions): PDFDocument;
  }

  const PDFDocument: PDFDocumentConstructor;
  export = PDFDocument;
}
