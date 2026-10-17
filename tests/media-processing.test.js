import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import sharp from 'sharp';
import { montarAppPessoal } from '../lib/app-api.js';

describe('Conversão real da Central de mídia', () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = express();
    app.use(express.json({ limit: '32kb' }));
    const supabase = {
      auth: {
        getUser: async token => token === 'test-token'
          ? { data: { user: { id: 'test-user', email: 'allowed@example.test' } }, error: null }
          : { data: { user: null }, error: new Error('Sessão inválida') }
      }
    };
    montarAppPessoal(app, {
      getSupabase: () => supabase,
      getAiRouter: () => ({ executar: async () => ({ texto: 'teste' }) }),
      sendWhatsAppSticker: async buffer => { if (!Buffer.isBuffer(buffer)) throw new Error('Buffer inválido'); },
      env: {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_ANON_KEY: 'test-anon-key',
        APP_ALLOWED_EMAIL: 'allowed@example.test'
      }
    });
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.once('error', reject);
    });
    baseUrl = 'http://127.0.0.1:' + server.address().port;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  it('recusa conversão sem login antes de aceitar o arquivo', async () => {
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const response = await fetch(baseUrl + '/api/app/media/sticker', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: image
    });
    assert.equal(response.status, 401);
  });

  it('converte uma imagem PNG real para WEBP e retorna arquivo válido', async () => {
    const image = await sharp({ create: { width: 32, height: 24, channels: 4, background: { r: 20, g: 200, b: 80, alpha: 1 } } }).png().toBuffer();
    const response = await fetch(baseUrl + '/api/app/media/sticker', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'image/png' },
      body: image
    });
    if (response.status !== 200) throw new Error('Falha na conversão: ' + response.status + ' ' + await response.text().catch(() => ''));
    assert.match(response.headers.get('content-type') || '', /image\/webp/i);
    const result = Buffer.from(await response.arrayBuffer());
    assert.ok(result.length > 20);
    assert.deepEqual([...result.subarray(0, 4)], [0x52, 0x49, 0x46, 0x46]);
    assert.equal(result.toString('ascii', 8, 12), 'WEBP');
  });


  it('envia uma figurinha WEBP válida para o WhatsApp conectado', async () => {
    const image = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 20, g: 200, b: 80, alpha: 1 } } }).webp().toBuffer();
    const response = await fetch(baseUrl + '/api/app/media/sticker/send', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'image/webp' },
      body: image
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  });

  it('recusa envio de arquivo que não seja WEBP', async () => {
    const response = await fetch(baseUrl + '/api/app/media/sticker/send', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/octet-stream' },
      body: Buffer.from('não é webp')
    });
    assert.equal(response.status, 415);
  });

  it('rejeita conteúdo que não é uma imagem sem derrubar o servidor', async () => {
    const response = await fetch(baseUrl + '/api/app/media/sticker', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/octet-stream' },
      body: Buffer.from('isto não é uma imagem')
    });
    assert.equal(response.status, 415);
    const body = await response.json();
    assert.match(body.error, /imagem compatível/i);
  });
});
