export const MOTIVOS_FILTRO = {
    SEM_ID: 'sem-id',
    SEM_CHAT: 'sem-chat',
    NAO_E_MEU: 'nao-e-meu',
    OUTRO_CHAT: 'outro-chat'
};

export function analisarMensagem(
    mensagem,
    { meuChat } = {}
) {
    const id =
        mensagem?.key?.id;

    if (!id) {
        return {
            ok: false,

            motivo:
                MOTIVOS_FILTRO.SEM_ID,

            id: null,

            chatJid: null
        };
    }

    const chatJid =
        mensagem?.key?.remoteJid;

    if (!chatJid) {
        return {
            ok: false,

            motivo:
                MOTIVOS_FILTRO.SEM_CHAT,

            id,

            chatJid: null
        };
    }

    if (!mensagem?.key?.fromMe) {
        return {
            ok: false,

            motivo:
                MOTIVOS_FILTRO.NAO_E_MEU,

            id,

            chatJid
        };
    }

    if (
        !meuChat ||
        chatJid !== meuChat
    ) {
        return {
            ok: false,

            motivo:
                MOTIVOS_FILTRO.OUTRO_CHAT,

            id,

            chatJid
        };
    }

    return {
        ok: true,

        motivo: null,

        id,

        chatJid
    };
}
