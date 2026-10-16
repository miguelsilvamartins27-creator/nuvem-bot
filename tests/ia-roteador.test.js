import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    ErroRoteador,
    criarRoteador,
    mensagemErroRoteador,
    normalizarOrdem
} from '../lib/ia/roteador.js';

const PROVEDORES_PADRAO = {
    groq: {
        chave: 'chave-groq',
        modeloTexto: 'modelo-texto-groq',
        modeloVisao: 'modelo-visao-groq'
    },
    gemini: {
        chave: 'chave-gemini',
        modeloTexto: 'gemini-2.5-flash',
        modeloVisao: 'gemini-2.5-flash'
    },
    openrouter: {
        chave: 'chave-openrouter',
        modeloTexto: 'openrouter/free',
        modeloVisao: 'openrouter/free'
    }
};

function criarRelogio(inicial = 1700000000000) {
    let atual = inicial;

    return {
        agora: () => atual,
        avancar: (ms) => {
            atual += ms;
        }
    };
}

function respostaJson(corpo, status = 200, headers = {}) {
    return new Response(JSON.stringify(corpo), {
        status,
        headers: {
            'content-type': 'application/json',
            ...headers
        }
    });
}

function respostaOpenAI(texto, status = 200) {
    return respostaJson(
        {
            choices: [
                { message: { content: texto } }
            ],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 5
            }
        },
        status
    );
}

function respostaGemini(texto, status = 200) {
    return respostaJson(
        {
            candidates: [
                {
                    content: {
                        parts: [{ text: texto }]
                    }
                }
            ],
            usageMetadata: {
                promptTokenCount: 3,
                candidatesTokenCount: 2
            }
        },
        status
    );
}

function respostaErro(mensagem, status, headers = {}) {
    return respostaJson(
        {
            error: { message: mensagem }
        },
        status,
        headers
    );
}

function criarFetchFila(lista) {
    const fila = [...lista];
    const chamadas = [];

    const fn = async (url, opcoes) => {
        chamadas.push({
            url,
            body: opcoes?.body
                ? JSON.parse(opcoes.body)
                : null
        });

        if (!fila.length) {
            throw new Error(`fetch inesperado: ${url}`);
        }

        const item = fila.shift();

        if (item instanceof Error) {
            throw item;
        }

        return item;
    };

    return {
        fn,
        chamadas
    };
}

function congelar(valor) {
    if (valor && typeof valor === 'object') {
        Object.freeze(valor);

        for (const item of Object.values(valor)) {
            congelar(item);
        }
    }

    return valor;
}

function criarBase(extra = {}) {
    const relogio = criarRelogio();

    const fetch = criarFetchFila(extra.fila || []);

    const logs = [];

    const roteador = criarRoteador({
        provedores: extra.provedores || PROVEDORES_PADRAO,
        texto: extra.texto,
        visao: extra.visao,
        tentativasPorProvedor: extra.tentativas ?? 2,
        esperaBackoffMs: 0,
        esperar: async () => {},
        agora: relogio.agora,
        fetchFn: fetch.fn,
        log: (mensagem) => logs.push(String(mensagem)),
        limites: extra.limites || {},
        limitesDuros: extra.limitesDuros || false,
        persistencia: extra.persistencia || null,
        permitirPago: extra.permitirPago || false,
        cooldowns: extra.cooldowns
    });

    return {
        roteador,
        chamadas: fetch.chamadas,
        logs,
        relogio
    };
}

const MENSAGENS = [
    { role: 'user', content: 'oi' }
];

describe('normalizarOrdem', () => {
    it('normaliza, remove desconhecidos e duplicados', () => {
        assert.deepEqual(
            normalizarOrdem('GROQ, gemini ,xpto, groq'),
            ['groq', 'gemini']
        );
    });

    it('aceita array e vazio', () => {
        assert.deepEqual(
            normalizarOrdem(['gemini', 'groq']),
            ['gemini', 'groq']
        );

        assert.deepEqual(normalizarOrdem(''), []);
        assert.deepEqual(normalizarOrdem(null), []);
    });
});

