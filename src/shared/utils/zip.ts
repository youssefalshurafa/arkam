// A minimal ZIP writer for packing already-built files into one download.
//
// Entries are STORED, not deflated: everything this is used for (.xlsx workbooks) is itself a
// deflated zip, so compressing again would cost time for no size gain.
//
// Written by hand rather than reusing SheetJS's bundled zip writer because that one masks every
// filename character to 7 bits (`charCodeAt(j) & 0x7F`), which turns Arabic organization and
// client names into garbage. Here names are written as UTF-8 with general-purpose flag bit 11
// set, which is what tells Windows Explorer, macOS Archive Utility, 7-Zip and unzip to read them
// as UTF-8 instead of the legacy DOS code page.
//
// No ZIP64: a workspace export stays far below 4 GB and 65,535 entries, and createZip throws
// rather than writing a corrupt archive if that ever stops being true.

export type ZipEntry = {
 // Forward-slash separated, no leading slash (e.g. "Org/Client.xlsx"). Folders are implied by the
 // paths — every extractor creates them on the way — so no separate directory entries are written.
 path: string;
 data: Uint8Array;
};

const UTF8_NAME_FLAG = 0x0800;
const VERSION = 20; // 2.0: the baseline every extractor understands for stored entries.
const MAX_UINT32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
 if (crcTable) return crcTable;
 const table = new Uint32Array(256);
 for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c >>> 0;
 }
 crcTable = table;
 return table;
}

export function crc32(data: Uint8Array): number {
 const table = getCrcTable();
 let crc = 0xffffffff;
 for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
 return (crc ^ 0xffffffff) >>> 0;
}

// MS-DOS date/time in the writer's local time — what extractors show as the file's modified time.
function dosDateTime(date: Date): { time: number; date: number } {
 const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
 return {
  time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
  date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
 };
}

export function createZip(entries: ZipEntry[], modified: Date = new Date()): Uint8Array<ArrayBuffer> {
 if (entries.length > MAX_ENTRIES) throw new Error(`Too many files for one ZIP (${entries.length}).`);
 const encoder = new TextEncoder();
 const { time, date } = dosDateTime(modified);

 const prepared = entries.map((entry) => ({
  name: encoder.encode(entry.path.replace(/\\/g, '/').replace(/^\/+/, '')),
  data: entry.data,
  crc: crc32(entry.data),
 }));

 const localSize = prepared.reduce((sum, e) => sum + 30 + e.name.length + e.data.length, 0);
 const centralSize = prepared.reduce((sum, e) => sum + 46 + e.name.length, 0);
 const total = localSize + centralSize + 22;
 if (total > MAX_UINT32) throw new Error('The export is too large for one ZIP file.');

 const out = new Uint8Array(new ArrayBuffer(total));
 const view = new DataView(out.buffer);
 let offset = 0;
 const u16 = (value: number) => {
  view.setUint16(offset, value, true);
  offset += 2;
 };
 const u32 = (value: number) => {
  view.setUint32(offset, value >>> 0, true);
  offset += 4;
 };
 const bytes = (value: Uint8Array) => {
  out.set(value, offset);
  offset += value.length;
 };

 const localOffsets: number[] = [];
 for (const e of prepared) {
  localOffsets.push(offset);
  u32(0x04034b50); // local file header signature
  u16(VERSION); // version needed to extract
  u16(UTF8_NAME_FLAG);
  u16(0); // method: stored
  u16(time);
  u16(date);
  u32(e.crc);
  u32(e.data.length); // compressed size (stored, so the same)
  u32(e.data.length); // uncompressed size
  u16(e.name.length);
  u16(0); // extra field length
  bytes(e.name);
  bytes(e.data);
 }

 const centralStart = offset;
 prepared.forEach((e, index) => {
  u32(0x02014b50); // central directory header signature
  u16(VERSION); // version made by (MS-DOS host)
  u16(VERSION); // version needed to extract
  u16(UTF8_NAME_FLAG);
  u16(0); // method: stored
  u16(time);
  u16(date);
  u32(e.crc);
  u32(e.data.length);
  u32(e.data.length);
  u16(e.name.length);
  u16(0); // extra field length
  u16(0); // comment length
  u16(0); // disk number start
  u16(0); // internal attributes
  u32(0); // external attributes
  u32(localOffsets[index]);
  bytes(e.name);
 });

 u32(0x06054b50); // end of central directory signature
 u16(0); // this disk
 u16(0); // disk with the central directory
 u16(prepared.length);
 u16(prepared.length);
 u32(centralSize);
 u32(centralStart);
 u16(0); // comment length

 return out;
}
