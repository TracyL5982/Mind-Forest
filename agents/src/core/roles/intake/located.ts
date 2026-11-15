import type { Item } from '../../domain.ts';
import { gpsOf } from '../../exif.ts';
import type { LatLon } from '../../ports.ts';
import type { RoleContext } from '../types.ts';

/** `data.at` when it holds a point on the earth. */
export function atOf(value: unknown): LatLon | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { lat, lon } = value as Record<string, unknown>;
  const inRange = (v: unknown, most: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= most;
  return inRange(lat, 90) && inRange(lon, 180) ? { lat, lon } : undefined;
}

/**
 * The items with `data.at` written where Intake can tell where they are: a JPEG's own GPS coordinates first, and otherwise, when maps
 * are on, a lookup of `data.where`. A photo is read on the machine, so it is located whether or not maps are on.
 */
export async function located(ctx: RoleContext, items: Item[]): Promise<Item[]> {
  return Promise.all(items.map(async (item) => {
    if (atOf(item.data.at)) return item;
    const at = (await photographed(ctx, item)) ?? (await looked(ctx, item));
    return at ? { ...item, data: { ...item.data, at } } : item;
  }));
}

async function photographed(ctx: RoleContext, item: Item): Promise<LatLon | null> {
  if (item.kind !== 'image' || !item.source.asset) return null;
  const file = await ctx.assets.get(item.source.asset).catch(() => null);
  return file && file.mime === 'image/jpeg' ? gpsOf(file.bytes) : null;
}

async function looked(ctx: RoleContext, item: Item): Promise<LatLon | null> {
  const where = typeof item.data.where === 'string' ? item.data.where.trim() : '';
  return where && ctx.tools.geocoder ? atOf(await ctx.tools.geocoder.locate(where)) ?? null : null;
}
