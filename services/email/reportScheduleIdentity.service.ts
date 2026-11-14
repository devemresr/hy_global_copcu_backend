import { User } from '../../models/User';
export async function reportScheduleCreator(schedule: {
	createdBy?: unknown;
	createdByName?: string | null;
	updatedBy?: unknown;
	adminName?: string | null;
}) {
	const id = String(schedule.createdBy ?? '');
	const creator = id ? await User.findById(id).select('username').lean() : null;
	const historical =
		schedule.createdByName ||
		(String(schedule.updatedBy ?? schedule.createdBy) === id
			? schedule.adminName
			: null);
	return { id, name: creator?.username || historical || 'Bilinmeyen yönetici' };
}
