import { grid } from './shared.js';

export const name = 'Cluster';

export const title = (group) => group.props.theme || group.title;

export const arrange = (group, ids, sizes) => grid(ids, sizes, { columns: ids.length <= 4 ? 2 : 3, gap: 8 });
