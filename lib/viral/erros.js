export const CATEGORIAS_VIRAL = {
    RESTRITO: 'restrito',
    VERIFICACAO: 'verificacao',
    IDADE: 'idade',
    REMOVIDO: 'removido',
    REGIAO: 'regiao',
    BLOQUEIO: 'bloqueio',
    LIMITE: 'limite',
    REDE: 'rede',
    TIMEOUT: 'timeout',
    EXTRACAO: 'extracao',
    NAO_COMPATIVEL: 'nao-compativel',
    TAMANHO: 'tamanho',
    FFMPEG: 'ffmpeg',
    ARQUIVO: 'arquivo',
    ENVIO: 'envio',
    RECURSOS: 'recursos',
    DESCONHECIDO: 'desconhecido'
};

// Política de recuperação por categoria (critério transparente):
// - retentavel: vale repetir o MESMO candidato após espera (falhas transitórias).
// - aceitaProximoCandidato: vale tentar outro resultado da pesquisa (apenas busca por texto;
//   para link enviado pelo usuário, o candidato é único e nunca é substituído).
// - esperaBaseMs: base do backoff linear (base * tentativa, teto aplicado no pipeline).
// - rotulo: forma curta usada em mensagens de transição entre candidatos.
const POLITICA = {
    [CATEGORIAS_VIRAL.RESTRITO]: {
        retentavel: false,
        aceitaProximoCandidato: true,
        esperaBaseMs: 0,
        rotulo: 'conteúdo privado ou restrito'
    },
    [CATEGORIAS_VIRAL.VERIFICACAO]: {
        retentavel: false,
        aceitaProximoCandidato: true,
        esperaBaseMs: 0,
        rotulo: 'verificação anti-bot da plataforma'
    },
    [CATEGORIAS_VIRAL.IDADE]: {
        retentavel: false,
        aceitaProximoCandidato: true,
        esperaBaseMs: 0,
        rotulo: 'restrição de idade'
    },
    [CATEGORIAS_VIRAL.REMOVIDO]: {
        retentavel: false,
        aceitaProximoCandidato: true,
        esperaBaseMs: 0,
        rotulo: 'conteúdo removido ou indisponível'
    },
    [CATEGORIAS_VIRAL.REGIAO]: {
        retentavel: false,
        aceitaProximoCandidato: true,
        esperaBaseMs: 0,
        rotulo: 'bloqueio regional'
    },
    [CATEGORIAS_VIRAL.BLOQUEIO]: {
        retentavel: false,
        aceitaProximoCandidato: true,
        esperaBaseMs: 0,
        rotulo: 'bloqueio da plataforma (403)'
    },
    [CATEGORIAS_VIRAL.LIMITE]: {
        retentavel: true,
        aceitaProximoCandidato: false,
        esperaBaseMs: 8000,
        rotulo: 'limite de requisições'
    },
    [CATEGORIAS_VIRAL.REDE]: {
        retentavel: true,
        aceitaProximoCandidato: false,
        esperaBaseMs: 2000,
        rotulo: 'falha de rede'
    },
    [CATEGORIAS_VIRAL.TIMEOUT]: {
        retentavel: true,
        aceitaProximoCandidato: true,
        esperaBaseMs: 2000,
        rotulo: 'tempo esgotado'
    },
    [CATEGORIAS_VIRAL.EXTRACAO]: {
        retentavel: true,
        aceitaProximoCandidato: true,
        esperaBaseMs: 1500,
        rotulo: 'falha de extração de metadados'
    },
    [CATEGORIAS_VIRAL.NAO_COMPATIVEL]: {
        retentavel: false,
        aceitaProximoCandidato: true,
        esperaBaseMs: 0,
        rotulo: 'formato não compatível'
    },
    [CATEGORIAS_VIRAL.TAMANHO]: {
        retentavel: false,
        aceitaProximoCandidato: true,
        esperaBaseMs: 0,
        rotulo: 'arquivo acima do limite'
    },
    [CATEGORIAS_VIRAL.FFMPEG]: {
        retentavel: false,
        aceitaProximoCandidato: false,
        esperaBaseMs: 0,
        rotulo: 'falha de conversão de áudio'
    },
    [CATEGORIAS_VIRAL.ARQUIVO]: {
        retentavel: false,
        aceitaProximoCandidato: false,
        esperaBaseMs: 0,
        rotulo: 'arquivo inválido'
    },
    [CATEGORIAS_VIRAL.ENVIO]: {
        retentavel: false,
        aceitaProximoCandidato: false,
        esperaBaseMs: 0,
        rotulo: 'falha no envio pelo WhatsApp'
    },
    [CATEGORIAS_VIRAL.RECURSOS]: {
        retentavel: false,
        aceitaProximoCandidato: false,
        esperaBaseMs: 0,
        rotulo: 'recursos do servidor esgotados'
    },
    [CATEGORIAS_VIRAL.DESCONHECIDO]: {
        retentavel: true,
        aceitaProximoCandidato: false,
        esperaBaseMs: 2000,
        rotulo: 'erro não identificado'
    }
};

