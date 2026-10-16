const API_BUSCA = 'https://archive.org/advancedsearch.php';
const API_METADATA = 'https://archive.org/metadata/';
const TIMEOUT_PADRAO_MS = 8000;
const LICENCAS_PERMITIDAS = [
    /^https?:\/\/creativecommons\.org\/licenses\/by(?:-nc)?(?:-sa)?\/\d+(?:\.\d+)?\/?$/i,
    /^https?:\/\/creativecommons\.org\/publicdomain\/zero\/\d+(?:\.\d+)?\/?$/i,
    /^https?:\/\/creativecommons\.org\/publicdomain\/mark\/\d+(?:\.\d+)?\/?$/i
];

function temLicencaPermissiva(item) {
    const valores = [
        item?.metadata?.licenseurl,
        item?.metadata?.license,
        item?.metadata?.rights
    ].filter(Boolean).map(valor => String(valor).trim());

    return valores.some(valor => {
        const url = valor.match(/^https?:\/\/creativecommons\.org\//i)?.[0]
            ? valor.replace(/[?#].*$/, '')
            : '';
        if (url && LICENCAS_PERMITIDAS.some(regex => regex.test(url))) return true;

        return /^(?:public domain|dom[ií]nio p[uú]blico|cc0(?:\s*1\.0)?)$/i.test(valor);
    });
}

function duracaoSegundos(valor) {
    if (typeof valor === 'number' && Number.isFinite(valor) && valor >= 0) return valor;
    const texto = String(valor || '').trim();
    if (!texto) return null;
    if (/^\d+(\.\d+)?$/.test(texto)) return Number(texto);
    const partes = texto.split(':').map(Number);
    if (partes.length > 3 || !partes.every(Number.isFinite) || partes.some(parte => parte < 0)) return null;
    return partes.reduce((total, parte) => total * 60 + parte, 0);
}

async function buscarJson(url, fetchImpl, timeoutMs) {
    const resposta = await fetchImpl(url, {
        headers: { 'User-Agent': 'NuvemBot/1.0 (audio search)' },
        signal: AbortSignal.timeout(timeoutMs)
    });
    if (!resposta?.ok) throw new Error(`Internet Archive respondeu HTTP ${resposta?.status ?? 'desconhecido'}`);
    return resposta.json();
}

/**
 * Busca áudio no Wikimedia Commons. Só aceita URLs HTTPS do próprio domínio
 * e licenças abertas reconhecidas nos metadados da API.
 */
export async function pesquisarWikimediaCommons(termo, {
    fetchImpl = globalThis.fetch,
    limite = 5,
    timeoutMs = TIMEOUT_PADRAO_MS
} = {}) {
    const quantidade = Number.isInteger(limite) ? Math.max(0, Math.min(5, limite)) : 5;
    const timeout = Number.isFinite(timeoutMs) ? Math.max(500, Math.min(15000, timeoutMs)) : TIMEOUT_PADRAO_MS;
    const consulta = String(termo || '')
        .replace(/[\\u0000-\\u001f\\u007f]/g, ' ')
        .replace(/[\\\\+!(){}\\[\\]^"~*?:]/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim()
        .slice(0, 150);
    if (!consulta || quantidade === 0 || typeof fetchImpl !== 'function') return [];

    const endpoint = new URL('https://commons.wikimedia.org/w/api.php');
    endpoint.searchParams.set('action', 'query');
    endpoint.searchParams.set('generator', 'search');
    endpoint.searchParams.set('gsrsearch', `filetype:audio ${consulta}`);
    endpoint.searchParams.set('gsrnamespace', '6');
    endpoint.searchParams.set('gsrlimit', String(Math.min(10, quantidade * 2)));
    endpoint.searchParams.set('prop', 'imageinfo');
    endpoint.searchParams.set('iiprop', 'url|extmetadata');
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('origin', '*');

    let resposta;
    try {
        resposta = await buscarJson(endpoint.toString(), fetchImpl, timeout);
    } catch {
        return [];
    }

    const paginas = Object.values(resposta?.query?.pages || {});
    const candidatos = [];
    for (const pagina of paginas) {
        if (candidatos.length >= quantidade) break;
        const info = pagina?.imageinfo?.[0];
        const url = String(info?.url || '');
        let host;
        try { host = new URL(url); } catch { continue; }
        if (host.protocol !== 'https:' || host.hostname !== 'upload.wikimedia.org') continue;

        const ext = info?.extmetadata || {};
        const licenseUrl = String(ext?.LicenseUrl?.value || '').trim();
        const licenseName = String(ext?.LicenseShortName?.value || '').trim();
        if (!temLicencaPermissiva({ metadata: { licenseurl: licenseUrl, license: licenseName } })) continue;
        if (!/\\.(?:mp3|ogg|oga|flac|wav|opus|m4a|aac)(?:$|[?#])/i.test(host.pathname)) continue;

        candidatos.push({
            url,
            titulo: String(ext?.ObjectName?.value || pagina?.title || 'Áudio do Wikimedia Commons')
                .replace(/<[^>]*>/g, '')
                .slice(0, 180),
            canal: 'Wikimedia Commons (licença aberta)',
            duracao: null,
            fonte: 'Wikimedia Commons'
        });
    }
    return candidatos;
}

/**
 * Pesquisa itens do Internet Archive e aceita apenas licenças explicitamente
 * reconhecidas. Falhas externas são tratadas pelo chamador como fonte indisponível.
 */
export async function pesquisarInternetArchive(termo, {
    fetchImpl = globalThis.fetch,
    limite = 5,
    timeoutMs = TIMEOUT_PADRAO_MS
} = {}) {
    const quantidade = Number.isInteger(limite) ? Math.max(0, Math.min(5, limite)) : 5;
    const timeout = Number.isFinite(timeoutMs) ? Math.max(500, Math.min(15000, timeoutMs)) : TIMEOUT_PADRAO_MS;
    const consulta = String(termo || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/[\\+!(){}\[\]^"~*?:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);

    if (!consulta || quantidade === 0 || typeof fetchImpl !== 'function') return [];

    const urlBusca = new URL(API_BUSCA);
    urlBusca.searchParams.set('q', `title:(${consulta}) AND mediatype:audio`);
    urlBusca.searchParams.append('fl[]', 'identifier');
    urlBusca.searchParams.append('fl[]', 'title');
    urlBusca.searchParams.set('rows', String(Math.min(20, quantidade * 4)));
    urlBusca.searchParams.set('page', '1');
    urlBusca.searchParams.set('output', 'json');

    let busca;
    try {
        busca = await buscarJson(urlBusca.toString(), fetchImpl, timeout);
    } catch {
        return [];
    }

    const docs = Array.isArray(busca?.response?.docs) ? busca.response.docs : [];
    const candidatos = [];
    const ids = [...new Set(docs
        .map(doc => String(doc?.identifier || ''))
        .filter(id => /^[a-zA-Z0-9._-]{1,180}$/.test(id)))];

    for (const id of ids) {
        if (candidatos.length >= quantidade) break;
        let item;
        try {
            item = await buscarJson(`${API_METADATA}${encodeURIComponent(id)}`, fetchImpl, timeout);
        } catch {
            continue;
        }

        if (!temLicencaPermissiva(item)) continue;
        const arquivos = Array.isArray(item?.files) ? item.files : [];
        const arquivo = arquivos.find(file => {
            const nome = String(file?.name || '');
            const formato = String(file?.format || '').trim();
            const bytes = Number(file?.size);
            return Boolean(
                nome &&
                !nome.includes('/') &&
                !nome.includes('\\') &&
                !nome.includes('..') &&
                !/[\u0000-\u001f\u007f]/.test(nome) &&
                /(?:^|\b)(mp3|mpeg|ogg|oga|flac|wav|wave|m4a|aac|opus)(?:\b|$)/i.test(formato) &&
                file?.private !== 'true' &&
                file?.private !== true &&
                (!Number.isFinite(bytes) || bytes > 0)
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
