import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localFileName, parseFontCss, renderLocalCss } from './fetch-fonts.ts';

// Trecho no formato real devolvido pelo Google Fonts (um por faixa de caracteres).
const SAMPLE = `
/* cyrillic */
@font-face {
  font-family: 'VT323';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/vt323/v17/cyr.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F;
}
/* latin-ext */
@font-face {
  font-family: 'VT323';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/vt323/v17/ext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5;
}
/* latin */
@font-face {
  font-family: 'Pixelify Sans';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/pixelifysans/v1/lat.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
`;

test('lê só latim e latim estendido, com peso variável e faixa de caracteres', () => {
  const faces = parseFontCss(SAMPLE);
  assert.deepEqual(faces.map((f) => [f.family, f.subset, f.weight]), [
    ['VT323', 'latin-ext', '400'],
    ['Pixelify Sans', 'latin', '400 700'],
  ]);
  assert.equal(faces[0]?.url, 'https://fonts.gstatic.com/s/vt323/v17/ext.woff2');
  assert.equal(faces[1]?.unicodeRange, 'U+0000-00FF, U+0131');
});

test('gera nomes de arquivo e CSS local', () => {
  const faces = parseFontCss(SAMPLE);
  assert.equal(localFileName(faces[1] as (typeof faces)[number]), 'pixelify-sans-latin-400-700.woff2');
  const css = renderLocalCss(faces);
  assert.match(css, /font-family: 'Pixelify Sans';/);
  assert.match(css, /src: url\('\.\/pixelify-sans-latin-400-700\.woff2'\) format\('woff2'\);/);
  assert.match(css, /unicode-range: U\+0000-00FF, U\+0131;/);
  assert.doesNotMatch(css, /gstatic/);
});

test('CSS vazio ou sem woff2 não gera fontes', () => {
  assert.deepEqual(parseFontCss(''), []);
  assert.deepEqual(parseFontCss("/* latin */ @font-face { font-family: 'X'; src: url(a.ttf) format('truetype'); }"), []);
});
