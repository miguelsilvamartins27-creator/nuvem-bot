import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizarComparacao,
    tokenizar,
    extrairCandidatos,
    avaliarCandidato,
    selecionarCandidatos
} from '../lib/viral/candidatos.js';

function criarJson(entries) {
    return {
        entries
    };
}

const ENTRADA_BOA = {
    id: 'B1',
    title: 'Artista - Song X (Official Video)',
    duration: 210,
    channel: 'Artista Oficial',
    webpage_url: 'https://www.youtube.com/watch?v=B1'
};

const ENTRADA_RUIM = {
    id: 'A1',
    title: 'Song X (10 hours loop)',
    duration: 36000,
    channel: 'Canal Ruim',
    webpage_url: 'https://www.youtube.com/watch?v=A1'
};

describe('normalizarComparacao', () => {
    it('remove acentos, pontuação e tags entre parênteses', () => {
        assert.equal(
            normalizarComparacao('Coração (Official Video) [HD]'),
            'coracao'
        );
    });

    it('mantém números', () => {
        assert.equal(
            normalizarComparacao('Musica 2000'),
            'musica 2000'
        );
    });
});

describe('tokenizar', () => {
    it('deduplica e ignora tokens de 1 caractere', () => {
        assert.deepEqual(
            tokenizar('A X X Musica Musica'),
            ['musica']
        );
    });
});

describe('extrairCandidatos', () => {
    it('ignora entradas malformadas sem título ou URL', () => {
        const candidatos = extrairCandidatos(
            criarJson([
                null,
                {},
                { title: 'sem url' },
                { webpage_url: 'https://x/1' },
                ENTRADA_BOA
            ])
        );

        assert.equal(candidatos.length, 1);
        assert.equal(candidatos[0].titulo, ENTRADA_BOA.title);
    });

    it('constrói URL a partir do id quando falta webpage_url', () => {
        const candidatos = extrairCandidatos(
            criarJson([
                { id: 'XYZ', title: 'Musica' }
            ])
        );

        assert.equal(
            candidatos[0].url,
            'https://www.youtube.com/watch?v=XYZ'
        );
    });

    it('respeita o limite', () => {
        const entries = Array.from({ length: 5 }, (_, i) => ({
            id: `V${i}`,
            title: `Musica ${i}`,
            duration: 200
        }));

        assert.equal(extrairCandidatos(criarJson(entries), { limite: 2 }).length, 2);
    });

    it('não quebra sem entries', () => {
        assert.deepEqual(extrairCandidatos(null), []);
        assert.deepEqual(extrairCandidatos({}), []);
    });
});

describe('avaliarCandidato', () => {
    const BOM_NORMALIZADO = {
        titulo: 'Artista - Song X (Official Video)',
        canal: 'Artista Oficial',
        duracao: 210
    };

    const RUIM_NORMALIZADO = {
        titulo: 'Song X (10 hours loop)',
        canal: 'Canal Ruim',
        duracao: 36000
    };

    it('pontua cobertura, frase exata, canal e duração', () => {
        const termo = 'Artista Song X';
        const resultado = avaliarCandidato(
            BOM_NORMALIZADO,
            tokenizar(termo),
            normalizarComparacao(termo)
        );

        assert.ok(resultado.pontuacao >= 80);
        assert.ok(resultado.motivos.some(m => m.includes('frase exata')));
    });

    it('penaliza marcadores de lixo quando não pedidos', () => {
        const termo = 'Song X';
        const resultado = avaliarCandidato(
            RUIM_NORMALIZADO,
            tokenizar(termo),
            normalizarComparacao(termo)
        );

        assert.ok(resultado.motivos.some(m => m.includes('marcador')));
        assert.ok(resultado.motivos.some(m => m.includes('muito longa')));
    });

    it('cobre termos com acentos nos dois lados', () => {
        const termo = 'Coração';
        const resultado = avaliarCandidato(
            {
                titulo: 'Musica Coracao Da Vida',
                canal: null,
                duracao: 180
            },
            tokenizar(termo),
            normalizarComparacao(termo)
        );

        assert.ok(resultado.pontuacao > 0);
    });

    it('duração curta demais é penalizada', () => {
        const termo = 'Musica Teste';
        const resultado = avaliarCandidato(
            {
                titulo: 'Musica Teste',
                canal: null,
                duracao: 10
            },
            tokenizar(termo),
            normalizarComparacao(termo)
        );

        assert.ok(resultado.motivos.some(m => m.includes('curta demais')));
    });
});

describe('selecionarCandidatos', () => {
    it('escolhe a melhor correspondência, não o primeiro resultado', () => {
        const { candidatos } = selecionarCandidatos(
            criarJson([ENTRADA_RUIM, ENTRADA_BOA]),
            'Artista Song X'
        );

        assert.equal(candidatos.length, 2);
        assert.equal(candidatos[0].url, ENTRADA_BOA.webpage_url);
        assert.equal(candidatos[1].url, ENTRADA_RUIM.webpage_url);
    });

    it('desempata de forma determinística pela ordem original', () => {
        const primeira = {
            id: 'P1',
            title: 'Mesma Musica',
            duration: 200
        };

        const segunda = {
            id: 'P2',
            title: 'Mesma Musica',
            duration: 200
        };

        const { candidatos } = selecionarCandidatos(
            criarJson([primeira, segunda]),
            'Mesma Musica'
        );

        assert.equal(candidatos[0].url, 'https://www.youtube.com/watch?v=P1');
        assert.equal(candidatos[1].url, 'https://www.youtube.com/watch?v=P2');
    });

    it('pesquisa sem resultados retorna lista vazia', () => {
        assert.deepEqual(
            selecionarCandidatos(criarJson([]), 'nada').candidatos,
            []
        );
    });

    it('respeita o limite final', () => {
        const entries = Array.from({ length: 5 }, (_, i) => ({
            id: `V${i}`,
            title: `Musica ${i}`,
            duration: 200
        }));

        const { candidatos } = selecionarCandidatos(
            criarJson(entries),
            'Musica',
            { limite: 3 }
        );

        assert.equal(candidatos.length, 3);
    });
});
