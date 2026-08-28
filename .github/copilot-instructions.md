# Instruções do Projeto — Recanto Verde API (encomendasrv-api)

## Stack e Tecnologias

- **Framework**: NestJS 11
- **Banco de Dados**: MySQL 8+ via Knex
- **Linguagem**: TypeScript (strict)
- **Validação**: class-validator + class-transformer (ValidationPipe global)
- **Testes**: Jest (unitários e e2e)

## Retrocompatibilidade e Segurança de Deploy (Regra de Ouro)

- **Prioridade Absoluta para Retrocompatibilidade**: As atualizações no backend DEVEM priorizar rigorosamente a retrocompatibilidade com versões anteriores da aplicação (especialmente apps móveis em circulação nas lojas App Store / Google Play).
- **Evitar Breaking Changes**: Mudanças em contratos de endpoints, nomes de campos, DTOs ou estruturas de resposta JSON nunca devem quebrar versões antigas do app.
- **Se a quebra for inevitável, a modificação deve ser evitada**: Caso uma alteração pretendida não possa conviver de forma 100% segura com clientes móveis legados em produção, **a modificação não deve ser implementada**. Adote suporte Dual-Mode (ex.: parâmetros opcionais `paginate=true`, novos endpoints, compatibilidade retroativa) ou cancele a alteração.

## Regras de Arquitetura

- Todos os controllers são protegidos por padrão (`JwtAuthGuard`). Rotas públicas exigem `@Public()`.
- Controle de perfis deve usar `@Roles(...)` com os perfis do sistema (`super`, `admin`, `portaria`, `morador`).
- Injeção de banco de dados via token `KNEX_CONNECTION` (nunca importar `knex` diretamente).
- DTOs devem manter validações consistentes com o `ValidationPipe` global.

## Validação Antes de Finalizar

- `npm run lint` — Lint do código.
- `npm run test` — Testes unitários.
- `npm run test:e2e` — Testes end-to-end com banco de dados de teste.
