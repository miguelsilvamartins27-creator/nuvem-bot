export function textoSeguro(texto) {
    return String(texto || '')
        .trim()
        .replace(/\r/g, '');
}

export function limitarTexto(texto, limite = 4000) {
    const valor = textoSeguro(texto);

    if (valor.length <= limite) {
        return valor;
    }

    return valor.slice(0, limite) + '...';
}

export function isUrl(texto) {
    try {
        const url = new URL(textoSeguro(texto));

        return ['http:', 'https:'].includes(url.protocol);
    } catch {
        return false;
    }
}

export function urlPublicaSegura(texto) {
    try {
        const url = new URL(textoSeguro(texto));

        if (!['http:', 'https:'].includes(url.protocol)) {
            return false;
        }

        const host = url.hostname.toLowerCase();

        if (!host) {
            return false;
        }

        if (
            host === 'localhost' ||
            host === '0.0.0.0' ||
            host === '::1' ||
            host === '[::1]' ||
            host.endsWith('.local') ||
            host.endsWith('.internal') ||
            host.endsWith('.localhost')
        ) {
            return false;
        }

        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
            const partes = host.split('.').map(Number);
            const [a, b] = partes;

            if (
                a === 0 ||
                a === 10 ||
                a === 127 ||
                (a === 169 && b === 254) ||
                (a === 192 && b === 168) ||
                (a === 172 && b >= 16 && b <= 31)
            ) {
                return false;
            }
        }

        return true;
    } catch {
        return false;
    }
}

export function identificarPlataforma(url) {
    try {
        const host = new URL(textoSeguro(url))
            .hostname
            .toLowerCase();

        if (
            host === 'youtu.be' ||
            host.endsWith('youtube.com') ||
            host.endsWith('youtube-nocookie.com')
        ) {
            return 'YouTube';
        }

        if (host.endsWith('tiktok.com')) {
            return 'TikTok';
        }

        if (
            host.endsWith('instagram.com') ||
            host.endsWith('instagr.am')
        ) {
            return 'Instagram';
        }

        if (host.endsWith('soundcloud.com')) {
            return 'SoundCloud';
        }

        if (host.endsWith('twitter.com') || host.endsWith('x.com')) {
            return 'Twitter/X';
        }

        if (host.endsWith('facebook.com') || host.endsWith('fb.watch')) {
            return 'Facebook';
        }

        if (host.endsWith('vimeo.com')) {
            return 'Vimeo';
        }

        if (host.endsWith('twitch.tv')) {
            return 'Twitch';
        }

        return 'Outra';
    } catch {
        return null;
    }
}

export function obterStatusErro(erro) {
    return (
        erro?.status ||
        erro?.statusCode ||
        (Number.isFinite(Number(erro?.code)) ? Number(erro.code) : null)
    );
}

export function erroEh429(erro) {
    const mensagem = String(erro?.message || erro || '').toLowerCase();
    const status = obterStatusErro(erro);

    return (
        status === 429 ||
        mensagem.includes('429') ||
        mensagem.includes('rate limit') ||
        mensagem.includes('too many requests')
    );
}

export function erroTemporarioGroq(erro) {
    const mensagem = String(erro?.message || erro || '').toLowerCase();
    const status = obterStatusErro(erro);

    return (
        status === 408 ||
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        mensagem.includes('timeout') ||
        mensagem.includes('overloaded') ||
        mensagem.includes('temporarily unavailable')
    );
}

