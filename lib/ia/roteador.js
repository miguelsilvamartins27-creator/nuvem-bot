import {
    categorizarErro,
    TIPOS_ERRO_IA
} from './erros.js';

import {
    PROVEDORES_IA,
    extrairTexto,
    extrairUso,
    montarRequisicao,
    validarModelo
} from './adaptadores.js';

import {
    obterLimiteDiario
} from './limites.js';

import {
    textoSeguro
} from '../utilidades.js';

const COOLDOWNS_PADRAO = {
    auth: 3600,
    financeiro: 3600,
    modelo_indisponivel: 86400,
    limite_dia: 1800,
    limite_minuto: 60,
    temporario: 30,
    rede: 15,
    desconhecido: 60
};

const PRECEDENCIA_FALHA = [
    TIPOS_ERRO_IA.AUTH,
    TIPOS_ERRO_IA.CONFIGURACAO,
    TIPOS_ERRO_IA.FINANCEIRO,
    TIPOS_ERRO_IA.LIMITE_DIA,
    TIPOS_ERRO_IA.LIMITE_MINUTO,
    TIPOS_ERRO_IA.IMAGEM_INVALIDA,
    TIPOS_ERRO_IA.MODELO_INDISPONIVEL,
    TIPOS_ERRO_IA.TEMPORARIO,
    TIPOS_ERRO_IA.REDE,
    TIPOS_ERRO_IA.DESCONHECIDO
];

const INTERVALO_SALVAMENTO_MS =
    30000;

export class ErroRoteador extends Error {
    constructor(
        mensagem,
        {
            tentativas = [],
            tipoPredominante =
                TIPOS_ERRO_IA.DESCONHECIDO,
            melhorEspera = null
        } = {}
    ) {
        super(mensagem);

        this.name =
            'ErroRoteador';

        this.roteador =
            true;

        this.tentativas =
            tentativas;

        this.tipoPredominante =
            tipoPredominante;

        this.melhorEspera =
            melhorEspera;
    }
}

export function normalizarOrdem(ordem) {
    const lista =
        Array.isArray(ordem)
            ? ordem
            : String(ordem || '').split(',');

    const vistos =
        new Set();

    const resultado = [];

    for (const item of lista) {
        const id =
            textoSeguro(item).toLowerCase();

        if (
            !id ||
            !PROVEDORES_IA.includes(id) ||
            vistos.has(id)
        ) {
            continue;
        }

        vistos.add(id);

        resultado.push(id);
    }

    return resultado;
}

export function mensagemErroRoteador(
    erro,
    { visao = false } = {}
) {
    const tentativas =
        Array.isArray(erro?.tentativas)
            ? erro.tentativas
            : [];

    const nomes = [
        ...new Set(
            tentativas
                .map(
                    (tentativa) =>
                        tentativa.provedor
                )
                .filter(Boolean)
        )
    ];

    const tipo =
        erro?.tipoPredominante;

    if (tipo === TIPOS_ERRO_IA.AUTH) {
        return (
            `❌ Nenhuma chave de IA foi aceita (${nomes.join(', ') || 'nenhum provedor'}).\n\n` +
            `Verifique GROQ_API_KEY, GEMINI_API_KEY e OPENROUTER_API_KEY.`
        );
    }

    if (tipo === TIPOS_ERRO_IA.CONFIGURACAO) {
        return (
            `⚠️ Nenhum provedor de IA pôde ser usado.\n\n` +
            `Confira IA_TEXTO_ORDEM/IA_VISAO_ORDEM, os modelos configurados e, no OpenRouter, use modelos ":free" (ou defina IA_PERMITIR_PAGO=true).`
        );
    }

    if (
        tipo === TIPOS_ERRO_IA.LIMITE_DIA ||
        tipo === TIPOS_ERRO_IA.LIMITE_MINUTO ||
        tipo === TIPOS_ERRO_IA.FINANCEIRO
    ) {
        const espera =
            Number(erro?.melhorEspera);

        const sufixo =
            Number.isFinite(espera) &&
            espera > 0
                ? ` Tente novamente em ~${espera}s.`
                : ` Tente novamente em instantes.`;

        return (
            `⏳ Todos os provedores de IA estão no limite agora.${sufixo}`
        );
    }

    if (
        tipo === TIPOS_ERRO_IA.IMAGEM_INVALIDA &&
        visao
    ) {
        return (
            `⚠️ Não consegui processar essa imagem.\n\n` +
            `Tente enviar a foto novamente (JPEG ou PNG).\n\n` +
            `💡 Alternativa: /refeicao <descrição>.`
        );
    }

    if (visao) {
        return (
            `❌ Não consegui analisar a foto agora.\n\n` +
            `💡 Alternativa: /refeicao <descrição>.`
        );
    }

    const lista =
        nomes.length
            ? `\n\nProvedores tentados: ${nomes.join(', ')}.`
            : '';

    return (
        `❌ Tive um problema ao consultar a IA.\n\n` +
        `Tente novamente.${lista}`
    );
}

