import type { CorridorId, Currency, Route } from "./types";

export interface Corridor {
  id: CorridorId;
  label: string;
  fromCountry: string;
  toCountry: string;
  fromCode: string;
  toCode: string;
  sourceCurrency: Currency;
  destCurrency: Currency;
  packId: "pk-sbp" | "cn-safe";
  /** map arc endpoints for the money-flow animation (lon, lat) */
  fromCity: { name: string; lon: number; lat: number };
  toCity: { name: string; lon: number; lat: number };
  routes: Route[];
}

export const CORRIDORS: Record<CorridorId, Corridor> = {
  "PK-TH": {
    id: "PK-TH",
    label: "Pakistan → Thailand",
    fromCountry: "Pakistan",
    toCountry: "Thailand",
    fromCode: "PK",
    toCode: "TH",
    sourceCurrency: "PKR",
    destCurrency: "THB",
    packId: "pk-sbp",
    fromCity: { name: "Lahore", lon: 74.35, lat: 31.55 },
    toCity: { name: "Bangkok", lon: 100.5, lat: 13.75 },
    routes: ["bank_transfer", "card_payment", "atm_cash", "carried_cash"],
  },
  "CN-GB": {
    id: "CN-GB",
    label: "China → United Kingdom",
    fromCountry: "China",
    toCountry: "United Kingdom",
    fromCode: "CN",
    toCode: "GB",
    sourceCurrency: "CNY",
    destCurrency: "GBP",
    packId: "cn-safe",
    fromCity: { name: "Shenzhen", lon: 114.06, lat: 22.54 },
    toCity: { name: "London", lon: -0.13, lat: 51.5 },
    routes: ["bank_transfer", "card_payment"],
  },
  "PK-GB": {
    id: "PK-GB",
    label: "Pakistan → United Kingdom",
    fromCountry: "Pakistan",
    toCountry: "United Kingdom",
    fromCode: "PK",
    toCode: "GB",
    sourceCurrency: "PKR",
    destCurrency: "GBP",
    packId: "pk-sbp",
    fromCity: { name: "Karachi", lon: 67.0, lat: 24.86 },
    toCity: { name: "London", lon: -0.13, lat: 51.5 },
    routes: ["bank_transfer", "card_payment"],
  },
};

export const ROUTE_LABEL: Record<Route, string> = {
  bank_transfer: "Bank transfer to the institution",
  card_payment: "Card payment at the institution",
  atm_cash: "Cash from an ATM abroad",
  carried_cash: "Foreign cash carried from home",
};

export const ROUTE_SHORT: Record<Route, string> = {
  bank_transfer: "Bank transfer",
  card_payment: "Card",
  atm_cash: "ATM cash",
  carried_cash: "Carried cash",
};
