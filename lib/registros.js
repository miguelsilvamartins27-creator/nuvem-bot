export const LIMITE_DESCRICAO = 300;

export function sanitizarDescricao(descricao) {
    const limpa = String(descricao || '')
        .trim()
        .slice(0, LIMITE_DESCRICAO);

    if (limpa.length < 2) {
        return null;
    }

    return limpa;
}

export function criarRegistro(descricao, tipo, agora = Date.now()) {
    return {
        id: agora,
        data: new Date(agora).toISOString(),
        descricao,
        tipo
    };
}

export function registrosDoDia(lista, data = new Date()) {
    if (!Array.isArray(lista)) {
        return [];
    }

    const dia = data.toDateString();

    return lista.filter(
        registro => new Date(registro.data).toDateString() === dia
    );
}

export function ultimosRegistros(lista, quantidade = 10) {
    if (!Array.isArray(lista)) {
        return [];
    }

    return lista.slice(-quantidade).reverse();
}

export function localizarParaExclusao(lista, numero) {
    if (!Array.isArray(lista)) {
        return null;
    }

    if (!Number.isInteger(numero) || numero < 1) {
        return null;
    }

    if (numero > lista.length) {
        return null;
    }

    const indice = lista.length - numero;

    return {
        indice,
        registro: lista[indice]
    };
}
