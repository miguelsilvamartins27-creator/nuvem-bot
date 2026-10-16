import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    PROVEDORES_IA,
    extrairTexto,
    extrairUso,
    montarRequisicao,
    validarModelo
} from '../lib/ia/adaptadores.js';

describe('validarModelo', () => {
    it('aceita modelos :free no OpenRouter', () => {
        assert.equal(
            validarModelo('openrouter', 'qwen/qwen3.8-27b:free').ok,
            true
        );

        assert.equal(
            validarModelo('openrouter', 'openrouter/free').ok,
            true
        );
    });

    it('bloqueia modelo pago no OpenRouter sem autorização', () => {
        const resultado =
            validarModelo('openrouter', 'openai/gpt-5');

        assert.equal(resultado.ok, false);
        assert.match(resultado.motivo, /:free/);
    });

    it('libera modelo pago no OpenRouter com IA_PERMITIR_PAGO', () => {
        assert.equal(
            validarModelo('openrouter', 'openai/gpt-5', true).ok,
            true
        );
    });

    it('não restringe Groq e Gemini', () => {
        assert.equal(
            validarModelo('groq', 'openai/gpt-oss-120b').ok,
            true
        );

        assert.equal(
            validarModelo('gemini', 'gemini-2.5-flash').ok,
            true
        );
    });

    it('rejeita modelo vazio', () => {
        assert.equal(validarModelo('groq', '').ok, false);
        assert.equal(validarModelo('groq', null).ok, false);
    });
});

describe('montarRequisicao - Groq', () => {
    it('monta payload OpenAI-compatible', () => {
        const requisicao = montarRequisicao('groq', {
            modelo: 'openai/gpt-oss-120b',
            mensagens: [
                { role: 'user', content: 'oi' }
            ],
            temperatura: 0.7,
            maxTokens: 2048,
            chave: 'chave-teste'
        });

        assert.equal(
            requisicao.url,
            'https://api.groq.com/openai/v1/chat/completions'
        );

        assert.equal(
            requisicao.headers.Authorization,
            'Bearer chave-teste'
        );

        assert.equal(
            requisicao.body.model,
            'openai/gpt-oss-120b'
        );

        assert.equal(requisicao.body.temperature, 0.7);
        assert.equal(requisicao.body.max_tokens, 2048);
        assert.deepEqual(requisicao.body.messages, [
            { role: 'user', content: 'oi' }
        ]);
    });
});

describe('montarRequisicao - OpenRouter', () => {
    it('monta payload com headers opcionais', () => {
        const requisicao = montarRequisicao('openrouter', {
            modelo: 'openrouter/free',
            mensagens: [
                { role: 'user', content: 'oi' }
            ],
            chave: 'chave-teste',
            extras: {
                referer: 'https://exemplo.com',
                titulo: 'Bot'
            }
        });

        assert.equal(
            requisicao.url,
            'https://openrouter.ai/api/v1/chat/completions'
        );

        assert.equal(
            requisicao.headers['HTTP-Referer'],
            'https://exemplo.com'
        );

        assert.equal(requisicao.headers['X-Title'], 'Bot');
    });

    it('omite headers opcionais quando ausentes', () => {
        const requisicao = montarRequisicao('openrouter', {
            modelo: 'openrouter/free',
            mensagens: [],
            chave: 'chave-teste'
        });

        assert.equal(
            requisicao.headers['HTTP-Referer'],
            undefined
        );

        assert.equal(requisicao.headers['X-Title'], undefined);
    });
});

