/**
 * Bid extraction with OpenAI or Gemini.
 *
 * Both providers get the same instructions and the same JSON schema, and must answer with
 * structured JSON (OpenAI Structured Outputs / Gemini responseSchema), so the result can be
 * stored and turned into a bid without free-text parsing. PDF attachments (tender documents)
 * are sent to the model directly; if a model refuses them, the email is retried as text only.
 */
import { config } from '../config.js';
import { HttpError } from '../http.js';
import type { AiProvider, BidExtraction } from '../types.js';

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: 'gpt-6-luna',
  gemini: 'gemini-3.5-flash'
};

/** Suggestions shown in Settings — any model ID the account can use is accepted. */
export const MODEL_SUGGESTIONS: Record<AiProvider, string[]> = {
  openai: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'],
  gemini: ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']
};

export interface EmailForAi {
  from: string;
  subject: string;
  receivedAt: Date;
  text: string;
  attachments: Array<{ filename: string; contentType: string; content?: Buffer }>;
}

export interface CompanyContext {
  name: string;
  companyType: string | null;
  sectors: string[];
  country: string | null;
}

export interface AiResult {
  extraction: BidExtraction;
  model: string;
  ms: number;
  attachmentsSent: string[];
}

const MAX_TEXT = 20000;
const MAX_PDFS = 3;
const MAX_PDF_BYTES = 8 * 1024 * 1024;

/* ---------------- prompt + schema ---------------- */

function instructions(company: CompanyContext, today: Date): string {
  return [
    `You triage the inbox of ${company.name}${company.companyType ? `, a ${company.companyType.toLowerCase()}` : ''}`,
    company.country ? ` based in ${company.country}` : '',
    company.sectors.length ? `, which bids for contracts in: ${company.sectors.join(', ')}` : '',
    '.\n\n',
    'Decide whether the email is a NEW bid opportunity the company could respond to: an invitation to tender, ',
    'RFP / RFQ / RFI / EOI, a procurement-portal or framework notice, a mini-competition or call-off, or a direct ',
    'request for a proposal or quote. Newsletters, marketing, invoices, receipts, internal chatter, meeting ',
    'invites, award or rejection notices, and replies about an already-tracked bid are NOT new opportunities.\n\n',
    'If it is an opportunity, extract the details. Rules:\n',
    '- Use only what the email and its attachments say. Never invent values; use null when unknown.\n',
    `- Today is ${today.toISOString().slice(0, 10)}. Give dueDate as YYYY-MM-DD (the submission deadline, not clarification dates).\n`,
    '- value: the contract value as a plain number in major units (e.g. 1840000), and currency as an ISO code (GBP, USD, INR, EUR).\n',
    '- title: a short name for the opportunity; client: the buying organisation; reference: their tender/RFP reference if given.\n',
    '- sector: one short label, preferably one of the company\'s sectors.\n',
    '- requirements: up to 8 short, actionable items the bid team must do or provide (documents, forms, site visits, deadlines).\n',
    '- summary: 1–3 sentences on what is being bought.\n',
    '- confidence: 0 to 1 — how sure you are this is a genuine new opportunity worth tracking.\n',
    '- reason: one sentence explaining the decision.'
  ].join('');
}

function emailText(email: EmailForAi, attachmentNames: string[]): string {
  const body = email.text.length > MAX_TEXT ? email.text.slice(0, MAX_TEXT) + '\n[… email truncated …]' : email.text;
  return [
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    `Received: ${email.receivedAt.toISOString()}`,
    email.attachments.length ? `Attachments: ${email.attachments.map((a) => a.filename).join(', ')}` : 'Attachments: none',
    attachmentNames.length ? `(The PDF attachments ${attachmentNames.join(', ')} are included for you to read.)` : '',
    '',
    body || '(no text body)'
  ].join('\n');
}

