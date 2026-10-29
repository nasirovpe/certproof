import { keccak256 } from 'viem';
import { validatePdfFormatHeuristics } from './heuristics';

export interface PdfWorkerRequest {
  id: number;
  buffer: ArrayBuffer;
}

export interface PdfWorkerResponse {
  id: number;
  success: boolean;
  documentHash?: `0x${string}`;
  sizeBytes?: number;
  error?: string;
}

self.onmessage = (event: MessageEvent<PdfWorkerRequest>) => {
  const { id, buffer } = event.data;
  try {
    const uint8Array = new Uint8Array(buffer);
    const sizeBytes = uint8Array.byteLength;

    const validation = validatePdfFormatHeuristics(uint8Array);
    if (!validation.valid) {
      self.postMessage({
        id,
        success: false,
        error: validation.error || 'Invalid PDF format heuristics.',
      } as PdfWorkerResponse);
      return;
    }

    const documentHash = keccak256(uint8Array);
    self.postMessage({
      id,
      success: true,
      documentHash,
      sizeBytes,
    } as PdfWorkerResponse);
  } catch (err: unknown) {
    self.postMessage({
      id,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    } as PdfWorkerResponse);
  }
};
