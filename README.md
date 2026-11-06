# Agenda Vitória

Aplicativo para organizar a agenda, o cadastro de pacientes e os recebimentos da Vitória.

## Abrir

Para testar a versão com conta e sincronização, execute `python -m http.server 8000 --bind 127.0.0.1` na pasta do repositório e abra [localhost:8000](http://localhost:8000). O acesso em outros dispositivos requer hospedagem HTTPS. O projeto usa Supabase Auth por e-mail e senha e permite acesso aos dados somente aos endereços aprovados.

O administrador cria o usuário aprovado em **Authentication → Users → Add user → Create new user**, com confirmação administrativa e senha definida fora do chat. A versão com conta salva as alterações imediatamente e verifica atualizações quando a janela volta ao foco. Se dois dispositivos editarem a mesma versão, a segunda gravação é recusada e o app carrega a versão atual.

Abrir `index.html` diretamente mantém o modo local, com os registros no navegador. Para levar registros locais a uma conta vazia, baixe o JSON em **Conta e backups** e importe o arquivo na versão com login. Use dados fictícios durante a validação.

## Backups e notificações

- O Supabase cria uma cópia diária após o primeiro salvamento. As cópias ficam no mesmo banco, com retenção de 30 dias. Em **Conta e backups**, é possível baixar os dados atuais ou baixar e restaurar uma cópia diária.
- Em **Conta e backups → Ativar notificações**, autorize o dispositivo. No iPhone, primeiro adicione o app à Tela de Início e abra por ela. O serviço verifica pendências a partir das 8h, horário de São Paulo, com novas tentativas durante a mesma hora. O aviso na tela bloqueada é genérico.
- O esquema está em `supabase/setup.sql` e `supabase/push.sql`. A função `agenda-alerts` precisa receber `supabase/functions/agenda-alerts/index.ts` e o `modelo.js` da raiz como arquivos adjacentes no pacote de deploy. Atualize a função se as regras de alerta em `modelo.js` mudarem.

## Hospedagem

Execute `node scripts/build-site.mjs` para preparar a pasta `dist`. Em uma hospedagem estática com HTTPS, configure esse comando e use `dist` como diretório de publicação. No Cloudflare Pages, conecte a branch `main` do GitHub, sem preset de framework.

## Fluxos

- **Agenda**. Disponibilidade semanal, sessões de uma hora, repetição semanal, remarcação, cancelamento e falta. Horários sobrepostos são bloqueados.
- **Particular por sessão**. A conclusão cria uma cobrança que pode ser baixada no mesmo momento ou depois.
- **Ciclos de quatro sessões**. Sessões realizadas e perdas confirmadas consomem o ciclo. Cancelamentos com pelo menos duas horas de antecedência preservam a sessão. Faltas e cancelamentos tardios do ciclo aguardam decisão. O vencimento segue o primeiro atendimento do próximo ciclo.
- **Conexa**. Informe o valor esperado ao concluir cada atendimento. O financeiro agrupa as sessões por mês e concilia os recebimentos manualmente, com dia de conferência configurável.
- **Alertas**. O menu sinaliza cobranças, fechamento de ciclo, sessões a resolver e repasses. É possível registrar recebimento parcial, prorrogar, suspender o aviso ou encerrar o acompanhamento.
- **Indicadores**. Caixa por data de recebimento, valores gerados no mês, saldo em aberto, atividade e ocupação calculada sobre a disponibilidade configurada atualmente.

## Verificação

Execute `node --check app.js` e `node --test modelo.test.js`.