const FIELDS: Array<[keyof BidExtraction, 'string' | 'number' | 'boolean' | 'array', boolean]> = [
  ['isBid', 'boolean', false],
  ['confidence', 'number', false],
  ['reason', 'string', false],
  ['title', 'string', true],
  ['client', 'string', true],
  ['reference', 'string', true],
  ['sector', 'string', true],
  ['value', 'number', true],
  ['currency', 'string', true],
  ['dueDate', 'string', true],
  ['contactName', 'string', true],
  ['contactEmail', 'string', true],
  ['incumbent', 'string', true],
  ['summary', 'string', true],
  ['requirements', 'array', false]
];

/** JSON Schema for OpenAI Structured Outputs (strict: every key required, nullable via type unions). */
const openAiSchema = {
  type: 'object',
  additionalProperties: false,
  required: FIELDS.map(([k]) => k),
  properties: Object.fromEntries(
    FIELDS.map(([k, t, nullable]) => [
      k,
      t === 'array' ? { type: 'array', items: { type: 'string' } } : { type: nullable ? [t, 'null'] : t }
    ])
  )
};

/** OpenAPI-style schema for Gemini responseSchema. */
const geminiSchema = {
  type: 'OBJECT',
  required: FIELDS.map(([k]) => k),
  propertyOrdering: FIELDS.map(([k]) => k),
  properties: Object.fromEntries(
    FIELDS.map(([k, t, nullable]) => [
      k,
      t === 'array' ? { type: 'ARRAY', items: { type: 'STRING' } } : { type: t.toUpperCase(), ...(nullable ? { nullable: true } : {}) }
    ])
  )
};

/* ---------------- normalising the model's answer ---------------- */

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'unknown' ? s : null;
};

export function normalizeExtraction(raw: unknown): BidExtraction {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const valueNum = typeof r.value === 'number' ? r.value : Number(String(r.value ?? '').replace(/[^\d.]/g, ''));
  const due = str(r.dueDate);
  const dueOk = due && !Number.isNaN(Date.parse(due)) ? new Date(Date.parse(due)).toISOString().slice(0, 10) : null;
  const conf = Number(r.confidence);
  return {
    isBid: r.isBid === true || r.isBid === 'true',
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf > 1 ? conf / 100 : conf)) : 0,
    reason: str(r.reason) ?? '',
    title: str(r.title),
    client: str(r.client),
    reference: str(r.reference),
    sector: str(r.sector),
    value: Number.isFinite(valueNum) && valueNum > 0 ? Math.round(valueNum) : null,
    currency: str(r.currency)?.toUpperCase().slice(0, 3) ?? null,
    dueDate: dueOk,
    contactName: str(r.contactName),
    contactEmail: str(r.contactEmail),
    incumbent: str(r.incumbent),
    summary: str(r.summary),
    requirements: Array.isArray(r.requirements) ? r.requirements.map(str).filter((x): x is string => !!x).slice(0, 8) : []
  };
}

/* ---------------- provider calls ---------------- */

class ProviderError extends HttpError {
  constructor(
    public provider: AiProvider,
    public httpStatus: number,
    message: string
  ) {
    super(502, 'AI_PROVIDER_ERROR', message);
  }
}

