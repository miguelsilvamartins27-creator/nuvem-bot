import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    classificarErroViral,
    CATEGORIAS_VIRAL
} from '../lib/viral/erros.js';

import {
    calcularEspera,
    baixarComPolitica,
    processarCandidatos,
    TETO_ESPERA_MS
} from '../lib/viral/pipeline.js';

function criarAmbiente({ agora = () => 100000, deadline = null } = {}) {
    const esperas = [];

    return {
        esperas,
        agora,
        deadline,
        esperar: async ms => {
            esperas.push(ms);
        },
        classificar: erro => classificarErroViral(erro, { etapa: 'download' })
    };
}

function erroComClassificacao(mensagem) {
    const erro = new Error(mensagem);
    erro.classificacaoViral = classificarErroViral(erro);

    return erro;
}

describe('calcularEspera', () => {
    it('usa a base da categoria multiplicada pela tentativa', () => {
        assert.equal(calcularEspera({ esperaBaseMs: 2000 }, 1), 2000);
        assert.equal(calcularEspera({ esperaBaseMs: 2000 }, 2), 4000);
    });

    it('respeita o teto', () => {
        assert.equal(calcularEspera({ esperaBaseMs: 8000 }, 5), TETO_ESPERA_MS);
    });

    it('categoria sem espera base não espera', () => {
        assert.equal(calcularEspera({ esperaBaseMs: 0 }, 3), 0);
    });
});

describe('baixarComPolitica', () => {
    it('sucesso imediato faz uma única tentativa', async () => {
        const ambiente = criarAmbiente();
        let chamadas = 0;

        const resultado = await baixarComPolitica({
            ...ambiente,
            tentarBaixar: async () => {
                chamadas++;

                return 'arquivo.mp3';
            }
        });

        assert.equal(resultado, 'arquivo.mp3');
        assert.equal(chamadas, 1);
        assert.deepEqual(ambiente.esperas, []);
    });

    it('falha transitória de rede espera e repete', async () => {
        const ambiente = criarAmbiente();
        let chamadas = 0;

        const resultado = await baixarComPolitica({
            ...ambiente,
            tentarBaixar: async () => {
                chamadas++;

                if (chamadas === 1) {
                    throw new Error('getaddrinfo ENOTFOUND');
                }

                return 'ok';
            }
        });

        assert.equal(resultado, 'ok');
        assert.equal(chamadas, 2);
        assert.deepEqual(ambiente.esperas, [2000]);
    });

    it('erro permanente não é retentado', async () => {
        const ambiente = criarAmbiente();
        let chamadas = 0;

        await assert.rejects(
            baixarComPolitica({
                ...ambiente,
                tentarBaixar: async () => {
                    chamadas++;

                    throw new Error('Private video. Sign in if you have been granted access');
                }
            }),
            erro => {
                assert.equal(
                    erro.classificacaoViral.categoria,
                    CATEGORIAS_VIRAL.RESTRITO
                );

                return true;
            }
        );

        assert.equal(chamadas, 1);
    });

    it('limite de requisições espera e retenta', async () => {
        const ambiente = criarAmbiente();
        let chamadas = 0;

        const resultado = await baixarComPolitica({
            ...ambiente,
            tentarBaixar: async () => {
                chamadas++;

                if (chamadas === 1) {
                    throw new Error('HTTP Error 429: Too Many Requests');
                }

                return 'ok';
            }
        });

        assert.equal(resultado, 'ok');
        assert.equal(chamadas, 2);
        assert.deepEqual(ambiente.esperas, [8000]);
    });

    it('arquivo grande tenta novamente com qualidade reduzida', async () => {
        const ambiente = criarAmbiente();
        const tentativas = [];

        const resultado = await baixarComPolitica({
            ...ambiente,
            tentarBaixar: async ({ qualidadeReduzida }) => {
                tentativas.push(qualidadeReduzida);

                if (!qualidadeReduzida) {
                    throw new Error('File is larger than max-filesize (30MiB > 25MiB)');
                }

                return 'ok';
            }
        });

        assert.equal(resultado, 'ok');
        assert.deepEqual(tentativas, [false, true]);
        assert.deepEqual(ambiente.esperas, []);
    });

    it('esgota as tentativas em falha persistente', async () => {
        const ambiente = criarAmbiente();
        let chamadas = 0;

        await assert.rejects(
            baixarComPolitica({
                ...ambiente,
                tentarBaixar: async () => {
                    chamadas++;

                    throw new Error('getaddrinfo ENOTFOUND');
                }
            }),
            erro => {
                assert.equal(
                    erro.classificacaoViral.categoria,
                    CATEGORIAS_VIRAL.REDE
                );

                return true;
            }
        );

        assert.equal(chamadas, 2);
        assert.deepEqual(ambiente.esperas, [2000]);
    });

    it('não inicia quando o orçamento já está esgotado', async () => {
        const ambiente = criarAmbiente({
            agora: () => 100000,
            deadline: 102000
        });

        let chamadas = 0;

        await assert.rejects(
            baixarComPolitica({
                ...ambiente,
                tentarBaixar: async () => {
                    chamadas++;

                    return 'ok';
                }
            }),
            erro => {
                assert.equal(
                    erro.classificacaoViral.categoria,
                    CATEGORIAS_VIRAL.TIMEOUT
                );

                return true;
            }
        );

        assert.equal(chamadas, 0);
    });

    it('limita a espera pelo orçamento restante', async () => {
        const ambiente = criarAmbiente({
            agora: () => 100000,
            deadline: 106000
        });

        let chamadas = 0;

        const resultado = await baixarComPolitica({
            ...ambiente,
            tentarBaixar: async () => {
                chamadas++;

                if (chamadas === 1) {
                    throw new Error('HTTP Error 429: Too Many Requests');
                }

                return 'ok';
            }
        });

        assert.equal(resultado, 'ok');
        assert.deepEqual(ambiente.esperas, [1000]);
    });

    it('passa restanteMs para o adaptador de download', async () => {
        const ambiente = criarAmbiente({
            agora: () => 100000,
            deadline: 130000
        });

        let recebido = null;

        await baixarComPolitica({
            ...ambiente,
            tentarBaixar: async ({ restanteMs }) => {
                recebido = restanteMs;

                return 'ok';
            }
        });

        assert.equal(recebido, 30000);
    });
});