describe('criarRoteador - sucesso', () => {
    it('usa o primeiro provedor da ordem', async () => {
        const { roteador, chamadas } = criarBase({
            fila: [respostaOpenAI('olá')]
        });

        const resultado = await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(resultado.provedor, 'groq');
        assert.equal(resultado.texto, 'olá');
        assert.equal(resultado.modelo, 'modelo-texto-groq');
        assert.deepEqual(resultado.uso, {
            entrada: 10,
            saida: 5
        });

        assert.match(chamadas[0].url, /api\.groq\.com/);
    });

    it('usa o modelo de visão na modalidade visão', async () => {
        const { roteador, chamadas } = criarBase({
            fila: [respostaOpenAI('análise')]
        });

        const mensagens = [
            {
                role: 'user',
                content: 'o que tem na foto?'
            }
        ];

        await roteador.executar({
            modalidade: 'visao',
            mensagens
        });

        assert.equal(
            chamadas[0].body.model,
            'modelo-visao-groq'
        );
    });

    it('não modifica as mensagens recebidas', async () => {
        const { roteador } = criarBase({
            fila: [respostaOpenAI('ok')]
        });

        const mensagens = congelar([
            { role: 'user', content: 'oi' }
        ]);

        const resultado = await roteador.executar({
            mensagens
        });

        assert.equal(resultado.texto, 'ok');
    });

    it('registra uso diário', async () => {
        const { roteador } = criarBase({
            fila: [respostaOpenAI('ok')]
        });

        await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(
            roteador.estado.uso.groq.requisicoes,
            1
        );

        assert.equal(roteador.estado.uso.groq.tokens, 15);
    });
});

describe('criarRoteador - fallback', () => {
    it('cai para o próximo provedor em 429', async () => {
        const { roteador, logs, relogio } = criarBase({
            fila: [
                respostaErro(
                    'Rate limit reached for requests per minute (RPM).',
                    429,
                    { 'retry-after': '30' }
                ),
                respostaGemini('resposta do gemini')
            ]
        });

        const resultado = await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(resultado.provedor, 'gemini');
        assert.equal(resultado.texto, 'resposta do gemini');

        assert.equal(
            roteador.estado.cooldowns.groq.tipo,
            'limite_minuto'
        );

        assert.equal(
            roteador.estado.cooldowns.groq.ate,
            relogio.agora() + 30000
        );

        assert.ok(
            logs.some((m) => m.includes('cooldown 30s'))
        );
    });

    it('pula provedor em cooldown na próxima chamada', async () => {
        const base = criarBase({
            fila: [
                respostaErro('Rate limit (RPM).', 429, {
                    'retry-after': '30'
                }),
                respostaGemini('ok'),
                respostaGemini('ok 2')
            ]
        });

        await base.roteador.executar({
            mensagens: MENSAGENS
        });

        await base.roteador.executar({
            mensagens: MENSAGENS
        });

        assert.match(
            base.chamadas[1].url,
            /generativelanguage\.googleapis\.com/
        );

        assert.match(
            base.chamadas[2].url,
            /generativelanguage\.googleapis\.com/
        );
    });

    it('volta a tentar o provedor após o cooldown', async () => {
        const base = criarBase({
            fila: [
                respostaErro('Rate limit (RPM).', 429, {
                    'retry-after': '30'
                }),
                respostaGemini('ok'),
                respostaOpenAI('voltou')
            ]
        });

        await base.roteador.executar({
            mensagens: MENSAGENS
        });

        base.relogio.avancar(31000);

        const resultado = await base.roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(resultado.provedor, 'groq');
        assert.equal(resultado.texto, 'voltou');
    });

    it('repete erro temporário no mesmo provedor antes do fallback', async () => {
        const { roteador, chamadas } = criarBase({
            fila: [
                respostaErro('internal error', 503),
                respostaErro('internal error', 503),
                respostaGemini('segundo provedor')
            ]
        });

        const resultado = await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(resultado.provedor, 'gemini');
        assert.equal(chamadas.length, 3);
        assert.match(chamadas[0].url, /api\.groq\.com/);
        assert.match(chamadas[1].url, /api\.groq\.com/);
    });

    it('trata resposta vazia como falha e usa o próximo', async () => {
        const { roteador } = criarBase({
            tentativas: 1,
            fila: [
                respostaOpenAI('   '),
                respostaGemini('ok')
            ]
        });

        const resultado = await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(resultado.provedor, 'gemini');
    });

    it('falha de rede cai para o próximo provedor', async () => {
        const { roteador } = criarBase({
            tentativas: 1,
            fila: [
                Object.assign(new Error('fetch failed'), {
                    name: 'TypeError'
                }),
                respostaGemini('ok')
            ]
        });

        const resultado = await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(resultado.provedor, 'gemini');
    });
});