function criarSignalTimeout(ms) {
    try {
        if (
            typeof AbortSignal !== 'undefined' &&
            typeof AbortSignal.timeout === 'function'
        ) {
            return AbortSignal.timeout(
                Math.max(
                    1000,
                    Number(ms) || 45000
                )
            );
        }
    } catch {
        return undefined;
    }

    return undefined;
}

async function lerCorpoJson(resposta) {
    try {
        const texto =
            await resposta.text();

        if (!texto) {
            return null;
        }

        try {
            return JSON.parse(texto);
        } catch {
            return {
                mensagem:
                    texto.slice(0, 500)
            };
        }
    } catch {
        return null;
    }
}

function lerRetryAfter(
    resposta,
    momento
) {
    try {
        const valor =
            resposta?.headers?.get?.(
                'retry-after'
            );

        if (!valor) {
            return null;
        }

        const numero =
            Number(valor);

        if (
            Number.isFinite(numero) &&
            numero > 0
        ) {
            return numero;
        }

        const data =
            Date.parse(valor);

        if (!Number.isFinite(data)) {
            return null;
        }

        const segundos =
            Math.ceil(
                (data - momento) / 1000
            );

        return segundos > 0
            ? segundos
            : null;
    } catch {
        return null;
    }
}

function obterMensagemCorpo(corpo) {
    if (!corpo) {
        return '';
    }

    if (typeof corpo === 'string') {
        return corpo;
    }

    return (
        corpo?.error?.message ||
        corpo?.message ||
        corpo?.error?.status ||
        ''
    );
}

