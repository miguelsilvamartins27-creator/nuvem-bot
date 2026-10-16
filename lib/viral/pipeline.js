import {
    CATEGORIAS_VIRAL,
    classificarErroViral
} from './erros.js';

export const TETO_ESPERA_MS = 15000;
export const MARGEM_ORCAMENTO_MS = 5000;

export function calcularEspera(classificacao, tentativa) {
    const base = Number(classificacao?.esperaBaseMs) || 0;

    if (base <= 0) {
        return 0;
    }

    return Math.min(base * Math.max(1, tentativa), TETO_ESPERA_MS);
}

export async function baixarComPolitica({
    tentarBaixar,
    classificar,
    esperar,
    agora,
    deadline = null,
    maxTentativas = 2
}) {
    let falhas = 0;
    let tentativa = 0;
    let qualidadeReduzida = false;

    while (true) {
        tentativa++;

        const restanteMs = deadline ? deadline - agora() : Infinity;

        if (restanteMs <= MARGEM_ORCAMENTO_MS) {
            const erro = new Error('Orçamento de tempo do /viral esgotado.');
            erro.categoriaViral = CATEGORIAS_VIRAL.TIMEOUT;
            erro.classificacaoViral = classificarErroViral(erro);

            throw erro;
        }

        try {
            return await tentarBaixar({
                tentativa,
                qualidadeReduzida,
                restanteMs
            });
        } catch (erro) {
            const classificacao = classificar(erro);

            erro.classificacaoViral = classificacao;

            if (
                classificacao.categoria === CATEGORIAS_VIRAL.TAMANHO &&
                !qualidadeReduzida
            ) {
                qualidadeReduzida = true;

                continue;
            }

            falhas++;

            if (!classificacao.retentavel || falhas >= maxTentativas) {
                throw erro;
            }

            const teto = deadline
                ? Math.max(0, deadline - agora() - MARGEM_ORCAMENTO_MS)
                : Infinity;

            const espera = Math.min(calcularEspera(classificacao, falhas), teto);

            if (espera > 0) {
                await esperar(espera);
            }
        }
    }
}

export async function processarCandidatos({
    candidatos,
    tentarCandidato,
    aoTrocar = null,
    deadline = null,
    agora,
    maxCandidatos = 3
}) {
    const tentados = [];
    const falhas = [];
    const limite = Math.max(0, Math.min(candidatos.length, maxCandidatos));

    for (let indice = 0; indice < limite; indice++) {
        if (deadline && deadline - agora() <= MARGEM_ORCAMENTO_MS) {
            falhas.push({
                categoria: CATEGORIAS_VIRAL.TIMEOUT,
                rotulo: 'orçamento de tempo esgotado'
            });

            break;
        }

        const candidato = candidatos[indice];

        tentados.push(candidato);

        try {
            const resultado = await tentarCandidato(candidato, indice);

            return {
                ok: true,
                candidato,
                resultado,
                tentados,
                falhas
            };
        } catch (erro) {
            const classificacao = erro?.classificacaoViral || {
                categoria: CATEGORIAS_VIRAL.DESCONHECIDO,
                aceitaProximoCandidato: false,
                rotulo: 'erro não identificado'
            };

            falhas.push(classificacao);

            if (indice >= limite - 1) {
                break;
            }

            if (!classificacao.aceitaProximoCandidato) {
                const proximoIndiceOutraFonte = candidatos.findIndex(
                    (item, posicao) =>
                        posicao > indice &&
                        candidato?.fonte &&
                        item?.fonte &&
                        item.fonte !== candidato.fonte
                );

                // Falhas específicas da fonte (ex.: 403/429 do YouTube)
                // não devem impedir a tentativa de um provedor independente.
                if (proximoIndiceOutraFonte === -1 || proximoIndiceOutraFonte >= limite) {
                    break;
                }

                indice = proximoIndiceOutraFonte - 1;
            }

            if (typeof aoTrocar === 'function') {
                await aoTrocar(classificacao, candidato, indice);
            }
        }
    }

    return {
        ok: false,
        candidato: null,
        resultado: null,
        tentados,
        falhas
    };
}