describe('criarRoteador - todos indisponíveis', () => {
    it('lança ErroRoteador com melhorEspera quando todos em limite', async () => {
        const base = criarBase({
            fila: [
                respostaErro('Rate limit (RPM).', 429, {
                    'retry-after': '30'
                }),
                respostaErro('Rate limit (RPM).', 429, {
                    'retry-after': '45'
                }),
                respostaErro('Rate limit (RPM).', 429, {
                    'retry-after': '60'
                })
            ]
        });

        await assert.rejects(
            base.roteador.executar({
                mensagens: MENSAGENS
            }),
            (erro) => {
                assert.equal(erro.roteador, true);
                assert.equal(
                    erro.tipoPredominante,
                    'limite_minuto'
                );

                assert.ok(erro.melhorEspera >= 29);
                assert.ok(erro.melhorEspera <= 30);

                return true;
            }
        );

        const quantidadeChamadas =
            base.chamadas.length;

        await assert.rejects(
            base.roteador.executar({
                mensagens: MENSAGENS
            }),
            (erro) => {
                assert.equal(erro.roteador, true);
                assert.ok(erro.melhorEspera > 0);

                return true;
            }
        );

        assert.equal(
            base.chamadas.length,
            quantidadeChamadas
        );
    });

    it('lança auth quando todas as chaves forem recusadas', async () => {
        const base = criarBase({
            fila: [
                respostaErro('invalid key', 401),
                respostaErro('invalid key', 401),
                respostaErro('invalid key', 401)
            ]
        });

        await assert.rejects(
            base.roteador.executar({
                mensagens: MENSAGENS
            }),
            (erro) => {
                assert.equal(
                    erro.tipoPredominante,
                    'auth'
                );

                return true;
            }
        );

        assert.equal(
            base.roteador.estado.cooldowns.groq.segundos,
            3600
        );
    });

    it('lança modelo_indisponivel com cooldown longo', async () => {
        const base = criarBase({
            fila: [
                respostaErro('model not found', 404),
                respostaGemini('ok')
            ]
        });

        const resultado = await base.roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(resultado.provedor, 'gemini');

        assert.equal(
            base.roteador.estado.cooldowns.groq.segundos,
            86400
        );
    });

    it('sem provedores configurados lança configuracao', async () => {
        const { roteador } = criarBase({
            provedores: {
                groq: { chave: '' },
                gemini: {},
                openrouter: { chave: '' }
            }
        });

        await assert.rejects(
            roteador.executar({
                mensagens: MENSAGENS
            }),
            (erro) => {
                assert.equal(
                    erro.tipoPredominante,
                    'configuracao'
                );

                return true;
            }
        );
    });
});

describe('criarRoteador - guarda de modelo pago (OpenRouter)', () => {
    it('bloqueia modelo pago e lança configuracao', async () => {
        const { roteador } = criarBase({
            provedores: {
                openrouter: {
                    chave: 'k',
                    modeloTexto: 'openai/gpt-5'
                }
            }
        });

        await assert.rejects(
            roteador.executar({
                mensagens: MENSAGENS
            }),
            (erro) => {
                assert.equal(
                    erro.tipoPredominante,
                    'configuracao'
                );

                return true;
            }
        );
    });

    it('libera modelo pago com IA_PERMITIR_PAGO', async () => {
        const { roteador, chamadas } = criarBase({
            permitirPago: true,
            provedores: {
                openrouter: {
                    chave: 'k',
                    modeloTexto: 'openai/gpt-5'
                }
            },
            fila: [respostaOpenAI('ok')]
        });

        const resultado = await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(resultado.provedor, 'openrouter');
        assert.equal(chamadas[0].body.model, 'openai/gpt-5');
    });
});

