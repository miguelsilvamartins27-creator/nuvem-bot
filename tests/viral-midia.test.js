import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
    validarArquivoAudio,
    nomeSeguroAudio,
    limparArquivosPasta,
    MIN_BYTES_AUDIO
} from '../lib/viral/midia.js';

let pasta;

function audioMp3Falso(bytes = 2048) {
    return Buffer.concat([
        Buffer.from('ID3'),
        Buffer.alloc(bytes)
    ]);
}

before(async () => {
    pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'viral-midia-'));
});

after(async () => {
    await fs.rm(pasta, { recursive: true, force: true });
});

describe('validarArquivoAudio', () => {
    it('arquivo inexistente é rejeitado', async () => {
        const resultado = await validarArquivoAudio(path.join(pasta, 'nao-existe.mp3'));

        assert.equal(resultado.ok, false);
        assert.equal(resultado.motivo, 'inexistente');
    });

    it('arquivo vazio é rejeitado', async () => {
        const caminho = path.join(pasta, 'vazio.mp3');
        await fs.writeFile(caminho, Buffer.alloc(0));

        const resultado = await validarArquivoAudio(caminho);

        assert.equal(resultado.ok, false);
        assert.equal(resultado.motivo, 'vazio');
    });

    it('arquivo pequeno demais é tratado como vazio', async () => {
        const caminho = path.join(pasta, 'minimo.mp3');
        await fs.writeFile(caminho, Buffer.alloc(MIN_BYTES_AUDIO - 1, 1));

        const resultado = await validarArquivoAudio(caminho);

        assert.equal(resultado.ok, false);
        assert.equal(resultado.motivo, 'vazio');
    });

    it('mp3 válido é aceito pelo conteúdo, não pela extensão', async () => {
        const caminho = path.join(pasta, 'valido.bin');
        await fs.writeFile(caminho, audioMp3Falso());

        const resultado = await validarArquivoAudio(caminho);

        assert.equal(resultado.ok, true);
        assert.equal(resultado.mime, 'audio/mpeg');
        assert.equal(resultado.ext, 'mp3');
    });

    it('arquivo de texto com extensão de áudio é rejeitado', async () => {
        const caminho = path.join(pasta, 'falso.mp3');
        await fs.writeFile(caminho, Buffer.from('isto nao e audio '.repeat(100)));

        const resultado = await validarArquivoAudio(caminho);

        assert.equal(resultado.ok, false);
        assert.equal(resultado.motivo, 'invalido');
    });

    it('arquivo acima do limite máximo é rejeitado', async () => {
        const caminho = path.join(pasta, 'grande.mp3');
        await fs.writeFile(caminho, audioMp3Falso());

        const resultado = await validarArquivoAudio(caminho, { maxBytes: 1024 });

        assert.equal(resultado.ok, false);
        assert.equal(resultado.motivo, 'grande');
    });

    it('diretório no lugar de arquivo é rejeitado', async () => {
        const caminho = path.join(pasta, 'pasta.mp3');
        await fs.mkdir(caminho);

        const resultado = await validarArquivoAudio(caminho);

        assert.equal(resultado.ok, false);
        assert.equal(resultado.motivo, 'nao-arquivo');
    });
});

describe('nomeSeguroAudio', () => {
    it('remove caracteres perigosos e preserva acentos', () => {
        assert.equal(
            nomeSeguroAudio('Construção / Ao Vivo: "top"'),
            'Construção  Ao Vivo top'
        );
    });

    it('limita a 80 caracteres', () => {
        assert.equal(nomeSeguroAudio('a'.repeat(200)).length, 80);
    });

    it('título vazio vira audio', () => {
        assert.equal(nomeSeguroAudio('///'), 'audio');
    });

    it('título ausente vira null', () => {
        assert.equal(nomeSeguroAudio(null), null);
        assert.equal(nomeSeguroAudio(''), null);
    });
});

describe('limparArquivosPasta', () => {
    it('remove todos os arquivos da pasta', async () => {
        const alvo = path.join(pasta, 'limpeza');
        await fs.mkdir(alvo);

        await fs.writeFile(path.join(alvo, 'a.mp3'), audioMp3Falso());
        await fs.writeFile(path.join(alvo, 'b.webm.part'), Buffer.alloc(10));

        const antes = await fs.readdir(alvo);
        assert.equal(antes.length, 2);

        await limparArquivosPasta(alvo);

        const depois = await fs.readdir(alvo);
        assert.equal(depois.length, 0);
    });

    it('não quebra com pasta inexistente ou vazia', async () => {
        await limparArquivosPasta(null);
        await limparArquivosPasta(path.join(pasta, 'nao-existe'));
    });
});
