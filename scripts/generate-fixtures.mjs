import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256 } from 'viem';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const fixturesDir = path.join(rootDir, 'fixtures');
const contractsFixturesDir = path.join(rootDir, 'contracts', 'test', 'fixtures');

fs.mkdirSync(fixturesDir, { recursive: true });
fs.mkdirSync(contractsFixturesDir, { recursive: true });

// Minimal synthetic PDF (valid PDF-1.4 format, zero personal info, zero external references)
const originalPdfContent =
`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>
endobj
4 0 obj
<< /Length 38 >>
stream
BT
/F1 12 Tf
72 712 Td
(CertProof Synthetic) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000216 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
304
%%EOF
`;

const originalBuffer = Buffer.from(originalPdfContent, 'utf-8');

// Duplicate buffer: exactly identical bytes
const duplicateBuffer = Buffer.from(originalBuffer);

// Modified buffer: exactly one byte changed (offset 274: change '(' to '[')
const modifiedBuffer = Buffer.from(originalBuffer);
const targetOffset = 274;
if (modifiedBuffer[targetOffset] !== 0x28) { // ASCII '('
  throw new Error(`Expected byte 0x28 at offset ${targetOffset}, found 0x${modifiedBuffer[targetOffset].toString(16)}`);
}
modifiedBuffer[targetOffset] = 0x5b; // ASCII '['

// Write files to fixtures/ and contracts/test/fixtures/
const files = [
  { name: 'original.pdf', buffer: originalBuffer },
  { name: 'duplicate.pdf', buffer: duplicateBuffer },
  { name: 'modified.pdf', buffer: modifiedBuffer },
];

for (const file of files) {
  fs.writeFileSync(path.join(fixturesDir, file.name), file.buffer);
  fs.writeFileSync(path.join(contractsFixturesDir, file.name), file.buffer);
}

// Compute Keccak-256 digests using Viem (raw unpadded Keccak-256 matching EVM standard)
const originalHash = keccak256(originalBuffer);
const duplicateHash = keccak256(duplicateBuffer);
const modifiedHash = keccak256(modifiedBuffer);

// Sanity assertions
if (originalHash !== duplicateHash) {
  throw new Error('Assertion failed: original and duplicate hashes do not match!');
}
if (originalHash === modifiedHash) {
  throw new Error('Assertion failed: single byte modification did not alter hash!');
}

const hashesData = {
  specification: 'Raw-byte Keccak-256 (Ethereum EVM Standard 0x20 opcode)',
  generatedAt: new Date().toISOString(),
  files: {
    original: {
      path: 'fixtures/original.pdf',
      sizeBytes: originalBuffer.length,
      keccak256: originalHash,
    },
    duplicate: {
      path: 'fixtures/duplicate.pdf',
      sizeBytes: duplicateBuffer.length,
      keccak256: duplicateHash,
    },
    modified: {
      path: 'fixtures/modified.pdf',
      sizeBytes: modifiedBuffer.length,
      keccak256: modifiedHash,
      byteDifference: {
        offset: targetOffset,
        originalByteHex: '0x' + originalBuffer[targetOffset].toString(16),
        modifiedByteHex: '0x' + modifiedBuffer[targetOffset].toString(16),
      },
    },
  },
};

fs.writeFileSync(path.join(fixturesDir, 'hashes.json'), JSON.stringify(hashesData, null, 2));
fs.writeFileSync(path.join(contractsFixturesDir, 'hashes.json'), JSON.stringify(hashesData, null, 2));

console.log('Fixtures generated successfully:');
console.log(`Original PDF Hash:  ${originalHash} (${originalBuffer.length} bytes)`);
console.log(`Duplicate PDF Hash: ${duplicateHash} (Identical: ${originalHash === duplicateHash})`);
console.log(`Modified PDF Hash:  ${modifiedHash} (Different: ${originalHash !== modifiedHash})`);
