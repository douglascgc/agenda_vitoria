# Agenda Vitória

Aplicativo para organizar a agenda, o cadastro de pacientes e os recebimentos da Vitória.

## Abrir

Para testar a versão com conta e sincronização, execute `python -m http.server 8000 --bind 127.0.0.1` na pasta do repositório e abra [localhost:8000](http://localhost:8000). A página inicial leva à Agenda Vitória, que exige login por e-mail e senha na versão hospedada. O acesso em outros dispositivos requer hospedagem HTTPS.

O administrador cria o usuário aprovado em **Authentication → Users → Add user → Create new user**, com confirmação administrativa e senha definida fora do chat. A versão com conta salva as alterações imediatamente e verifica atualizações quando a janela volta ao foco. Se dois dispositivos editarem a mesma versão, a segunda gravação é recusada e o app carrega a versão atual.

Abrir `agenda.html` diretamente mantém o modo local, com os registros no navegador. Para levar registros locais a uma conta vazia, baixe o JSON em **Conta e backups** e importe o arquivo na versão com login. Use dados fictícios durante a validação.

## Backups e notificações

- O Supabase cria uma cópia diária após o primeiro salvamento. As cópias ficam no mesmo banco, com retenção de 30 dias. Em **Conta e backups**, é possível baixar os dados atuais ou baixar e restaurar uma cópia diária.
- Em **Conta e backups → Ativar notificações**, autorize o dispositivo. No iPhone, primeiro adicione o app à Tela de Início e abra por ela. O serviço verifica pendências a partir das 8h, horário de São Paulo, com novas tentativas durante a mesma hora. O aviso na tela bloqueada é genérico.
- O esquema inicial está em `supabase/setup.sql` e `supabase/push.sql`. A atualização `supabase/push-nonce.sql` faz o agendador usar credenciais descartáveis com validade de dois minutos. A função `agenda-alerts` precisa receber `supabase/functions/agenda-alerts/index.ts` e o `modelo.js` da raiz como arquivos adjacentes no pacote de deploy. Atualize a função se as regras de alerta em `modelo.js` mudarem.

## Hospedagem

Execute `node scripts/build-site.mjs` para preparar a pasta `dist`. Em uma hospedagem estática com HTTPS, configure esse comando e use `dist` como diretório de publicação. No Cloudflare Pages, conecte a branch `main` do GitHub, sem preset de framework.

## Google Calendário

No Google Cloud, habilite a **Google Calendar API**, configure a tela de consentimento e crie um cliente OAuth do tipo **Aplicativo da Web**. Em **Origens JavaScript autorizadas**, adicione a origem HTTPS em que o app for publicado, ou `http://localhost:8000` para desenvolvimento. Enquanto o app estiver no modo de teste do Google, adicione a conta da Vitória como usuária de teste. O escopo solicitado é `calendar.events.owned.readonly`.

Na Agenda, abra **Sincronizar Google**, informe o ID público do cliente OAuth e escolha o período. A Vitória autoriza a leitura da conta dela e seleciona quais eventos quer importar ou atualizar. A integração lê o calendário principal. Preserva a data, o horário e a duração, expande eventos recorrentes e verifica conflitos. O token fica em memória durante a consulta e títulos do Google só aparecem na revisão. O app não modifica o Google, não aplica cancelamentos automaticamente e não registra presença nem recebimentos durante a importação.

## Fluxos

- **Agenda**. Disponibilidade semanal, sessões de uma hora, repetição semanal, remarcação, cancelamento e falta. Horários sobrepostos são bloqueados.
- **Particular por sessão**. A conclusão cria uma cobrança que pode ser baixada no mesmo momento ou depois.
- **Ciclos de quatro sessões**. Sessões realizadas e perdas confirmadas consomem o ciclo. Cancelamentos com pelo menos duas horas de antecedência preservam a sessão. Faltas e cancelamentos tardios do ciclo aguardam decisão. O vencimento segue o primeiro atendimento do próximo ciclo.
- **Conexa**. Informe o valor esperado ao concluir cada atendimento. O financeiro agrupa as sessões por mês e concilia os recebimentos manualmente, com dia de conferência configurável.
- **Alertas**. O menu sinaliza cobranças, fechamento de ciclo, sessões a resolver e repasses. É possível registrar recebimento parcial, prorrogar, suspender o aviso ou encerrar o acompanhamento.
- **Indicadores**. Caixa por data de recebimento, valores gerados no mês, saldo em aberto, atividade e ocupação calculada sobre a disponibilidade configurada atualmente.

## Verificação

Execute `node --check app.js` e `node --test modelo.test.js`.