export function criarRoteador({
    provedores = {},
    texto = 'groq,gemini,openrouter',
    visao = 'groq,gemini,openrouter',
    cooldowns = {},
    tentativasPorProvedor = 2,
    esperaBackoffMs = 500,
    permitirPago = false,
    limites = {},
    limitesDuros = false,
    timeoutMs = 45000,
    persistencia = null,
    fetchFn =
        typeof fetch === 'function'
            ? fetch
            : null,
    agora = () => Date.now(),
    esperar = (ms) =>
        new Promise(
            (resolver) =>
                setTimeout(resolver, ms)
        ),
    log = () => {}
} = {}) {
    if (!fetchFn) {
        throw new Error(
            'fetch indisponível neste ambiente.'
        );
    }

    const ordens = {
        texto:
            normalizarOrdem(texto),

        visao:
            normalizarOrdem(visao)
    };

    const cooldownMap = {
        ...COOLDOWNS_PADRAO,
        ...cooldowns
    };

    const estado = {
        cooldowns: {},
        uso: {},
        avisados: {}
    };

    let persistenciaCarregada =
        false;

    let ultimoSalvamento =
        0;

    function hoje() {
        return new Date(
            agora()
        )
            .toISOString()
            .slice(0, 10);
    }

    function registroUso(id) {
        const dia =
            hoje();

        let registro =
            estado.uso[id];

        if (
            !registro ||
            registro.dia !== dia
        ) {
            registro = {
                dia,

                requisicoes:
                    0,

                tokens:
                    0
            };

            estado.uso[id] =
                registro;
        }

        return registro;
    }

    async function carregarPersistencia() {
        if (persistenciaCarregada) {
            return;
        }

        persistenciaCarregada =
            true;

        if (!persistencia?.carregar) {
            return;
        }

        try {
            const dados =
                await persistencia.carregar();

            if (
                !dados ||
                typeof dados !== 'object'
            ) {
                return;
            }

            const dia =
                hoje();

            for (const id of PROVEDORES_IA) {
                const registro =
                    dados[id];

                if (
                    !registro ||
                    registro.dia !== dia
                ) {
                    continue;
                }

                estado.uso[id] = {
                    dia,

                    requisicoes:
                        Math.max(
                            0,
                            Math.floor(
                                Number(
                                    registro.requisicoes
                                ) || 0
                            )
                        ),

                    tokens:
                        Math.max(
                            0,
                            Math.floor(
                                Number(
                                    registro.tokens
                                ) || 0
                            )
                        )
                };
            }
        } catch (erro) {
            log(
                `⚠️ IA: falha ao carregar uso persistido (${
                    erro?.message ||
                    erro
                }).`
            );
        }
    }

    async function salvarPersistencia() {
        if (!persistencia?.salvar) {
            return;
        }

        const momento =
            agora();

        if (
            momento -
                ultimoSalvamento <
            INTERVALO_SALVAMENTO_MS
        ) {
            return;
        }

        ultimoSalvamento =
            momento;

        try {
            await persistencia.salvar(
                estado.uso
            );
        } catch (erro) {
            log(
                `⚠️ IA: falha ao salvar uso (${
                    erro?.message ||
                    erro
                }).`
            );
        }
    }

    function chaveCooldown(
        id,
        modalidade,
        tipo
    ) {
        if (
            tipo === TIPOS_ERRO_IA.AUTH ||
            tipo === TIPOS_ERRO_IA.FINANCEIRO
        ) {
            return id;
        }

        return modalidade === 'visao'
            ? `${id}:visao`
            : id;
    }

    function cooldownAtivo(
        id,
        modalidade,
        momento
    ) {
        const chaves = [id];

        if (modalidade === 'visao') {
            chaves.push(`${id}:visao`);
        }

        let ativo = null;

        for (const chave of chaves) {
            const registro =
                estado.cooldowns[chave];

            if (
                registro &&
                registro.ate > momento &&
                (
                    !ativo ||
                    registro.ate >
                        ativo.ate
                )
            ) {
                ativo = registro;
            }
        }

        return ativo;
    }

    function aplicarCooldown(
        id,
        modalidade,
        tipo,
        retrySegundos,
        momento
    ) {
        const chave =
            chaveCooldown(
                id,
                modalidade,
                tipo
            );

        const padrao =
            Number(cooldownMap[tipo]);

        const informado =
            Number(retrySegundos);

        const segundos =
            Number.isFinite(informado) &&
            informado > 0
                ? Math.min(
                    Math.max(informado, 1),
                    21600
                )
                : Number.isFinite(padrao) &&
                    padrao > 0
                    ? padrao
                    : 60;

        estado.cooldowns[chave] = {
            ate:
                momento +
                segundos * 1000,

            tipo,

            segundos
        };

        return segundos;
    }

    function montarCadeia(
        modalidade,
        momento
    ) {
        const ordem =
            ordens[modalidade] || [];

        const candidatos = [];

        const pulados = [];

        let esperaMinima =
            null;

        for (const id of ordem) {
            const provedor =
                provedores?.[id];

            const chave =
                textoSeguro(
                    provedor?.chave
                );

            if (!chave) {
                pulados.push({
                    provedor:
                        id,

                    tipo:
                        TIPOS_ERRO_IA.CONFIGURACAO,

                    detalhe:
                        'sem chave configurada'
                });

                continue;
            }

            const modelo =
                textoSeguro(
                    modalidade === 'visao'
                        ? provedor.modeloVisao ||
                            provedor.modeloTexto
                        : provedor.modeloTexto
                );

            if (!modelo) {
                pulados.push({
                    provedor:
                        id,

                    tipo:
                        TIPOS_ERRO_IA.CONFIGURACAO,

                    detalhe:
                        'sem modelo configurado'
                });

                continue;
            }

            const permissao =
                validarModelo(
                    id,
                    modelo,
                    permitirPago
                );

            if (!permissao.ok) {
                pulados.push({
                    provedor:
                        id,

                    tipo:
                        TIPOS_ERRO_IA.CONFIGURACAO,

                    detalhe:
                        permissao.motivo
                });

                continue;
            }

            const cooldown =
                cooldownAtivo(
                    id,
                    modalidade,
                    momento
                );

            if (cooldown) {
                const restante =
                    Math.ceil(
                        (
                            cooldown.ate -
                            momento
                        ) / 1000
                    );

                esperaMinima =
                    esperaMinima === null
                        ? restante
                        : Math.min(
                            esperaMinima,
                            restante
                        );

                pulados.push({
                    provedor:
                        id,

                    tipo:
                        cooldown.tipo,

                    detalhe:
                        `em cooldown (~${restante}s)`
                });

                continue;
            }

            const limite =
                obterLimiteDiario(
                    id,
                    limites
                );

            if (
                limitesDuros &&
                limite &&
                registroUso(id)
                    .requisicoes >= limite
            ) {
                pulados.push({
                    provedor:
                        id,

                    tipo:
                        TIPOS_ERRO_IA.LIMITE_DIA,

                    detalhe:
                        'limite diário configurado atingido'
                });

                continue;
            }

            candidatos.push({
                id,
                modelo,
                chave,

                extras:
                    provedor.extras,

                urlBase:
                    provedor.urlBase
            });
        }

        return {
            candidatos,
            pulados,
            esperaMinima
        };
    }

    function escolherTipoPredominante(
        tentativas
    ) {
        const tipos =
            new Set(
                tentativas.map(
                    (tentativa) =>
                        tentativa.tipo
                )
            );

        for (const tipo of PRECEDENCIA_FALHA) {
            if (tipos.has(tipo)) {
                return tipo;
            }
        }

        return TIPOS_ERRO_IA.DESCONHECIDO;
    }

    function calcularMelhorEspera(
        momento
    ) {
        let melhor =
            null;

        for (const registro of Object.values(
            estado.cooldowns
        )) {
            if (registro.ate <= momento) {
                continue;
            }

            const restante =
                Math.ceil(
                    (
                        registro.ate -
                        momento
                    ) / 1000
                );

            melhor =
                melhor === null
                    ? restante
                    : Math.min(
                        melhor,
                        restante
                    );
        }

        return melhor;
    }

    async function executar({
        modalidade = 'texto',
        mensagens,
        temperatura,
        maxTokens
    } = {}) {
        await carregarPersistencia();

        const momento =
            agora();

        const {
            candidatos,
            pulados,
            esperaMinima
        } = montarCadeia(
            modalidade,
            momento
        );

        if (!candidatos.length) {
            const tipo =
                pulados.length
                    ? escolherTipoPredominante(
                        pulados
                    )
                    : TIPOS_ERRO_IA.CONFIGURACAO;

            throw new ErroRoteador(
                'Nenhum provedor de IA disponível.',
                {
                    tentativas:
                        pulados,

                    tipoPredominante:
                        tipo,

                    melhorEspera:
                        esperaMinima
                }
            );
        }

        const tentativas =
            [];

        const maxTentativas =
            Math.max(
                1,
                Number(
                    tentativasPorProvedor
                ) || 1
            );

        for (const candidato of candidatos) {
            for (
                let tentativa = 1;
                tentativa <= maxTentativas;
                tentativa++
            ) {
                let requisicao;

                try {
                    requisicao =
                        montarRequisicao(
                            candidato.id,
                            {
                                modelo:
                                    candidato.modelo,

                                mensagens,

                                temperatura,

                                maxTokens,

                                chave:
                                    candidato.chave,

                                urlBase:
                                    candidato.urlBase,

                                extras:
                                    candidato.extras
                            }
                        );

                } catch (erro) {
                    const info =
                        categorizarErro(
                            erro
                        );

                    tentativas.push({
                        provedor:
                            candidato.id,

                        tipo:
                            info.tipo,

                        detalhe:
                            erro?.message
                    });

                    break;
                }

                log(
                    `🤖 IA ${candidato.id}/${modalidade} tentativa ${tentativa}/${maxTentativas}`
                );

                let resposta;

                try {
                    resposta =
                        await fetchFn(
                            requisicao.url,
                            {
                                method:
                                    'POST',

                                headers:
                                    requisicao.headers,

                                body:
                                    JSON.stringify(
                                        requisicao.body
                                    ),

                                signal:
                                    criarSignalTimeout(
                                        timeoutMs
                                    )
                            }
                        );

                } catch (erroFetch) {
                    const erro = {
                        provedor:
                            candidato.id,

                        mensagem:
                            erroFetch?.name ===
                            'AbortError'
                                ? 'timeout'
                                : erroFetch
                                      ?.message,

                        erroOriginal:
                            erroFetch
                    };

                    const info =
                        categorizarErro(
                            erro
                        );

                    tentativas.push({
                        provedor:
                            candidato.id,

                        tipo:
                            info.tipo,

                        detalhe:
                            String(
                                erroFetch?.message ||
                                erroFetch
                            )
                    });

                    const podeRepetir =
                        info.tipo ===
                            TIPOS_ERRO_IA.TEMPORARIO ||
                        info.tipo ===
                            TIPOS_ERRO_IA.REDE ||
                        info.tipo ===
                            TIPOS_ERRO_IA.DESCONHECIDO;

                    if (
                        tentativa <
                            maxTentativas &&
                        podeRepetir
                    ) {
                        await esperar(
                            esperaBackoffMs *
                                Math.pow(
                                    2,
                                    tentativa - 1
                                )
                        );

                        continue;
                    }

                    aplicarCooldown(
                        candidato.id,
                        modalidade,
                        info.tipo,
                        info.retrySegundos,
                        agora()
                    );

                    break;
                }

                if (!resposta.ok) {
                    const corpo =
                        await lerCorpoJson(
                            resposta
                        );

                    const erro = {
                        provedor:
                            candidato.id,

                        status:
                            resposta.status,

                        retryAfterSegundos:
                            lerRetryAfter(
                                resposta,
                                agora()
                            ),

                        corpo,

                        mensagem:
                            obterMensagemCorpo(
                                corpo
                            ) ||
                            resposta.statusText
                    };

                    const info =
                        categorizarErro(
                            erro
                        );

                    tentativas.push({
                        provedor:
                            candidato.id,

                        tipo:
                            info.tipo,

                        status:
                            resposta.status,

                        detalhe:
                            erro.mensagem
                    });

                    const podeRepetir =
                        info.tipo ===
                            TIPOS_ERRO_IA.TEMPORARIO ||
                        info.tipo ===
                            TIPOS_ERRO_IA.DESCONHECIDO;

                    if (
                        tentativa <
                            maxTentativas &&
                        podeRepetir
                    ) {
                        await esperar(
                            esperaBackoffMs *
                                Math.pow(
                                    2,
                                    tentativa - 1
                                )
                        );

                        continue;
                    }

                    if (
                        info.tipo !==
                        TIPOS_ERRO_IA.IMAGEM_INVALIDA
                    ) {
                        const segundos =
                            aplicarCooldown(
                                candidato.id,
                                modalidade,
                                info.tipo,
                                info.retrySegundos,
                                agora()
                            );

                        log(
                            `⚠️ IA ${candidato.id}: ${info.tipo} — cooldown ${segundos}s`
                        );
                    }

                    break;
                }

                let json;

                try {
                    json =
                        await resposta.json();

                } catch {
                    json =
                        null;
                }

                const textoResposta =
                    extrairTexto(
                        candidato.id,
                        json
                    );

                if (!textoResposta) {
                    tentativas.push({
                        provedor:
                            candidato.id,

                        tipo:
                            TIPOS_ERRO_IA.TEMPORARIO,

                        detalhe:
                            'resposta vazia'
                    });

                    if (
                        tentativa <
                        maxTentativas
                    ) {
                        await esperar(
                            esperaBackoffMs *
                                Math.pow(
                                    2,
                                    tentativa - 1
                                )
                        );

                        continue;
                    }

                    aplicarCooldown(
                        candidato.id,
                        modalidade,
                        TIPOS_ERRO_IA.TEMPORARIO,
                        null,
                        agora()
                    );

                    break;
                }

                const uso =
                    extrairUso(
                        candidato.id,
                        json
                    );

                const registro =
                    registroUso(
                        candidato.id
                    );

                registro.requisicoes +=
                    1;

                if (uso) {
                    registro.tokens +=
                        (Number(uso.entrada) ||
                            0) +
                        (Number(uso.saida) || 0);
                }

                const limite =
                    obterLimiteDiario(
                        candidato.id,
                        limites
                    );

                if (limite) {
                    const aviso =
                        estado.avisados[
                            candidato.id
                        ] ||
                        (estado.avisados[
                            candidato.id
                        ] = {});

                    if (
                        registro.requisicoes >=
                            Math.ceil(
                                limite * 0.9
                            ) &&
                        !aviso[registro.dia]
                    ) {
                        aviso[registro.dia] =
                            true;

                        log(
                            `⚠️ IA ${candidato.id}: ${registro.requisicoes}/${limite} requisições hoje (aviso; o limite gratuito é variável e pode mudar).`
                        );
                    }
                }

                await salvarPersistencia();

                log(
                    `✅ IA ${candidato.id} respondeu (${modalidade}).`
                );

                return {
                    texto:
                        textoResposta,

                    provedor:
                        candidato.id,

                    modelo:
                        candidato.modelo,

                    uso
                };
            }
        }

        throw new ErroRoteador(
            'Todos os provedores de IA falharam.',
            {
                tentativas,

                tipoPredominante:
                    escolherTipoPredominante(
                        tentativas
                    ),

                melhorEspera:
                    calcularMelhorEspera(
                        agora()
                    )
            }
        );
    }

    return {
        executar,
        estado,
        montarCadeia
    };
}
