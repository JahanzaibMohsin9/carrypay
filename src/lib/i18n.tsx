"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import type { Lang } from "@/domain/types";

const en = {
  overview: "Overview",
  activity: "Activity",
  money: "Money",
  documents: "Documents",
  security: "Security",
  yourCases: "Your cases",
  newCase: "New case",
  needsYou: "Needs your approval",
  review: "Review",
  paid: "Paid",
  inFlight: "On the way",
  toPay: "Still to pay",
  billTotal: "Bill",
  estimate: "Estimate",
  agentWorking: "CarryPay is working",
  agentIdle: "Watching your case",
  agentStopped: "Stopped by you",
  latest: "Latest from CarryPay",
  seeAll: "See all",
  allowances: "Allowances used",
  savings: "Saved vs. withdrawing cash abroad",
  route: "Money route",
  approvePayment: "Approve payment",
  holdToApprove: "Hold to approve",
  approved: "Approved",
  decline: "Decline",
  why: "Why this way",
  compare: "All the ways to pay",
  costBreakdown: "What you pay",
  checks: "Checked before asking you",
  arrives: "Arrives",
  instant: "Instantly",
  totalCost: "Total cost to you",
  verifiedAccount: "Verified account",
  docsToSign: "Forms you sign with this approval",
  messagePlaceholder: "Message CarryPay…",
  send: "Send",
  invoices: "Bills",
  payments: "Payments",
  noPayments: "No payments yet",
  emergencyStop: "Emergency stop",
  emergencyStopHint: "Instantly pauses the agent. Nothing moves until you turn it back on.",
  logIntegrity: "Activity log integrity",
  verifyNow: "Verify in this browser",
  download: "Download execution log",
  threats: "Blocked & flagged",
  rules: "Rules CarryPay follows",
  permissions: "What CarryPay may do",
  tierRead: "Read & check",
  tierCommunicate: "Write & prepare",
  tierMoney: "Move money",
  tierForbidden: "Never",
  tierReadHint: "Read emails and documents, compare routes, check rules",
  tierCommunicateHint: "Email the verified institution, fill in forms, message you",
  tierMoneyHint: "Only with your fingerprint approval, every time",
  tierForbiddenHint: "Unverified accounts, going over limits, splitting bills across relatives",
  from: "From",
  to: "To",
  day: "Day",
  you: "You",
  open: "Open",
  close: "Close",
  refundDue: "Refund on the way",
  refundReceived: "Refund received",
  allPaid: "All paid",
  protectedBy: "Protected",
  noThreats: "Nothing suspicious so far",
  routeBank: "Bank transfer",
  routeCard: "Card",
  routeAtm: "ATM cash",
  routeCash: "Carried cash",
  waitingEstimate: "Waiting for the hospital's estimate.",
  waitingFees: "Waiting for the fee statement.",
  nothingYet: "Nothing yet.",
  directToHospital: "direct to hospital",
  directToUniversity: "direct to university",
  savedVsCard: "Saved vs. paying by card",
  limitsNotePk: "Limits from State Bank of Pakistan rules. CarryPay never goes over them or borrows someone else's.",
  limitsNoteCn: "Limits from SAFE rules. CarryPay never goes over them or borrows someone else's quota.",
};

type Dict = typeof en;

