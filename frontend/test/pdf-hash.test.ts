import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  computePdfKeccak256,
  validatePdfFormatHeuristics,
  MAX_PDF_SIZE_BYTES,
} from '@/lib/pdf/hash';

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures');

describe('PDF In-Memory Keccak-256 Hashing & Format Heuristics', () => {
  const originalBytes = fs.readFileSync(path.join(FIXTURES_DIR, 'original.pdf'));
  const duplicateBytes = fs.readFileSync(path.join(FIXTURES_DIR, 'duplicate.pdf'));
  const modifiedBytes = fs.readFileSync(path.join(FIXTURES_DIR, 'modified.pdf'));
  const hashesJson = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, 'hashes.json'), 'utf-8')
  );

  it('computes exact Keccak-256 matching original.pdf fixture', async () => {
    const res = await computePdfKeccak256(new Uint8Array(originalBytes));
    expect(res.documentHash).toBe(hashesJson.files.original.keccak256);
    expect(res.sizeBytes).toBe(originalBytes.length);
  });

  it('computes exact Keccak-256 matching duplicate.pdf fixture', async () => {
    const res = await computePdfKeccak256(new Uint8Array(duplicateBytes));
    expect(res.documentHash).toBe(hashesJson.files.duplicate.keccak256);
    expect(res.documentHash).toBe(hashesJson.files.original.keccak256);
  });

  it('computes exact Keccak-256 matching modified.pdf fixture (single byte alteration)', async () => {
    const res = await computePdfKeccak256(new Uint8Array(modifiedBytes));
    expect(res.documentHash).toBe(hashesJson.files.modified.keccak256);
    expect(res.documentHash).not.toBe(hashesJson.files.original.keccak256);
  });

  it('validates standard PDF header and trailer heuristics', () => {
    const validation = validatePdfFormatHeuristics(new Uint8Array(originalBytes));
    expect(validation.valid).toBe(true);
    expect(validation.headerValid).toBe(true);
    expect(validation.trailerValid).toBe(true);
  });

  it('rejects files missing the %PDF- header marker at offset 0', async () => {
    const invalidHeader = new Uint8Array(originalBytes);
    invalidHeader[0] = 0x41; // 'A' instead of '%'
    await expect(computePdfKeccak256(invalidHeader)).rejects.toThrow(
      /Missing '%PDF-' header marker/
    );
  });

  it('rejects files missing the %%EOF trailer marker in the final 1024 bytes', async () => {
    // Corrupt trailer by replacing %%EOF
    const corruptedTrailer = new Uint8Array(originalBytes);
    // Find %%EOF and corrupt it
    const eofStr = '%%EOF';
    const contentStr = Buffer.from(corruptedTrailer).toString('binary');
    const idx = contentStr.lastIndexOf(eofStr);
    expect(idx).toBeGreaterThan(0);
    corruptedTrailer[idx] = 0x58; // Replace '%' with 'X'

    await expect(computePdfKeccak256(corruptedTrailer)).rejects.toThrow(
      /Missing '%%EOF' trailer marker/
    );
  });

  it('rejects empty files (0 bytes) before reading', async () => {
    const emptyBlob = new Blob([], { type: 'application/pdf' });
    await expect(computePdfKeccak256(emptyBlob)).rejects.toThrow(/contains 0 bytes/);
  });

  it('enforces 32 MB size limit before reading the file into memory', async () => {
    // Create a mock Blob with size > 32 MB whose arrayBuffer() should never be called
    const arrayBufferSpy = vi.fn();
    const oversizedBlob = {
      size: MAX_PDF_SIZE_BYTES + 1,
      type: 'application/pdf',
      arrayBuffer: arrayBufferSpy,
    } as unknown as Blob;

    // Use Blob prototype check or instanceof check
    Object.setPrototypeOf(oversizedBlob, Blob.prototype);

    await expect(computePdfKeccak256(oversizedBlob)).rejects.toThrow(
      /File exceeds maximum allowed size of 32 MB/
    );
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it('respects AbortSignal to cancel hashing on rapid file replacement', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      computePdfKeccak256(new Uint8Array(originalBytes), { signal: controller.signal })
    ).rejects.toThrow(/Hashing aborted/);
  });

  it('never performs network requests during hashing (zero upload privacy guarantee)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    try {
      await computePdfKeccak256(new Uint8Array(originalBytes));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  describe('Web Worker Execution & Parity', () => {
    it('dispatches to Web Worker when Worker is available in browser environment', async () => {
      let postedMessage: any = null;
      let terminated = false;

      class MockWorker {
        onmessage: ((e: any) => void) | null = null;
        onerror: ((e: any) => void) | null = null;

        postMessage(msg: any) {
          postedMessage = msg;
          setTimeout(() => {
            if (this.onmessage) {
              this.onmessage({
                data: {
                  id: msg.id,
                  success: true,
                  documentHash: hashesJson.files.original.keccak256,
                  sizeBytes: originalBytes.length,
                },
              });
            }
          }, 10);
        }

        terminate() {
          terminated = true;
        }
      }

      // Mock window and Worker
      const originalWindow = (global as any).window;
      const originalWorker = (global as any).Worker;

      (global as any).window = { document: {} };
      (global as any).Worker = MockWorker;

      try {
        const res = await computePdfKeccak256(new Uint8Array(originalBytes));
        expect(res.documentHash).toBe(hashesJson.files.original.keccak256);
        expect(postedMessage).not.toBeNull();
        expect(postedMessage.buffer).toBeDefined();
        expect(terminated).toBe(true);
      } finally {
        (global as any).window = originalWindow;
        (global as any).Worker = originalWorker;
      }
    });

    it('terminates Web Worker immediately when AbortSignal triggers', async () => {
      let terminated = false;

      class MockSlowWorker {
        onmessage: ((e: any) => void) | null = null;
        onerror: ((e: any) => void) | null = null;

        postMessage(_msg: any) {
          // Never replies to simulate in-flight long calculation
        }

        terminate() {
          terminated = true;
        }
      }

      const originalWindow = (global as any).window;
      const originalWorker = (global as any).Worker;

      (global as any).window = { document: {} };
      (global as any).Worker = MockSlowWorker;

      const controller = new AbortController();

      try {
        const hashPromise = computePdfKeccak256(new Uint8Array(originalBytes), {
          signal: controller.signal,
        });

        // Trigger abort mid-flight
        setTimeout(() => {
          controller.abort();
        }, 10);

        await expect(hashPromise).rejects.toThrow(/Hashing aborted/);
        expect(terminated).toBe(true);
      } finally {
        (global as any).window = originalWindow;
        (global as any).Worker = originalWorker;
      }
    });
  });
});
