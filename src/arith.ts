// Exact comparisons of products, so shares and floors never touch floating point.

/** The sign of a·b − c·d for non-negative safe integers. */
export function compareProducts(a: number, b: number, c: number, d: number): -1 | 0 | 1 {
  const left = BigInt(a) * BigInt(b);
  const right = BigInt(c) * BigInt(d);
  return left < right ? -1 : left > right ? 1 : 0;
}
