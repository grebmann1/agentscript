import { startServer } from './node.js';

const running = await startServer({
  onListen: info => {
    console.log(`Agent server listening on http://localhost:${info.port}`);
  },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    running.stop();
    process.exit(0);
  });
}
