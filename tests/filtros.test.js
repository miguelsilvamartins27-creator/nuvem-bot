import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    MOTIVOS_FILTRO,
    analisarMensagem
} from '../lib/filtros.js';

const MEU_CHAT = '5511999999999@s.whatsapp.net';

const OUTRO_CHAT = '5511888888888@s.whatsapp.net';

function criarMensagem(extra = {}, chaveExtra = {}) {
    return {
        key: {
            id: 'MSG1',
            remoteJid: MEU_CHAT,
            fromMe: true,
            ...chaveExtra
        },
        message: {
            conversation: 'oi'
        },
        ...extra
    };
}

describe('analisarMensagem', () => {
    it('aceita mensagem própria do chat autorizado', () => {
        const analise = analisarMensagem(
            criarMensagem(),
            { meuChat: MEU_CHAT }
        );

        assert.equal(analise.ok, true);
        assert.equal(analise.id, 'MSG1');
        assert.equal(analise.chatJid, MEU_CHAT);
        assert.equal(analise.motivo, null);
    });

    it('rejeita mensagem sem id', () => {
        const analise = analisarMensagem(
            criarMensagem({}, { id: undefined }),
            { meuChat: MEU_CHAT }
        );

        assert.equal(analise.ok, false);
        assert.equal(analise.motivo, MOTIVOS_FILTRO.SEM_ID);
        assert.equal(analise.id, null);
    });

    it('rejeita mensagem sem chatJid', () => {
        const analise = analisarMensagem(
            criarMensagem({}, { remoteJid: undefined }),
            { meuChat: MEU_CHAT }
        );

        assert.equal(analise.ok, false);
        assert.equal(analise.motivo, MOTIVOS_FILTRO.SEM_CHAT);
        assert.equal(analise.id, 'MSG1');
    });

    it('rejeita mensagem que não foi enviada por mim', () => {
        const analise = analisarMensagem(
            criarMensagem({}, { fromMe: false }),
            { meuChat: MEU_CHAT }
        );

        assert.equal(analise.ok, false);
        assert.equal(analise.motivo, MOTIVOS_FILTRO.NAO_E_MEU);
    });

    it('rejeita mensagem de outro chat', () => {
        const analise = analisarMensagem(
            criarMensagem({}, { remoteJid: OUTRO_CHAT }),
            { meuChat: MEU_CHAT }
        );

        assert.equal(analise.ok, false);
        assert.equal(analise.motivo, MOTIVOS_FILTRO.OUTRO_CHAT);
        assert.equal(analise.chatJid, OUTRO_CHAT);
    });

    it('rejeita tudo quando meuChat não está configurado', () => {
        const semConfig = analisarMensagem(
            criarMensagem(),
            {}
        );

        assert.equal(semConfig.ok, false);
        assert.equal(
            semConfig.motivo,
            MOTIVOS_FILTRO.OUTRO_CHAT
        );

        const semOpcoes = analisarMensagem(
            criarMensagem()
        );

        assert.equal(semOpcoes.ok, false);
    });

    it('rejeita mensagem nula ou sem key', () => {
        assert.equal(
            analisarMensagem(null, { meuChat: MEU_CHAT }).motivo,
            MOTIVOS_FILTRO.SEM_ID
        );

        assert.equal(
            analisarMensagem(undefined, { meuChat: MEU_CHAT }).motivo,
            MOTIVOS_FILTRO.SEM_ID
        );

        assert.equal(
            analisarMensagem({}, { meuChat: MEU_CHAT }).motivo,
            MOTIVOS_FILTRO.SEM_ID
        );
    });

    it('não modifica a mensagem recebida', () => {
        const mensagem = criarMensagem();

        Object.freeze(mensagem.key);
        Object.freeze(mensagem);

        const analise = analisarMensagem(
            mensagem,
            { meuChat: MEU_CHAT }
        );

        assert.equal(analise.ok, true);
        assert.equal(mensagem.key.id, 'MSG1');
    });
});
