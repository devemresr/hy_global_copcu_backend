/**
 * Hard-deletes one audit event referencing rule 1792266463169-q30603ssj4e.
 * Does not delete the rule itself or other events in its audit batch.
 *
 * Dry run by default:
 *   npm run logs:delete-rule-event
 *   npm run logs:delete-rule-event -- --run
 * If several events reference this rule, select the exact event shown by
 * the dry run using --event-id <MongoDB ObjectId>, then add --run.
 */
import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import { LogEvent, LOG_ENTITY_TYPES, type FieldChange } from '../models/LogEvent';

const RULE_ID = '1792266463169-q30603ssj4e';
const args = process.argv.slice(2);
const run = args.includes('--run');
let eventId: string | undefined;
for (let index = 0; index < args.length; index++) {
	if (args[index] === '--run') continue;
	if (args[index] === '--event-id' && eventId === undefined) {
		eventId = args[++index];
		if (!eventId || !/^[a-f\d]{24}$/i.test(eventId)) throw new Error('--event-id requires a 24-character MongoDB ObjectId');
	} else throw new Error(`Unknown or repeated option: ${args[index]}`);
}

function referencesRule(fields: FieldChange[]): boolean {
	return fields.some((field) => field.field === 'rule' && [field.previousValue, field.newValue].some((value) => {
		if (typeof value !== 'string') return false;
		try {
			const rule: unknown = JSON.parse(value);
			return typeof rule === 'object' && rule !== null && 'id' in rule && rule.id === RULE_ID;
		} catch { return false; }
	}));
}

async function main(): Promise<void> {
	// Even dry-run connections must not create indexes or collections.
	mongoose.set('autoIndex', false);
	mongoose.set('autoCreate', false);
	await connectDB();
	const idPattern = new RegExp(`"id"\\s*:\\s*"${RULE_ID}"`);
	const filter = {
		entityType: LOG_ENTITY_TYPES.ITEM_RULE,
		...(eventId ? { _id: new mongoose.Types.ObjectId(eventId) } : {}),
		fields: { $elemMatch: { field: 'rule', $or: [{ previousValue: idPattern }, { newValue: idPattern }] } },
	};
	const candidates = await LogEvent.find(filter).sort({ createdAt: 1 }).lean();
	// Check parsed JSON rather than relying on a substring match for deletion.
	const matches = candidates.filter((event) => referencesRule(event.fields));
	console.log(JSON.stringify({
		mode: run ? 'run' : 'dry-run',
		ruleId: RULE_ID,
		matchedCount: matches.length,
		events: matches.map((event) => ({
			eventId: String(event._id),
			action: event.action,
			ruleName: event.entityKey,
			adminUsername: event.adminUsername,
			createdAt: event.createdAt,
			batchId: event.batchId,
			fields: event.fields,
		})),
	}, null, 2));
	if (!run) {
		console.log('Dry run: nothing deleted. Review the event(s), then add --run. Use --event-id <id> if more than one matches.');
		return;
	}
	if (!matches.length) {
		console.log('No matching event found. Nothing deleted.');
		return;
	}
	if (matches.length !== 1) throw new Error('Multiple events reference this rule. Select exactly one using --event-id <id>; nothing deleted.');
	const target = matches[0];
	const result = await LogEvent.deleteOne({ ...filter, _id: target._id });
	console.log(JSON.stringify({ eventId: String(target._id), hardDeleted: result.deletedCount }));
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
}).finally(() => mongoose.disconnect());
