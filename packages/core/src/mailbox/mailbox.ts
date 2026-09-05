import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type ConsultationRequest,
  ConsultationRequestSchema,
  type ReviewRequest,
  ReviewRequestSchema,
  type ReviewResponse,
  ReviewResponseSchema,
} from '@losina/schemas';
import { parse, stringify } from 'yaml';

function mailboxDir(runDir: string): string {
  return join(runDir, 'mailbox');
}

function requestPath(runDir: string, taskId: string, seq: number): string {
  return join(mailboxDir(runDir), `${taskId}.request.${seq}.yaml`);
}

function responsePath(runDir: string, taskId: string, seq: number): string {
  return join(mailboxDir(runDir), `${taskId}.response.${seq}.yaml`);
}

function consultationRequestPath(runDir: string, taskId: string, seq: number): string {
  return join(mailboxDir(runDir), `${taskId}.consultation.${seq}.yaml`);
}

export async function writeReviewRequest(runDir: string, request: ReviewRequest): Promise<string> {
  const validated = ReviewRequestSchema.parse(request);
  const path = requestPath(runDir, validated.taskId, validated.seq);
  await mkdir(mailboxDir(runDir), { recursive: true });
  await writeFile(path, stringify(validated), 'utf-8');
  return path;
}

export async function loadReviewRequest(path: string): Promise<ReviewRequest> {
  const raw = await readFile(path, 'utf-8');
  return ReviewRequestSchema.parse(parse(raw));
}

export async function writeReviewResponse(
  runDir: string,
  response: ReviewResponse,
): Promise<string> {
  const validated = ReviewResponseSchema.parse(response);
  const path = responsePath(runDir, validated.taskId, validated.seq);
  await mkdir(mailboxDir(runDir), { recursive: true });
  await writeFile(path, stringify(validated), 'utf-8');
  return path;
}

export async function loadReviewResponse(path: string): Promise<ReviewResponse> {
  const raw = await readFile(path, 'utf-8');
  return ReviewResponseSchema.parse(parse(raw));
}

export async function writeConsultationRequest(
  runDir: string,
  request: ConsultationRequest,
): Promise<string> {
  const validated = ConsultationRequestSchema.parse(request);
  const path = consultationRequestPath(runDir, validated.taskId, validated.seq);
  await mkdir(mailboxDir(runDir), { recursive: true });
  await writeFile(path, stringify(validated), 'utf-8');
  return path;
}

export async function loadConsultationRequest(path: string): Promise<ConsultationRequest> {
  const raw = await readFile(path, 'utf-8');
  return ConsultationRequestSchema.parse(parse(raw));
}
