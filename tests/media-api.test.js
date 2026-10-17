import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const apiUrl = new URL('../lib/app-api.js', import.meta.url);
const htmlUrl = new URL('../app/index.html', import.meta.url);
const jsUrl = new URL('../app/app.js', import.meta.url);

describe('Central de mídia da Nuvem', () => {
  it('expõe rotas privadas para figurinha, vídeo e extração de áudio', async () => {
    const source = await fs.readFile(apiUrl, 'utf8');
    for (const route of ['/api/app/media/sticker', '/api/app/media/sticker-video', '/api/app/media/audio']) {
      const start = source.indexOf("app.post('" + route + "'");
      assert.notEqual(start, -1, 'rota ausente: ' + route);
      const snippet = source.slice(start, start + 550);
      assert.ok(snippet.includes('requireUser'), 'rota sem autenticação: ' + route);
      assert.ok(snippet.includes('limitMedia'), 'rota sem limite de uso: ' + route);
    }
  });

  it('limita tamanho e usa processamento temporário de arquivos', async () => {
    const source = await fs.readFile(apiUrl, 'utf8');
    assert.ok(source.includes('MAX_MEDIA_UPLOAD_BYTES = 12 * 1024 * 1024'));
    assert.ok(source.includes("path.join(os.tmpdir(), 'nuvem-media-'") || source.includes("path.join(os.tmpdir(), 'nuvem-sticker-'"));
    assert.ok(source.includes('await fs.rm(dir, { recursive: true, force: true })'));
  });

  it('interface contém formulários reais ligados às ferramentas', async () => {
    const html = await fs.readFile(htmlUrl, 'utf8');
    const js = await fs.readFile(jsUrl, 'utf8');
    for (const id of ['sticker-editor-file', 'sticker-video-form', 'audio-form', 'audio-search-form']) {
      assert.ok(html.includes('id="' + id + '"'), 'formulário ausente: ' + id);
    }
    assert.ok(js.includes('/api/app/media/sticker-video'));
    assert.ok(js.includes('/api/app/media/audio'));
    assert.ok(js.includes('/api/app/media/search-audio'));
    assert.ok(js.includes('media-audio-player'));
    assert.ok(html.includes('Enviar figurinha ao WhatsApp'));
    assert.ok(html.includes('Remover fundo uniforme'));
    assert.ok(html.includes('sticker-pack-select'));
    assert.ok(js.includes('MAX_STICKERS_PER_PACK = 8'));
    assert.ok(js.includes('removeUniformBackground'));
    assert.ok(html.includes('id="view-figurinhas"'));
  });

  it('a interface mantém o controle de ocultar valores no resumo e nos gráficos', async () => {
    const html = await fs.readFile(htmlUrl, 'utf8');
    const js = await fs.readFile(jsUrl, 'utf8');
    assert.ok(html.includes('id="finance-eye"'));
    assert.ok(js.includes('.expense-amount,.category-chart-amount'));
    assert.ok(js.includes('nuvem-financas.csv'));
  });
});
