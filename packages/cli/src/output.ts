const useColor =
  process.stdout.isTTY === true &&
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb";

const ESC = String.fromCharCode(27);
const wrap = (open: number, close: number) => (s: string) =>
  useColor ? `${ESC}[${open}m${s}${ESC}[${close}m` : s;

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const cyan = wrap(36, 39);

export const tick = (): string => green("✓");
export const cross = (): string => red("✗");

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
