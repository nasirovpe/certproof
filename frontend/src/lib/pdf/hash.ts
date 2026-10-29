import { keccak256 } from 'viem';
import {
  MAX_PDF_SIZE_BYTES,
  PDF_HEADER_MAGIC,
  PDF_TRAILER_MAGIC,
  TRAILER_SEARCH_WINDOW_BYTES,
  PdfValidationResult,
  PdfHashResult,
  validatePdfFormatHeuristics,
} from './heuristics';
import type { PdfWorkerRequest, PdfWorkerResponse } from './pdf-hash.worker';

// Re-export for backward compatibility
export {
  MAX_PDF_SIZE_BYTES,
  PDF_HEADER_MAGIC,
  PDF_TRAILER_MAGIC,
  TRAILER_SEARCH_WINDOW_BYTES,
  validatePdfFormatHeuristics,
};
export type { PdfValidationResult, PdfHashResult };

let workerRequestId = 0;

/**
 * Executes PDF heuristics and Keccak-256 calculation inside a dedicated Web Worker
 * to prevent blocking the browser main UI thread.
 */
function hashWithWebWorker(
  buffer: ArrayBuffer,
  signal?: AbortSignal
): Promise<PdfHashResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Hashing aborted by user.', 'AbortError'));
      return;
    }

    let worker: Worker | null = null;
    const reqId = ++workerRequestId;

    const cleanup = () => {
      if (worker) {
        worker.terminate();
        worker = null;
      }
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException('Hashing aborted by user.', 'AbortError'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      worker = new Worker(new URL('./pdf-hash.worker.ts', import.meta.url), {
        type: 'module',
      });

      worker.onmessage = (event: MessageEvent<PdfWorkerResponse>) => {
        if (event.data.id !== reqId) return;
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        cleanup();

        if (event.data.success && event.data.documentHash && event.data.sizeBytes !== undefined) {
          resolve({
            documentHash: event.data.documentHash,
            sizeBytes: event.data.sizeBytes,
          });
        } else {
          reject(new Error(event.data.error || 'Failed to hash PDF file in worker.'));
        }
      };

      worker.onerror = (err: ErrorEvent) => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        cleanup();
        reject(new Error(err.message || 'Web Worker error during PDF hashing.'));
      };

      const request: PdfWorkerRequest = { id: reqId, buffer };
      // Transfer buffer to avoid main-thread memory duplication
      worker.postMessage(request, [buffer]);
    } catch (err: unknown) {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      cleanup();
      reject(err);
    }
  });
}

/**
 * Computes the exact Keccak-256 digest of an unaltered candidate PDF.
 *
 * Zero-Tamper Pipeline Rules:
 * 1. Checks file size BEFORE reading the file into memory.
 * 2. Rejects empty files (0 bytes) and files exceeding 32 MB.
 * 3. Applies PDF header/trailer format heuristics.
 * 4. Offloads raw unpadded Keccak-256 to a background Web Worker in browser environments
 *    to preserve UI responsiveness, falling back to direct computation in Node/SSR.
 * 5. Does NOT normalize text, strip metadata, parse or reserialize, or compress.
 * 6. Keeps bytes in transient memory only (never written to disk or browser storage).
 * 7. Never uploads PDF bytes, filenames, or contents to any network server.
 */
export async function computePdfKeccak256(
  input: File | Blob | ArrayBuffer | Uint8Array,
  options?: { signal?: AbortSignal }
): Promise<PdfHashResult> {
  if (options?.signal?.aborted) {
    throw new DOMException('Hashing aborted by user.', 'AbortError');
  }

  let sizeBytes: number;
  let arrayBuffer: ArrayBuffer;

  // 1. Pre-Read Size Enforcement
  if (input instanceof File || input instanceof Blob) {
    sizeBytes = input.size;
    if (sizeBytes === 0) {
      throw new Error('Empty file: The selected file contains 0 bytes.');
    }
    if (sizeBytes > MAX_PDF_SIZE_BYTES) {
      throw new Error(
        `File exceeds maximum allowed size of 32 MB (${sizeBytes.toLocaleString()} bytes). Enforced prior to reading.`
      );
    }

    if (options?.signal?.aborted) {
      throw new DOMException('Hashing aborted by user.', 'AbortError');
    }

    // Read unaltered raw ArrayBuffer into memory
    arrayBuffer = await input.arrayBuffer();

    if (options?.signal?.aborted) {
      throw new DOMException('Hashing aborted by user.', 'AbortError');
    }
  } else if (input instanceof Uint8Array) {
    sizeBytes = input.byteLength;
    if (sizeBytes === 0) {
      throw new Error('Empty file: The selected file contains 0 bytes.');
    }
    if (sizeBytes > MAX_PDF_SIZE_BYTES) {
      throw new Error(
        `File exceeds maximum allowed size of 32 MB (${sizeBytes.toLocaleString()} bytes).`
      );
    }
    const copy = new Uint8Array(input.byteLength);
    copy.set(input);
    arrayBuffer = copy.buffer;
  } else {
    // ArrayBuffer
    sizeBytes = input.byteLength;
    if (sizeBytes === 0) {
      throw new Error('Empty file: The selected file contains 0 bytes.');
    }
    if (sizeBytes > MAX_PDF_SIZE_BYTES) {
      throw new Error(
        `File exceeds maximum allowed size of 32 MB (${sizeBytes.toLocaleString()} bytes).`
      );
    }
    const copy = new Uint8Array(input.byteLength);
    copy.set(new Uint8Array(input));
    arrayBuffer = copy.buffer;
  }

  // 2. Offload to Web Worker if supported by browser environment
  const isBrowserWithWorker =
    typeof window !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    typeof window.document !== 'undefined';

  if (isBrowserWithWorker) {
    try {
      return await hashWithWebWorker(arrayBuffer, options?.signal);
    } catch (err: unknown) {
      // If user aborted, rethrow immediately
      if (
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        throw err;
      }
      // If Web Worker instantiation is not supported in the active runner, fallback to direct execution
    }
  }

  // 3. Fallback direct execution (Node.js test environment or environments without Worker support)
  const uint8Array = new Uint8Array(arrayBuffer);
  const validation = validatePdfFormatHeuristics(uint8Array);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid PDF format heuristics.');
  }

  if (options?.signal?.aborted) {
    throw new DOMException('Hashing aborted by user.', 'AbortError');
  }

  const documentHash = keccak256(uint8Array);

  return {
    documentHash,
    sizeBytes,
  };
}
