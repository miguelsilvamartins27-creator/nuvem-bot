import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    TIPOS_ERRO_IA,
    categorizarErro,
    extrairRetrySegundos
} from '../lib/ia/erros.js';

describe('extrairRetrySegundos', () => {
    it('usa retryAfterSegundos quando presente', () => {
        assert.equal(
            extrairRetrySegundos({ retryAfterSegundos: 42 }),
            42
        );
    });

    it('extrai "try again in Xs" da mensagem', () => {
        const erro = {
            mensagem:
                'Rate limit reached. Please try again in 7.2s.'
        };

        assert.equal(extrairRetrySegundos(erro), 8);
    });

    it('extrai "try again in Xm Ys" da mensagem', () => {
        const erro = {
            mensagem:
                'Rate limit reached. Please try again in 1m30.5s.'
        };

        assert.equal(extrairRetrySegundos(erro), 91);
    });

    it('extrai retryDelay do corpo (Gemini)', () => {
        const erro = {
            corpo: {
                error: {
                    code: 429,
                    status: 'RESOURCE_EXHAUSTED',
                    details: [
                        {
                            '@type':
                                'type.googleapis.com/google.rpc.RetryInfo',
                            retryDelay: '35s'
                        }
                    ]
                }
            }
        };

        assert.equal(extrairRetrySegundos(erro), 35);
    });

    it('extrai retry-after textual como fallback', () => {
        const erro = {
            mensagem: 'Too many requests, retry-after: 12'
        };

        assert.equal(extrairRetrySegundos(erro), 12);
    });

    it('limita valores absurdos a 6 horas', () => {
        assert.equal(
            extrairRetrySegundos({ retryAfterSegundos: 999999 }),
            21600
        );
    });

    it('retorna null quando não há informação', () => {
        assert.equal(extrairRetrySegundos({}), null);
        assert.equal(extrairRetrySegundos(null), null);
        assert.equal(
            extrairRetrySegundos({
                mensagem: 'erro qualquer'
            }),
            null
        );
    });
});

describe('categorizarErro', () => {
    it('trata 429 de RPM como limite_minuto', () => {
        const info = categorizarErro({
            status: 429,
            mensagem:
                'Rate limit reached for model on requests per minute (RPM). Please try again in 7.2s.'
        });

        assert.equal(info.tipo, TIPOS_ERRO_IA.LIMITE_MINUTO);
        assert.equal(info.retrySegundos, 8);
    });

    it('trata 429 de RPD como limite_dia', () => {
        const info = categorizarErro({
            status: 429,
            mensagem:
                'Rate limit reached for model on requests per day (RPD).'
        });

        assert.equal(info.tipo, TIPOS_ERRO_IA.LIMITE_DIA);
    });

    it('trata quota diária do Gemini como limite_dia', () => {
        const info = categorizarErro({
            status: 429,
            mensagem:
                'Quota exceeded for quota metric generate_content_free_tier_requests',
            corpo: {
                error: {
                    code: 429,
                    status: 'RESOURCE_EXHAUSTED',
                    details: [
                        {
                            quotaId:
                                'GenerateRequestsPerDayPerProjectPerModel-FreeTier'
                        }
                    ]
                }
            }
        });

        assert.equal(info.tipo, TIPOS_ERRO_IA.LIMITE_DIA);
    });

    it('trata RESOURCE_EXHAUSTED sem status como limite', () => {
        const info = categorizarErro({
            mensagem: 'RESOURCE_EXHAUSTED'
        });

        assert.equal(info.tipo, TIPOS_ERRO_IA.LIMITE_MINUTO);
    });

    it('trata 401 e 403 como auth', () => {
        assert.equal(
            categorizarErro({ status: 401 }).tipo,
            TIPOS_ERRO_IA.AUTH
        );

        assert.equal(
            categorizarErro({ status: 403 }).tipo,
            TIPOS_ERRO_IA.AUTH
        );

        assert.equal(
            categorizarErro({
                status: 400,
                mensagem: 'UNAUTHENTICATED: invalid key'
            }).tipo,
            TIPOS_ERRO_IA.AUTH
        );
    });

    it('trata 402 como financeiro', () => {
        assert.equal(
            categorizarErro({
                status: 402,
                mensagem: 'insufficient credits'
            }).tipo,
            TIPOS_ERRO_IA.FINANCEIRO
        );
    });

    it('trata 404 como modelo_indisponivel', () => {
        assert.equal(
            categorizarErro({ status: 404 }).tipo,
            TIPOS_ERRO_IA.MODELO_INDISPONIVEL
        );
    });

    it('trata "model does not exist" como modelo_indisponivel', () => {
        assert.equal(
            categorizarErro({
                status: 400,
                mensagem:
                    'The model `qwen/qwen3.8-27b` does not exist'
            }).tipo,
            TIPOS_ERRO_IA.MODELO_INDISPONIVEL
        );
    });

    it('trata imagem grande/inválida como imagem_invalida', () => {
        assert.equal(
            categorizarErro({
                status: 400,
                mensagem:
                    'image is too large or invalid'
            }).tipo,
            TIPOS_ERRO_IA.IMAGEM_INVALIDA
        );

        assert.equal(
            categorizarErro({
                mensagem:
                    'Formato de imagem não suportado pelo Gemini (esperado data URL).'
            }).tipo,
            TIPOS_ERRO_IA.IMAGEM_INVALIDA
        );
    });

    it('trata 5xx como temporario', () => {
        assert.equal(
            categorizarErro({ status: 503 }).tipo,
            TIPOS_ERRO_IA.TEMPORARIO
        );

        assert.equal(
            categorizarErro({
                status: 500,
                mensagem: 'internal error'
            }).tipo,
            TIPOS_ERRO_IA.TEMPORARIO
        );
    });

    it('trata AbortError e timeout como temporario', () => {
        const abortado = {
            erroOriginal: {
                name: 'AbortError',
                message: 'The operation was aborted'
            }
        };

        assert.equal(
            categorizarErro(abortado).tipo,
            TIPOS_ERRO_IA.TEMPORARIO
        );

        assert.equal(
            categorizarErro({
                mensagem: 'request timeout'
            }).tipo,
            TIPOS_ERRO_IA.TEMPORARIO
        );
    });

    it('trata falha de rede como rede', () => {
        assert.equal(
            categorizarErro({
                erroOriginal: {
                    name: 'TypeError',
                    message: 'fetch failed'
                }
            }).tipo,
            TIPOS_ERRO_IA.REDE
        );

        assert.equal(
            categorizarErro({
                mensagem: 'getaddrinfo ENOTFOUND api.groq.com'
            }).tipo,
            TIPOS_ERRO_IA.REDE
        );
    });

    it('trata erro desconhecido como desconhecido', () => {
        assert.equal(
            categorizarErro({}).tipo,
            TIPOS_ERRO_IA.DESCONHECIDO
        );

        assert.equal(
            categorizarErro(null).tipo,
            TIPOS_ERRO_IA.DESCONHECIDO
        );
    });
});
