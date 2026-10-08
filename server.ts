// env must be the first import: it validates process.env before any other
// module is evaluated, and exits the process if anything is missing.
import env from './config/env';
import { createServer, type Server } from 'node:http';
import app from './app';
import { connectDB, disconnectDB } from './config/db';
import { initVersionState } from './services/sync/version.service';
import logger from './util/logger';

const log = logger.child({ module: 'server' });

// Docker sends SIGKILL 10s after SIGTERM; finish before that.
const SHUTDOWN_TIMEOUT_MS = 8_000;
let shuttingDown = false;

export async function startServer(httpServer: Server): Promise<Server> {
	log.info('Starting server');

	await connectDB();
	log.info('MongoDB connected');

	await initVersionState();

	await new Promise<void>((resolve, reject) => {
		httpServer.once('error', reject);
		httpServer.listen(env.PORT, '0.0.0.0', () => {
			httpServer.off('error', reject);
			resolve();
		});
	});

	log.info({ port: env.PORT }, 'Server listening');
	return httpServer;
}

export async function gracefulShutdown(server?: Server): Promise<void> {
	if (shuttingDown) {
		log.warn('Shutdown already in progress');
		return;
	}
	shuttingDown = true;
	log.info('Graceful shutdown started');

	const errors: unknown[] = [];

	// Stop accepting connections and wait for in-flight requests
	if (server?.listening) {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		}).catch((err: unknown) => errors.push(err));
	}

	await disconnectDB().catch((err: unknown) => errors.push(err));

	if (errors.length > 0) {
		throw new AggregateError(errors, 'Graceful shutdown encountered errors');
	}
	log.info('Shutdown complete');
}

async function shutdownAndExit(server: Server, signal: NodeJS.Signals): Promise<void> {
	log.info({ signal }, 'Received shutdown signal');
	const forceExit = setTimeout(() => {
		log.fatal({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Shutdown timed out, forcing exit');
		process.exit(1);
	}, SHUTDOWN_TIMEOUT_MS);
	forceExit.unref();

	try {
		await gracefulShutdown(server);
		process.exit(0);
	} catch (error) {
		log.error({ err: error }, 'Graceful shutdown failed');
		process.exit(1);
	}
}

const httpServer = createServer(app);

process.on('SIGTERM', (signal) => void shutdownAndExit(httpServer, signal));
process.on('SIGINT', (signal) => void shutdownAndExit(httpServer, signal));

try {
	await startServer(httpServer);
} catch (error) {
	log.fatal({ err: error }, 'Server failed to start');
	// Non-zero so Docker's restart policy kicks in
	await gracefulShutdown(httpServer).catch(() => {});
	process.exit(1);
}
