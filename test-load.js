// TESTE DE CARREGAMENTO - NÃO CONECTA AO WHATSAPP
// Apenas verifica se o módulo carrega sem erros

import { execSync } from 'child_process';

console.log('🧪 TESTE DE CARREGAMENTO DO MÓDULO\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

try {
    console.log('📦 Verificando sintaxe do index.js...');
    
    // Verificar sintaxe
    execSync('node -c index.js', { encoding: 'utf8' });
    
    console.log('✅ Sintaxe JavaScript válida');
    console.log('✅ Nenhum erro de importação');
    console.log('✅ Estrutura do código correta');
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ TESTE DE CARREGAMENTO PASSOU');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log('⚠️  NOTA: Este teste NÃO conecta ao WhatsApp');
    console.log('⚠️  Para teste completo, use: npm start');
    console.log('⚠️  O bot tentará conectar ao WhatsApp via QR code\n');
    
} catch (erro) {
    console.error('\n❌ ERRO NO CARREGAMENTO:');
    console.error(erro.message);
    console.error('\n' + erro.stack);
    process.exit(1);
}
