import fs from 'node:fs';

const productsUrl = new URL('../src/game/stars/purchaseProducts.json', import.meta.url);
export const PRODUCTS = JSON.parse(fs.readFileSync(productsUrl, 'utf8')).map((product) => ({
  ...product,
  amount: (product.pricePence / 100).toFixed(2),
}));

export function productBySku(sku) {
  return PRODUCTS.find((product) => product.sku === sku) ?? null;
}

export function paypalAmount(product) {
  return {
    currency_code: product.currency,
    value: product.amount,
  };
}
