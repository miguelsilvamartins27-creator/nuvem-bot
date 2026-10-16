import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    textoSeguro,
    limitarTexto,
    isUrl,
    urlPublicaSegura,
    identificarPlataforma,
    obterStatusErro,
    erroEh429,
    erroTemporarioGroq,
    obterTempoRetry,
    mensagemErroViral
} from '../lib/utilidades.js';

describe('textoSeguro', () => {
    it('remove espaços nas bordas', () => {
        assert.equal(textoSeguro('  ola  '), 'ola');
    });

    it('remove retorno de carro', () => {
        assert.equal(textoSeguro('linha1\r\nlinha2'), 'linha1\nlinha2');
    });

    it('converte null e undefined em string vazia', () => {
        assert.equal(textoSeguro(null), '');
        assert.equal(textoSeguro(undefined), '');
    });

    it('converte números em string', () => {
        assert.equal(textoSeguro(42), '42');
    });
});

describe('limitarTexto', () => {
    it('mantém texto dentro do limite', () => {
        assert.equal(limitarTexto('curto', 10), 'curto');
    });

    it('trunca e adiciona reticências', () => {
        assert.equal(limitarTexto('1234567890', 5), '12345...');
    });

    it('usa limite padrão de 4000', () => {
        const texto = 'a'.repeat(5000);
        assert.equal(limitarTexto(texto).length, 4003);
    });
});

describe('isUrl', () => {
    it('aceita http e https', () => {
        assert.equal(isUrl('http://exemplo.com'), true);
        assert.equal(isUrl('https://exemplo.com/video'), true);
    });

    it('rejeita outros protocolos e texto inválido', () => {
        assert.equal(isUrl('ftp://exemplo.com'), false);
        assert.equal(isUrl('apenas texto'), false);
        assert.equal(isUrl(''), false);
    });
});

describe('urlPublicaSegura', () => {
    it('aceita URLs públicas http/https', () => {
        assert.equal(urlPublicaSegura('https://www.youtube.com/watch?v=abc'), true);
        assert.equal(urlPublicaSegura('http://8.8.8.8/video'), true);
    });

    it('rejeita protocolos não http', () => {
        assert.equal(urlPublicaSegura('ftp://exemplo.com'), false);
    });

    it('rejeita localhost e domínios internos', () => {
        assert.equal(urlPublicaSegura('http://localhost:3000'), false);
        assert.equal(urlPublicaSegura('http://0.0.0.0'), false);
        assert.equal(urlPublicaSegura('http://servidor.local'), false);
        assert.equal(urlPublicaSegura('http://api.internal'), false);
    });

    it('rejeita IPs privados e loopback', () => {
        assert.equal(urlPublicaSegura('http://127.0.0.1'), false);
        assert.equal(urlPublicaSegura('http://10.0.0.5'), false);
        assert.equal(urlPublicaSegura('http://192.168.1.1'), false);
        assert.equal(urlPublicaSegura('http://172.16.0.1'), false);
        assert.equal(urlPublicaSegura('http://172.31.255.1'), false);
        assert.equal(urlPublicaSegura('http://169.254.1.1'), false);
        assert.equal(urlPublicaSegura('http://0.1.2.3'), false);
    });

    it('aceita IP em faixa 172 fora do intervalo privado', () => {
        assert.equal(urlPublicaSegura('http://172.32.0.1'), true);
    });

    it('rejeita entrada vazia ou inválida', () => {
        assert.equal(urlPublicaSegura(''), false);
        assert.equal(urlPublicaSegura('nao e url'), false);
    });
});

describe('identificarPlataforma', () => {
    it('identifica YouTube', () => {
        assert.equal(identificarPlataforma('https://www.youtube.com/watch?v=x'), 'YouTube');
        assert.equal(identificarPlataforma('https://youtu.be/x'), 'YouTube');
        assert.equal(identificarPlataforma('https://music.youtube-nocookie.com/x'), 'YouTube');
    });

    it('identifica TikTok e Instagram', () => {
        assert.equal(identificarPlataforma('https://www.tiktok.com/@a/video/1'), 'TikTok');
        assert.equal(identificarPlataforma('https://www.instagram.com/reel/1'), 'Instagram');
        assert.equal(identificarPlataforma('https://instagr.am/p/1'), 'Instagram');
    });

    it('identifica SoundCloud, Twitter/X, Facebook, Vimeo e Twitch', () => {
        assert.equal(identificarPlataforma('https://soundcloud.com/a/b'), 'SoundCloud');
        assert.equal(identificarPlataforma('https://twitter.com/a/status/1'), 'Twitter/X');
        assert.equal(identificarPlataforma('https://x.com/a/status/1'), 'Twitter/X');
        assert.equal(identificarPlataforma('https://www.facebook.com/watch/1'), 'Facebook');
        assert.equal(identificarPlataforma('https://fb.watch/abc'), 'Facebook');
        assert.equal(identificarPlataforma('https://vimeo.com/123'), 'Vimeo');
        assert.equal(identificarPlataforma('https://www.twitch.tv/a'), 'Twitch');
    });

    it('retorna Outra para domínio desconhecido', () => {
        assert.equal(identificarPlataforma('https://exemplo.com/video'), 'Outra');
    });

    it('retorna null para URL inválida', () => {
        assert.equal(identificarPlataforma('nao e url'), null);
    });
});