export function obterTempoRetry(erro) {
    const mensagem = String(erro?.message || erro || '');

    const match = mensagem.match(/retry[- ]after["':\s]+["']?(\d+)/i);

    if (match) {
        const segundos = Number(match[1]);

        if (Number.isFinite(segundos) && segundos > 0) {
            return Math.min(segundos, 120);
        }
    }

    return 10;
}

export function mensagemErroViral(erro, plataforma = null, maxFilesizeMB = 25) {
    const mensagem = String(
        erro?.stderr || erro?.message || erro || ''
    ).toLowerCase();

    const httpCode = erro?.stderr?.match(/http error (\d+)/i)?.[1];

    const nomeServico =
        plataforma && plataforma !== 'Outra' ? plataforma : 'A plataforma';

    if (httpCode === '403') {
        return (
            `🚫 *Bloqueio temporário*\n\n` +
            `${nomeServico} bloqueou a requisição do servidor.\n` +
            `Isso é comum em servidores compartilhados.\n\n` +
            `⏰ Aguarde 2-5 minutos e tente novamente.\n\n` +
            `💡 Alternativa: envie o vídeo ou áudio aqui e use /audio.`
        );
    }

    if (
        httpCode === '429' ||
        mensagem.includes('too many requests') ||
        mensagem.includes('rate limit')
    ) {
        return (
            `⏱️ *Muitas requisições*\n\n` +
            `${nomeServico} está limitando os downloads.\n\n` +
            `⏰ Aguarde 1-2 minutos antes de tentar novamente.\n\n` +
            `💡 Alternativa: envie o vídeo ou áudio aqui e use /audio.`
        );
    }

    if (
        mensagem.includes('file is too large') ||
        mensagem.includes('file larger than')
    ) {
        return (
            `📦 *Arquivo muito grande*\n\n` +
            `O áudio excede o limite de ${maxFilesizeMB}MB.\n\n` +
            `Tente um vídeo mais curto.`
        );
    }

    if (mensagem.includes('ffmpeg')) {
        return (
            '⚠️ *Conversor indisponível*\n\n' +
            'O FFmpeg não está disponível no servidor no momento.\n\n' +
            'Tente novamente mais tarde.'
        );
    }

    if (
        mensagem.includes('failed to extract any player response') ||
        mensagem.includes('javascript') ||
        mensagem.includes('ejs') ||
        mensagem.includes('challenge') ||
        mensagem.includes('player response')
    ) {
        return (
            `❌ ${nomeServico} não permitiu a extração desse conteúdo.\n\n` +
            'O downloader está configurado com runtime JavaScript e EJS atualizado.\n\n' +
            '💡 Alternativa: envie o vídeo ou áudio aqui e use /audio.'
        );
    }

    if (
        mensagem.includes('timed out') ||
        mensagem.includes('timeout') ||
        mensagem.includes('time limit')
    ) {
        return (
            '⏱️ O download demorou demais e foi cancelado.\n\n' +
            'Tente novamente com um vídeo mais curto.'
        );
    }

    if (
        mensagem.includes('unable to download webpage') ||
        mensagem.includes('getaddrinfo') ||
        mensagem.includes('network') ||
        mensagem.includes('socket') ||
        mensagem.includes('connection')
    ) {
        return (
            '🌐 *Falha de rede*\n\n' +
            'Não foi possível acessar a plataforma.\n\n' +
            'Verifique sua conexão e tente novamente.'
        );
    }

    if (
        mensagem.includes('nenhum resultado') ||
        mensagem.includes('no video results') ||
        mensagem.includes('no results')
    ) {
        return (
            '❌ Não encontrei esse áudio.\n\n' +
            'Tente outro nome ou termo.'
        );
    }

    if (
        mensagem.includes('private') ||
        mensagem.includes('login required') ||
        mensagem.includes('sign in') ||
        mensagem.includes('login_required') ||
        mensagem.includes('not a bot')
    ) {
        return (
            `🔒 *Conteúdo restrito*\n\n` +
            `Esse conteúdo exige acesso/login e não pôde ser baixado.\n\n` +
            `💡 Alternativa: envie o vídeo ou áudio aqui e use /audio.`
        );
    }

    if (mensagem.includes('unsupported')) {
        return (
            '❌ Esse link/formato não é compatível com o downloader.\n\n' +
            '💡 Você também pode enviar o arquivo de áudio diretamente aqui.'
        );
    }

    if (
        mensagem.includes('video unavailable') ||
        mensagem.includes('unavailable')
    ) {
        return (
            '❌ Esse vídeo não está disponível para reprodução.\n\n' +
            '💡 Alternativa: envie o vídeo ou áudio aqui e use /audio.'
        );
    }

    return (
        '❌ Não consegui baixar esse áudio.\n\n' +
        'Tente novamente ou use outro termo/link.\n\n' +
        '💡 Você também pode enviar o arquivo de áudio diretamente aqui.'
    );
}
