import { describe, expect, it } from 'vitest'
import allFailuresClassified from './all-failures-classified.json'

/**
 * R1-C: Quote state machine regression tests
 *
 * R0 found two distinct "no quote" situations that must be handled differently:
 *
 * 1. "unavailable_in_captured_context" (4 cases):
 *    - Page explicitly shows "Currently unavailable"
 *    - This is OBSERVED absence - we have evidence the quote doesn't exist
 *
 * 2. "purchase_options_only_in_capture" (23 cases):
 *    - Page shows "See All Buying Options" without selected quote
 *    - This is UNOBSERVED - we don't know if quote exists in unopened options
 *
 * R1 must distinguish these states and handle them differently.
 */
describe('R1-C: Quote state machine', () => {
  const unavailableCases = allFailuresClassified.classifications.unavailable_in_captured_context.cases
  const purchaseOptionsCases = allFailuresClassified.classifications.purchase_options_only_in_capture.cases

  describe('State 1: unavailable_in_captured_context', () => {
    it('has 4 cases with explicit unavailability signals', () => {
      expect(unavailableCases).toHaveLength(4)

      for (const testCase of unavailableCases) {
        expect(testCase.classification).toBe('unavailable_in_captured_context')
        expect(testCase.observation).toContain('Currently unavailable')
        expect(testCase.causeCertainty).toBe('capture_observation_only')
      }
    })

    it('documents the unavailability evidence', () => {
      // All 4 cases should have checked #availability or similar selectors
      for (const testCase of unavailableCases) {
        expect(testCase.witness.selectors).toBeDefined()
        // At least one selector should be related to availability
        const hasAvailabilitySelector = testCase.witness.selectors.some(
          (sel: string) => sel.includes('availability') || sel.includes('buybox')
        )
        expect(hasAvailabilitySelector).toBe(true)
      }
    })

    it('establishes observed vs inferred distinction', () => {
      // These cases have OBSERVED evidence that quote is absent
      // Future state machine should mark these as:
      // quoteState: 'absent_observed'
      // NOT: 'unobserved' or 'unknown'

      for (const testCase of unavailableCases) {
        expect(testCase.selectedQuote.visible).toBe(false)
        // The key insight: we have positive evidence of unavailability
        expect(testCase.observation).toMatch(/Currently unavailable|lacks a selected quote/)
      }
    })
  })

  describe('State 2: purchase_options_only_in_capture', () => {
    it('has 23 cases - the largest failure category', () => {
      expect(purchaseOptionsCases).toHaveLength(23)

      for (const testCase of purchaseOptionsCases) {
        expect(testCase.classification).toBe('purchase_options_only_in_capture')
        expect(testCase.observation).toContain('See All Buying Options')
        expect(testCase.observation).toContain('unopened options were not assessed')
      }
    })

    it('documents the uncertainty - unopened options', () => {
      // These cases are different: we see a path to MORE info, but didn't follow it
      // Future state machine should mark these as:
      // quoteState: 'unobserved'
      // expandable: true
      // NOT: 'absent_observed'

      for (const testCase of purchaseOptionsCases) {
        expect(testCase.selectedQuote.visible).toBe(false)
        expect(testCase.causeCertainty).toBe('capture_observation_only')
        // Key: we don't know if a quote exists in the unopened options
        expect(testCase.observation).toContain('unopened options were not assessed')
      }
    })

    it('identifies the selector evidence', () => {
      // Most should reference #buybox since that's where "See All Buying Options" appears
      const buyboxCount = purchaseOptionsCases.filter((tc: any) =>
        tc.witness.selectors.includes('#buybox')
      ).length

      expect(buyboxCount).toBeGreaterThan(15) // Most cases should use #buybox
    })
  })

  describe('Quote state machine requirements', () => {
    it('establishes four distinct quote states', () => {
      // Proposed state machine:
      // 1. 'present' - quote found and extracted
      // 2. 'absent_observed' - evidence that quote doesn't exist (4 "unavailable" cases)
      // 3. 'unobserved' - not found yet, may exist elsewhere (23 "options" cases)
      // 4. 'conflicting' - multiple conflicting quotes found

      expect(unavailableCases.length).toBe(4) // absent_observed
      expect(purchaseOptionsCases.length).toBe(23) // unobserved
    })

    it('documents readiness conditions', () => {
      // All 29 cases should have timing data showing browser phase
      const allCases = [...unavailableCases, ...purchaseOptionsCases]

      for (const testCase of allCases) {
        expect(testCase.timingsMs.browser).toBeGreaterThan(0)
        // Browser time should be reasonable (not too short)
        expect(testCase.timingsMs.browser).toBeGreaterThan(3000)
      }
    })

    it('separates extraction from waiting', () => {
      // R1 should not do infinite sleep
      // Instead: bounded wait for readiness conditions

      // Current R0 observations:
      const allCases = [...unavailableCases, ...purchaseOptionsCases]
      const avgBrowserTime = allCases.reduce((sum: number, tc: any) =>
        sum + tc.timingsMs.browser, 0) / allCases.length

      // Most cases complete browser phase in 6-9 seconds
      expect(avgBrowserTime).toBeGreaterThan(5000)
      expect(avgBrowserTime).toBeLessThan(12000)

      // None should have excessive retry waits in R0
      for (const testCase of allCases) {
        expect(testCase.timingsMs.retryWait).toBe(0)
      }
    })
  })

  describe('R1-D decision point: should we expand "See All Buying Options"?', () => {
    it('identifies 23 cases that could potentially be recovered', () => {
      // This is a PRODUCT DECISION, not just a technical fix
      expect(purchaseOptionsCases).toHaveLength(23)

      // If we DON'T expand: 86% success rate remains
      // If we DO expand and succeed: up to 97-98% possible (23/29 recovered)
      // If we DO expand and fail: risk of incorrect data or rate limiting
    })

    it('documents the expansion requirements IF we proceed', () => {
      // IF the product decision is to expand options:
      // 1. Must be read-only (no add to cart)
      // 2. Must verify ASIN still matches after expansion
      // 3. Must verify region/currency context unchanged
      // 4. Must handle "no matching seller" case
      // 5. Must respect Amazon's rate limits

      // For now, this is a placeholder for controlled experiments
      expect(purchaseOptionsCases.length).toBe(23)
    })

    it('suggests a 3-case pilot experiment', () => {
      // Recommendation: pick 3 diverse cases for controlled experiment
      // - Different product categories (electronics, clothing, food)
      // - Verify: can we find matching ASIN quote after expansion?
      // - Verify: does it trigger additional checks/rate limits?

      const sampleIndices = [14, 25, 31] // From different cohort indices
      const samples = purchaseOptionsCases.filter((tc: any) =>
        sampleIndices.includes(tc.index)
      )

      expect(samples.length).toBeGreaterThanOrEqual(2) // Should find at least 2
    })
  })
})

/**
 * R1-C Implementation Plan:
 *
 * 1. Create QuoteState enum:
 *    enum QuoteState {
 *      Present = 'present',
 *      AbsentObserved = 'absent_observed',
 *      Unobserved = 'unobserved',
 *      Conflicting = 'conflicting'
 *    }
 *
 * 2. Enhance readiness detection:
 *    - Don't just wait for DOM length stability
 *    - Check for explicit signals:
 *      - Buy box loaded (#buybox present)
 *      - Price area ready or unavailability shown
 *      - "See All Buying Options" appears (if applicable)
 *    - Bounded wait: max 10-12 seconds, not infinite
 *
 * 3. Update amazonPrices() extraction:
 *    - Return { state: QuoteState, prices: ProductPrice[], evidence: string[] }
 *    - Separate "didn't find" from "found unavailable signal"
 *
 * 4. Offline replay validation:
 *    - Test on all 29 HTML files when available
 *    - Verify classification matches expected state
 *    - Ensure no false "absent_observed" on pages we just didn't wait for
 *
 * 5. Diagnostic output:
 *    - For absent_observed: show unavailability selector + text
 *    - For unobserved: show what we checked + suggest next steps
 *    - For present: show price selector + verification chain
 */
