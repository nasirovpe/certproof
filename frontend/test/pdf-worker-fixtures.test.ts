import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { PdfWorkerRequest, PdfWorkerResponse } from '@/lib/pdf/pdf-hash.worker';

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures');
const originalBytes = fs.readFileSync(path.join(FIXTURES_DIR, 'original.pdf'));
const duplicateBytes = fs.readFileSync(path.join(FIXTURES_DIR, 'duplicate.pdf'));
const modifiedBytes = fs.readFileSync(path.join(FIXTURES_DIR, 'modified.pdf'));
const hashesJson = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_DIR, 'hashes.json'), 'utf-8')
);

describe('Web Worker Direct Logic Execution with Fixed PDF Fixtures', () => {
  let postedResponses: PdfWorkerResponse[] = [];
  let workerHandler: (event: MessageEvent<PdfWorkerRequest>) => void;

  beforeAll(async () => {
    // Setup simulated Web Worker environment to capture self.onmessage and self.postMessage
    postedResponses = [];
    (globalThis as any).self = {
      postMessage: (resp: PdfWorkerResponse) => {
        postedResponses.push(resp);
      },
    };

    // Dynamically import worker to register self.onmessage
    await import('@/lib/pdf/pdf-hash.worker');
    workerHandler = (globalThis as any).self.onmessage;
  });

  beforeEach(() => {
    postedResponses = [];
  });

  it('worker computes exact Keccak-256 for original.pdf fixture buffer', () => {
    const copy = new Uint8Array(originalBytes).buffer;
    const req: PdfWorkerRequest = { id: 101, buffer: copy };

    workerHandler({ data: req } as MessageEvent<PdfWorkerRequest>);

    expect(postedResponses.length).toBe(1);
    const resp = postedResponses[0];
    expect(resp.id).toBe(101);
    expect(resp.success).toBe(true);
    expect(resp.documentHash).toBe(hashesJson.files.original.keccak256);
    expect(resp.sizeBytes).toBe(originalBytes.length);
  });

  it('worker computes exact Keccak-256 for duplicate.pdf fixture buffer', () => {
    const copy = new Uint8Array(duplicateBytes).buffer;
    const req: PdfWorkerRequest = { id: 102, buffer: copy };

    workerHandler({ data: req } as MessageEvent<PdfWorkerRequest>);

    expect(postedResponses.length).toBe(1);
    const resp = postedResponses[0];
    expect(resp.id).toBe(102);
    expect(resp.success).toBe(true);
    expect(resp.documentHash).toBe(hashesJson.files.duplicate.keccak256);
    expect(resp.documentHash).toBe(hashesJson.files.original.keccak256);
  });

  it('worker computes distinct Keccak-256 for modified.pdf fixture buffer (single byte change)', () => {
    const copy = new Uint8Array(modifiedBytes).buffer;
    const req: PdfWorkerRequest = { id: 103, buffer: copy };

    workerHandler({ data: req } as MessageEvent<PdfWorkerRequest>);

    expect(postedResponses.length).toBe(1);
    const resp = postedResponses[0];
    expect(resp.id).toBe(103);
    expect(resp.success).toBe(true);
    expect(resp.documentHash).toBe(hashesJson.files.modified.keccak256);
    expect(resp.documentHash).not.toBe(hashesJson.files.original.keccak256);
  });

  it('worker enforces format heuristics and rejects corrupted container header', () => {
    const corrupted = new Uint8Array(originalBytes);
    corrupted[0] = 0x41; // 'A' instead of '%'
    const req: PdfWorkerRequest = { id: 104, buffer: corrupted.buffer };

    workerHandler({ data: req } as MessageEvent<PdfWorkerRequest>);

    expect(postedResponses.length).toBe(1);
    const resp = postedResponses[0];
    expect(resp.id).toBe(104);
    expect(resp.success).toBe(false);
    expect(resp.error).toMatch(/Missing '%PDF-' header marker/i);
    expect(resp.documentHash).toBeUndefined();
  });
});
