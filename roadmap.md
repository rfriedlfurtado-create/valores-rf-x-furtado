# Roadmap — Sistema Controle de Clientes / Já Pagos

## Fase 1 (escopo prioritário)
- [x] Habilitar banco de dados (Lovable Cloud)
- [x] Schema: clientes, variacoes_nome, pagamentos, importacoes, clientes_importados, correspondencias, correspondencias_rejeitadas
- [x] Design system financeiro (tokens, tipografia, dark/light)
- [x] Layout com menu lateral fixo + responsivo
- [x] Dashboard com cards e tabela "Já pagos identificados"
- [x] Clientes: lista, filtros, busca, ordenação
- [x] Perfil do cliente + registro de pagamento
- [x] Importar clientes: arquivo (xlsx/csv) e colagem manual
- [x] Motor de similaridade (normalização, Levenshtein, Jaro-Winkler, tokens)
- [x] Seção Já Pagos + modal comparativo (confirmar / rejeitar / depois)
- [x] Análise de nomes por faixa de probabilidade
- [x] Histórico de pagamentos
- [x] Histórico de importações + detalhe
- [x] Configurações (limiares de similaridade)
- [x] Head metadata por rota

## Futuro
- [x] Mapear mais colunas na importação (CPF, valor, data) — CPF exato tem prioridade máxima na correspondência
- Importação de Word
- Multiusuário / permissões