describe('processarCandidatos', () => {
    const candidatos = [
        { url: 'https://x/1', titulo: 'Um' },
        { url: 'https://x/2', titulo: 'Dois' },
        { url: 'https://x/3', titulo: 'Tres' }
    ];

    it('primeiro candidato restrito, alternativa funciona', async () => {
        const trocas = [];

        const resultado = await processarCandidatos({
            candidatos,
            agora: () => 100000,
            tentarCandidato: async (candidato, indice) => {
                if (indice === 0) {
                    throw erroComClassificacao('Private video');
                }

                return `baixado:${candidato.url}`;
            },
            aoTrocar: async (cls, candidato) => {
                trocas.push(cls.categoria);
            }
        });

        assert.equal(resultado.ok, true);
        assert.equal(resultado.candidato.url, 'https://x/2');
        assert.equal(resultado.resultado, 'baixado:https://x/2');
        assert.equal(resultado.falhas.length, 1);
        assert.equal(resultado.falhas[0].categoria, CATEGORIAS_VIRAL.RESTRITO);
        assert.deepEqual(trocas, [CATEGORIAS_VIRAL.RESTRITO]);
    });

    it('todos os candidatos indisponíveis retorna falha agregada', async () => {
        const resultado = await processarCandidatos({
            candidatos,
            agora: () => 100000,
            tentarCandidato: async (candidato, indice) => {
                const mensagens = [
                    'Private video',
                    "Sign in to confirm you're not a bot",
                    'Video unavailable'
                ];

                throw erroComClassificacao(mensagens[indice]);
            }
        });

        assert.equal(resultado.ok, false);
        assert.equal(resultado.tentados.length, 3);
        assert.deepEqual(
            resultado.falhas.map(f => f.categoria),
            [
                CATEGORIAS_VIRAL.RESTRITO,
                CATEGORIAS_VIRAL.VERIFICACAO,
                CATEGORIAS_VIRAL.REMOVIDO
            ]
        );
    });

    it('falha de rede interrompe sem tentar próximos candidatos', async () => {
        const resultado = await processarCandidatos({
            candidatos,
            agora: () => 100000,
            tentarCandidato: async () => {
                throw erroComClassificacao('getaddrinfo ENOTFOUND');
            }
        });

        assert.equal(resultado.ok, false);
        assert.equal(resultado.tentados.length, 1);
        assert.deepEqual(
            resultado.falhas.map(f => f.categoria),
            [CATEGORIAS_VIRAL.REDE]
        );
    });

    it('respeita o limite de candidatos', async () => {
        const resultado = await processarCandidatos({
            candidatos,
            maxCandidatos: 2,
            agora: () => 100000,
            tentarCandidato: async () => {
                throw erroComClassificacao('Private video');
            }
        });

        assert.equal(resultado.tentados.length, 2);
    });

    it('para quando o orçamento acaba', async () => {
        const resultado = await processarCandidatos({
            candidatos,
            agora: () => 100000,
            deadline: 103000,
            tentarCandidato: async () => {
                throw erroComClassificacao('Private video');
            }
        });

        assert.equal(resultado.ok, false);
        assert.equal(resultado.tentados.length, 0);
        assert.equal(resultado.falhas[0].categoria, CATEGORIAS_VIRAL.TIMEOUT);
    });

    it('não chama aoTrocar após o último candidato', async () => {
        const trocas = [];

        await processarCandidatos({
            candidatos: candidatos.slice(0, 2),
            agora: () => 100000,
            tentarCandidato: async () => {
                throw erroComClassificacao('Private video');
            },
            aoTrocar: async () => {
                trocas.push(1);
            }
        });

        assert.equal(trocas.length, 1);
    });

    it('erro sem classificação conhecida interrompe', async () => {
        const resultado = await processarCandidatos({
            candidatos,
            agora: () => 100000,
            tentarCandidato: async () => {
                throw new Error('erro cru sem classificação');
            }
        });

        assert.equal(resultado.tentados.length, 1);
        assert.equal(resultado.falhas[0].categoria, CATEGORIAS_VIRAL.DESCONHECIDO);
    });

    it('sucesso no primeiro candidato não aciona troca', async () => {
        const trocas = [];

        const resultado = await processarCandidatos({
            candidatos,
            agora: () => 100000,
            tentarCandidato: async () => 'ok',
            aoTrocar: async () => {
                trocas.push(1);
            }
        });

        assert.equal(resultado.ok, true);
        assert.equal(resultado.candidato.url, 'https://x/1');
        assert.equal(trocas.length, 0);
    });
});
