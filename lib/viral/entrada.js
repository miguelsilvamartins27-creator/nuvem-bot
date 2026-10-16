import { textoSeguro, isUrl } from '../utilidades.js';

const LIMITE_TERMO = 200;

export function montarTermoBusca(texto) {
    return String(texto || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, LIMITE_TERMO);
}

function pareceUrlQuebrada(texto) {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(texto)) {
        return true;
    }

    if (/^www\./i.test(texto)) {
        return true;
    }

    if (/^[^\s@]+\.[a-z]{2,}\//i.test(texto)) {
        return true;
    }

    return false;
}

export function interpretarEntrada(termo) {
    const texto = textoSeguro(termo);

    if (!texto) {
        return {
            tipo: 'vazio',
            valor: null
        };
    }

    if (isUrl(texto)) {
        return {
            tipo: 'url',
            valor: texto
        };
    }

    if (pareceUrlQuebrada(texto)) {
        return {
            tipo: 'url-invalida',
            valor: texto
        };
    }

    const normalizado = montarTermoBusca(texto);

    if (!normalizado) {
        return {
            tipo: 'vazio',
            valor: null
        };
    }

    return {
        tipo: 'texto',
        valor: normalizado
    };
}
