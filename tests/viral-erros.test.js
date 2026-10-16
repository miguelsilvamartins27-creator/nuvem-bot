import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    CATEGORIAS_VIRAL,
    classificarErroViral,
    mensagemErroViral,
    mensagemFalhaCandidatos
} from '../lib/viral/erros.js';

describe('classificarErroViral', () => {
    it('verificação anti-bot não é conteúdo privado', () => {
        const cls = classificarErroViral({
            stderr: "ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies"
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.VERIFICACAO);
        assert.equal(cls.retentavel, false);
        assert.equal(cls.aceitaProximoCandidato, true);
    });

    it('conteúdo privado é restrito e não aceita retry', () => {
        const cls = classificarErroViral({
            stderr: 'ERROR: Private video. Sign in if you have been granted access to this video'
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.RESTRITO);
        assert.equal(cls.retentavel, false);
        assert.equal(cls.aceitaProximoCandidato, true);
    });

    it('conteúdo só para membros é restrito', () => {
        const cls = classificarErroViral({
            stderr: "ERROR: Join this channel to get access to members-only content"
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.RESTRITO);
    });

    it('"confirm your age" é restrição de idade, não anti-bot', () => {
        const cls = classificarErroViral({
            message: 'Sign in to confirm your age'
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.IDADE);
    });

    it('bloqueio regional', () => {
        const cls = classificarErroViral({
            stderr: 'ERROR: The uploader has not made this video available in your country'
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.REGIAO);
    });

    it('vídeo removido', () => {
        const cls = classificarErroViral({
            stderr: 'ERROR: Video unavailable'
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.REMOVIDO);
    });

    it('vídeo removido pelo uploader', () => {
        const cls = classificarErroViral({
            stderr: 'ERROR: This video has been removed by the uploader'
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.REMOVIDO);
    });

    it('HTTP 403 é bloqueio sem retry', () => {
        const cls = classificarErroViral({
            stderr: 'ERROR: unable to download video data: HTTP Error 403: Forbidden'
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.BLOQUEIO);
        assert.equal(cls.retentavel, false);
    });

    it('HTTP 429 é limite com retry', () => {
        const cls = classificarErroViral({
            stderr: 'ERROR: HTTP Error 429: Too Many Requests'
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.LIMITE);
        assert.equal(cls.retentavel, true);
        assert.equal(cls.aceitaProximoCandidato, false);
    });

    it('HTTP 503 é falha de rede com retry', () => {
        const cls = classificarErroViral({
            stderr: 'ERROR: unable to download webpage: HTTP Error 503'
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.REDE);
        assert.equal(cls.retentavel, true);
    });

    it('HTTP 404 é conteúdo removido', () => {
        const cls = classificarErroViral({
            message: 'HTTP Error 404: Not Found'
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.REMOVIDO);
    });

    it('falha de DNS é rede', () => {
        const cls = classificarErroViral({
            message: 'getaddrinfo ENOTFOUND www.youtube.com'
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.REDE);
    });

    it('timeout marcado pelo processo é timeout', () => {
        const erro = new Error('O yt-dlp excedeu o tempo limite.');
        erro.timeoutViral = true;

        const cls = classificarErroViral(erro);

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.TIMEOUT);
        assert.equal(cls.retentavel, true);
    });

    it('timeout por mensagem', () => {
        const cls = classificarErroViral({
            message: 'ERROR: The download timed out'
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.TIMEOUT);
    });

    it('falha de extração de player response', () => {
        const cls = classificarErroViral({
            stderr: 'ERROR: [youtube] abc: Failed to extract any player response'
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.EXTRACAO);
        assert.equal(cls.retentavel, true);
    });

    it('falha do ffmpeg não é retentável', () => {
        const cls = classificarErroViral({
            stderr: 'ERROR: Postprocessing: ffmpeg not found. Please install or provide the path'
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.FFMPEG);
        assert.equal(cls.retentavel, false);
        assert.equal(cls.aceitaProximoCandidato, false);
    });

    it('arquivo acima do limite', () => {
        const cls = classificarErroViral({
            stderr: '[download] File is larger than max-filesize (30.00MiB > 25.00MiB)'
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.TAMANHO);
    });

    it('formato não compatível', () => {
        const cls = classificarErroViral({
            stderr: 'ERROR: Unsupported URL: https://exemplo.com/video'
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.NAO_COMPATIVEL);
    });

    it('erro de envio pela etapa', () => {
        const cls = classificarErroViral(
            new Error('qualquer coisa'),
            { etapa: 'envio' }
        );

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.ENVIO);
        assert.equal(cls.aceitaProximoCandidato, false);
    });

    it('erro de validação de arquivo pela etapa', () => {
        const cls = classificarErroViral(
            new Error('arquivo vazio'),
            { etapa: 'validacao' }
        );

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.ARQUIVO);
    });

    it('categoria pré-marcada é respeitada', () => {
        const erro = new Error('ruído');
        erro.categoriaViral = 'envio';

        const cls = classificarErroViral(erro);

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.ENVIO);
    });

    it('disco cheio é recursos do servidor', () => {
        const cls = classificarErroViral({
            message: 'ENOSPC: no space left on device'
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.RECURSOS);
    });

    it('erro nulo cai em desconhecido', () => {
        const cls = classificarErroViral(null);

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.DESCONHECIDO);
    });

    it('erro incompreensível cai em desconhecido', () => {
        const cls = classificarErroViral({
            message: 'xyz abc 123'
        });

        assert.equal(cls.categoria, CATEGORIAS_VIRAL.DESCONHECIDO);
    });
});

describe('mensagemErroViral', () => {
    it('anti-bot tem mensagem própria e não cita conteúdo restrito', () => {
        const msg = mensagemErroViral({
            stderr: "Sign in to confirm you're not a bot"
        });

        assert.match(msg, /anti-bot/);
        assert.doesNotMatch(msg, /Conteúdo restrito/);
    });

    it('privado cita conteúdo restrito', () => {
        const msg = mensagemErroViral({
            stderr: 'Private video'
        });

        assert.match(msg, /Conteúdo restrito/);
    });

    it('envio tem mensagem distinta de busca', () => {
        const erro = new Error('socket fechado');
        erro.categoriaViral = 'envio';

        const msg = mensagemErroViral(erro);

        assert.match(msg, /Falha ao enviar/);
    });
});

describe('mensagemFalhaCandidatos', () => {
    it('prioriza verificação anti-bot quando presente', () => {
        const msg = mensagemFalhaCandidatos(
            [
                { categoria: CATEGORIAS_VIRAL.REMOVIDO },
                { categoria: CATEGORIAS_VIRAL.VERIFICACAO }
            ],
            { ehBusca: true }
        );

        assert.match(msg, /anti-bot/);
    });

    it('para link único sugere pesquisa por nome', () => {
        const msg = mensagemFalhaCandidatos(
            [{ categoria: CATEGORIAS_VIRAL.RESTRITO }],
            { ehBusca: false, plataforma: 'YouTube' }
        );

        assert.match(msg, /Conteúdo restrito/);
        assert.match(msg, /nome da música/);
    });

    it('para busca com várias falhas sugere termo mais específico', () => {
        const msg = mensagemFalhaCandidatos(
            [
                { categoria: CATEGORIAS_VIRAL.REMOVIDO },
                { categoria: CATEGORIAS_VIRAL.REGIAO }
            ],
            { ehBusca: true, plataforma: 'YouTube' }
        );

        assert.match(msg, /não está disponível|Bloqueio regional/);
        assert.match(msg, /termo mais específico/);
    });

    it('não quebra com lista vazia', () => {
        const msg = mensagemFalhaCandidatos([], { ehBusca: true });

        assert.equal(typeof msg, 'string');
        assert.ok(msg.length > 0);
    });
});
