import { LogEvent } from '../../models/LogEvent';
import type { LogAction, LogEntityType, FieldChange } from '../../models/LogEvent';
import logger from '../../util/logger';

const log = logger.child({ service: 'recordLogEvent' });

type RecordLogEventInput = {
	adminId: string;
	adminUsername: string;
	action: LogAction;
	entityType: LogEntityType;
	entityId: string;
	entityKey: string;
	fields: FieldChange[];
};

// Best-effort: the item write already committed by the time this runs, so a
// logging failure shouldn't turn a successful CRUD response into a 500.
export async function recordLogEvent(input: RecordLogEventInput): Promise<void> {
	try {
		await LogEvent.create(input);
	} catch (error) {
		log.error({ err: error, ...input }, 'Failed to record log event');
	}
}
