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

export {
    mensagemErroViral
} from './viral/erros.js';
