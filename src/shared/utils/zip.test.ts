import { describe, expect, it } from 'vitest';
import { crc32, createZip } from './zip';

// A minimal reader that follows the archive the way an extractor does: end-of-central-directory
// record → central directory → each entry's local header → its data.
function readZip(zip: Uint8Array) {
 const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
 const decoder = new TextDecoder();
 const eocd = zip.length - 22;
 expect(view.getUint32(eocd, true)).toBe(0x06054b50);
 const count = view.getUint16(eocd + 10, true);
 const centralSize = view.getUint32(eocd + 12, true);
 const centralStart = view.getUint32(eocd + 16, true);
 expect(centralStart + centralSize).toBe(eocd);

 const entries: Array<{ name: string; flags: number; crc: number; data: Uint8Array }> = [];
 let p = centralStart;
 for (let i = 0; i < count; i++) {
  expect(view.getUint32(p, true)).toBe(0x02014b50);
  const flags = view.getUint16(p + 8, true);
  const crc = view.getUint32(p + 16, true);
  const size = view.getUint32(p + 24, true);
  const nameLength = view.getUint16(p + 28, true);
  const localOffset = view.getUint32(p + 42, true);
  const name = decoder.decode(zip.subarray(p + 46, p + 46 + nameLength));

  expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
  expect(view.getUint16(localOffset + 8, true)).toBe(0); // stored
  const localNameLength = view.getUint16(localOffset + 26, true);
  expect(decoder.decode(zip.subarray(localOffset + 30, localOffset + 30 + localNameLength))).toBe(name);
  const dataStart = localOffset + 30 + localNameLength + view.getUint16(localOffset + 28, true);
  entries.push({ name, flags, crc, data: zip.subarray(dataStart, dataStart + size) });
  p += 46 + nameLength;
 }
 return entries;
}

describe('crc32', () => {
 it('matches the standard check value', () => {
  expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array())).toBe(0);
 });
});

describe('createZip', () => {
 it('round-trips files, keeping non-ASCII (Arabic) paths as UTF-8', () => {
  const encoder = new TextEncoder();
  const files = [
   { path: 'المعاملات.xlsx', data: encoder.encode('transactions') },
   { path: 'شركة النور/أحمد.xlsx', data: encoder.encode('ledger of أحمد') },
   { path: 'Unassigned/Client.xlsx', data: new Uint8Array([0, 1, 2, 255]) },
  ];
  const entries = readZip(createZip(files));
  expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.path));
  entries.forEach((entry, index) => {
   expect(entry.flags & 0x0800).toBe(0x0800);
   expect(Array.from(entry.data)).toEqual(Array.from(files[index].data));
   expect(entry.crc).toBe(crc32(files[index].data));
  });
 });

 it('normalises backslashes and leading slashes in paths', () => {
  const entries = readZip(createZip([{ path: '\\Org\\Client.xlsx', data: new Uint8Array([1]) }]));
  expect(entries[0].name).toBe('Org/Client.xlsx');
 });

 it('writes a valid empty archive', () => {
  expect(readZip(createZip([]))).toEqual([]);
 });
});
