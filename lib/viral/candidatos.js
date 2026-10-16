const DURACAO_MINIMA_S = 30;
const DURACAO_MAXIMA_S = 1800;

const MARCADORES_LIXO = [
    '1 hour',
    '2 hours',
    '3 hours',
    '6 hours',
    '10 hours',
    '24/7',
    'loop',
    'megamix',
    'full album',
    'hours of'
];

export function normalizarComparacao(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[()[\]{}][^()[\]{}]*[()[\]{}]/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function normalizarSemRemoverTags(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

export function tokenizar(texto) {
    const tokens = normalizarComparacao(texto)
        .split(' ')
        .filter(token => token.length >= 2);

    return [...new Set(tokens)];
}

export function extrairCandidatos(json, { limite = 8 } = {}) {
    const entradas = Array.isArray(json?.entries) ? json.entries : [];
    const candidatos = [];

    for (let indice = 0; indice < entradas.length; indice++) {
        const entrada = entradas[indice];

        if (!entrada || typeof entrada !== 'object') {
            continue;
        }

        const url =
            entrada.webpage_url ||
            entrada.original_url ||
            (entrada.id ? `https://www.youtube.com/watch?v=${entrada.id}` : null);

        if (!url) {
            continue;
        }

        const titulo = String(entrada.title || '').trim();

        if (!titulo) {
            continue;
        }

        const duracao = Number(entrada.duration);

        candidatos.push({
            url,
            titulo,
            canal: entrada.channel || entrada.uploader || null,
            duracao: Number.isFinite(duracao) && duracao > 0 ? duracao : null,
            indice
        });

        if (candidatos.length >= limite) {
            break;
        }
    }

    return candidatos;
}

export function avaliarCandidato(candidato, tokensTermo, termoNormalizado) {
    const tituloNormalizado = normalizarComparacao(candidato?.titulo);
    const canalNormalizado = normalizarComparacao(candidato?.canal);
    const motivos = [];
    let pontuacao = 0;

    if (tokensTermo.length) {
        const presentes = tokensTermo.filter(token => tituloNormalizado.includes(token));
        const cobertura = presentes.length / tokensTermo.length;

        pontuacao += Math.round(cobertura * 60);

        if (presentes.length) {
            motivos.push(`titulo cobre ${presentes.length}/${tokensTermo.length} termos`);
        }
    }

    if (termoNormalizado.length >= 6 && tituloNormalizado.includes(termoNormalizado)) {
        pontuacao += 12;
        motivos.push('frase exata no titulo');
    }

    if (
        canalNormalizado &&
        tokensTermo.some(token => canalNormalizado.includes(token))
    ) {
        pontuacao += 8;
        motivos.push('canal corresponde ao termo');
    }

    const duracao = candidato?.duracao;

    if (duracao === null || duracao === undefined) {
        pontuacao += 3;
        motivos.push('duracao desconhecida');
    } else if (duracao >= DURACAO_MINIMA_S && duracao <= DURACAO_MAXIMA_S) {
        pontuacao += 10;
        motivos.push('duracao plausivel');
    } else if (duracao < DURACAO_MINIMA_S) {
        const pedidoCurto = /loop|short|trecho|clip/.test(termoNormalizado);

        if (!pedidoCurto) {
            pontuacao -= 10;
            motivos.push('duracao curta demais');
        }
    } else if (duracao > DURACAO_MAXIMA_S) {
        pontuacao -= 5;
        motivos.push('duracao muito longa');
    }

    let penalidade = 0;
    const tituloSemTags = normalizarSemRemoverTags(candidato?.titulo);

    for (const marcador of MARCADORES_LIXO) {
        if (tituloSemTags.includes(marcador) && !termoNormalizado.includes(marcador)) {
            penalidade += 8;
        }
    }

    penalidade = Math.min(penalidade, 16);

    if (penalidade) {
        pontuacao -= penalidade;
        motivos.push(`penalidade de marcador (${penalidade})`);
    }

    return {
        pontuacao,
        motivos
    };
}

export function selecionarCandidatos(json, termo, { limite = 8 } = {}) {
    const tokensTermo = tokenizar(termo);
    const termoNormalizado = normalizarComparacao(termo);

    const candidatos = extrairCandidatos(json, { limite: Math.max(limite, 1) * 2 })
        .map(candidato => ({
            ...candidato,
            ...avaliarCandidato(candidato, tokensTermo, termoNormalizado)
        }))
        .sort((a, b) => {
            if (b.pontuacao !== a.pontuacao) {
                return b.pontuacao - a.pontuacao;
            }

            return a.indice - b.indice;
        })
        .slice(0, limite);

    return {
        termoNormalizado,
        candidatos
    };
}
