# Crew Capital

Escritório 3D de agentes para OANDA Practice (DEMO).

## Executar

Node.js 22+ (testes usam node:sqlite) e Bash.

```sh
npm test
npm run build
npm run dev
```

A prévia exige configuração de autenticação; não disponibiliza banco D1 ou credenciais de produção automaticamente. Implantação atual usa Cloudflare Workers gerenciado pelo OpenAI Sites, D1 e migrações em `drizzle/`.

Segredos ficam exclusivamente no servidor. Consulte `.env.example`; não envie chaves ou senhas ao Git.

## Estado real em 29/10/2026

Interface 3D e integração OANDA demo implementadas. Calendário Forex Factory apresentou HTTP 429; novas operações são bloqueadas sem calendário válido. Chamada OpenAI e ciclo completo ainda precisam de validação. Agenda de análises autônomas ainda não ativada; relatório diário separado já agendado no Sites. Este repositório não ativa nem transfere automaticamente essas configurações.

Limites: US$500 virtuais, risco planejado US$2,50, bloqueio de perda diária US$10, uma posição por vez, IA estimada US$0,25/dia. Sem ambiente de dinheiro real.

Código importado da versão Sites 11, commit b838a4f4c55fe7695c793c9573bfdd8af0344866. Arquivos compilados são gerados pelo build. Three.js distribuído com sua licença em vendor/.
