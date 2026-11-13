type Movement = {
	id: string;
	date: string;
	sequence: number;
	group: string;
	amountCents: number;
};
export const isExpense = (group: string) =>
	group === 'purchase' || group === 'other';

export function financeLedger<T extends Movement>(movements: T[]) {
	let balance = 0;
	return [...movements]
		.sort(
			(a, b) =>
				a.date.localeCompare(b.date) ||
				a.sequence - b.sequence ||
				a.id.localeCompare(b.id),
		)
		.map((row) => {
			const before = balance;
			balance += isExpense(row.group) ? -row.amountCents : row.amountCents;
			return {
				...row,
				balanceBefore: before / 100,
				balanceAfter: balance / 100,
			};
		});
}

export function dailyFinanceTotals(movements: Movement[]) {
	const days = new Map<
		string,
		{ date: string; income: number; expenses: number; count: number }
	>();
	for (const row of movements) {
		const day = days.get(row.date) ?? {
			date: row.date,
			income: 0,
			expenses: 0,
			count: 0,
		};
		if (isExpense(row.group)) day.expenses += row.amountCents;
		else day.income += row.amountCents;
		day.count++;
		days.set(row.date, day);
	}
	return [...days.values()]
		.sort((a, b) => b.date.localeCompare(a.date))
		.map((day) => ({
			...day,
			income: day.income / 100,
			expenses: day.expenses / 100,
			net: (day.income - day.expenses) / 100,
		}));
}
