import type { ReportScheduleInput } from '../schemas/reportSchedule.schema';

const parts = (time: Date) => {
	const values = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Istanbul',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(time);
	const get = (key: string) =>
		Number(values.find((value) => value.type === key)!.value);
	return {
		year: get('year'),
		month: get('month'),
		day: get('day'),
		hour: get('hour'),
		minute: get('minute'),
		second: get('second'),
	};
};
function istanbulTime(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
) {
	const desired = Date.UTC(year, month - 1, day, hour, minute);
	let candidate = desired;
	for (let i = 0; i < 3; i++) {
		const shown = parts(new Date(candidate));
		candidate -=
			Date.UTC(
				shown.year,
				shown.month - 1,
				shown.day,
				shown.hour,
				shown.minute,
				shown.second,
			) - desired;
	}
	return new Date(candidate);
}
export function nextReportRun(
	schedule: Pick<
		ReportScheduleInput,
		'frequency' | 'time' | 'weekday' | 'monthDay'
	>,
	after = new Date(),
) {
	const today = parts(after),
		[hour, minute] = schedule.time.split(':').map(Number);
	for (let offset = 0; offset < 370; offset++) {
		const day = new Date(
			Date.UTC(today.year, today.month - 1, today.day + offset),
		);
		if (schedule.frequency === 'weekly' && day.getUTCDay() !== schedule.weekday)
			continue;
		if (
			schedule.frequency === 'monthly' &&
			day.getUTCDate() !== schedule.monthDay
		)
			continue;
		const candidate = istanbulTime(
			day.getUTCFullYear(),
			day.getUTCMonth() + 1,
			day.getUTCDate(),
			hour,
			minute,
		);
		if (candidate > after) return candidate;
	}
	throw new Error('Could not calculate next report time');
}
export function reportPeriodRange(
	period: ReportScheduleInput['relativePeriod'],
	now = new Date(),
): { from?: string; until?: string } {
	if (period === 'allTime') return {};
	const p = parts(now),
		date = new Date(Date.UTC(p.year, p.month - 1, p.day));
	const day = (offset: number) =>
		new Date(date.getTime() + offset * 86400000).toISOString().slice(0, 10);
	const today = day(0),
		monday = -((date.getUTCDay() + 6) % 7);
	switch (period) {
		case 'today':
			return { from: today, until: today };
		case 'yesterday':
			return { from: day(-1), until: day(-1) };
		case 'thisWeek':
			return { from: day(monday), until: today };
		case 'lastWeek':
			return { from: day(monday - 7), until: day(monday - 1) };
		case 'thisMonth':
			return { from: today.slice(0, 7) + '-01', until: today };
		case 'lastMonth':
			return {
				from: new Date(Date.UTC(p.year, p.month - 2, 1))
					.toISOString()
					.slice(0, 10),
				until: new Date(Date.UTC(p.year, p.month - 1, 0))
					.toISOString()
					.slice(0, 10),
			};
		case 'thisYear':
			return { from: p.year + '-01-01', until: today };
		case 'lastYear':
			return { from: p.year - 1 + '-01-01', until: p.year - 1 + '-12-31' };
		case 'last7Days':
			return { from: day(-6), until: today };
		case 'last30Days':
			return { from: day(-29), until: today };
	}
}
