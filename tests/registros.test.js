import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    LIMITE_DESCRICAO,
    sanitizarDescricao,
    criarRegistro,
    registrosDoDia,
    ultimosRegistros,
    localizarParaExclusao
} from '../lib/registros.js';

describe('LIMITE_DESCRICAO', () => {
    it('é 300', () => {
        assert.equal(LIMITE_DESCRICAO, 300);
    });
});

describe('sanitizarDescricao', () => {
    it('remove espaços nas bordas', () => {
        assert.equal(sanitizarDescricao('  corrida  '), 'corrida');
    });

    it('trunca em 300 caracteres', () => {
        const texto = 'a'.repeat(500);
        assert.equal(sanitizarDescricao(texto).length, 300);
    });

    it('retorna null para descrição curta ou vazia', () => {
        assert.equal(sanitizarDescricao('a'), null);
        assert.equal(sanitizarDescricao(''), null);
        assert.equal(sanitizarDescricao('   '), null);
        assert.equal(sanitizarDescricao(null), null);
        assert.equal(sanitizarDescricao(undefined), null);
    });

    it('aceita exatamente 2 caracteres', () => {
        assert.equal(sanitizarDescricao('ok'), 'ok');
    });
});

describe('criarRegistro', () => {
    it('cria registro com id, data ISO, descrição e tipo', () => {
        const agora = 1776000000000;
        const registro = criarRegistro('corrida', 'treino', agora);

        assert.equal(registro.id, agora);
        assert.equal(registro.data, new Date(agora).toISOString());
        assert.equal(registro.descricao, 'corrida');
        assert.equal(registro.tipo, 'treino');
    });
});

describe('registrosDoDia', () => {
    it('filtra apenas registros do dia informado', () => {
        const hoje = new Date('2026-10-16T12:00:00');
        const ontem = new Date('2026-10-15T12:00:00');

        const lista = [
            criarRegistro('ontem', 'treino', ontem.getTime()),
            criarRegistro('hoje cedo', 'treino', new Date('2026-10-16T08:00:00').getTime()),
            criarRegistro('hoje tarde', 'refeicao', new Date('2026-10-16T20:00:00').getTime())
        ];

        const resultado = registrosDoDia(lista, hoje);

        assert.equal(resultado.length, 2);
        assert.equal(resultado[0].descricao, 'hoje cedo');
        assert.equal(resultado[1].descricao, 'hoje tarde');
    });

    it('retorna lista vazia para entrada inválida', () => {
        assert.deepEqual(registrosDoDia(null), []);
        assert.deepEqual(registrosDoDia(undefined), []);
        assert.deepEqual(registrosDoDia({}), []);
    });
});

describe('ultimosRegistros', () => {
    it('retorna os últimos N registros, mais recente primeiro', () => {
        const lista = [1, 2, 3, 4, 5].map(n =>
            criarRegistro(`registro${n}`, 'treino', n)
        );

        const resultado = ultimosRegistros(lista, 3);

        assert.equal(resultado.length, 3);
        assert.equal(resultado[0].descricao, 'registro5');
        assert.equal(resultado[1].descricao, 'registro4');
        assert.equal(resultado[2].descricao, 'registro3');
    });

    it('usa 10 como quantidade padrão', () => {
        const lista = Array.from({ length: 15 }, (_, i) =>
            criarRegistro(`registro${i}`, 'treino', i + 1)
        );

        assert.equal(ultimosRegistros(lista).length, 10);
    });

    it('retorna lista vazia para entrada inválida', () => {
        assert.deepEqual(ultimosRegistros(null), []);
        assert.deepEqual(ultimosRegistros('texto'), []);
    });
});

describe('localizarParaExclusao', () => {
    const lista = [
        criarRegistro('mais antigo', 'treino', 1),
        criarRegistro('meio', 'treino', 2),
        criarRegistro('mais recente', 'treino', 3)
    ];

    it('número 1 aponta para o mais recente', () => {
        const resultado = localizarParaExclusao(lista, 1);

        assert.equal(resultado.indice, 2);
        assert.equal(resultado.registro.descricao, 'mais recente');
    });

    it('número igual ao tamanho aponta para o mais antigo', () => {
        const resultado = localizarParaExclusao(lista, 3);

        assert.equal(resultado.indice, 0);
        assert.equal(resultado.registro.descricao, 'mais antigo');
    });

    it('retorna null para número fora do intervalo', () => {
        assert.equal(localizarParaExclusao(lista, 4), null);
        assert.equal(localizarParaExclusao(lista, 0), null);
        assert.equal(localizarParaExclusao(lista, -1), null);
    });

    it('retorna null para número não inteiro', () => {
        assert.equal(localizarParaExclusao(lista, 1.5), null);
        assert.equal(localizarParaExclusao(lista, NaN), null);
        assert.equal(localizarParaExclusao(lista, '1'), null);
    });

    it('retorna null para lista inválida', () => {
        assert.equal(localizarParaExclusao(null, 1), null);
        assert.equal(localizarParaExclusao(undefined, 1), null);
    });
});
