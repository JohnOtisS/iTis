import { createHmac } from "node:crypto";

const SECRET_PATTERNS = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:api[_ -]?key|secret|password|mật khẩu|token)\s*[:=]\s*\S+/gi,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

const SENSITIVE_PATTERNS = [
  /\b(?:confidential|internal only|trade secret|private data|company data)\b/i,
  /\b(?:nội bộ|bảo mật|bí mật|dữ liệu công ty|bí mật kinh doanh)\b/i,
  /\b(?:salary|payroll|revenue|profit|customer list|employee list)\b/i,
  /\b(?:lương|bảng lương|doanh thu|lợi nhuận|danh sách khách hàng|danh sách nhân viên)\b/i,
  /\b(?:tax id|social security|passport|citizen id|identity card)\b/i,
  /\b(?:mã số thuế|căn cước|cccd|cmnd|hộ chiếu)\b/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:\+?\d[\s().-]?){9,15}/,
  /\b(?:\d[ -]*?){13,19}\b/,
  ...SECRET_PATTERNS.map((pattern) => new RegExp(pattern.source, pattern.flags.replace("g", ""))),
];

export function containsSecret(value: string) {
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

export function assessSensitiveData(value: string, hasAttachments = false) {
  const reasons: string[] = [];
  if (hasAttachments) reasons.push("attachment");
  for (const pattern of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) reasons.push("personal_or_company_data");
  }
  return { sensitive: reasons.length > 0, reasons: [...new Set(reasons)] };
}

export function externalSafetyIdentifier(userId: string) {
  const secret = process.env.SESSION_SECRET || "itis-local-privacy";
  return createHmac("sha256", secret).update(`openai:${userId}`).digest("hex").slice(0, 48);
}

export function createExternalRedactor(knownValues: Array<string | null | undefined>) {
  const replacements = new Map<string, string>();
  let counter = 0;
  const remember = (value: string, category: string) => {
    if (!value.trim()) return value;
    const existing = [...replacements.entries()].find(([, original]) => original === value)?.[0];
    if (existing) return existing;
    const token = `[PRIVATE_${category}_${++counter}]`;
    replacements.set(token, value);
    return token;
  };
  const protect = (input: string) => {
    let output = input;
    for (const pattern of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      output = output.replace(pattern, "[SECRET_REMOVED]");
    }
    for (const value of knownValues.filter((item): item is string => Boolean(item?.trim()))) {
      output = output.replaceAll(value, remember(value, "IDENTITY"));
    }
    output = output.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, (value) => remember(value, "EMAIL"));
    output = output.replace(/(?:\+?\d[\s().-]?){9,15}/g, (value) => remember(value, "PHONE"));
    output = output.replace(/\b(?:\d[ -]*?){13,19}\b/g, (value) => remember(value, "NUMBER"));
    return output;
  };
  const restore = (input: string) => {
    let output = input;
    for (const [token, original] of replacements) output = output.replaceAll(token, original);
    return output;
  };
  return { protect, restore };
}

