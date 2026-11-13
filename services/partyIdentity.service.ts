import { Bayi } from '../models/Bayi';
import { Investor } from '../models/Investor';
import { Order } from '../models/Order';
import { FinanceEntry } from '../models/Finance';
import { LogEvent, type FieldChange } from '../models/LogEvent';
import { normalizeBayiName } from '../schemas/bayi.schema';
import { normalizeBayiPhone } from '../util/bayiPhone';

type Party = {
	_id: unknown;
	name: string;
	phone?: string | null;
	createdAt: Date;
};
type Snapshot = {
	id?: unknown;
	name?: string | null;
	phone?: string | null;
	createdAt?: Date;
};
export class PartyDirectory {
	readonly records = new Map<string, Party>();
	private names = new Map<string, Set<string>>();
	private phones = new Map<string, Set<string>>();
	constructor(records: Party[]) {
		for (const row of records) {
			this.records.set(String(row._id), row);
			this.remember(row._id, row.name, row.phone);
		}
	}
	remember(id: unknown, name?: string | null, phone?: string | null) {
		const key = String(id ?? '');
		if (!this.records.has(key)) return false;
		let changed = false;
		for (const [map, value] of [
			[this.names, name ? normalizeBayiName(name) : ''],
			[this.phones, phone ? normalizeBayiPhone(phone) : ''],
		] as const) {
			if (value) {
				const ids = map.get(value) ?? new Set<string>();
				if (!ids.has(key)) changed = true;
				ids.add(key);
				map.set(value, ids);
			}
		}
		return changed;
	}
	resolve(snapshot: Snapshot): string | null {
		// An explicit ID stays authoritative even if its party has been removed.
		if (snapshot.id) return String(snapshot.id);
		const names = this.names.get(normalizeBayiName(snapshot.name ?? ''));
		const phones = this.phones.get(normalizeBayiPhone(snapshot.phone ?? ''));
		let ids = names
			? new Set(names)
			: phones
				? new Set(phones)
				: new Set<string>();
		if (snapshot.phone && phones && names)
			ids = new Set([...ids].filter((id) => phones.has(id)));
		else if (snapshot.phone && names && !phones) return null;
		// Never match a historical record to a party created after that record.
		if (snapshot.createdAt)
			ids = new Set(
				[...ids].filter(
					(id) => this.records.get(id)!.createdAt <= snapshot.createdAt!,
				),
			);
		return ids.size === 1 ? [...ids][0] : null;
	}
	currentName(id: unknown) {
		return this.records.get(String(id ?? ''))?.name ?? null;
	}
}
export async function loadPartyDirectory() {
	const [bayiler, investors, orders, entries, events] = await Promise.all([
		Bayi.find().select('name phone createdAt').lean(),
		Investor.find().select('name phone createdAt').lean(),
		Order.find().select('name bayiId bayiPhone createdAt').lean(),
		FinanceEntry.find()
			.select('investorId investorName investorPhone createdAt')
			.lean(),
		LogEvent.find({ entityType: { $in: ['bayi', 'investor'] } })
			.select('entityType entityKey bayiId investorId fields createdAt')
			.sort({ createdAt: 1, _id: 1 })
			.lean(),
	]);
	const bayi = new PartyDirectory(bayiler),
		investor = new PartyDirectory(investors);
	for (const row of orders)
		if (row.bayiId) bayi.remember(row.bayiId, row.name, row.bayiPhone);
	for (const row of entries)
		if (row.investorId)
			investor.remember(row.investorId, row.investorName, row.investorPhone);
	// Recover aliases from trustworthy IDs and uniquely resolvable older rename events.
	for (let pass = 0; pass <= events.length; pass++) {
		let changed = false;
		for (const event of events) {
			const directory = event.entityType === 'bayi' ? bayi : investor;
			const field = (name: string) =>
				event.fields.find((field: FieldChange) => field.field === name);
			const change = field('name'),
				phone = field('phone');
			const id = directory.resolve({
				id: event.entityType === 'bayi' ? event.bayiId : event.investorId,
				name: event.entityKey,
				phone: typeof phone?.newValue === 'string' ? phone.newValue : null,
				createdAt: event.createdAt,
			});
			if (id) {
				for (const name of [
					event.entityKey,
					change?.previousValue,
					change?.newValue,
				])
					if (typeof name === 'string')
						changed = directory.remember(id, name) || changed;
				for (const value of [phone?.previousValue, phone?.newValue])
					if (typeof value === 'string')
						changed = directory.remember(id, null, value) || changed;
			}
		}
		if (!changed) break;
	}
	const purchases = new Map(
		orders.map((row) => {
			const id = bayi.resolve({
				id: row.bayiId,
				name: row.name,
				phone: row.bayiPhone,
				createdAt: row.createdAt,
			});
			return [
				String(row._id),
				{
					bayiId: id,
					bayiName: row.name ?? '',
					currentBayiName: bayi.currentName(id),
				},
			] as const;
		}),
	);
	return { bayi, investor, purchases };
}

