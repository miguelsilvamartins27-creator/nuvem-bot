const API_BUSCA = 'https://archive.org/advancedsearch.php';
const API_METADATA = 'https://archive.org/metadata/';
const TIMEOUT_PADRAO_MS = 8000;
const FORMATOS_AUDIO = /^(mp3|mpeg|ogg|oga|flac|wav|wave|m4a|aac|opus)$/i;
const LICENCAS_PERMITIDAS = [
    /creativecommons\.org\/(licenses\/(by|by-sa|by-nc|by-nd)|publicdomain|publicdomain\/zero)/i,
    /creativecommons\.org\/publicdomain/i,
    /public domain/i,
    /CC0/i
];

function temLicencaPermissiva(metadata) {
    const valores = [
        metadata?.metadata?.licenseurl,
        metadata?.metadata?.rights,
        metadata?.metadata?.license
    ].filter(Boolean).map(String);

    return valores.some(valor => LICENCAS_PERMITIDAS.some(regex => regex.test(valor)));
}

function duracaoSegundos(valor) {
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
    const texto = String(valor || '').trim();
    if (!texto) return null;
    if (/^\d+(\.\d+)?$/.test(texto)) return Number(texto);
    const partes = texto.split(':').map(Number);
    if (!partes.every(Number.isFinite) || partes.length > 3) return null;
    return partes.reduce((total, parte) => total * 60 + parte, 0);
}

async function buscarJson(url, fetchImpl, timeoutMs) {
    const resposta = await fetchImpl(url, {
        headers: { 'User-Agent': 'NuvemBot/1.0 (audio search; contact: project owner)' },
        signal: AbortSignal.timeout(timeoutMs)
    });
    if (!resposta.ok) throw new Error(`Internet Archive respondeu HTTP ${resposta.status}`);
    return resposta.json();
}

/**
 * Pesquisa somente itens cujo metadado indique licença aberta/domínio público.
 * Retorna URLs diretas geradas a partir do host oficial archive.org; não segue
 * URLs arbitrárias fornecidas pelo usuário.
 */
export async function pesquisarInternetArchive(termo, {
    fetchImpl = globalThis.fetch,
    limite = 5,
    timeoutMs = TIMEOUT_PADRAO_MS
} = {}) {
    const consulta = String(termo || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 180);
    if (!consulta || typeof fetchImpl !== 'function') return [];

    const urlBusca = new URL(API_BUSCA);
    urlBusca.searchParams.set('q', `${consulta} AND mediatype:audio`);
    urlBusca.searchParams.append('fl[]', 'identifier');
    urlBusca.searchParams.append('fl[]', 'title');
    urlBusca.searchParams.set('rows', String(Math.max(1, Math.min(10, limite * 2))));
    urlBusca.searchParams.set('page', '1');
    urlBusca.searchParams.set('output', 'json');

    let busca;
    try {
        busca = await buscarJson(urlBusca.toString(), fetchImpl, timeoutMs);
    } catch (erro) {
        return [];
    }

    const docs = Array.isArray(busca?.response?.docs) ? busca.response.docs : [];
    const candidatos = [];
    const ids = docs
        .map(doc => String(doc?.identifier || ''))
        .filter(id => /^[a-zA-Z0-9._-]{1,180}$/.test(id));

    for (const id of ids) {
        if (candidatos.length >= limite) break;
        let item;
        try {
            item = await buscarJson(`${API_METADATA}${encodeURIComponent(id)}`, fetchImpl, timeoutMs);
        } catch {
            continue;
        }

        if (!temLicencaPermissiva(item)) continue;
        const arquivos = Array.isArray(item?.files) ? item.files : [];
        const arquivo = arquivos.find(file => {
            const nome = String(file?.name || '');
            const formato = String(file?.format || '').trim();
            return Boolean(
                nome &&
                !nome.includes('/') &&
                !nome.includes('..') &&
                !/[\u0000-\u001f\u007f]/.test(nome) &&
                FORMATOS_AUDIO.test(formato) &&
                file?.private !== 'true'
            );
        });
        if (!arquivo) continue;

        const nomeArquivo = String(arquivo.name);
        const duracao = duracaoSegundos(arquivo.length || arquivo.duration);
        candidatos.push({
            url: `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(nomeArquivo)}`,
            titulo: String(item?.metadata?.title || docs.find(doc => doc.identifier === id)?.title || nomeArquivo).slice(0, 180),
            canal: 'Internet Archive (licença aberta)',
            duracao,
            fonte: 'Internet Archive'
        });
    }

    return candidatos;
}
