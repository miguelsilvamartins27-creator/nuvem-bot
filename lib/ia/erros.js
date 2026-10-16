import {
    erroEh429,
    obterStatusErro,
    textoSeguro
} from '../utilidades.js';

export const TIPOS_ERRO_IA = {
    LIMITE_MINUTO: 'limite_minuto',
    LIMITE_DIA: 'limite_dia',
    AUTH: 'auth',
    FINANCEIRO: 'financeiro',
    MODELO_INDISPONIVEL: 'modelo_indisponivel',
    IMAGEM_INVALIDA: 'imagem_invalida',
    CONFIGURACAO: 'configuracao',
    TEMPORARIO: 'temporario',
    REDE: 'rede',
    DESCONHECIDO: 'desconhecido'
};

const MARCAS_LIMITE_DIA =
    /per\s*_?\s*day|perday|daily|\(rpd\)|\brpd\b|requests?\s*per\s*day/i;

const MARCAS_MODELO =
    /not[\s_-]?found|does not exist|does[\s_-]?not[\s_-]?support|decommissioned|not supported|unsupported[\s_-]?model|model[\s_-]?not[\s_-]?available/i;

const MARCAS_IMAGEM =
    /imagem|image/;

const MARCAS_IMAGEM_PROBLEMA =
    /too[\s_-]?large|invalid|unsupported|decode|corrupt|mime|formato|não suportad|nao suportad/i;

function textoCompleto(erro) {
    const partes = [];

    if (erro?.mensagem) {
        partes.push(String(erro.mensagem));
    }

    if (erro?.mensagemOriginal) {
        partes.push(String(erro.mensagemOriginal));
    }

    if (erro?.erroOriginal?.message) {
        partes.push(String(erro.erroOriginal.message));
    }

    if (erro?.corpo) {
        try {
            partes.push(JSON.stringify(erro.corpo));
        } catch {
            partes.push(String(erro.corpo));
        }
    }

    return textoSeguro(partes.join(' '));
}

function limitarSegundos(valor) {
    return Math.min(Math.max(Math.ceil(valor), 1), 21600);
}

export function extrairRetrySegundos(erro) {
    if (!erro) {
        return null;
    }

    const candidatos = [];

    const doHeader = Number(erro.retryAfterSegundos);

    if (Number.isFinite(doHeader) && doHeader > 0) {
        candidatos.push(doHeader);
    }

    const texto = textoCompleto(erro);

    const tentarNovamente =
        texto.match(
            /try again in\s+(?:(\d+(?:\.\d+)?)m)?(\d+(?:\.\d+)?)s/i
        );

    if (tentarNovamente) {
        const minutos =
            Number(tentarNovamente[1]) || 0;

        const segundos =
            Number(tentarNovamente[2]) || 0;

        const total =
            minutos * 60 + segundos;

        if (total > 0) {
            candidatos.push(total);
        }
    }

    const retryDelay =
        texto.match(
            /retryDelay"?\s*:?\s*"?(\d+(?:\.\d+)?)s/i
        );

    if (retryDelay) {
        const total = Number(retryDelay[1]);

        if (total > 0) {
            candidatos.push(total);
        }
    }

    const retryAfter =
        texto.match(
            /retry[- _]after["':\s]+["']?(\d+)/i
        );

    if (retryAfter) {
        const total = Number(retryAfter[1]);

        if (total > 0) {
            candidatos.push(total);
        }
    }

    if (!candidatos.length) {
        return null;
    }

    return limitarSegundos(candidatos[0]);
}

export function categorizarErro(erro) {
    const status =
        Number(
            obterStatusErro(erro)
        );

    const texto =
        textoCompleto(erro).toLowerCase();

    const nomeOriginal =
        String(
            erro?.erroOriginal?.name ||
            ''
        );

    const retrySegundos =
        extrairRetrySegundos(erro);

    if (
        status === 401 ||
        status === 403 ||
        texto.includes('unauthenticated') ||
        texto.includes('permission_denied')
    ) {
        return {
            tipo:
                TIPOS_ERRO_IA.AUTH,

            retrySegundos
        };
    }

    if (status === 402) {
        return {
            tipo:
                TIPOS_ERRO_IA.FINANCEIRO,

            retrySegundos
        };
    }

    if (
        status === 404 ||
        (
            texto.includes('model') &&
            MARCAS_MODELO.test(texto)
        )
    ) {
        return {
            tipo:
                TIPOS_ERRO_IA.MODELO_INDISPONIVEL,

            retrySegundos
        };
    }

    if (
        (
            MARCAS_IMAGEM.test(texto) &&
            MARCAS_IMAGEM_PROBLEMA.test(texto)
        ) ||
        texto.includes('formato de imagem')
    ) {
        return {
            tipo:
                TIPOS_ERRO_IA.IMAGEM_INVALIDA,

            retrySegundos
        };
    }

    if (
        status === 429 ||
        erroEh429(erro) ||
        /rate[\s_-]?limit|too many requests|resource_exhausted/i.test(texto)
    ) {
        return {
            tipo:
                MARCAS_LIMITE_DIA.test(texto)
                    ? TIPOS_ERRO_IA.LIMITE_DIA
                    : TIPOS_ERRO_IA.LIMITE_MINUTO,

            retrySegundos
        };
    }

    if (
        nomeOriginal === 'AbortError' ||
        status === 408 ||
        /abort|timeout|timed out/i.test(texto)
    ) {
        return {
            tipo:
                TIPOS_ERRO_IA.TEMPORARIO,

            retrySegundos
        };
    }

    if (
        status >= 500 ||
        /overloaded|temporarily|unavailable/i.test(texto)
    ) {
        return {
            tipo:
                TIPOS_ERRO_IA.TEMPORARIO,

            retrySegundos
        };
    }

    if (
        nomeOriginal === 'TypeError' ||
        /fetch failed|enotfound|econnrefused|econnreset|eai_again|network|socket hang up/i.test(texto)
    ) {
        return {
            tipo:
                TIPOS_ERRO_IA.REDE,

            retrySegundos
        };
    }

    return {
        tipo:
            TIPOS_ERRO_IA.DESCONHECIDO,

        retrySegundos
    };
}
