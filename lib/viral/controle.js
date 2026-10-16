export function criarControleDownload() {
    let idAtivo = null;

    return {
        tentarIniciar(id) {
            if (idAtivo !== null) {
                return false;
            }

            idAtivo = id ?? true;

            return true;
        },

        finalizar() {
            idAtivo = null;
        },

        estaAtivo() {
            return idAtivo !== null;
        },

        idAtivo() {
            return idAtivo;
        }
    };
}

export function criarDeduplicador(limite = 1000) {
    const vistos = new Set();

    return {
        jaVisto(id) {
            return id ? vistos.has(id) : false;
        },

        marcar(id) {
            if (!id) {
                return;
            }

            vistos.add(id);

            if (vistos.size > limite) {
                vistos.delete(vistos.values().next().value);
            }
        }
    };
}
