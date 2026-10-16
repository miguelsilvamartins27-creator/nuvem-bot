import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    interpretarEntrada,
    montarTermoBusca
} from '../lib/viral/entrada.js';

describe('interpretarEntrada', () => {
    it('sem argumento é vazio', () => {
        assert.equal(interpretarEntrada(undefined).tipo, 'vazio');
        assert.equal(interpretarEntrada('').tipo, 'vazio');
        assert.equal(interpretarEntrada('   ').tipo, 'vazio');
        assert.equal(interpretarEntrada('\n\t ').tipo, 'vazio');
    });

    it('apenas caracteres de controle é vazio', () => {
        assert.equal(interpretarEntrada('\u0007\u0007').tipo, 'vazio');
    });

    it('URL http/https é aceita', () => {
        assert.equal(
            interpretarEntrada('https://www.youtube.com/watch?v=abc').tipo,
            'url'
        );

        assert.equal(
            interpretarEntrada('http://exemplo.com/audio').tipo,
            'url'
        );
    });

    it('URL com protocolo não suportado é inválida', () => {
        assert.equal(interpretarEntrada('ftp://exemplo.com/x').tipo, 'url-invalida');
        assert.equal(interpretarEntrada('rtmp://exemplo.com/x').tipo, 'url-invalida');
    });

    it('domínio sem protocolo é link inválido', () => {
        assert.equal(interpretarEntrada('www.youtube.com/watch?v=a').tipo, 'url-invalida');
        assert.equal(interpretarEntrada('youtube.com/watch?v=a').tipo, 'url-invalida');
    });

    it('protocolo sem endereço é link inválido', () => {
        assert.equal(interpretarEntrada('http://').tipo, 'url-invalida');
    });

    it('termo de texto preserva acentos e colapsa espaços', () => {
        const entrada = interpretarEntrada('  Evidências   da  Vida ');

        assert.equal(entrada.tipo, 'texto');
        assert.equal(entrada.valor, 'Evidências da Vida');
    });

    it('remove caracteres de controle do texto', () => {
        const entrada = interpretarEntrada('a\u0007b\u0000c');

        assert.equal(entrada.tipo, 'texto');
        assert.equal(entrada.valor, 'a b c');
    });

    it('trunca termos muito longos em 200 caracteres', () => {
        const entrada = interpretarEntrada('x'.repeat(500));

        assert.equal(entrada.tipo, 'texto');
        assert.equal(entrada.valor.length, 200);
    });

    it('ponto em nome comum não vira link inválido', () => {
        assert.equal(interpretarEntrada('nome.da.musica').tipo, 'texto');
        assert.equal(interpretarEntrada('8.8.8.8').tipo, 'texto');
    });
});

describe('montarTermoBusca', () => {
    it('normaliza sem destruir caracteres musicais', () => {
        assert.equal(
            montarTermoBusca('  Chico   Buarque – Construção (ao vivo) '),
            'Chico Buarque – Construção (ao vivo)'
        );
    });
});
