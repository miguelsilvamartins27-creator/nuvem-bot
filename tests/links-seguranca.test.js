import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const CAMINHO_INDEX = new URL('../index.js', import.meta.url);

async function blocoDaFuncao(nome) {
    const fonte = await fs.readFile(CAMINHO_INDEX, 'utf8');
    const inicio = fonte.indexOf(`function ${nome}(`);

    assert.notEqual(inicio, -1, `função ${nome} não encontrada`);

    const restante = fonte.slice(inicio);
    const fim = restante.slice(1).search(/\n(?:async )?function /);

    return fim === -1 ? restante : restante.slice(0, fim + 1);
}

describe('portões de segurança dos links em produção', () => {
    it('/audio valida o link com validarUrlViral (e não apenas urlPublicaSegura)', async () => {
        const bloco = await blocoDaFuncao('comandoAudio');

        assert.ok(bloco.includes('validarUrlViral('));
        assert.ok(!bloco.includes('urlPublicaSegura('));
    });

    it('/viral revalida o link imediatamente antes do download', async () => {
        const bloco = await blocoDaFuncao('comandoViral');

        assert.ok(bloco.includes('const revalidacao'));
        assert.ok(bloco.includes('textoLinkRecusado('));
    });
});
