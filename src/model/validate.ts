import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import common from '../../schema/common.schema.json';
import pack from '../../schema/pack.schema.json';
import subject from '../../schema/subject.schema.json';
import dojo from '../../schema/dojo.schema.json';
import session from '../../schema/session.schema.json';
import event from '../../schema/event.schema.json';
import request from '../../schema/request.schema.json';
import response from '../../schema/response.schema.json';
import bundle from '../../schema/bundle.schema.json';
import work from '../../schema/work.schema.json';
import type { AiRequest, AiResponse, Bundle, Dojo, LogEvent, Pack, Session, SheetWork, Subject } from './types';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const s of [common, pack, subject, dojo, session, event, request, response, bundle, work]) ajv.addSchema(s);

const BASE = 'https://github.com/JakobGoelden/LearningCenter/schema/';

export type SchemaName =
  | 'pack'
  | 'subject'
  | 'dojo'
  | 'session'
  | 'event'
  | 'request'
  | 'response'
  | 'bundle'
  | 'work';

interface SchemaTypes {
  pack: Pack;
  subject: Subject;
  dojo: Dojo;
  session: Session;
  event: LogEvent;
  request: AiRequest;
  response: AiResponse;
  bundle: Bundle;
  work: SheetWork;
}

const cache = new Map<SchemaName, ValidateFunction>();

function validator(name: SchemaName): ValidateFunction {
  let fn = cache.get(name);
  if (!fn) {
    fn = ajv.getSchema(`${BASE}${name}.schema.json`);
    if (!fn) throw new Error(`Unknown schema: ${name}`);
    cache.set(name, fn);
  }
  return fn;
}

export class ValidationError extends Error {
  constructor(
    readonly schema: SchemaName,
    readonly where: string,
    readonly errors: ErrorObject[],
  ) {
    super(`${where}: ${formatErrors(errors)}`);
    this.name = 'ValidationError';
  }
}

export function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return 'unknown error';
  return errors
    .slice(0, 5)
    .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim())
    .join('; ');
}

/** Returns the error list, or null when `data` is valid. */
export function check(name: SchemaName, data: unknown): ErrorObject[] | null {
  const fn = validator(name);
  return fn(data) ? null : [...(fn.errors ?? [])];
}

/** Validates and narrows `data`, throwing a readable ValidationError otherwise. */
export function assertValid<N extends SchemaName>(
  name: N,
  data: unknown,
  where: string = name,
): SchemaTypes[N] {
  const errors = check(name, data);
  if (errors) throw new ValidationError(name, where, errors);
  return data as SchemaTypes[N];
}
