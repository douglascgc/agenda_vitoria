# Agenda Vitória

Aplicativo local para organizar a agenda, o cadastro de pacientes e os recebimentos da Vitória.

## Abrir

Abra `index.html` em um navegador moderno. Comece cadastrando um paciente e definindo a disponibilidade semanal. Também é possível servir os arquivos estáticos em localhost para manter uma origem fixa.

Os registros começam vazios e ficam no armazenamento do navegador, no perfil e endereço em que o app foi aberto. Limpar os dados do navegador pode apagar os registros. A versão local não tem login, sincronização, cópia de segurança automática ou envio de notificações em segundo plano. Use dados fictícios para validar o fluxo antes de cadastrar pacientes reais.

## Fluxos

- **Agenda**. Disponibilidade semanal, sessões de uma hora, repetição semanal, remarcação, cancelamento e falta. Horários sobrepostos são bloqueados.
- **Particular por sessão**. A conclusão cria uma cobrança que pode ser baixada no mesmo momento ou depois.
- **Ciclos de quatro sessões**. Sessões realizadas e perdas confirmadas consomem o ciclo. Cancelamentos com pelo menos duas horas de antecedência preservam a sessão. Faltas e cancelamentos tardios do ciclo aguardam decisão. O vencimento segue o primeiro atendimento do próximo ciclo.
- **Conexa**. Informe o valor esperado ao concluir cada atendimento. O financeiro agrupa as sessões por mês e concilia os recebimentos manualmente, com dia de conferência configurável.
- **Alertas**. O menu sinaliza cobranças, fechamento de ciclo, sessões a resolver e repasses. É possível registrar recebimento parcial, prorrogar, suspender o aviso ou encerrar o acompanhamento.
- **Indicadores**. Caixa por data de recebimento, valores gerados no mês, saldo em aberto, atividade e ocupação calculada sobre a disponibilidade configurada atualmente.

## Verificação

Execute `node --check app.js` e `node --test modelo.test.js`.
