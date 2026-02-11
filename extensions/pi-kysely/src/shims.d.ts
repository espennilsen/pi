declare module "better-sqlite3" {
	const BetterSqlite3: any;
	export default BetterSqlite3;
}

declare module "pg" {
	export const Pool: any;
}

declare module "mysql2" {
	export function createPool(config: any): any;
}
