'use strict';

self.addEventListener('push', event => {
  event.waitUntil(self.registration.showNotification('Agenda Vitória', {
    body: 'Você tem alertas pendentes. Abra a agenda para conferir.',
    tag: 'agenda-vitoria-pendencias'
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(new URL('agenda.html', self.location.href).href));
});