describe('criarRoteador - cotas', () => {
    it('avisa quando atinge 90% do limite diário configurado', async () => {
        const { roteador, logs } = criarBase({
            limites: { groq: 2 },
            fila: [respostaOpenAI('a'), respostaOpenAI('b')]
        });

        await roteador.executar({
            mensagens: MENSAGENS
        });

        await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.ok(
            logs.some((m) => m.includes('aviso'))
        );
    });

    it('com limitesDuros, pula provedor acima do limite', async () => {
        const { roteador, chamadas } = criarBase({
            limites: { groq: 1 },
            limitesDuros: true,
            fila: [respostaOpenAI('a'), respostaGemini('b')]
        });

        const primeiro = await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(primeiro.provedor, 'groq');

        const segundo = await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(segundo.provedor, 'gemini');

        assert.match(
            chamadas[1].url,
            /generativelanguage\.googleapis\.com/
        );
    });

    it('carrega e salva uso quando persistência habilitada', async () => {
        let salvo = null;

        const { roteador } = criarBase({
            persistencia: {
                carregar: async () => ({
                    groq: {
                        dia: '2023-11-14',
                        requisicoes: 5,
                        tokens: 0
                    }
                }),
                salvar: async (uso) => {
                    salvo = uso;
                }
            },
            fila: [respostaOpenAI('ok')]
        });

        await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(
            roteador.estado.uso.groq.requisicoes,
            6
        );

        assert.equal(salvo.groq.requisicoes, 6);
    });
});

describe('mensagemErroRoteador', () => {
    it('auth cita as variáveis de ambiente', () => {
        const texto = mensagemErroRoteador({
            roteador: true,
            tipoPredominante: 'auth',
            tentativas: [
                { provedor: 'groq', tipo: 'auth' }
            ]
        });

        assert.match(texto, /GROQ_API_KEY/);
        assert.match(texto, /GEMINI_API_KEY/);
        assert.match(texto, /OPENROUTER_API_KEY/);
    });

    it('limite inclui tempo de espera', () => {
        const texto = mensagemErroRoteador({
            roteador: true,
            tipoPredominante: 'limite_minuto',
            melhorEspera: 30,
            tentativas: []
        });

        assert.match(texto, /limite/);
        assert.match(texto, /~30s/);
    });

    it('configuracao explica o guard do OpenRouter', () => {
        const texto = mensagemErroRoteador({
            roteador: true,
            tipoPredominante: 'configuracao',
            tentativas: []
        });

        assert.match(texto, /IA_PERMITIR_PAGO/);
    });

    it('visão com imagem inválida sugere /refeicao', () => {
        const texto = mensagemErroRoteador(
            {
                roteador: true,
                tipoPredominante: 'imagem_invalida',
                tentativas: []
            },
            { visao: true }
        );

        assert.match(texto, /\/refeicao/);
    });

    it('genérico lista provedores tentados', () => {
        const texto = mensagemErroRoteador({
            roteador: true,
            tipoPredominante: 'desconhecido',
            tentativas: [
                { provedor: 'groq', tipo: 'desconhecido' },
                { provedor: 'gemini', tipo: 'desconhecido' }
            ]
        });

        assert.match(texto, /groq, gemini/);
    });
});

describe('ErroRoteador', () => {
    it('carrega marcador roteador para o index diferenciar', () => {
        const erro = new ErroRoteador('teste');

        assert.equal(erro.roteador, true);
        assert.equal(erro.name, 'ErroRoteador');
        assert.ok(erro instanceof Error);
    });
});

describe('criarRoteador - seleção de provedores', () => {
    it('pula provedor sem chave e usa o próximo', async () => {
        const { roteador, chamadas } = criarBase({
            provedores: {
                groq: {
                    chave: '',
                    modeloTexto: 'modelo-groq'
                },
                gemini: {
                    chave: 'k-gemini',
                    modeloTexto: 'gemini-2.5-flash'
                },
                openrouter: {
                    chave: ''
                }
            },
            fila: [respostaGemini('ok')]
        });

        const resultado = await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(resultado.provedor, 'gemini');
        assert.equal(chamadas.length, 1);
        assert.match(
            chamadas[0].url,
            /generativelanguage/
        );
    });

    it('respeita a ordem configurada dos provedores', async () => {
        const { roteador, chamadas } = criarBase({
            texto: 'gemini,groq',
            fila: [respostaGemini('primeiro')]
        });

        const resultado = await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(resultado.provedor, 'gemini');
        assert.match(
            chamadas[0].url,
            /generativelanguage/
        );
    });
});

