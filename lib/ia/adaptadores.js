import {
    textoSeguro
} from '../utilidades.js';

export const PROVEDORES_IA = [
    'groq',
    'gemini',
    'openrouter'
];

const BASES_PADRAO = {
    groq:
        'https://api.groq.com/openai/v1',

    gemini:
        'https://generativelanguage.googleapis.com/v1beta',

    openrouter:
        'https://openrouter.ai/api/v1'
};

export function validarModelo(
    provedor,
    modelo,
    permitirPago = false
) {
    const id =
        textoSeguro(modelo);

    if (!id) {
        return {
            ok:
                false,

            motivo:
                'modelo vazio'
        };
    }

    if (provedor !== 'openrouter') {
        return {
            ok:
                true
        };
    }

    if (permitirPago) {
        return {
            ok:
                true
        };
    }

    if (
        id === 'openrouter/free' ||
        /:free$/i.test(id)
    ) {
        return {
            ok:
                true
        };
    }

    return {
        ok:
            false,

        motivo:
            'modelo pago ou sem variante gratuita no OpenRouter; use um id terminado em ":free" ou defina IA_PERMITIR_PAGO=true'
    };
}

function partirDataUrl(url) {
    const valor =
        String(url || '');

    const match =
        valor.match(
            /^data:([^;,]+);base64,(.+)$/i
        );

    if (!match) {
        return null;
    }

    return {
        mimeType:
            match[1],

        data:
            match[2]
    };
}

function extrairTextos(conteudo) {
    if (typeof conteudo === 'string') {
        return textoSeguro(conteudo);
    }

    if (!Array.isArray(conteudo)) {
        return '';
    }

    return conteudo
        .map(
            (parte) =>
                typeof parte?.text === 'string'
                    ? parte.text
                    : ''
        )
        .join(' ')
        .trim();
}

function converterPartsGemini(conteudo) {
    if (typeof conteudo === 'string') {
        const texto =
            textoSeguro(conteudo);

        return texto
            ? [
                {
                    text:
                        texto
                }
            ]
            : [];
    }

    if (!Array.isArray(conteudo)) {
        return [];
    }

    const parts = [];

    for (const parte of conteudo) {
        if (!parte) {
            continue;
        }

        if (parte.type === 'text') {
            const texto =
                textoSeguro(parte.text);

            if (texto) {
                parts.push({
                    text:
                        texto
                });
            }

            continue;
        }

        if (parte.type === 'image_url') {
            const url =
                parte?.image_url?.url ||
                parte?.image_url ||
                '';

            const dados =
                partirDataUrl(url);

            if (!dados) {
                throw new Error(
                    'Formato de imagem não suportado pelo Gemini (esperado data URL).'
                );
            }

            parts.push({
                inlineData:
                    dados
            });
        }
    }

    return parts;
}

function converterMensagensGemini(mensagens = []) {
    const sistemas = [];

    const contents = [];

    for (const mensagem of mensagens) {
        const role =
            mensagem?.role;

        if (role === 'system') {
            const texto =
                extrairTextos(
                    mensagem?.content
                );

            if (texto) {
                sistemas.push(texto);
            }

            continue;
        }

        const parts =
            converterPartsGemini(
                mensagem?.content
            );

        if (!parts.length) {
            continue;
        }

        contents.push({
            role:
                role === 'assistant'
                    ? 'model'
                    : 'user',

            parts
        });
    }

    return {
        sistemas,
        contents
    };
}

function montarRequisicaoOpenAI(
    provedor,
    opcoes
) {
    const {
        modelo,
        mensagens,
        temperatura,
        maxTokens,
        chave,
        urlBase,
        extras = {}
    } = opcoes;

    const base =
        textoSeguro(urlBase) ||
        BASES_PADRAO[provedor];

    const headers = {
        'Content-Type':
            'application/json',

        Authorization:
            `Bearer ${chave}`
    };

    if (provedor === 'openrouter') {
        if (textoSeguro(extras.referer)) {
            headers['HTTP-Referer'] =
                textoSeguro(extras.referer);
        }

        if (textoSeguro(extras.titulo)) {
            headers['X-Title'] =
                textoSeguro(extras.titulo);
        }
    }

    const corpo = {
        model:
            modelo,

        messages:
            mensagens
    };

    if (Number.isFinite(Number(temperatura))) {
        corpo.temperature =
            Number(temperatura);
    }

    if (Number.isFinite(Number(maxTokens))) {
        corpo.max_tokens =
            Number(maxTokens);
    }

    return {
        url:
            `${base}/chat/completions`,

        headers,

        body:
            corpo
    };
}