const ur: Dict = {
  overview: "خلاصہ",
  activity: "سرگرمی",
  money: "رقم",
  documents: "دستاویزات",
  security: "حفاظت",
  yourCases: "آپ کے کیس",
  newCase: "نیا کیس",
  needsYou: "آپ کی منظوری درکار ہے",
  review: "دیکھیں",
  paid: "ادا شدہ",
  inFlight: "راستے میں",
  toPay: "باقی",
  billTotal: "بل",
  estimate: "تخمینہ",
  agentWorking: "کیری پے کام کر رہا ہے",
  agentIdle: "آپ کے کیس پر نظر ہے",
  agentStopped: "آپ نے روک دیا",
  latest: "کیری پے کی تازہ خبر",
  seeAll: "سب دیکھیں",
  allowances: "استعمال شدہ حدیں",
  savings: "بیرون ملک کیش نکالنے کے مقابلے میں بچت",
  route: "رقم کا راستہ",
  approvePayment: "ادائیگی کی منظوری",
  holdToApprove: "منظوری کے لیے دبائے رکھیں",
  approved: "منظور",
  decline: "انکار",
  why: "یہ طریقہ کیوں",
  compare: "ادائیگی کے تمام طریقے",
  costBreakdown: "آپ کیا ادا کریں گے",
  checks: "آپ سے پوچھنے سے پہلے جانچا گیا",
  arrives: "پہنچے گی",
  instant: "فوراً",
  totalCost: "آپ کی کل لاگت",
  verifiedAccount: "تصدیق شدہ اکاؤنٹ",
  docsToSign: "اس منظوری کے ساتھ دستخط ہونے والے فارم",
  messagePlaceholder: "کیری پے کو پیغام لکھیں…",
  send: "بھیجیں",
  invoices: "بل",
  payments: "ادائیگیاں",
  noPayments: "ابھی کوئی ادائیگی نہیں",
  emergencyStop: "ہنگامی بندش",
  emergencyStopHint: "ایجنٹ فوراً رک جائے گا۔ جب تک آپ دوبارہ نہ کھولیں کچھ نہیں ہوگا۔",
  logIntegrity: "سرگرمی ریکارڈ کی سالمیت",
  verifyNow: "اس براؤزر میں جانچیں",
  download: "ریکارڈ ڈاؤن لوڈ کریں",
  threats: "روکے گئے خطرات",
  rules: "قواعد جن پر کیری پے عمل کرتا ہے",
  permissions: "کیری پے کیا کر سکتا ہے",
  tierRead: "پڑھنا اور جانچنا",
  tierCommunicate: "لکھنا اور تیار کرنا",
  tierMoney: "رقم بھیجنا",
  tierForbidden: "کبھی نہیں",
  tierReadHint: "ای میلز اور دستاویزات پڑھنا، طریقوں کا موازنہ، قواعد کی جانچ",
  tierCommunicateHint: "تصدیق شدہ ادارے کو ای میل، فارم بھرنا، آپ کو پیغام",
  tierMoneyHint: "ہر بار صرف آپ کی فنگر پرنٹ منظوری سے",
  tierForbiddenHint: "غیر تصدیق شدہ اکاؤنٹ، حد سے تجاوز، رشتہ داروں میں بل تقسیم کرنا",
  from: "از",
  to: "بنام",
  day: "دن",
  you: "آپ",
  open: "کھولیں",
  close: "بند کریں",
  refundDue: "واپسی راستے میں ہے",
  refundReceived: "رقم واپس مل گئی",
  allPaid: "سب ادا ہو گیا",
  protectedBy: "محفوظ",
  noThreats: "ابھی تک کچھ مشکوک نہیں",
  routeBank: "بینک ٹرانسفر",
  routeCard: "کارڈ",
  routeAtm: "اے ٹی ایم کیش",
  routeCash: "ساتھ لایا گیا کیش",
  waitingEstimate: "ہسپتال کے تخمینے کا انتظار ہے۔",
  waitingFees: "فیس اسٹیٹمنٹ کا انتظار ہے۔",
  nothingYet: "ابھی کچھ نہیں۔",
  directToHospital: "براہ راست ہسپتال کو",
  directToUniversity: "براہ راست یونیورسٹی کو",
  savedVsCard: "کارڈ کے مقابلے میں بچت",
  limitsNotePk: "حدیں اسٹیٹ بینک آف پاکستان کے قواعد سے ہیں۔ کیری پے کبھی ان سے تجاوز نہیں کرتا اور نہ کسی اور کی حد استعمال کرتا ہے۔",
  limitsNoteCn: "حدیں SAFE کے قواعد سے ہیں۔ کیری پے کبھی ان سے تجاوز نہیں کرتا۔",
};