function explain(provider: AiProvider, status: number, detail: string | undefined, model: string): string {
  const name = provider === 'openai' ? 'OpenAI' : 'Gemini';
  if (status === 401 || status === 403) return `${name} rejected the API key — check it in Settings.`;
  if (status === 404) return `${name} doesn't know the model "${model}" (or this key can't use it) — pick another in Settings.`;
  if (status === 429) return `${name} rate limit or quota reached — try again later or check billing on your ${name} account.`;
  return `${name} error ${status}${detail ? ': ' + detail : ''}`;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; json: any }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000)
    });
  } catch (err) {
    throw new HttpError(502, 'AI_UNREACHABLE', `Couldn't reach the AI provider: ${(err as Error).message}`);
  }
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function pdfsFor(email: EmailForAi, readAttachments: boolean) {
  if (!readAttachments) return [];
  return email.attachments
    .filter((a) => a.content && (a.contentType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf')))
    .filter((a) => (a.content?.length ?? 0) <= MAX_PDF_BYTES)
    .slice(0, MAX_PDFS);
}

async function callOpenAi(apiKey: string, model: string, system: string, email: EmailForAi, pdfs: ReturnType<typeof pdfsFor>) {
  const content: unknown[] = [{ type: 'text', text: emailText(email, pdfs.map((p) => p.filename)) }];
  for (const p of pdfs) {
    content.push({ type: 'file', file: { filename: p.filename, file_data: `data:application/pdf;base64,${p.content!.toString('base64')}` } });
  }
  const { status, json } = await postJson(
    `${config.openaiBaseUrl}/chat/completions`,
    { authorization: `Bearer ${apiKey}` },
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content }
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'bid_extraction', strict: true, schema: openAiSchema } }
    }
  );
  if (status >= 400) throw new ProviderError('openai', status, explain('openai', status, json?.error?.message, model));
  const message = json?.choices?.[0]?.message;
  if (message?.refusal) throw new ProviderError('openai', 200, `OpenAI declined to read this email: ${message.refusal}`);
  return JSON.parse(String(message?.content ?? '{}'));
}

async function callGemini(apiKey: string, model: string, system: string, email: EmailForAi, pdfs: ReturnType<typeof pdfsFor>) {
  const parts: unknown[] = [{ text: emailText(email, pdfs.map((p) => p.filename)) }];
  for (const p of pdfs) parts.push({ inlineData: { mimeType: 'application/pdf', data: p.content!.toString('base64') } });
  const { status, json } = await postJson(
    `${config.geminiBaseUrl}/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': apiKey },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: geminiSchema }
    }
  );
  if (status >= 400) throw new ProviderError('gemini', status, explain('gemini', status, json?.error?.message, model));
  const candidate = json?.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
  if (!text) {
    const why = json?.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'empty response';
    throw new ProviderError('gemini', 200, `Gemini returned no answer (${why}).`);
  }
  return JSON.parse(text);
}

/** Runs extraction with the chosen provider. Throws HttpError with a readable message on failure. */
export async function extractBid(opts: {
  provider: AiProvider;
  apiKey: string;
  model: string;
  email: EmailForAi;
  company: CompanyContext;
  readAttachments: boolean;
}): Promise<AiResult> {
  const started = Date.now();
  const system = instructions(opts.company, new Date());
  const call = opts.provider === 'openai' ? callOpenAi : callGemini;
  let pdfs = pdfsFor(opts.email, opts.readAttachments);

  let raw: unknown;
  try {
    raw = await call(opts.apiKey, opts.model, system, opts.email, pdfs);
  } catch (err) {
    // Some models can't take files — fall back to the email text alone.
    if (pdfs.length && err instanceof ProviderError && err.httpStatus === 400) {
      pdfs = [];
      raw = await call(opts.apiKey, opts.model, system, opts.email, pdfs);
    } else if (err instanceof SyntaxError) {
      throw new HttpError(502, 'AI_BAD_RESPONSE', 'The AI answered with something that is not valid JSON.');
    } else {
      throw err;
    }
  }

  return { extraction: normalizeExtraction(raw), model: opts.model, ms: Date.now() - started, attachmentsSent: pdfs.map((p) => p.filename) };
}

/** A tiny real request used by the "Test" button in Settings. */
export async function testProvider(provider: AiProvider, apiKey: string, model: string, company: CompanyContext): Promise<AiResult> {
  return extractBid({
    provider,
    apiKey,
    model,
    company,
    readAttachments: false,
    email: {
      from: 'procurement@example-council.gov',
      subject: 'Invitation to tender: Website redesign (ref ECX-2207)',
      receivedAt: new Date(),
      text: 'Example Council invites tenders for a website redesign, budget £120,000. Submissions close 30 days from today via our portal. Contact: Jo Smith.',
      attachments: []
    }
  });
}
