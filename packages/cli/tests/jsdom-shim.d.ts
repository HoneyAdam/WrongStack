declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string | Buffer | ArrayBufferView, options?: unknown);
    window: {
      document: Document;
    };
  }
}
