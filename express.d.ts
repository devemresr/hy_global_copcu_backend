export type Primitive = string | number | boolean | null;

export type NestedObject = {
	[key: string]: Primitive | NestedObject | Primitive[];
};
declare global {
	namespace Express {
		interface Request {
			userId?: string;
			accessToken?: string;
			tokenRefreshNeeded?: boolean;
			validatedQuery?: NestedObject;
			// Set by authorize.middleware once a permission/role check passes -
			// downstream handlers reuse it instead of a second admin lookup.
			adminUsername?: string;
		}
	}
}