describe('criarRoteador - erros HTTP', () => {
    it('403 (auth) aplica cooldown de 1h e cai para o próximo', async () => {
        const { roteador } = criarBase({
            fila: [
                respostaErro('forbidden', 403),
                respostaGemini('ok')
            ]
        });

        const resultado = await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(resultado.provedor, 'gemini');

        assert.equal(
            roteador.estado.cooldowns.groq.tipo,
            'auth'
        );

        assert.equal(
            roteador.estado.cooldowns.groq.segundos,
            3600
        );
    });

    it('402 (financeiro) cai para o próximo', async () => {
        const { roteador } = criarBase({
            fila: [
                respostaErro(
                    'insufficient credits',
                    402
                ),
                respostaGemini('ok')
            ]
        });

        const resultado = await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(resultado.provedor, 'gemini');

        assert.equal(
            roteador.estado.cooldowns.groq.tipo,
            'financeiro'
        );
    });

    it('cota diária tem cooldown maior que cota por minuto', async () => {
        const diario = criarBase({
            fila: [
                respostaErro(
                    'Rate limit reached for requests per day (RPD).',
                    429
                ),
                respostaGemini('ok')
            ]
        });

        await diario.roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(
            diario.roteador.estado.cooldowns.groq.tipo,
            'limite_dia'
        );

        assert.equal(
            diario.roteador.estado.cooldowns.groq.segundos,
            1800
        );

        const minuto = criarBase({
            fila: [
                respostaErro(
                    'Rate limit reached for requests per minute (RPM).',
                    429
                ),
                respostaGemini('ok')
            ]
        });

        await minuto.roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(
            minuto.roteador.estado.cooldowns.groq.tipo,
            'limite_minuto'
        );

        assert.equal(
            minuto.roteador.estado.cooldowns.groq.segundos,
            60
        );
    });

    it('respeita retry-after em formato de data', async () => {
        const base = criarBase({
            fila: [
                respostaErro('slow down', 429, {
                    'retry-after': new Date(
                        1700000000000 + 45000
                    ).toUTCString()
                }),
                respostaGemini('ok')
            ]
        });

        await base.roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(
            base.roteador.estado.cooldowns.groq.segundos,
            45
        );

        assert.equal(
            base.roteador.estado.cooldowns.groq.ate,
            1700000000000 + 45000
        );
    });

    it('resposta 200 com JSON inválido cai para o próximo', async () => {
        const { roteador } = criarBase({
            tentativas: 1,
            fila: [
                new Response(
                    'isto-nao-e-json{{{',
                    {
                        status: 200,
                        headers: {
                            'content-type':
                                'application/json'
                        }
                    }
                ),
                respostaGemini('ok')
            ]
        });

        const resultado = await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(resultado.provedor, 'gemini');
    });
});

describe('criarRoteador - timeout', () => {
    it('AbortError aplica cooldown temporário e cai para o próximo', async () => {
        const { roteador } = criarBase({
            tentativas: 1,
            fila: [
                Object.assign(
                    new Error(
                        'This operation was aborted'
                    ),
                    { name: 'AbortError' }
                ),
                respostaGemini('ok')
            ]
        });

        const resultado = await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(resultado.provedor, 'gemini');

        assert.equal(
            roteador.estado.cooldowns.groq.tipo,
            'temporario'
        );

        assert.equal(
            roteador.estado.cooldowns.groq.segundos,
            30
        );
    });
});

