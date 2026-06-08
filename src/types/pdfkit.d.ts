// Minimal type shim for pdfkit — no @types/pdfkit package exists.
declare module 'pdfkit' {
  interface PDFDocumentOptions {
    margin?: number;
    size?: string;
    [key: string]: any;
  }

  interface PDFDocument extends NodeJS.EventEmitter {
    page: { width: number; height: number };
    fontSize(size: number): this;
    font(name: string): this;
    text(text: string, options?: Record<string, any>): this;
    moveDown(lines?: number): this;
    image(src: Buffer | string, options?: Record<string, any>): this;
    end(): void;
  }

  interface PDFDocumentConstructor {
    new (options?: PDFDocumentOptions): PDFDocument;
  }

  const PDFDocument: PDFDocumentConstructor;
  export = PDFDocument;
}
