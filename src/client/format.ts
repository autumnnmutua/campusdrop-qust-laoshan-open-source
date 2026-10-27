/** Amount in fen as a price with cents, e.g. ¥2.00 — for orders, payments and refunds. */
export const money=(fen:number)=>`¥${(fen/100).toFixed(2)}`;
/** Amount in fen without trailing zero cents, e.g. ¥2 or ¥2.50 — for price lists and tips in running text. */
export const yuan=(fen:number)=>`¥${(fen/100).toFixed(fen%100?2:0)}`;