describe('criarRoteador - cooldown por modalidade', () => {
    it('erro de visão não bloqueia texto', async () => {
        const base = criarBase({
            fila: [
                respostaErro('model not found', 404),
                respostaGemini('visao ok'),
                respostaOpenAI('texto ok')
            ]
        });

        const visao = await base.roteador.executar({
            modalidade: 'visao',
            mensagens: MENSAGENS
        });

        assert.equal(visao.provedor, 'gemini');

        assert.equal(
            base.roteador.estado.cooldowns['groq:visao']
                .tipo,
            'modelo_indisponivel'
        );

        assert.equal(
            base.roteador.estado.cooldowns.groq,
            undefined
        );

        const texto = await base.roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(texto.provedor, 'groq');
        assert.equal(texto.texto, 'texto ok');

        assert.match(
            base.chamadas[2].url,
            /api\.groq\.com/
        );
    });

    it('erro de auth no texto bloqueia também a visão', async () => {
        const base = criarBase({
            fila: [
                respostaErro('invalid key', 401),
                respostaGemini('texto ok'),
                respostaGemini('visao ok')
            ]
        });

        const texto = await base.roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(texto.provedor, 'gemini');

        assert.equal(
            base.roteador.estado.cooldowns.groq.tipo,
            'auth'
        );

        const visao = await base.roteador.executar({
            modalidade: 'visao',
            mensagens: MENSAGENS
        });

        assert.equal(visao.provedor, 'gemini');

        assert.match(
            base.chamadas[2].url,
            /generativelanguage/
        );
    });
});

describe('criarRoteador - fallback completo e integridade', () => {
    it('groq → gemini → openrouter na mesma requisição', async () => {
        const { roteador, chamadas } = criarBase({
            tentativas: 1,
            fila: [
                respostaErro('Rate limit (RPM).', 429),
                respostaErro('internal error', 503),
                respostaOpenAI('do openrouter')
            ]
        });

        const resultado = await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(resultado.provedor, 'openrouter');
        assert.equal(resultado.texto, 'do openrouter');
        assert.equal(chamadas.length, 3);
        assert.match(chamadas[0].url, /api\.groq\.com/);
        assert.match(
            chamadas[1].url,
            /generativelanguage/
        );
        assert.match(chamadas[2].url, /openrouter\.ai/);
    });

    it('uma falha + um sucesso gera exatamente duas requisições', async () => {
        const { roteador, chamadas } = criarBase({
            tentativas: 1,
            fila: [
                respostaErro('Rate limit (RPM).', 429),
                respostaGemini('ok')
            ]
        });

        const resultado = await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.ok(resultado.texto);
        assert.equal(chamadas.length, 2);
    });

    it('sucesso no primeiro provedor não dispara fallback', async () => {
        const { roteador, chamadas } = criarBase({
            fila: [respostaOpenAI('única')]
        });

        await roteador.executar({
            mensagens: MENSAGENS
        });

        assert.equal(chamadas.length, 1);
    });

    it('mantém as mensagens intactas durante o fallback', async () => {
        const { roteador, chamadas } = criarBase({
            texto: 'groq,openrouter',
            tentativas: 1,
            fila: [
                respostaErro('Rate limit (RPM).', 429),
                respostaOpenAI('ok')
            ]
        });

        const mensagens = congelar([
            { role: 'user', content: 'oi' },
            { role: 'assistant', content: 'olá' },
            { role: 'user', content: 'tudo bem?' }
        ]);

        await roteador.executar({
            mensagens
        });

        assert.match(
            chamadas[1].url,
            /openrouter\.ai/
        );

        assert.deepEqual(chamadas[1].body.messages, [
            { role: 'user', content: 'oi' },
            { role: 'assistant', content: 'olá' },
            { role: 'user', content: 'tudo bem?' }
        ]);
    });
});

describe('criarRoteador - guarda de pagos na visão', () => {
    it('modelo pago não pode ser usado na visão via fallback de modelo', async () => {
        const { roteador, chamadas } = criarBase({
            visao: 'openrouter',
            provedores: {
                openrouter: {
                    chave: 'k',
                    modeloTexto:
                        'anthropic/claude-opus-4',
                    modeloVisao: ''
                }
            }
        });

        await assert.rejects(
            roteador.executar({
                modalidade: 'visao',
                mensagens: MENSAGENS
            }),
            (erro) => {
                assert.equal(
                    erro.tipoPredominante,
                    'configuracao'
                );

                return true;
            }
        );

        assert.equal(chamadas.length, 0);
    });
});