export type PartyIdentityEvent = {
	_id: unknown;
	entityType: string;
	entityId?: unknown;
	entityKey: string;
	bayiId?: unknown;
	bayiName?: string | null;
	investorId?: string | null;
	investorName?: string | null;
	bayis?: { bayiId?: string | null; bayiName: string }[] | null;
	fields: { field: string; newValue: unknown }[];
	createdAt: Date;
};
export function resolveLogPartyIdentity(
	event: PartyIdentityEvent,
	parties: Awaited<ReturnType<typeof loadPartyDirectory>>,
) {
	const purchase =
		event.entityType === 'stock_purchase'
			? parties.purchases.get(String(event.entityId))
			: undefined;
	const bayiName =
		event.bayiName ??
		purchase?.bayiName ??
		(event.entityType === 'bayi' ? event.entityKey : null);
	const rawInvestorName = event.fields.find(
		(field) => field.field === 'investor',
	)?.newValue;
	const investorName =
		event.investorName ??
		(event.entityType === 'investor'
			? event.entityKey
			: typeof rawInvestorName === 'string'
				? rawInvestorName
				: null);
	const phone = event.fields.find((field) => field.field === 'phone')?.newValue;
	const bayiId = parties.bayi.resolve({
		id:
			event.bayiId ??
			purchase?.bayiId ??
			(event.entityType === 'bayi' ? event.entityId : null),
		name: bayiName,
		phone:
			event.entityType === 'bayi' && typeof phone === 'string' ? phone : null,
		createdAt: event.createdAt,
	});
	const investorId = parties.investor.resolve({
		id: event.investorId,
		name: investorName,
		phone:
			event.entityType === 'investor' && typeof phone === 'string'
				? phone
				: null,
		createdAt: event.createdAt,
	});
	const bayis = (event.bayis ?? []).map((row) => ({
		...row,
		currentBayiName: parties.bayi.currentName(row.bayiId),
	}));
	return {
		bayis,
		bayiId,
		bayiName,
		currentBayiName: parties.bayi.currentName(bayiId),
		investorId,
		investorName,
		currentInvestorName: parties.investor.currentName(investorId),
	};
}
// Freeze uniquely resolved legacy associations before a name or phone can be reused.
// Only missing references are written; historical labels and amounts are untouched.
export async function preserveLegacyPartyLinks(
	kind: 'bayi' | 'investor',
	id: string,
) {
	const parties = await loadPartyDirectory();
	if (kind === 'bayi') {
		const ids = [...parties.purchases]
			.filter(([, party]) => party.bayiId === id)
			.map(([purchaseId]) => purchaseId);
		if (ids.length)
			await Order.updateMany(
				{ _id: { $in: ids }, bayiId: null },
				{ $set: { bayiId: id } },
				{ timestamps: false },
			);
	} else {
		const entries = await FinanceEntry.find({
			investorId: null,
			investorName: { $type: 'string' },
		}).lean();
		const ids = entries
			.filter(
				(row) =>
					parties.investor.resolve({
						name: row.investorName,
						phone: row.investorPhone,
						createdAt: row.createdAt,
					}) === id,
			)
			.map((row) => row._id);
		if (ids.length)
			await FinanceEntry.updateMany(
				{ _id: { $in: ids }, investorId: null },
				{ $set: { investorId: id } },
				{ timestamps: false },
			);
	}
	const field = kind === 'bayi' ? 'bayiId' : 'investorId';
	const events = await LogEvent.find({
		[field]: null,
		entityType: {
			$in:
				kind === 'bayi'
					? ['bayi', 'stock_purchase']
					: ['investor', 'finance_entry'],
		},
	}).lean();
	const ids = events
		.filter((event) => resolveLogPartyIdentity(event, parties)[field] === id)
		.map((event) => event._id);
	if (ids.length)
		await LogEvent.updateMany(
			{ _id: { $in: ids }, [field]: null },
			{ $set: { [field]: id } },
			{ timestamps: false },
		);
}
