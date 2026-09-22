import app from './app';
import { connectDB } from './config/db';
import { createServer, Server } from 'node:http';
import env from './config/env';

const PORT = env.PORT;
let shuttingDown = false;

export async function startServer(httpServer: Server): Promise<Server> {
	console.log('starting server');

	await connectDB();
	console.log('MongoDB connected');

	await new Promise((resolve) => {
		httpServer.listen(parseInt(PORT.toString()), '0.0.0.0', () => {
			console.log('connected at port: ', PORT);
			resolve(void 0);
		});
	});

	console.log('Server started successfully');
	return httpServer;
}

export async function gracefulShutdown(server?: Server) {
	if (shuttingDown) {
		console.log('Shutdown already in progress');
		return;
	}

	shuttingDown = true;
	const errors: unknown[] = [];
	console.log('gracefulShutdown started', new Error().stack);

	if (server) {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		}).catch((err) => errors.push(err));
	}

	if (errors.length > 0) {
		console.error('Shutdown completed with errors:', errors);
		throw new AggregateError(errors, 'Graceful shutdown encountered errors');
	}
}

const httpServer = createServer(app);
(async () => {
	try {
		await startServer(httpServer);
	} catch (error) {
		console.error('error at startServer:', error);
		process.exitCode = 0;
	}
})();

process.on('SIGTERM', () => gracefulShutdown(httpServer));
process.on('SIGINT', () => gracefulShutdown(httpServer));