function montarRequisicaoGemini(opcoes) {
    const {
        modelo,
        mensagens,
        temperatura,
        maxTokens,
        chave,
        urlBase
    } = opcoes;

    const base =
        textoSeguro(urlBase) ||
        BASES_PADRAO.gemini;

    const {
        sistemas,
        contents
    } = converterMensagensGemini(
        mensagens
    );

    const corpo = {
        contents
    };

    if (sistemas.length) {
        corpo.systemInstruction = {
            parts: [
                {
                    text:
                        sistemas.join('\n\n')
                }
            ]
        };
    }

    const generationConfig = {};

    if (Number.isFinite(Number(temperatura))) {
        generationConfig.temperature =
            Number(temperatura);
    }

    if (Number.isFinite(Number(maxTokens))) {
        generationConfig.maxOutputTokens =
            Number(maxTokens);
    }

    if (Object.keys(generationConfig).length) {
        corpo.generationConfig =
            generationConfig;
    }

    return {
        url:
            `${base}/models/${modelo}:generateContent`,

        headers: {
            'Content-Type':
                'application/json',

            'x-goog-api-key':
                chave
        },

        body:
            corpo
    };
}

export function montarRequisicao(
    provedor,
    opcoes = {}
) {
    if (
        !PROVEDORES_IA.includes(
            provedor
        )
    ) {
        throw new Error(
            `Provedor de IA desconhecido: ${provedor}`
        );
    }

    const modelo =
        textoSeguro(opcoes.modelo);

    if (!modelo) {
        throw new Error(
            `Modelo de IA ausente para ${provedor}.`
        );
    }

    const chave =
        textoSeguro(opcoes.chave);

    if (!chave) {
        throw new Error(
            `Chave de API ausente para ${provedor}.`
        );
    }

    const normalizado = {
        ...opcoes,
        modelo,
        chave
    };

    if (provedor === 'gemini') {
        return montarRequisicaoGemini(
            normalizado
        );
    }

    return montarRequisicaoOpenAI(
        provedor,
        normalizado
    );
}

export function extrairTexto(
    provedor,
    json
) {
    if (provedor === 'gemini') {
        const parts =
            json?.candidates?.[0]
                ?.content?.parts;

        if (!Array.isArray(parts)) {
            return null;
        }

        const texto = parts
            .map(
                (parte) =>
                    parte?.text || ''
            )
            .join('')
            .trim();

        return texto || null;
    }

    const conteudo =
        json?.choices?.[0]
            ?.message?.content;

    if (Array.isArray(conteudo)) {
        const texto = conteudo
            .map(
                (parte) =>
                    typeof parte === 'string'
                        ? parte
                        : parte?.text || ''
            )
            .join('')
            .trim();

        return texto || null;
    }

    const texto =
        typeof conteudo === 'string'
            ? conteudo.trim()
            : '';

    return texto || null;
}

export function extrairUso(
    provedor,
    json
) {
    if (provedor === 'gemini') {
        const uso =
            json?.usageMetadata;

        if (!uso) {
            return null;
        }

        return {
            entrada:
                Number(
                    uso.promptTokenCount
                ) || 0,

            saida:
                Number(
                    uso.candidatesTokenCount
                ) || 0
        };
    }

    const uso =
        json?.usage;

    if (!uso) {
        return null;
    }

    return {
        entrada:
            Number(
                uso.prompt_tokens
            ) || 0,

        saida:
            Number(
                uso.completion_tokens
            ) || 0
    };
}
