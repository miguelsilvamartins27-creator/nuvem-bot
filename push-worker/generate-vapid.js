import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log('Copie estes valores diretamente para as variáveis de ambiente. Não publique a chave privada.');
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('VAPID_SUBJECT=mailto:SEU_EMAIL_DE_CONTATO');
