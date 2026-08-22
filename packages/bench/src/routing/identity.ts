/**
 * The unified identity rule, shared by every layer that touches a fetch
 * result: a wire identity that was contradicted (identity_mismatch) or that
 * could not be observed (identity_unobserved) makes the result UNACCEPTABLE,
 * no matter how much content came back.
 *
 * ProviderSubject enforces it at the source (such results return
 * failed/identity_compromised, never success). LadderRunner enforces it on
 * anything a channel hands it (best-so-far never accepts it, handoff retries
 * cannot smuggle it through). w2l-provider exits non-zero on it.
 * RoutingHistory records it as contentful=0, failureClass=identity_mismatch.
 *
 * One predicate, imported everywhere — that is what "same semantics" means.
 * Not four copies that can drift.
 */

export function identityCompromised(
  trace: readonly { event: string }[],
): boolean {
  return trace.some(
    (t) => t.event === 'identity_mismatch' || t.event === 'identity_unobserved',
  )
}
