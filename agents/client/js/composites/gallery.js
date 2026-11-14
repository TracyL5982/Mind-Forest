import { grid, squarish } from './shared.js';

export const name = 'Gallery';

export const arrange = (group, ids, sizes) => grid(ids, sizes, { columns: Number(group.props.columns) || squarish(ids.length), gap: 12 });