const PADROES = [
    {
        categoria: CATEGORIAS_VIRAL.IDADE,
        termos: [
            'age-restricted',
            'age restricted',
            'confirm your age',
            'inappropriate for some users',
            'only available for users 18'
        ]
    },
    {
        categoria: CATEGORIAS_VIRAL.VERIFICACAO,
        termos: [
            'not a bot',
            'confirm you are not a bot',
            'sign in to confirm',
            'captcha',
            'prove you are not a robot'
        ]
    },
    {
        categoria: CATEGORIAS_VIRAL.REGIAO,
        termos: [
            'not available in your country',
            'not made this video available in your country',
            'geo restricted',
            'geo-restricted',
            'blocked in your country',
            'blocked in your region',
            'not available in your region'
        ]
    },
    {
        categoria: CATEGORIAS_VIRAL.RESTRITO,
        termos: [
            'private video',
            'this video is private',
            'members-only',
            'members only',
            'members on level',
            'join this channel',
            'login required',
            'sign in if you',
            'only available to',
            'subscribers only',
            'requires authentication',
            'unauthenticated',
            'video is only available for'
        ]
    },
    {
        categoria: CATEGORIAS_VIRAL.REMOVIDO,
        termos: [
            'video unavailable',
            'has been removed',
            'no longer available',
            'removed by the uploader',
            'does not exist',
            'unavailable video',
            'is unavailable',
            'premieres in',
            'playlist does not exist'
        ]
    },
    {
        categoria: CATEGORIAS_VIRAL.NAO_COMPATIVEL,
        termos: [
            'unsupported url',
            'unsupported',
            'drm'
        ]
    },
    {
        categoria: CATEGORIAS_VIRAL.TAMANHO,
        termos: [
            'file is larger than',
            'file is too large',
            'larger than max',
            'max-filesize'
        ]
    },
    {
        categoria: CATEGORIAS_VIRAL.FFMPEG,
        termos: [
            'ffmpeg',
            'ffprobe',
            'postprocessing',
            'post-processing',
            'conversion failed'
        ]
    },
    {
        categoria: CATEGORIAS_VIRAL.LIMITE,
        termos: [
            'too many requests',
            'rate limit',
            'rate-limit',
            'throttl'
        ]
    },
    {
        categoria: CATEGORIAS_VIRAL.EXTRACAO,
        termos: [
            'failed to extract',
            'unable to extract',
            'no video formats',
            'player response',
            'nsig',
            'ejs',
            'challenge',
            'javascript runtime',
            'remote component',
            'retornou um json valido'
        ]
    },
    {
        categoria: CATEGORIAS_VIRAL.REDE,
        termos: [
            'getaddrinfo',
            'enotfound',
            'econnrefused',
            'econnreset',
            'etimedout',
            'network is unreachable',
            'temporary failure in name resolution',
            'connection reset',
            'connection aborted',
            'connection refused',
            'socket hang up',
            'unable to download webpage',
            'unable to resolve',
            'tls',
            'ssl',
            'certificate'
        ]
    },
    {
        categoria: CATEGORIAS_VIRAL.RECURSOS,
        termos: [
            'enospc',
            'no space left',
            'emfile',
            'too many open files'
        ]
    },
    {
        categoria: CATEGORIAS_VIRAL.TIMEOUT,
        termos: [
            'timed out',
            'time limit',
            'excedeu o tempo limite'
        ]
    }
];

