import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    criarControleDownload,
    criarDeduplicador
} from '../lib/viral/controle.js';

describe('criarControleDownload', () => {
    it('permite apenas um download ativo por vez', () => {
        const controle = criarControleDownload();

        assert.equal(controle.tentarIniciar('a'), true);
        assert.equal(controle.tentarIniciar('b'), false);
        assert.equal(controle.estaAtivo(), true);
        assert.equal(controle.idAtivo(), 'a');
    });

    it('libera após finalizar', () => {
        const controle = criarControleDownload();

        controle.tentarIniciar('a');
        controle.finalizar();

        assert.equal(controle.estaAtivo(), false);
        assert.equal(controle.idAtivo(), null);
        assert.equal(controle.tentarIniciar('b'), true);
    });

    it('múltiplas solicitações concorrentes: só uma inicia', () => {
        const controle = criarControleDownload();
        const aceitos = [];

        for (const id of ['u1', 'u2', 'u3']) {
            if (controle.tentarIniciar(id)) {
                aceitos.push(id);
            }
        }

        assert.deepEqual(aceitos, ['u1']);

        controle.finalizar();

        assert.equal(controle.tentarIniciar('u3'), true);
    });
});

describe('criarDeduplicador', () => {
    it('detecta mensagens duplicadas', () => {
        const dedup = criarDeduplicador();

        assert.equal(dedup.jaVisto('MSG1'), false);

        dedup.marcar('MSG1');

        assert.equal(dedup.jaVisto('MSG1'), true);
        assert.equal(dedup.jaVisto('MSG2'), false);
    });

    it('ignora ids vazios', () => {
        const dedup = criarDeduplicador();

        dedup.marcar(null);

        assert.equal(dedup.jaVisto(null), false);
    });

    it('respeita o limite removendo o mais antigo', () => {
        const dedup = criarDeduplicador(3);

        for (const id of ['a', 'b', 'c', 'd']) {
            dedup.marcar(id);
        }

        assert.equal(dedup.jaVisto('a'), false);
        assert.equal(dedup.jaVisto('b'), true);
        assert.equal(dedup.jaVisto('d'), true);
    });

    it('processamento de mensagem duplicada ocorre uma única vez', () => {
        const dedup = criarDeduplicador();
        const processadas = [];

        const processar = id => {
            if (dedup.jaVisto(id)) {
                return false;
            }

            dedup.marcar(id);
            processadas.push(id);

            return true;
        };

        assert.equal(processar('XYZ'), true);
        assert.equal(processar('XYZ'), false);
        assert.deepEqual(processadas, ['XYZ']);
    });
});
