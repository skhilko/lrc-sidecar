import type { MatchDecision, MatchReason, ProviderLyricsRecord, ScoredCandidate, TrackIdentity } from "../domain/types.js";
import { scoreCandidate } from "./score.js";

export interface DecisionOptions { threshold: number; ambiguityMargin: number; lyricsMaxBytes: number }

export function decideSearchMatch(track: TrackIdentity, records: readonly ProviderLyricsRecord[], options: DecisionOptions): MatchDecision {
  const candidates = records.map((record) => scoreCandidate(track, record, options.lyricsMaxBytes))
    .sort((left, right) => right.score - left.score || left.record.id - right.record.id);
  const highestScoring = candidates[0];
  if (!highestScoring) return { decision: "reject", reasons: ["SCORE_BELOW_THRESHOLD"], candidates };
  const qualifying = candidates.filter((candidate) => qualifies(candidate, options.threshold));
  const top = qualifying[0];
  if (!top) {
    const reasons = unique([...highestScoring.reasons, ...(highestScoring.score < options.threshold ? ["SCORE_BELOW_THRESHOLD" as const] : [])]);
    return { decision: "reject", reasons, candidates };
  }
  const second = qualifying[1];
  if (second && top.score - second.score <= options.ambiguityMargin) {
    return { decision: "ambiguous", candidates: [top, second], reasons: ["COMPETING_CANDIDATE"] };
  }
  return { decision: "accept", candidate: top, score: top.score, reasons: top.reasons };
}

export function verifyExactMatch(track: TrackIdentity, record: ProviderLyricsRecord, lyricsMaxBytes: number): MatchDecision {
  const candidate = scoreCandidate(track, record, lyricsMaxBytes);
  const exactDuration = track.durationSeconds !== null && Math.abs(track.durationSeconds - record.duration) <= 2;
  if (candidate.titleApproved && candidate.artistApproved && exactDuration && !candidate.hardRejected) {
    return { decision: "accept", candidate, score: candidate.score, reasons: candidate.reasons };
  }
  const reasons: MatchReason[] = [...candidate.reasons];
  if (!exactDuration && !reasons.includes("DURATION_MISMATCH")) reasons.push("DURATION_MISMATCH");
  return { decision: "reject", reasons: unique(reasons), candidates: [candidate] };
}

function qualifies(candidate: ScoredCandidate, threshold: number): boolean {
  return candidate.score >= threshold && candidate.titleApproved && candidate.artistApproved && candidate.durationApproved && !candidate.hardRejected;
}

function unique<T>(items: readonly T[]): T[] { return [...new Set(items)]; }
