import type { TestProject } from 'vitest/node';
import { MongoMemoryServer } from 'mongodb-memory-server';

declare module 'vitest' {
	export interface ProvidedContext {
		mongoUri: string;
	}
}

// One in-memory MongoDB for the whole run; each test file connects to it and
// setup.ts drops the database before every test.
export default async function setup(project: TestProject) {
	const mongo = await MongoMemoryServer.create();
	project.provide('mongoUri', mongo.getUri());

	return async () => {
		await mongo.stop();
	};
}