describe('obterStatusErro', () => {
    it('lê status, statusCode e code numérico', () => {
        assert.equal(obterStatusErro({ status: 429 }), 429);
        assert.equal(obterStatusErro({ statusCode: 500 }), 500);
        assert.equal(obterStatusErro({ code: '503' }), 503);
    });

    it('retorna null quando não há status', () => {
        assert.equal(obterStatusErro({}), null);
        assert.equal(obterStatusErro({ code: 'ENOENT' }), null);
        assert.equal(obterStatusErro(null), null);
    });
});

describe('erroEh429', () => {
    it('detecta 429 por status', () => {
        assert.equal(erroEh429({ status: 429 }), true);
    });

    it('detecta 429 por mensagem', () => {
        assert.equal(erroEh429({ message: 'HTTP Error 429' }), true);
        assert.equal(erroEh429({ message: 'Rate limit exceeded' }), true);
        assert.equal(erroEh429({ message: 'Too Many Requests' }), true);
    });

    it('retorna false para outros erros', () => {
        assert.equal(erroEh429({ message: 'erro qualquer' }), false);
        assert.equal(erroEh429(null), false);
    });
});

describe('erroTemporarioGroq', () => {
    it('trata status temporários', () => {
        for (const status of [408, 429, 500, 502, 503, 504]) {
            assert.equal(erroTemporarioGroq({ status }), true);
        }
    });

    it('trata mensagens temporárias', () => {
        assert.equal(erroTemporarioGroq({ message: 'request timeout' }), true);
        assert.equal(erroTemporarioGroq({ message: 'model overloaded' }), true);
        assert.equal(erroTemporarioGroq({ message: 'temporarily unavailable' }), true);
    });

    it('retorna false para erro permanente', () => {
        assert.equal(erroTemporarioGroq({ status: 400 }), false);
        assert.equal(erroTemporarioGroq({ message: 'invalid api key' }), false);
    });
});

describe('obterTempoRetry', () => {
    it('extrai retry-after da mensagem', () => {
        assert.equal(obterTempoRetry({ message: 'Please retry after 30 seconds' }), 30);
        assert.equal(obterTempoRetry({ message: 'retry-after: 15' }), 15);
    });

    it('limita a 120 segundos', () => {
        assert.equal(obterTempoRetry({ message: 'retry after 999' }), 120);
    });

    it('usa 10 segundos como padrão', () => {
        assert.equal(obterTempoRetry({ message: 'erro genérico' }), 10);
        assert.equal(obterTempoRetry(null), 10);
    });
});

describe('mensagemErroViral', () => {
    it('mensagem para 403 cita a plataforma e plano B', () => {
        const msg = mensagemErroViral({ stderr: 'HTTP Error 403' }, 'YouTube');
        assert.match(msg, /Bloqueio/);
        assert.match(msg, /YouTube/);
        assert.match(msg, /\/audio/);
    });

    it('mensagem para 429', () => {
        const msg = mensagemErroViral({ stderr: 'HTTP Error 429' }, 'TikTok');
        assert.match(msg, /Muitas requisições/);
        assert.match(msg, /TikTok/);
    });

    it('mensagem para arquivo muito grande usa o limite parametrizado', () => {
        const msg = mensagemErroViral({ message: 'file is too large' }, null, 50);
        assert.match(msg, /50MB/);
    });

    it('mensagem para ffmpeg ausente', () => {
        const msg = mensagemErroViral({ message: 'ffmpeg not found' });
        assert.match(msg, /Conversor indisponível/);
    });

    it('mensagem para timeout', () => {
        const msg = mensagemErroViral({ message: 'download timed out' });
        assert.match(msg, /demorou demais/);
    });

    it('mensagem para falha de rede', () => {
        const msg = mensagemErroViral({ message: 'getaddrinfo ENOTFOUND' });
        assert.match(msg, /Falha de rede/);
    });

    it('mensagem para conteúdo restrito', () => {
        const msg = mensagemErroViral({ message: 'Sign in to confirm you are not a bot' });
        assert.match(msg, /Conteúdo restrito/);
    });

    it('mensagem para vídeo indisponível', () => {
        const msg = mensagemErroViral({ stderr: 'ERROR: Video unavailable' });
        assert.match(msg, /não está disponível/);
    });

    it('mensagem genérica como fallback', () => {
        const msg = mensagemErroViral({ message: 'erro desconhecido xyz' });
        assert.match(msg, /Não consegui baixar/);
    });

    it('não quebra com entrada nula', () => {
        const msg = mensagemErroViral(null);
        assert.equal(typeof msg, 'string');
        assert.ok(msg.length > 0);
    });
});
