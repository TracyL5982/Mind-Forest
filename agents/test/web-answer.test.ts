import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openaiWebAnswer } from '../src/node/web-answer.ts';

const ANSWER =
  'WORN runs until 21 March 2027, and Willem de Kooning at Work until 17 January 2027. ' +
  '([rijksmuseum.nl](https://www.rijksmuseum.nl/en/whats-on?filter=now-on-view&utm_source=openai)) ' +
  'Tickets are €25 ([rijksmuseum.nl](https://www.rijksmuseum.nl/en/tickets?utm_source=openai)) ([iamsterdam.com](https://www.iamsterdam.com/en/rijks?utm_source=openai)), under 18 free.';

function cites(text: string, url: string) {
  const span = `](${url})`;
  const end = text.indexOf(span) + span.length + 1;
  return { type: 'url_citation', start_index: text.lastIndexOf('([', end), end_index: end, url, title: 'A page' };
}

const READ = ['https://www.rijksmuseum.nl/en/whats-on/exhibitions/worn', 'https://www.rijksmuseum.nl/en/visit'];

/** The Responses API as it answers: the pages a search read come back only when the request asks for them. */
function responses(text: string, annotations: object[]): typeof fetch {
  return async (_url, init) => {
    const asked = JSON.parse(String(init?.body)) as { include?: string[] };
    const sources = asked.include?.includes('web_search_call.action.sources') ? READ.map((url) => ({ type: 'url', url: `${url}?utm_source=openai` })) : undefined;
    return new Response(
      JSON.stringify({
        output: [
          { type: 'web_search_call', action: { type: 'search', query: 'Rijksmuseum exhibitions', sources } },
          { type: 'message', content: [{ type: 'output_text', text, annotations }] },
        ],
        usage: { input_tokens: 1000, output_tokens: 100 },
      }),
    );
  };
}

test('a web answer reaches Momo without its citations, and the log keeps the pages it cited and read', async () => {
  const lines: string[] = [];
  const annotations = [
    cites(ANSWER, 'https://www.rijksmuseum.nl/en/whats-on?filter=now-on-view&utm_source=openai'),
    cites(ANSWER, 'https://www.rijksmuseum.nl/en/tickets?utm_source=openai'),
    cites(ANSWER, 'https://www.iamsterdam.com/en/rijks?utm_source=openai'),
  ];
  const heard = await openaiWebAnswer(responses(ANSWER, annotations), { apiKey: 'k', log: (line) => lines.push(line) })("What's on at the Rijksmuseum?");
  assert.equal(heard, 'WORN runs until 21 March 2027, and Willem de Kooning at Work until 17 January 2027. Tickets are €25, under 18 free.');
  assert.equal(lines.length, 1, 'one line per answer');
  const [, cited, read] = lines[0]!.split(' | ');
  assert.equal(cited, 'cited https://www.rijksmuseum.nl/en/whats-on?filter=now-on-view https://www.rijksmuseum.nl/en/tickets https://www.iamsterdam.com/en/rijks');
  assert.equal(read, `read ${READ.join(' ')}`, 'every page the search read, without its tracking tag');
});

test('an answer that cites nothing still logs the pages its search read', async () => {
  const lines: string[] = [];
  const heard = await openaiWebAnswer(responses('WORN is on until 21 March 2027.', []), { apiKey: 'k', log: (line) => lines.push(line) })('Is WORN on?');
  assert.equal(heard, 'WORN is on until 21 March 2027.');
  assert.match(lines[0]!, / \| cited nothing \| read https:\/\/www\.rijksmuseum\.nl\/en\/whats-on\/exhibitions\/worn https:\/\/www\.rijksmuseum\.nl\/en\/visit$/);
});
