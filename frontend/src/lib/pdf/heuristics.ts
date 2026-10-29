/**
 * Maximum permitted PDF file size: 32 Megabytes (33,554,432 bytes).
 * Enforced BEFORE reading the file into browser memory to prevent client freeze.
 */
export const MAX_PDF_SIZE_BYTES = 32 * 1024 * 1024; // 33,554,432 bytes

// PDF Header magic bytes: '%PDF-' in ASCII: 0x25, 0x50, 0x44, 0x46, 0x2D
export const PDF_HEADER_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

// PDF Trailer end-of-file marker: '%%EOF' in ASCII: 0x25, 0x25, 0x45, 0x4F, 0x46
export const PDF_TRAILER_MAGIC = new Uint8Array([0x25, 0x25, 0x45, 0x4f, 0x46]);

export const TRAILER_SEARCH_WINDOW_BYTES = 1024;

export interface PdfValidationResult {
  valid: boolean;
  error?: string;
  headerValid?: boolean;
  trailerValid?: boolean;
}

export interface PdfHashResult {
  documentHash: `0x${string}`;
  sizeBytes: number;
}

/**
 * Validates PDF container format heuristics on raw byte buffer:
 * 1. Offset 0 must match '%PDF-' (magic bytes 0x25 0x50 0x44 0x46 0x2D).
 * 2. Final 1,024 bytes (or full buffer if smaller) must contain '%%EOF' (0x25 0x25 0x45 0x4F 0x46).
 *
 * NOTE: These are container format checks only. They verify standard PDF framing markers,
 * but do NOT perform full structural syntax parsing or a malware/embedded-script assessment.
 */
export function validatePdfFormatHeuristics(bytes: Uint8Array): PdfValidationResult {
  if (bytes.length < PDF_HEADER_MAGIC.length) {
    return {
      valid: false,
      error: 'Invalid PDF format: File is too small to contain a valid PDF header.',
      headerValid: false,
      trailerValid: false,
    };
  }

  // 1. Header Magic Check at Offset 0
  let headerValid = true;
  for (let i = 0; i < PDF_HEADER_MAGIC.length; i++) {
    if (bytes[i] !== PDF_HEADER_MAGIC[i]) {
      headerValid = false;
      break;
    }
  }

  if (!headerValid) {
    return {
      valid: false,
      error: "Invalid PDF format: Missing '%PDF-' header marker at offset 0. File does not appear to be a PDF container.",
      headerValid: false,
      trailerValid: false,
    };
  }

  // 2. Trailer EOF Check within final 1,024 bytes
  const scanStart = Math.max(0, bytes.length - TRAILER_SEARCH_WINDOW_BYTES);
  const trailerWindow = bytes.subarray(scanStart);
  let trailerValid = false;

  for (let i = 0; i <= trailerWindow.length - PDF_TRAILER_MAGIC.length; i++) {
    let match = true;
    for (let j = 0; j < PDF_TRAILER_MAGIC.length; j++) {
      if (trailerWindow[i + j] !== PDF_TRAILER_MAGIC[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      trailerValid = true;
      break;
    }
  }

  if (!trailerValid) {
    return {
      valid: false,
      error: "Invalid PDF format: Missing '%%EOF' trailer marker within final 1,024 bytes. File may be truncated or corrupted.",
      headerValid: true,
      trailerValid: false,
    };
  }

  return {
    valid: true,
    headerValid: true,
    trailerValid: true,
  };
}
