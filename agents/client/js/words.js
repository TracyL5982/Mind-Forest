/**
 * The words a card draws that are not the item's own: a name for a title that is missing, the
 * count of what a card leaves out, the names of a side, a kind, a tone and a voice. Each is here
 * once in English and once in Chinese, and a card takes the set that matches its item, so a
 * Chinese card is Chinese throughout. A footprint is worked out with the same words the card draws.
 * docs/libraries.md repeats the table.
 */
const WORDS = {
  en: {
    untitled: 'Untitled',
    more: (count) => `and ${count} more`,
    moreOf: (rows, columns) => `and ${[rows > 0 && `${rows} more row${rows === 1 ? '' : 's'}`, columns > 0 && `${columns} more column${columns === 1 ? '' : 's'}`].filter(Boolean).join(', ')}`,
    others: ' and others',
    pros: 'For',
    cons: 'Against',
    paper: 'Paper',
    book: 'Book',
    caution: 'Caution',
    note: 'Note',
    question: 'Q',
    answer: 'A',
    link: 'link',
    noPicture: 'Picture unavailable',
    noClip: 'This clip has no file to play.',
    noSound: 'This recording has no file to play.',
    noData: 'No data',
    chart: 'Chart',
    done: 'Done',
    notDone: 'Not done',
    tally: (done, count) => `${done} of ${count} done`,
    when: 'When',
    where: 'Where',
    people: 'People',
    origin: 'Origin',
  },
  zh: {
    untitled: '未命名',
    more: (count) => `还有 ${count} 项`,
    moreOf: (rows, columns) => `还有 ${[rows > 0 && `${rows} 行`, columns > 0 && `${columns} 列`].filter(Boolean).join('、')}`,
    others: ' 等',
    pros: '优点',
    cons: '缺点',
    paper: '论文',
    book: '图书',
    caution: '注意',
    note: '备注',
    question: '问',
    answer: '答',
    link: '链接',
    noPicture: '图片无法显示',
    noClip: '这段视频没有可播放的文件。',
    noSound: '这段录音没有可播放的文件。',
    noData: '暂无数据',
    chart: '图表',
    done: '已完成',
    notDone: '未完成',
    tally: (done, count) => `已完成 ${done}/${count}`,
    when: '时间',
    where: '地点',
    people: '人物',
    origin: '来源',
  },
};

const HAN = /\p{Script=Han}/gu;
const LATIN = /[A-Za-z]/g;
/** Web addresses and hex colours are written in Latin letters whatever the language around them, so they are not counted. */
const NOT_WORDS = /\b(?:https?:\/\/|www\.)\S*|#[0-9A-Fa-f]{3,8}\b/g;
const sets = new WeakMap();

/**
 * The words for an item's card: Chinese when its title and text together, without web addresses
 * and hex colours, hold a Han character and no more Latin letters than Han characters, and English
 * otherwise.
 */
export function wordsOf(item) {
  if (!item || typeof item !== 'object') return WORDS.en;
  let words = sets.get(item);
  if (!words) {
    const written = `${typeof item.title === 'string' ? item.title : ''}\n${typeof item.text === 'string' ? item.text : ''}`.replace(NOT_WORDS, ' ');
    const han = written.match(HAN)?.length ?? 0;
    words = han > 0 && (written.match(LATIN)?.length ?? 0) <= han ? WORDS.zh : WORDS.en;
    sets.set(item, words);
  }
  return words;
}
