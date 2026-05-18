import { createConsola } from "consola";

export interface Logger {
	info(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
	debug(message: string, ...args: unknown[]): void;
	trace(message: string, ...args: unknown[]): void;
}

function resolveLevel(): number {
	const raw = process.env.NQT_LOG_LEVEL;
	if (raw !== undefined) {
		const n = Number(raw);
		if (Number.isInteger(n) && n >= 0 && n <= 5) {
			return n;
		}
	}
	return 3; // info
}

const _consola = createConsola({ level: resolveLevel() });

export function setLogLevel(level: number): void {
	_consola.level = level;
}

export const logger: Logger = {
	info(message, ...args) {
		_consola.info(message, ...args);
	},
	warn(message, ...args) {
		_consola.warn(message, ...args);
	},
	error(message, ...args) {
		_consola.error(message, ...args);
	},
	debug(message, ...args) {
		_consola.debug(message, ...args);
	},
	trace(message, ...args) {
		_consola.trace(message, ...args);
	},
};
