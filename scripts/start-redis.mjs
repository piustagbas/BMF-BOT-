/**
 * Starts an embedded Redis on 6379 for local/dev (no Docker/Homebrew required).
 * Usage: pnpm redis:start
 */
import net from 'node:net';
import { RedisMemoryServer } from 'redis-memory-server';

const port = Number(process.env.REDIS_PORT || 6379);

function portOpen(p) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: p }, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(800);
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

if (await portOpen(port)) {
  console.log(`Redis already listening on redis://127.0.0.1:${port} — nothing to start.`);
  process.exit(0);
}

const server = await RedisMemoryServer.create({
  instance: { port },
});

const host = await server.getHost();
const p = await server.getPort();
console.log(`Embedded Redis listening on redis://${host}:${p}`);
console.log('Keep this process running. Ctrl+C to stop.');

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await new Promise(() => {});