const zh: Dict = {
  overview: "概览",
  activity: "动态",
  money: "付款",
  documents: "文件",
  security: "安全",
  yourCases: "我的事项",
  newCase: "新建事项",
  needsYou: "需要您批准",
  review: "查看",
  paid: "已付",
  inFlight: "在途",
  toPay: "待付",
  billTotal: "账单",
  estimate: "预估",
  agentWorking: "CarryPay 正在处理",
  agentIdle: "正在关注您的事项",
  agentStopped: "已被您暂停",
  latest: "CarryPay 最新进展",
  seeAll: "查看全部",
  allowances: "额度使用情况",
  savings: "相比境外取现节省",
  route: "资金路径",
  approvePayment: "批准付款",
  holdToApprove: "长按批准",
  approved: "已批准",
  decline: "拒绝",
  why: "为什么这样付",
  compare: "所有付款方式",
  costBreakdown: "费用明细",
  checks: "批准前已核查",
  arrives: "到账",
  instant: "即时",
  totalCost: "您的总成本",
  verifiedAccount: "已核验账户",
  docsToSign: "本次批准一并签署的表格",
  messagePlaceholder: "给 CarryPay 发消息…",
  send: "发送",
  invoices: "账单",
  payments: "付款记录",
  noPayments: "暂无付款",
  emergencyStop: "紧急停止",
  emergencyStopHint: "立即暂停代理。您重新开启前不会有任何资金变动。",
  logIntegrity: "操作日志完整性",
  verifyNow: "在本浏览器中验证",
  download: "下载执行日志",
  threats: "已拦截与标记",
  rules: "CarryPay 遵循的规定",
  permissions: "CarryPay 的权限",
  tierRead: "读取与核查",
  tierCommunicate: "撰写与准备",
  tierMoney: "转出资金",
  tierForbidden: "绝不",
  tierReadHint: "阅读邮件和文件、比较付款方式、核查规定",
  tierCommunicateHint: "给已核验机构发邮件、填写表格、给您发消息",
  tierMoneyHint: "每一次都需要您的指纹批准",
  tierForbiddenHint: "未核验账户、超出额度、借用亲属额度分拆",
  from: "从",
  to: "到",
  day: "第",
  you: "您",
  open: "打开",
  close: "关闭",
  refundDue: "退款在途",
  refundReceived: "退款已到账",
  allPaid: "已全部付清",
  protectedBy: "受保护",
  noThreats: "目前没有可疑情况",
  routeBank: "银行电汇",
  routeCard: "刷卡",
  routeAtm: "ATM取现",
  routeCash: "携带现金",
  waitingEstimate: "正在等待医院的费用预估。",
  waitingFees: "正在等待学校的学费单。",
  nothingYet: "暂无动态。",
  directToHospital: "直接付给医院",
  directToUniversity: "直接付给学校",
  savedVsCard: "相比刷卡节省",
  limitsNotePk: "额度依据巴基斯坦国家银行规定。CarryPay 绝不超额，也不借用他人额度。",
  limitsNoteCn: "额度依据国家外汇管理局规定。CarryPay 绝不超额，也不借用他人额度（不“蚂蚁搬家”）。",
};

export const DICTS: Record<Lang, Dict> = { en, ur, zh };

export const ROUTE_KEY = { bank_transfer: "routeBank", card_payment: "routeCard", atm_cash: "routeAtm", carried_cash: "routeCash" } as const;
export type TKey = keyof Dict;

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: TKey) => string;
}

const Ctx = createContext<LangCtx>({ lang: "en", setLang: () => {}, t: (k) => en[k] });

// The chosen language lives in localStorage (per viewer) with an in-memory fallback.
const KEY = "carrypay.lang";
let memoryLang: Lang | null = null;
const listeners = new Set<() => void>();

function readLang(): Lang | null {
  try {
    const saved = localStorage.getItem(KEY) as Lang | null;
    if (saved && saved in DICTS) return saved;
  } catch {}
  return memoryLang;
}

function writeLang(l: Lang) {
  memoryLang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {}
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => e.key === KEY && fn();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function LangProvider({ children, initial }: { children: React.ReactNode; initial?: Lang }) {
  const lang = useSyncExternalStore(subscribe, () => readLang() ?? initial ?? "en", () => initial ?? "en");
  const setLang = writeLang;
  return <Ctx.Provider value={{ lang, setLang, t: (k) => DICTS[lang][k] ?? en[k] }}>{children}</Ctx.Provider>;
}

export function useT() {
  return useContext(Ctx);
}
