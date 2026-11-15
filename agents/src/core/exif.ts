import type { LatLon } from './ports.ts';

const GPS_IFD = 0x8825;
const TAG = { latRef: 1, lat: 2, lonRef: 3, lon: 4 } as const;
const RATIONAL = 5;
const ASCII = 2;

/**
 * Where a JPEG was taken, from the GPS block of its Exif data, or null when it has none or the data
 * is damaged. Reads only the segment headers and the few entries it needs, never the picture.
 */
export function gpsOf(bytes: Uint8Array): LatLon | null {
  try {
    const exif = exifSegment(bytes);
    if (!exif) return null;
    const tiff = new Tiff(exif);
    const gps = tiff.entries(tiff.u32(4)).get(GPS_IFD);
    if (gps === undefined) return null;
    const tags = tiff.entries(tiff.u32(gps.at + 8));
    const lat = degrees(tiff, tags.get(TAG.lat), tiff.letter(tags.get(TAG.latRef)), 'N', 'S', 90);
    const lon = degrees(tiff, tags.get(TAG.lon), tiff.letter(tags.get(TAG.lonRef)), 'E', 'W', 180);
    return lat === null || lon === null ? null : { lat, lon };
  } catch {
    return null;
  }
}

/** The TIFF block inside the APP1 segment that starts `Exif\0\0`, or null. */
function exifSegment(bytes: Uint8Array): DataView | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0) !== 0xffd8) return null;
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]!;
    // Start of scan: the picture follows, and no Exif segment comes after it.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = view.getUint16(at + 2);
    const start = at + 4;
    if (marker === 0xe1 && length >= 14 && String.fromCharCode(...bytes.subarray(start, start + 6)) === 'Exif\0\0') {
      return new DataView(bytes.buffer, bytes.byteOffset + start + 6, Math.min(length - 8, bytes.length - start - 6));
    }
    at += 2 + length;
  }
  return null;
}

interface Entry {
  /** Where the entry starts, from the start of the TIFF block. */
  at: number;
  type: number;
  count: number;
}

class Tiff {
  private readonly little: boolean;

  constructor(private readonly view: DataView) {
    const order = view.getUint16(0);
    if (order !== 0x4949 && order !== 0x4d4d) throw new Error('not TIFF');
    this.little = order === 0x4949;
    if (this.u16(2) !== 42) throw new Error('not TIFF');
  }

  u16(at: number): number {
    return this.view.getUint16(at, this.little);
  }

  u32(at: number): number {
    return this.view.getUint32(at, this.little);
  }

  /** The entries of the directory at `at`, by tag. */
  entries(at: number): Map<number, Entry> {
    const found = new Map<number, Entry>();
    const count = this.u16(at);
    for (let n = 0; n < count; n++) {
      const entry = at + 2 + n * 12;
      found.set(this.u16(entry), { at: entry, type: this.u16(entry + 2), count: this.u32(entry + 4) });
    }
    return found;
  }

  /** The first letter of a short ASCII value, which sits inside the entry itself. */
  letter(entry: Entry | undefined): string {
    return entry && entry.type === ASCII && entry.count >= 1 ? String.fromCharCode(this.view.getUint8(entry.at + 8)) : '';
  }

  /** The `n`th of the entry's rationals, which sit where the entry points, because three never fit in four bytes. */
  rational(entry: Entry, n: number): number {
    const at = this.u32(entry.at + 8) + n * 8;
    const below = this.u32(at + 4);
    if (below === 0) throw new Error('zero denominator');
    return this.u32(at) / below;
  }
}

/** Degrees, minutes and seconds as one signed number, or null when the entry is missing, the side unknown or the value out of range. */
function degrees(tiff: Tiff, entry: Entry | undefined, side: string, plus: string, minus: string, most: number): number | null {
  if (!entry || entry.type !== RATIONAL || entry.count < 3 || (side !== plus && side !== minus)) return null;
  const value = tiff.rational(entry, 0) + tiff.rational(entry, 1) / 60 + tiff.rational(entry, 2) / 3600;
  if (!Number.isFinite(value) || value > most) return null;
  return side === minus ? -value : value;
}
