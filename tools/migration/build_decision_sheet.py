#!/usr/bin/env python3
import json,sys
from pathlib import Path
def main(src,dst):
 d=json.loads(Path(src).read_text()); lines=['# High-risk canonical-publisher decision sheet','', 'Only the 14 groups still requiring explicit maintainer disposition are listed. No entry is approved automatically. Latest transaction data is direct evidence; first transaction and historical name ownership remain unavailable.','']
 for e in d['entries']:
  pubs=', '.join(e['publishers']); c=e['candidateCanonicalPublisher']; status=e['status']
  payloads=[r for r in e['resources'] if r['payloadAvailability']=='available']; unavailable=sum(r['payloadAvailability']=='unavailable' for r in e['resources'])
  deleted=sum(r['payloadClaims'].get('status')=='deleted' for r in payloads)
  blocks=[str(r['latestTransaction'].get('blockHeight')) for r in e['resources'] if r.get('latestTransaction')]
  lines += [f'## {e["entityType"]} `{e["entityId"]}` — `{status}`', '', f'- Candidate: `{c}` (Core created `{e["candidateCreated"]}`)', f'- Competing publishers: {pubs}', f'- Evidence supporting candidate: minimum Core-created resource; latest transaction/block metadata is available for this snapshot (`{" , ".join(blocks)}`).', '- Evidence against candidate: payload creator/author is not uniformly corroborating; later resources can be legitimate actor republications; first transaction is unavailable.', f'- Payload state: {len(payloads)} available, {unavailable} unavailable, {deleted} visible deletion payloads.', f'- Exact ambiguity: {e["manualReviewReason"]}; immutable-field and mutation-path comparison remains a human decision.', '- Safest options: retain compatibility-only; approve candidate only after first-publication evidence; or quarantine V2 adoption.', '- Recommended decision: `REVIEW-REQUIRED` pending maintainer review; preserve `QUARANTINE` for identifier-family conflicts/high publisher count.', '- Consequence of incorrect choice: grants V2 ownership to an operation actor or suppresses the legitimate creator.', '']
 Path(dst).write_text('\n'.join(lines))
if __name__=='__main__': main(sys.argv[1],sys.argv[2])
