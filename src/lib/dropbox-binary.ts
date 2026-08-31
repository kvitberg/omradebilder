/**
 * Dropbox-SDK-en legger nedlastet innhold i ulike felt avhengig av hvilken
 * fetch-implementasjon som er tilgjengelig: `fileBinary` under node-fetch, og
 * `fileBlob` med moderne innebygd fetch (som Next.js og nyere Node bruker).
 * Vi tar imot begge, ellers blir det `undefined` i det ene miljøet.
 */
export async function toArrayBuffer(result: unknown): Promise<ArrayBuffer> {
  const payload = result as { fileBinary?: Uint8Array; fileBlob?: Blob };

  if (payload.fileBlob) {
    return payload.fileBlob.arrayBuffer();
  }
  if (payload.fileBinary) {
    const source = payload.fileBinary;
    const copy = new ArrayBuffer(source.byteLength);
    new Uint8Array(copy).set(source);
    return copy;
  }
  throw new Error("Dropbox returnerte verken fileBinary eller fileBlob");
}
