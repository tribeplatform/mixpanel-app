import '@/utils/env';
import '@utils/tracer';
import App from '@/app';
import HealthRoute from '@routes/health.route';
import IndexRoute from '@routes/index.route';
import WebhookRoute from '@/routes/webhook.route';

const app = new App({
  client: [new IndexRoute(), new HealthRoute()],
  server: [new WebhookRoute()],
});

app.listen();
