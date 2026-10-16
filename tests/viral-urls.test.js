import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    enderecoPrivado,
    validarUrlViral
} from '../lib/viral/urls.js';

describe('enderecoPrivado', () => {
    it('reconhece loopback e indefinidos', () => {
        assert.equal(enderecoPrivado('127.0.0.1'), true);
        assert.equal(enderecoPrivado('0.0.0.0'), true);
        assert.equal(enderecoPrivado('::1'), true);
        assert.equal(enderecoPrivado('::'), true);
        assert.equal(enderecoPrivado(''), true);
    });

    it('reconhece faixas privadas IPv4', () => {
        assert.equal(enderecoPrivado('10.0.0.1'), true);
        assert.equal(enderecoPrivado('172.16.0.1'), true);
        assert.equal(enderecoPrivado('172.31.255.255'), true);
        assert.equal(enderecoPrivado('192.168.1.1'), true);
        assert.equal(enderecoPrivado('169.254.169.254'), true);
    });

    it('aceita IPs públicos IPv4', () => {
        assert.equal(enderecoPrivado('8.8.8.8'), false);
        assert.equal(enderecoPrivado('172.32.0.1'), false);
        assert.equal(enderecoPrivado('1.1.1.1'), false);
    });

    it('reconhece faixas privadas IPv6', () => {
        assert.equal(enderecoPrivado('fc00::1'), true);
        assert.equal(enderecoPrivado('fd12:3456:789a::1'), true);
        assert.equal(enderecoPrivado('fe80::1'), true);
    });

    it('trata IPv4 mapeado em IPv6', () => {
        assert.equal(enderecoPrivado('::ffff:192.168.1.1'), true);
        assert.equal(enderecoPrivado('::ffff:8.8.8.8'), false);
        assert.equal(enderecoPrivado('::ffff:127.0.0.1'), true);
        assert.equal(enderecoPrivado('::ffff:7f00:1'), true);
    });

    it('reconhece faixas bloqueadas adicionais IPv6', () => {
        assert.equal(enderecoPrivado('64:ff9b::7f00:1'), true);
        assert.equal(enderecoPrivado('2002:7f00:1::'), true);
        assert.equal(enderecoPrivado('2001:db8::1'), true);
        assert.equal(enderecoPrivado('ff02::1'), true);
    });

    it('aceita IPv6 público', () => {
        assert.equal(enderecoPrivado('2606:4700:4700::1111'), false);
    });
});

describe('validarUrlViral', () => {
    it('formato inválido é rejeitado', async () => {
        const resultado = await validarUrlViral('nao e url');

        assert.equal(resultado.ok, false);
        assert.equal(resultado.motivo, 'formato');
    });

    it('localhost e IPs privados literais são rejeitados', async () => {
        for (const alvo of [
            'http://localhost:3000/video',
            'http://127.0.0.1/video',
            'http://10.0.0.5/video',
            'http://192.168.0.10/video',
            'http://[::1]/video'
        ]) {
            const resultado = await validarUrlViral(alvo);

            assert.equal(resultado.ok, false, alvo);
            assert.equal(resultado.motivo, 'privado', alvo);
        }
    });

    it('IPv6 privados, locais, reservados e mapeados são rejeitados', async () => {
        for (const alvo of [
            'http://[fd00::1]/video',
            'http://[fe80::1]/video',
            'http://[::ffff:127.0.0.1]/video',
            'http://[2001:db8::1]/video'
        ]) {
            const resultado = await validarUrlViral(alvo, {
                resolver: async () => {
                    throw new Error('literal não deve consultar DNS');
                }
            });

            assert.equal(resultado.ok, false, alvo);
            assert.equal(resultado.motivo, 'privado', alvo);
        }
    });

    it('IPv6 público literal é aceito', async () => {
        const resultado = await validarUrlViral(
            'http://[2606:4700:4700::1111]/video'
        );

        assert.equal(resultado.ok, true);
    });

    it('host que resolve para IP privado é rejeitado (proteção SSRF)', async () => {
        const resultado = await validarUrlViral(
            'http://musica.exemplo.com/video',
            {
                resolver: async () => [
                    { address: '10.1.2.3' }
                ]
            }
        );

        assert.equal(resultado.ok, false);
        assert.equal(resultado.motivo, 'privado');
    });

    it('host público é aceito', async () => {
        const resultado = await validarUrlViral(
            'https://www.youtube.com/watch?v=abc',
            {
                resolver: async () => [
                    { address: '142.250.79.46' },
                    { address: '2606:4700::1111' }
                ]
            }
        );

        assert.equal(resultado.ok, true);
        assert.equal(resultado.url, 'https://www.youtube.com/watch?v=abc');
    });

    it('resolver único sem array também funciona', async () => {
        const resultado = await validarUrlViral(
            'https://exemplo.com/audio',
            {
                resolver: async () => ({ address: '8.8.8.8' })
            }
        );

        assert.equal(resultado.ok, true);
    });

    it('URL com credenciais embutidas é rejeitada', async () => {
        const resultado = await validarUrlViral(
            'https://usuario:senha@exemplo.com/audio'
        );

        assert.equal(resultado.ok, false);
        assert.equal(resultado.motivo, 'credenciais');
    });

    it('falha de DNS é reportada', async () => {
        const resultado = await validarUrlViral(
            'https://nao-resolve.exemplo.com/audio',
            {
                resolver: async () => {
                    throw new Error('ENOTFOUND');
                }
            }
        );

        assert.equal(resultado.ok, false);
        assert.equal(resultado.motivo, 'dns');
    });
});