describe('montarRequisicao - Gemini', () => {
    it('converte system, histórico e imagem', () => {
        const requisicao = montarRequisicao('gemini', {
            modelo: 'gemini-2.5-flash',
            mensagens: [
                {
                    role: 'system',
                    content: 'Você é um assistente.'
                },
                {
                    role: 'user',
                    content: 'pergunta anterior'
                },
                {
                    role: 'assistant',
                    content: 'resposta anterior'
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'o que tem na foto?'
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url:
                                    'data:image/jpeg;base64,QUJD'
                            }
                        }
                    ]
                }
            ],
            temperatura: 0.4,
            maxTokens: 1024,
            chave: 'chave-teste'
        });

        assert.match(
            requisicao.url,
            /models\/gemini-2\.5-flash:generateContent$/
        );

        assert.equal(
            requisicao.headers['x-goog-api-key'],
            'chave-teste'
        );

        assert.equal(
            requisicao.body.systemInstruction.parts[0].text,
            'Você é um assistente.'
        );

        assert.equal(requisicao.body.contents.length, 3);
        assert.equal(requisicao.body.contents[0].role, 'user');
        assert.equal(requisicao.body.contents[1].role, 'model');
        assert.deepEqual(
            requisicao.body.contents[1].parts,
            [{ text: 'resposta anterior' }]
        );

        const ultima = requisicao.body.contents[2];

        assert.deepEqual(ultima.parts[0], {
            text: 'o que tem na foto?'
        });

        assert.deepEqual(ultima.parts[1], {
            inlineData: {
                mimeType: 'image/jpeg',
                data: 'QUJD'
            }
        });

        assert.equal(
            requisicao.body.generationConfig.temperature,
            0.4
        );

        assert.equal(
            requisicao.body.generationConfig.maxOutputTokens,
            1024
        );
    });

    it('rejeita imagem que não é data URL', () => {
        assert.throws(
            () =>
                montarRequisicao('gemini', {
                    modelo: 'gemini-2.5-flash',
                    mensagens: [
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'image_url',
                                    image_url: {
                                        url: 'https://exemplo.com/foto.jpg'
                                    }
                                }
                            ]
                        }
                    ],
                    chave: 'chave-teste'
                }),
            /imagem não suportado/i
        );
    });
});

describe('montarRequisicao - erros', () => {
    it('rejeita provedor desconhecido', () => {
        assert.throws(
            () =>
                montarRequisicao('xpto', {
                    modelo: 'x',
                    chave: 'y'
                }),
            /desconhecido/i
        );
    });

    it('rejeita modelo ou chave ausentes', () => {
        assert.throws(
            () =>
                montarRequisicao('groq', {
                    modelo: '',
                    chave: 'y'
                }),
            /Modelo de IA ausente/
        );

        assert.throws(
            () =>
                montarRequisicao('groq', {
                    modelo: 'x',
                    chave: ''
                }),
            /Chave de API ausente/
        );
    });

    it('lista os provedores conhecidos', () => {
        assert.deepEqual(PROVEDORES_IA, [
            'groq',
            'gemini',
            'openrouter'
        ]);
    });
});

describe('extrairTexto', () => {
    it('extrai de resposta OpenAI-compatible', () => {
        assert.equal(
            extrairTexto('groq', {
                choices: [
                    { message: { content: '  olá  ' } }
                ]
            }),
            'olá'
        );
    });

    it('extrai de resposta Gemini', () => {
        assert.equal(
            extrairTexto('gemini', {
                candidates: [
                    {
                        content: {
                            parts: [
                                { text: 'parcial 1 ' },
                                { text: 'parcial 2' }
                            ]
                        }
                    }
                ]
            }),
            'parcial 1 parcial 2'
        );
    });

    it('retorna null para resposta vazia ou bloqueada', () => {
        assert.equal(extrairTexto('groq', {}), null);

        assert.equal(
            extrairTexto('groq', {
                choices: [{ message: { content: '   ' } }]
            }),
            null
        );

        assert.equal(
            extrairTexto('gemini', { candidates: [] }),
            null
        );
    });
});

describe('extrairUso', () => {
    it('extrai tokens OpenAI-compatible', () => {
        assert.deepEqual(
            extrairUso('groq', {
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 5
                }
            }),
            { entrada: 10, saida: 5 }
        );
    });

    it('extrai tokens Gemini', () => {
        assert.deepEqual(
            extrairUso('gemini', {
                usageMetadata: {
                    promptTokenCount: 3,
                    candidatesTokenCount: 2
                }
            }),
            { entrada: 3, saida: 2 }
        );
    });

    it('retorna null quando não há uso', () => {
        assert.equal(extrairUso('groq', {}), null);
        assert.equal(extrairUso('gemini', {}), null);
    });
});