function textoNormalizadoDoErro(erro) {
    return String(erro?.stderr || erro?.message || erro || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'");
}

function extrairCodigoHttp(texto) {
    const resultado = texto.match(/http error[: ]*\s*(\d{3})/i);

    return resultado ? Number(resultado[1]) : null;
}

function categoriaPorCodigoHttp(codigo) {
    if (codigo === 401) {
        return CATEGORIAS_VIRAL.RESTRITO;
    }

    if (codigo === 403) {
        return CATEGORIAS_VIRAL.BLOQUEIO;
    }

    if (codigo === 404 || codigo === 410) {
        return CATEGORIAS_VIRAL.REMOVIDO;
    }

    if (codigo === 429) {
        return CATEGORIAS_VIRAL.LIMITE;
    }

    if (codigo >= 500 && codigo <= 599) {
        return CATEGORIAS_VIRAL.REDE;
    }

    return null;
}

export function classificarErroViral(erro, { etapa = null } = {}) {
    const categoriaInformada = Object.values(CATEGORIAS_VIRAL).includes(
        erro?.categoriaViral
    );

    if (categoriaInformada) {
        return {
            categoria: erro.categoriaViral,
            ...POLITICA[erro.categoriaViral]
        };
    }

    if (etapa === 'envio') {
        return {
            categoria: CATEGORIAS_VIRAL.ENVIO,
            ...POLITICA[CATEGORIAS_VIRAL.ENVIO]
        };
    }

    if (etapa === 'validacao') {
        return {
            categoria: CATEGORIAS_VIRAL.ARQUIVO,
            ...POLITICA[CATEGORIAS_VIRAL.ARQUIVO]
        };
    }

    if (erro?.timeoutViral === true) {
        return {
            categoria: CATEGORIAS_VIRAL.TIMEOUT,
            ...POLITICA[CATEGORIAS_VIRAL.TIMEOUT]
        };
    }

    const texto = textoNormalizadoDoErro(erro);

    if (!texto) {
        return {
            categoria: CATEGORIAS_VIRAL.DESCONHECIDO,
            ...POLITICA[CATEGORIAS_VIRAL.DESCONHECIDO]
        };
    }

    const codigoHttp = extrairCodigoHttp(texto);

    if (codigoHttp) {
        const categoriaPorCodigo = categoriaPorCodigoHttp(codigoHttp);

        if (categoriaPorCodigo) {
            return {
                categoria: categoriaPorCodigo,
                ...POLITICA[categoriaPorCodigo]
            };
        }
    }

    for (const { categoria, termos } of PADROES) {
        if (termos.some(termo => texto.includes(termo))) {
            return {
                categoria,
                ...POLITICA[categoria]
            };
        }
    }

    return {
        categoria: CATEGORIAS_VIRAL.DESCONHECIDO,
        ...POLITICA[CATEGORIAS_VIRAL.DESCONHECIDO]
    };
}

function nomeServico(plataforma) {
    return plataforma && plataforma !== 'Outra' ? plataforma : 'A plataforma';
}

function mensagemDeClassificacao(classificacao, { plataforma = null, maxFilesizeMB = 25 } = {}) {
    const servico = nomeServico(plataforma);

    switch (classificacao.categoria) {
        case CATEGORIAS_VIRAL.VERIFICACAO:
            return (
                `🤖 *${servico} bloqueou o servidor*\n\n` +
                `A plataforma exigiu verificação anti-bot (comum em servidores de nuvem).\n` +
                `Isso costuma ser temporário.\n\n` +
                `⏰ Tente novamente em alguns minutos.\n\n` +
                `💡 Alternativa: envie o vídeo/áudio aqui e use /audio.`
            );

        case CATEGORIAS_VIRAL.RESTRITO:
            return (
                `🔒 *Conteúdo restrito*\n\n` +
                `O conteúdo é privado, exclusivo para membros ou exige login.\n` +
                `Não é possível baixar pelo servidor.\n\n` +
                `💡 Alternativa: envie o vídeo/áudio aqui e use /audio.`
            );

        case CATEGORIAS_VIRAL.IDADE:
            return (
                `🔞 *Restrição de idade*\n\n` +
                `Esse conteúdo exige verificação de idade e não pode ser acessado pelo servidor.\n\n` +
                `💡 Alternativa: envie o vídeo/áudio aqui e use /audio.`
            );

        case CATEGORIAS_VIRAL.REMOVIDO:
            return (
                `❌ *Conteúdo indisponível*\n\n` +
                `O vídeo foi removido ou não existe mais.\n\n` +
                `💡 Tente /viral com outro termo.`
            );

        case CATEGORIAS_VIRAL.REGIAO:
            return (
                `🌍 *Bloqueio regional*\n\n` +
                `Esse conteúdo não está disponível na região do servidor.\n\n` +
                `💡 Alternativa: envie o vídeo/áudio aqui e use /audio.`
            );

        case CATEGORIAS_VIRAL.BLOQUEIO:
            return (
                `🚫 *Bloqueio temporário*\n\n` +
                `${servico} bloqueou a requisição do servidor.\n` +
                `Isso é comum em servidores compartilhados.\n\n` +
                `⏰ Aguarde 2-5 minutos e tente novamente.\n\n` +
                `💡 Alternativa: envie o vídeo ou áudio aqui e use /audio.`
            );

        case CATEGORIAS_VIRAL.LIMITE:
            return (
                `⏱️ *Muitas requisições*\n\n` +
                `${servico} está limitando os downloads.\n\n` +
                `⏰ Aguarde 1-2 minutos antes de tentar novamente.\n\n` +
                `💡 Alternativa: envie o vídeo ou áudio aqui e use /audio.`
            );

        case CATEGORIAS_VIRAL.REDE:
            return (
                `🌐 *Falha de rede*\n\n` +
                `Não foi possível acessar a plataforma.\n\n` +
                `Tente novamente em instantes.`
            );

        case CATEGORIAS_VIRAL.TIMEOUT:
            return (
                `⏱️ *Tempo esgotado*\n\n` +
                `A operação demorou demais e foi cancelada.\n\n` +
                `Tente novamente com um termo mais específico ou um vídeo mais curto.`
            );

        case CATEGORIAS_VIRAL.EXTRACAO:
            return (
                `❌ ${servico} não permitiu a extração desse conteúdo.\n\n` +
                `O downloader está configurado com runtime JavaScript e EJS atualizado.\n\n` +
                `⏰ Tente novamente em alguns minutos.\n\n` +
                `💡 Alternativa: envie o vídeo ou áudio aqui e use /audio.`
            );

        case CATEGORIAS_VIRAL.NAO_COMPATIVEL:
            return (
                `❌ Esse link/formato não é compatível com o downloader.\n\n` +
                `💡 Você também pode enviar o arquivo de áudio diretamente aqui.`
            );

        case CATEGORIAS_VIRAL.TAMANHO:
            return (
                `📦 *Arquivo muito grande*\n\n` +
                `O áudio excede o limite de ${maxFilesizeMB}MB, mesmo em qualidade reduzida.\n\n` +
                `Tente um vídeo mais curto.`
            );

        case CATEGORIAS_VIRAL.FFMPEG:
            return (
                `⚠️ *Conversor indisponível*\n\n` +
                `O FFmpeg não está disponível no servidor no momento.\n\n` +
                `Tente novamente mais tarde.`
            );

        case CATEGORIAS_VIRAL.ARQUIVO:
            return (
                `❌ *Arquivo inválido*\n\n` +
                `O download terminou, mas o arquivo de áudio saiu vazio ou corrompido.\n\n` +
                `Tente novamente ou use outro termo/link.`
            );

        case CATEGORIAS_VIRAL.ENVIO:
            return (
                `📤 *Falha ao enviar*\n\n` +
                `O áudio foi obtido, mas o envio pelo WhatsApp falhou.\n\n` +
                `Tente novamente em instantes.`
            );

        case CATEGORIAS_VIRAL.RECURSOS:
            return (
                `⚠️ *Servidor sem recursos*\n\n` +
                `O servidor ficou sem espaço ou recursos temporariamente.\n\n` +
                `Tente novamente mais tarde.`
            );

        default:
            return (
                `❌ Não consegui baixar esse áudio.\n\n` +
                `Tente novamente ou use outro termo/link.\n\n` +
                `💡 Você também pode enviar o arquivo de áudio diretamente aqui.`
            );
    }
}

export function mensagemErroViral(erro, plataforma = null, maxFilesizeMB = 25) {
    const classificacao = classificarErroViral(erro);

    return mensagemDeClassificacao(classificacao, {
        plataforma,
        maxFilesizeMB
    });
}

const PRIORIDADE_FALHAS = [
    CATEGORIAS_VIRAL.VERIFICACAO,
    CATEGORIAS_VIRAL.LIMITE,
    CATEGORIAS_VIRAL.BLOQUEIO,
    CATEGORIAS_VIRAL.REDE,
    CATEGORIAS_VIRAL.TIMEOUT,
    CATEGORIAS_VIRAL.RESTRITO,
    CATEGORIAS_VIRAL.IDADE,
    CATEGORIAS_VIRAL.REGIAO,
    CATEGORIAS_VIRAL.REMOVIDO,
    CATEGORIAS_VIRAL.EXTRACAO,
    CATEGORIAS_VIRAL.TAMANHO,
    CATEGORIAS_VIRAL.FFMPEG,
    CATEGORIAS_VIRAL.NAO_COMPATIVEL,
    CATEGORIAS_VIRAL.RECURSOS,
    CATEGORIAS_VIRAL.ARQUIVO,
    CATEGORIAS_VIRAL.DESCONHECIDO
];

export function mensagemFalhaCandidatos(
    falhas = [],
    { plataforma = null, ehBusca = false, maxFilesizeMB = 25 } = {}
) {
    const categorias = new Set(
        (Array.isArray(falhas) ? falhas : [])
            .map(falha => falha?.categoria)
            .filter(Boolean)
    );

    let escolhida = CATEGORIAS_VIRAL.DESCONHECIDO;

    for (const categoria of PRIORIDADE_FALHAS) {
        if (categorias.has(categoria)) {
            escolhida = categoria;
            break;
        }
    }

    let mensagem = mensagemDeClassificacao(
        {
            categoria: escolhida,
            ...POLITICA[escolhida]
        },
        { plataforma, maxFilesizeMB }
    );

    if (!ehBusca && categorias.size > 0) {
        mensagem +=
            `\n\n💡 Esse link específico não pode ser baixado.` +
            `\nTente /viral com o nome da música para procurar outra fonte.`;
    }

    if (ehBusca && categorias.size > 1) {
        mensagem +=
            `\n\nℹ️ Tentei mais de um resultado da pesquisa sem sucesso.` +
            `\nTente um termo mais específico (artista + nome).`;
    }

    return mensagem;
}
